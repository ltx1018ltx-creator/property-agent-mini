"""Content-addressed image storage and resumable legacy image migration."""
import base64
import gzip
import hashlib
import json
import logging
import re
from urllib.error import HTTPError
from urllib.parse import quote
from urllib.request import Request, urlopen

BACKUPS = 'listing-image-backups'
MAX_IMAGE = 2 * 1024 * 1024
LOG = logging.getLogger('listing.media')


def decode_image(value):
    match = re.fullmatch(r'data:image/(jpeg|jpg|png|webp);base64,([A-Za-z0-9+/\r\n]+={0,2})', value)
    if not match:
        raise ValueError('unsupported_image')
    data = base64.b64decode(match[2], validate=True)
    kind = 'jpeg' if match[1] == 'jpg' else match[1]
    if not data or len(data) > MAX_IMAGE:
        raise ValueError('image_size')
    valid = (kind == 'jpeg' and data.startswith(b'\xff\xd8\xff') or
             kind == 'png' and data.startswith(b'\x89PNG\r\n\x1a\n') or
             kind == 'webp' and data[:4] == b'RIFF' and data[8:12] == b'WEBP')
    if not valid:
        raise ValueError('invalid_image')
    return data, kind


class MediaStore:
    def __init__(self, url, key, request):
        self.url, self.key, self.request = url, key, request
        self.verified_images = {}

    def upload(self, bucket, path, data, mime, public=False):
        endpoint = self.url + '/storage/v1/object/' + bucket + '/' + quote(path, safe='/')
        headers = {'apikey': self.key, 'Authorization': 'Bearer ' + self.key,
                   'Content-Type': mime, 'Cache-Control': 'max-age=31536000' if public else 'no-store',
                   'x-upsert': 'false'}
        try:
            with urlopen(Request(endpoint, data=data, headers=headers, method='POST'), timeout=30) as response:
                response.read(4096)
        except HTTPError as error:
            # Storage may use 400 or 409 for a duplicate object. Never trust
            # that response alone: compare the stored bytes before using it.
            if error.code not in (400, 409):
                raise
        verify_url = (self.url + '/storage/v1/object/public/' + bucket + '/' + quote(path, safe='/')) if public else endpoint
        verify_headers = {} if public else {'apikey': self.key, 'Authorization': 'Bearer ' + self.key}
        with urlopen(Request(verify_url, headers=verify_headers), timeout=30) as response:
            verified = response.read(len(data) + 1)
        if hashlib.sha256(verified).digest() != hashlib.sha256(data).digest():
            raise ValueError('stored_image_mismatch')
        return self.url + '/storage/v1/object/public/' + bucket + '/' + quote(path, safe='/')

    def image(self, value, owner):
        if not isinstance(value, str) or not value.startswith('data:image/'):
            return value
        data, kind = decode_image(value)
        digest = hashlib.sha256(data).hexdigest()
        cache_key = (owner, digest)
        if cache_key not in self.verified_images:
            self.verified_images[cache_key] = self.upload('listing-images', 'optimized/' + owner + '/' + digest + '.' + kind,
                                                         data, 'image/' + kind, public=True)
        return self.verified_images[cache_key]

    def convert(self, value, owner):
        if isinstance(value, list):
            return [self.convert(v, owner) for v in value]
        if not isinstance(value, dict):
            return value
        updated = dict(value)
        for field in ('photo', 'cover'):
            if field in updated:
                updated[field] = self.image(updated[field], owner)
        if isinstance(updated.get('photos'), list):
            updated['photos'] = [self.image(v, owner) for v in updated['photos']]
        if isinstance(updated.get('listings'), list):
            updated['listings'] = self.convert(updated['listings'], owner)
        return updated

    def photos(self, values, owner):
        if not isinstance(values, list) or len(values) > 10:
            raise ValueError('invalid_photos')
        # Validate the entire batch before uploading any images.
        for value in values:
            if not isinstance(value, str):
                raise ValueError('invalid_photo')
            if value.startswith('data:image/'):
                decode_image(value)
            elif not value.startswith(self.url + '/storage/v1/object/public/listing-images/'):
                raise ValueError('invalid_photo_url')
        return [self.image(value, owner) for value in values]

    def migrate(self):
        """Back up each source, verify uploads, then compare-and-swap one row.

        A failure leaves the original row untouched. Content hashes make retries
        idempotent. Backups are private and never served by application routes.
        """
        existing = self.request('/storage/v1/bucket')
        backup = next((b for b in existing if b.get('id') == BACKUPS), None)
        if backup is None:
            self.request('/storage/v1/bucket', 'POST', {'id': BACKUPS, 'name': BACKUPS, 'public': False})
        elif backup.get('public') is not False:
            raise ValueError('backup_bucket_not_private')
        results = {}
        for table, field in (('team_listings', 'listing'), ('public_shares', 'payload')):
            results[table] = self.migrate_table(table, field)
        LOG.warning('Image migration complete: %s', json.dumps(results))
        return results

    def migrate_table(self, table, field):
        changed = skipped = failed = 0
        last = None
        while True:
            path = '/rest/v1/' + table + '?select=id&order=id.asc&limit=100'
            if last:
                path += '&id=gt.' + quote(last, safe='')
            batch = self.request(path)
            if not batch:
                break
            for item in batch:
                try:
                    rows = self.request('/rest/v1/' + table + '?id=eq.' + item['id'] + '&select=id,owner_id,' + field)
                    if not rows:
                        continue
                    row = rows[0]
                    listing = row[field]
                    # Only these public-photo fields are migrated; all other
                    # listing fields remain byte-for-byte equivalent JSON values.
                    if 'data:image/' not in json.dumps(listing):
                        continue
                    original = json.dumps(row, sort_keys=True, separators=(',', ':')).encode()
                    digest = hashlib.sha256(original).hexdigest()
                    self.upload(BACKUPS, table + '/' + row['id'] + '/' + digest + '.json.gz',
                                gzip.compress(original, mtime=0), 'application/gzip')
                    updated = self.convert(listing, row['owner_id'])
                    result = self.request('/rest/v1/rpc/replace_embedded_listing_images', 'POST',
                                          {'source_table': table, 'record_id': row['id'], 'expected': listing, 'replacement': updated})
                    if result:
                        changed += 1
                    else:
                        skipped += 1
                except Exception as error:
                    failed += 1
                    LOG.warning('Image migration row failed: exception_class=%s', type(error).__name__)
            last = batch[-1]['id']
        LOG.warning('Image migration finished: changed=%s concurrent_skipped=%s failed=%s', changed, skipped, failed)
        return {'changed': changed, 'concurrent_skipped': skipped, 'failed': failed}
