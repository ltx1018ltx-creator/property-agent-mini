import http.client
import json
import logging
import threading
import unittest
from http.server import ThreadingHTTPServer
from io import BytesIO
from pathlib import Path
from unittest.mock import patch
from urllib.error import HTTPError

import server

DID='22222222-2222-4222-8222-222222222222'
SID='11111111-1111-4111-8111-111111111111'
UID='33333333-3333-4333-8333-333333333333'
LID='44444444-4444-4444-8444-444444444444'

class PublishListingTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.httpd=ThreadingHTTPServer(('127.0.0.1',0),server.Handler)
        cls.thread=threading.Thread(target=cls.httpd.serve_forever,daemon=True);cls.thread.start()
        cls.port=cls.httpd.server_address[1]
    @classmethod
    def tearDownClass(cls):cls.httpd.shutdown();cls.httpd.server_close();cls.thread.join()
    def request(self):
        connection=http.client.HTTPConnection('127.0.0.1',self.port,timeout=2)
        connection.request('POST',f'/api/admin/listing-submission-drafts/{DID}/publish',b'{}',
                           {'Authorization':'Bearer admin-jwt','Content-Type':'application/json'})
        response=connection.getresponse();result=response.status,json.loads(response.read());connection.close();return result
    @staticmethod
    def draft(**changes):
        row={'id':DID,'listing_submission_id':SID,'structured_data':{'location':'Melaka','propertyType':'Terrace','price':500000},
             'marketing_copy':'Approved copy','status':'approved','published_listing_id':None,'published_at':None}
        row.update(changes);return row
    def test_admin_authorization_required(self):
        with patch.object(server,'require_admin',return_value=(False,403)):
            self.assertEqual(self.request()[0],403)
    def test_approval_is_required_before_images_or_insert(self):
        with patch.object(server,'require_admin',return_value=(True,200)), \
             patch.object(server,'_supabase_request',return_value=[self.draft(status='needs_review')]), \
             patch.object(server,'_copy_submission_images') as copy:
            status,body=self.request()
        self.assertEqual((status,body['code']),(409,'draft_not_approved'));copy.assert_not_called()
    def test_allow_list_mapping_and_marketing_copy(self):
        listing=server._listing_from_draft({'location':'Melaka','propertyType':'Terrace','price':500000,
            'missingFields':['bedrooms'],'attacker':'no'},'中文广告',['https://public/image.jpg'])
        self.assertEqual(listing['rawText'],'location: Melaka\npropertyType: Terrace\nprice: 500000\n中文广告')
        self.assertEqual(listing['photos'],['https://public/image.jpg'])
        self.assertNotIn('attacker',listing);self.assertNotIn('missingFields',listing)
    def test_original_message_and_identifiers_never_enter_listing(self):
        private='PRIVATE ORIGINAL MESSAGE +60 12-345 6789 whatsapp-ingestion/submission/private-object'
        listing=server._listing_from_draft({'location':'Melaka','propertyType':'Terrace',
            'originalWhatsAppText':private,'senderId':'60123456789','metaMessageId':'wamid.secret'},
            'Approved public copy',[])
        self.assertNotIn('PRIVATE ORIGINAL MESSAGE',json.dumps(listing))
        self.assertNotIn('whatsapp-ingestion',json.dumps(listing))
        self.assertNotIn('12-345 6789',json.dumps(listing))
        for value in ('Call +60 12-345 6789','wamid.ABCDEF','whatsapp-ingestion/private/path',
                      '11111111-1111-4111-8111-111111111111'):
            with self.subTest(value=value),self.assertRaises(ValueError):
                server._listing_from_draft({'location':'Melaka'},value,[])
    def test_invalid_field_type_is_rejected(self):
        with self.assertRaises(ValueError):server._listing_from_draft({'price':'not numeric'},'',[])
    def test_success_copies_images_and_publishes_once(self):
        calls=[]
        def db(path,method='GET',payload=None,**kwargs):
            calls.append((path,payload))
            if path.startswith('/rest/v1/listing_submission_drafts'):return [self.draft()]
            if path=='/auth/v1/user':return {'id':UID}
            if 'publish_approved_listing' in path:return {'listing_id':LID,'published_at':'now','duplicate':False}
            raise AssertionError(path)
        with patch.object(server,'require_admin',return_value=(True,200)),patch.object(server,'_supabase_request',side_effect=db), \
             patch.object(server,'_copy_submission_images',return_value=['https://public/image.jpg']) as copy:
            status,body=self.request()
        self.assertEqual(status,200);self.assertEqual(body['listing_id'],LID)
        copy.assert_called_once_with(SID,DID)
        payload=[p for path,p in calls if 'publish_approved_listing' in path][0]
        self.assertEqual(payload['clean_listing']['photos'],['https://public/image.jpg'])
    def test_duplicate_click_returns_existing_without_copy(self):
        with patch.object(server,'require_admin',return_value=(True,200)), \
             patch.object(server,'_supabase_request',return_value=[self.draft(published_listing_id=LID,published_at='then')]), \
             patch.object(server,'_copy_submission_images') as copy:
            status,body=self.request()
        self.assertEqual(status,200);self.assertTrue(body['duplicate']);copy.assert_not_called()
    def test_partial_image_failure_preserves_approved_draft(self):
        with patch.object(server,'require_admin',return_value=(True,200)), \
             patch.object(server,'_supabase_request',side_effect=([self.draft()],{'id':UID})), \
             patch.object(server,'_copy_submission_images',side_effect=OSError('storage unavailable')):
            status,body=self.request()
        self.assertEqual((status,body['code']),(503,'publish_failed'))

    def test_publish_http_error_logs_sanitized_postgrest_diagnostics(self):
        secret='service-role-secret'
        clean_value='Approved copy'
        response=json.dumps({'code':'23505','message':f'duplicate {clean_value} phone +60123456789',
            'details':f'Authorization: Bearer {secret}',
            'hint':'See https://private.example/rest/v1 and wamid.SECRET_MESSAGE'}).encode()
        error=HTTPError('https://private.example/rest/v1/rpc/publish_approved_listing',409,
                        'private reason',{},BytesIO(response))
        def db(path,method='GET',payload=None,**kwargs):
            if path.startswith('/rest/v1/listing_submission_drafts'):return [self.draft()]
            if path=='/auth/v1/user':return {'id':UID}
            raise error
        with patch.object(server,'SUPABASE_SERVICE_ROLE_KEY',secret), \
             patch.object(server,'require_admin',return_value=(True,200)), \
             patch.object(server,'_supabase_request',side_effect=db), \
             patch.object(server,'_copy_submission_images',return_value=[]), \
             self.assertLogs('ai.drafts',logging.ERROR) as logs:
            status,body=self.request()
        output=' '.join(logs.output)
        self.assertEqual((status,body['code']),(503,'publish_failed'))
        self.assertIn('status=409 code=23505',output)
        self.assertIn('operation=publish_approved_listing',output)
        self.assertIn('message=duplicate <redacted> phone <redacted-phone>',output)
        self.assertIn('details=Authorization=<redacted>',output)
        for sensitive in (secret,clean_value,'60123456789','private.example','wamid.SECRET_MESSAGE','private reason'):
            self.assertNotIn(sensitive,output)

    def test_copy_http_error_redacts_private_storage_and_meta_identifiers(self):
        response=json.dumps({'code':'PGRST116','message':'copy failed',
            'details':'whatsapp-ingestion/submission/private-object',
            'hint':'meta_media_id=123456789012345'}).encode()
        error=HTTPError('https://private.example/storage/private-object',404,'private reason',{},BytesIO(response))
        with patch.object(server,'require_admin',return_value=(True,200)), \
             patch.object(server,'_supabase_request',side_effect=([self.draft()],{'id':UID})), \
             patch.object(server,'_copy_submission_images',side_effect=error), \
             self.assertLogs('ai.drafts',logging.ERROR) as logs:
            status,body=self.request()
        output=' '.join(logs.output)
        self.assertEqual((status,body['code']),(503,'publish_failed'))
        self.assertIn('status=404 code=PGRST116 message=copy failed',output)
        self.assertIn('operation=copy_listing_image',output)
        self.assertIn('details=<redacted-storage-path>',output)
        self.assertIn('hint=<redacted-meta-id>',output)
        for sensitive in ('private-object','123456789012345','private.example','private reason'):
            self.assertNotIn(sensitive,output)
    def test_migration_has_atomic_idempotency_and_private_source(self):
        sql=(Path(server.__file__).parent/'supabase/migrations/202609170001_publish_approved_listings.sql').read_text()
        self.assertIn('for update',sql);self.assertIn("draft.status<>'approved'",sql)
        self.assertIn('published_listing_id',sql);self.assertIn("values ('listing-images','listing-images',true)",sql)
        phase2=(Path(server.__file__).parent/'supabase/migrations/202609140002_whatsapp_media_ingestion.sql').read_text()
        self.assertIn("values ('whatsapp-ingestion', 'whatsapp-ingestion', false)",phase2)
    def test_service_role_team_listings_permissions_migration(self):
        sql=(Path(server.__file__).parent/'supabase/migrations/202609170002_grant_team_listings_service_role.sql').read_text()
        normalized=' '.join(sql.lower().split())
        self.assertIn('grant select, insert on table public.team_listings to service_role;',normalized)
        self.assertIn("notify pgrst, 'reload schema';",normalized)
        self.assertNotIn(' to anon',normalized)
        self.assertNotIn(' to authenticated',normalized)
        for operation in ('update','delete','truncate'):
            self.assertNotIn(f'grant {operation}',normalized)
        for statement in ('insert into public.team_listings','update public.team_listings','delete from public.team_listings'):
            self.assertNotIn(statement,normalized)
    def test_listing_images_are_public_read_and_browser_write_denied(self):
        sql=(Path(server.__file__).parent/'supabase/migrations/202609170001_publish_approved_listings.sql').read_text()
        self.assertIn("values ('listing-images','listing-images',true)",sql)
        self.assertIn('for select to anon,authenticated',sql)
        self.assertNotIn('for select to anon,authenticated\n  using (bucket_id<>',sql)
        for operation in ('insert','update','delete'):
            self.assertIn(f'for {operation} to anon,authenticated',sql)
        self.assertGreaterEqual(sql.count("bucket_id<>'listing-images'"),4)
        self.assertIn('service_role bypasses RLS and is the sole writer',sql)

if __name__=='__main__':unittest.main()
