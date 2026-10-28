import base64
import copy
import gzip
import json
import unittest
from unittest.mock import Mock, patch
from urllib.error import HTTPError

import listing_media

URL = 'https://example.supabase.co'
OWNER = '11111111-1111-4111-8111-111111111111'
ID = '22222222-2222-4222-8222-222222222222'
IMAGE = 'data:image/jpeg;base64,' + base64.b64encode(b'\xff\xd8\xffexample-image').decode()


class MediaTests(unittest.TestCase):
    def test_bad_formats_sizes_and_magic_are_rejected_before_any_upload(self):
        store = listing_media.MediaStore(URL, 'not-a-real-key', Mock())
        with patch.object(store, 'upload') as upload:
            for bad in ['data:image/svg+xml;base64,AAAA', 'data:image/jpeg;base64,AAAA',
                        'https://elsewhere.invalid/a.jpg', 5]:
                with self.subTest(bad=bad), self.assertRaises(ValueError):
                    store.photos([IMAGE, bad], OWNER)
            upload.assert_not_called()

    def test_photos_preserve_order_and_content_address_paths(self):
        store = listing_media.MediaStore(URL, 'not-a-real-key', Mock())
        existing = URL + '/storage/v1/object/public/listing-images/old.jpg'
        with patch.object(store, 'upload', return_value='stored') as upload:
            self.assertEqual(store.photos([IMAGE, existing, IMAGE], OWNER), ['stored', existing, 'stored'])
        self.assertEqual(upload.call_count, 1)
        self.assertTrue(upload.call_args.args[1].startswith('optimized/' + OWNER + '/'))
        self.assertEqual(upload.call_args.args[2], b'\xff\xd8\xffexample-image')

    def migration(self, conflict=False, upload_failure=False, public_backup=False):
        original = {'id': ID, 'owner_id': OWNER, 'updated_at': '2026-10-28T00:00:00+00:00',
                    'listing': {'photos': [IMAGE], 'photo': IMAGE, 'price': 300000,
                                'rawText': 'must survive unchanged', 'bedrooms': 3}}
        source = copy.deepcopy(original)
        writes = []
        batches = iter([[{'id': ID}], []])
        def request(path, method='GET', payload=None, **kwargs):
            if path == '/storage/v1/bucket':
                return [{'id': listing_media.BACKUPS, 'public': public_backup}]
            if path == '/rest/v1/rpc/replace_embedded_listing_images':
                writes.append((path, payload))
                return not conflict
            if '/public_shares?' in path:
                return []
            if 'select=id&' in path:
                return next(batches)
            return [source]
        store = listing_media.MediaStore(URL, 'not-a-real-key', request)
        uploads = []
        def upload(bucket, path, data, mime, public=False):
            uploads.append((bucket, data, public))
            if public and upload_failure:
                raise OSError('simulated failure')
            return URL + '/storage/v1/object/public/listing-images/image.jpeg'
        return original, store, uploads, writes, upload

    def test_migration_backs_up_original_and_preserves_non_photo_data(self):
        original, store, uploads, writes, upload = self.migration()
        with patch.object(store, 'upload', side_effect=upload):
            self.assertEqual(store.migrate()['team_listings']['changed'], 1)
        self.assertEqual(json.loads(gzip.decompress(uploads[0][1])), original)
        self.assertFalse(uploads[0][2])
        self.assertEqual(writes[0][1]['expected'], original['listing'])
        value = writes[0][1]['replacement']
        self.assertEqual(value['price'], original['listing']['price'])
        self.assertEqual(value['rawText'], original['listing']['rawText'])
        self.assertEqual(len(value['photos']), 1)
        self.assertTrue(value['photo'].startswith('https://'))

    def test_failed_photo_upload_does_not_update_original_row(self):
        _, store, _, writes, upload = self.migration(upload_failure=True)
        with patch.object(store, 'upload', side_effect=upload):
            self.assertEqual(store.migrate()['team_listings']['failed'], 1)
        self.assertEqual(writes, [])

    def test_concurrent_edit_is_skipped(self):
        _, store, _, _, upload = self.migration(conflict=True)
        with patch.object(store, 'upload', side_effect=upload):
            result = store.migrate()['team_listings']
        self.assertEqual(result['changed'], 0)
        self.assertEqual(result['concurrent_skipped'], 1)

    def test_public_backup_bucket_fails_closed(self):
        _, store, uploads, writes, upload = self.migration(public_backup=True)
        with patch.object(store, 'upload', side_effect=upload), self.assertRaises(ValueError):
            store.migrate()
        self.assertFalse(uploads or writes)

    def test_nested_share_preserves_collection_fields_and_order(self):
        store = listing_media.MediaStore(URL, 'not-a-real-key', Mock())
        payload = {'collection': True, 'clientName': 'preserved',
                   'listings': [{'id': 'first', 'photos': [IMAGE]}, {'id': 'second', 'photo': IMAGE}]}
        with patch.object(store, 'upload', return_value='stored'):
            result = store.convert(payload, OWNER)
        self.assertEqual([x['id'] for x in result['listings']], ['first', 'second'])
        self.assertEqual(result['listings'][0]['photos'], ['stored'])
        self.assertEqual(result['listings'][1]['photo'], 'stored')
        self.assertEqual(result['clientName'], 'preserved')
        self.assertEqual(payload['listings'][0]['photos'], [IMAGE])

    def test_upload_verifies_stored_bytes_including_duplicate_conflicts(self):
        store = listing_media.MediaStore(URL, 'not-a-real-key', Mock())
        verified = Mock()
        verified.__enter__ = Mock(return_value=verified)
        verified.__exit__ = Mock(return_value=False)
        verified.read.return_value = b'wrong-image'
        conflict = HTTPError(URL, 409, 'duplicate', {}, None)
        with patch.object(listing_media, 'urlopen', side_effect=[conflict, verified]), self.assertRaises(ValueError):
            store.upload('listing-images', 'test.jpeg', b'expected-image', 'image/jpeg', public=True)


if __name__ == '__main__':
    unittest.main()
