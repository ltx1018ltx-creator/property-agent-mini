import hashlib
import hmac
import http.client
import json
import logging
import os
import threading
import unittest
from io import BytesIO
from pathlib import Path
from unittest.mock import patch
from urllib.error import HTTPError

import server
from http.server import ThreadingHTTPServer


class WebhookTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.httpd=ThreadingHTTPServer(('127.0.0.1',0),server.Handler)
        cls.thread=threading.Thread(target=cls.httpd.serve_forever,daemon=True)
        cls.thread.start()
        cls.port=cls.httpd.server_address[1]

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()
        cls.httpd.server_close()
        cls.thread.join()

    def setUp(self):
        server._webhook_events.clear()
        self.env=patch.dict(os.environ,{'WHATSAPP_VERIFY_TOKEN':'verify-me','META_APP_SECRET':'app-secret',
                                        'WHATSAPP_INGESTION_ENABLED':'false'})
        self.env.start()

    def tearDown(self):
        self.env.stop()

    def request(self,method,path,body=None,headers=None):
        conn=http.client.HTTPConnection('127.0.0.1',self.port,timeout=2)
        conn.request(method,path,body=body,headers=headers or {})
        response=conn.getresponse()
        result=(response.status,response.read(),dict(response.getheaders()))
        conn.close()
        return result

    def signed_post(self,payload,signature_body=None):
        body=json.dumps(payload,separators=(',',':')).encode()
        signed=body if signature_body is None else signature_body
        signature='sha256='+hmac.new(b'app-secret',signed,hashlib.sha256).hexdigest()
        return self.request('POST','/api/whatsapp/webhook',body,{
            'Content-Type':'application/json','X-Hub-Signature-256':signature,
        })

    def test_verification_accepts_matching_token_and_returns_challenge(self):
        status,body,_=self.request('GET','/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=12345')
        self.assertEqual((status,body),(200,b'12345'))

    def test_verification_access_log_omits_query_parameters_and_values(self):
        with patch.object(server.Handler,'log_message') as access_log:
            status,body,_=self.request(
                'GET',
                '/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=secret-challenge',
            )
        self.assertEqual((status,body),(200,b'secret-challenge'))
        output=str(access_log.call_args_list)
        self.assertIn('/api/whatsapp/webhook',output)
        for sensitive in ('hub.mode','hub.verify_token','hub.challenge','verify-me','secret-challenge'):
            self.assertNotIn(sensitive,output)

    def test_verification_rejects_wrong_token(self):
        status,_,_=self.request('GET','/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=12345')
        self.assertEqual(status,403)

    def test_valid_and_invalid_signatures(self):
        payload={'object':'whatsapp_business_account','entry':[]}
        self.assertEqual(self.signed_post(payload)[0],200)
        self.assertEqual(self.signed_post(payload,b'different bytes')[0],401)

    def test_duplicate_payload_is_acknowledged_and_identified(self):
        payload={'object':'whatsapp_business_account','entry':[]}
        first=json.loads(self.signed_post(payload)[1])
        second=json.loads(self.signed_post(payload)[1])
        self.assertFalse(first['duplicate'])
        self.assertTrue(second['duplicate'])

    def test_normal_message_logs_only_safe_redacted_metadata(self):
        payload=self.message_payload({'id':'wamid.abc','from':'60123456789','type':'text','text':{'body':'TOP SECRET'}})
        with self.assertLogs('whatsapp.webhook',logging.INFO) as logs:
            self.assertEqual(self.signed_post(payload)[0],200)
        output=' '.join(logs.output)
        self.assertIn('field=messages classification=messages item_count=1',output)
        self.assertIn('has_id=true skip_reason=ingestion_disabled',output)
        self.assertNotIn('wamid.abc',output)
        self.assertNotIn('60123456789',output)
        self.assertNotIn('TOP SECRET',output)
        self.assertNotIn('15550001111',output)

    def test_business_app_message_echo_is_classified(self):
        payload={'object':'whatsapp_business_account','entry':[{'changes':[{
            'field':'smb_message_echoes','value':{'metadata':{'phone_number_id':'15550001111'},
            'message_echoes':[{'id':'wamid.echo','from':'15550001111','to':'60123456789',
            'type':'image','image':{'id':'media.1','caption':'PRIVATE','data':'NEVER STORE'},
            'timestamp':'1789344000'}]}}]}]}
        with self.assertLogs('whatsapp.webhook',logging.INFO) as logs:
            self.assertEqual(self.signed_post(payload)[0],200)
        output=' '.join(logs.output)
        self.assertIn('field=smb_message_echoes classification=smb_message_echoes item_count=1',output)
        self.assertIn('has_id=true skip_reason=ingestion_disabled',output)
        self.assertNotIn('wamid.echo',output)
        self.assertNotIn('PRIVATE',output)
        self.assertNotIn('NEVER STORE',output)
        self.assertNotIn('60123456789',output)

    def test_disabled_ingestion_makes_no_supabase_request(self):
        payload=self.message_payload({'id':'wamid.off','from':'1','type':'text','text':{'body':'hello'},
                                      'timestamp':'1789344000'})
        with patch.object(server,'urlopen') as urlopen:
            self.assertEqual(self.signed_post(payload)[0],200)
        urlopen.assert_not_called()

    def test_supabase_rpc_request_uses_exact_url_headers_and_postgrest_shape(self):
        message={'meta_message_id':'wamid.request','text':'private message','sender':'private phone'}
        captured=[]
        class Response:
            def __enter__(self):return self
            def __exit__(self,*args):return False
            def read(self):return b'"submission-id"'
        def receive(req,timeout):
            captured.append((req,timeout))
            return Response()
        with patch.object(server,'SUPABASE_URL','https://example.supabase.co///'), \
             patch.object(server,'SUPABASE_SERVICE_ROLE_KEY','service-role-test'), \
             patch.object(server,'urlopen',side_effect=receive):
            server.store_whatsapp_message(message)
        req,timeout=captured[0]
        self.assertEqual(req.full_url,'https://example.supabase.co/rest/v1/rpc/ingest_whatsapp_message')
        self.assertEqual(req.method,'POST')
        self.assertEqual(timeout,20)
        self.assertEqual(req.get_header('Apikey'),'service-role-test')
        self.assertEqual(req.get_header('Authorization'),'Bearer service-role-test')
        self.assertEqual(req.get_header('Content-type'),'application/json')
        self.assertEqual(json.loads(req.data),{'event':message})

    def test_supabase_http_error_logs_only_safe_postgrest_diagnostics(self):
        response=json.dumps({'code':'PGRST202','message':(
            'missing private message 60123456789 at '
            'https://example.supabase.co/rest/v1/rpc/ingest_whatsapp_message token=secret-token'
        ),'details':'raw body detail'}).encode()
        error=HTTPError('https://example.supabase.co/rest/v1/rpc/ingest_whatsapp_message',404,
                        'Not Found',{},BytesIO(response))
        with patch.object(server,'SUPABASE_URL','https://example.supabase.co/'), \
             patch.object(server,'SUPABASE_SERVICE_ROLE_KEY','service-role-secret'), \
             patch.object(server,'urlopen',side_effect=error), \
             self.assertLogs('whatsapp.webhook',logging.ERROR) as logs:
            with self.assertRaises(HTTPError):
                server.store_whatsapp_message({'text':'private message','sender':'60123456789'})
        output=' '.join(logs.output)
        self.assertIn('status=404 code=PGRST202 message=missing <redacted>',output)
        self.assertIn('operation=store_whatsapp_message',output)
        for sensitive in ('private message','60123456789','example.supabase.co','secret-token',
                          'service-role-secret','raw body detail'):
            self.assertNotIn(sensitive,output)

    def test_ingestion_http_failure_has_safe_category_class_and_postgrest_fields(self):
        payload=self.fixture('smb_message_echoes_text.json')
        response=json.dumps({'code':'PGRST202','message':'private echo text'}).encode()
        error=HTTPError('https://private.example/rpc',404,'private reason',{},BytesIO(response))
        with patch.dict(os.environ,{'WHATSAPP_INGESTION_ENABLED':'true'}), \
             patch.object(server,'SUPABASE_SERVICE_ROLE_KEY','service-role-test'), \
             patch.object(server,'urlopen',side_effect=error), \
             self.assertLogs('whatsapp.webhook',logging.ERROR) as logs:
            self.assertEqual(self.signed_post(payload)[0],503)
        output=' '.join(logs.output)
        self.assertIn('skip_reason=ingestion_failed failure_category=postgrest_http_error',output)
        self.assertIn('exception_class=HTTPError operation=store_whatsapp_message',output)
        self.assertIn('status=404 code=PGRST202',output)
        for sensitive in ('private echo text','wamid.ECHO_TEXT','Three-bedroom condo',
                          '60123456789','private.example','service-role-test','private reason'):
            self.assertNotIn(sensitive,output)

    def test_ingestion_non_http_failure_logs_only_safe_fixed_diagnostics(self):
        payload=self.fixture('smb_message_echoes_text.json')
        exception=RuntimeError('private echo text https://private.example 60123456789')
        with patch.dict(os.environ,{'WHATSAPP_INGESTION_ENABLED':'true'}), \
             patch.object(server,'store_whatsapp_message',side_effect=exception), \
             self.assertLogs('whatsapp.webhook',logging.ERROR) as logs:
            self.assertEqual(self.signed_post(payload)[0],503)
        output=' '.join(logs.output)
        self.assertIn('failure_category=unexpected_exception exception_class=RuntimeError',output)
        self.assertIn('operation=store_whatsapp_message',output)
        for sensitive in ('private echo text','private.example','60123456789','wamid.ECHO_TEXT'):
            self.assertNotIn(sensitive,output)

    def test_success_log_has_only_safe_aggregate_counts(self):
        payload=self.fixture('smb_message_echoes_images.json')
        with patch.dict(os.environ,{'WHATSAPP_INGESTION_ENABLED':'true'}), \
             patch.object(server,'SUPABASE_SERVICE_ROLE_KEY','service-role-test'), \
             patch.object(server,'urlopen') as urlopen, \
             self.assertLogs('whatsapp.webhook',logging.INFO) as logs:
            urlopen.return_value.__enter__.return_value.read.return_value=b'null'
            self.assertEqual(self.signed_post(payload)[0],200)
        success=[line for line in logs.output if 'ingestion succeeded:' in line]
        self.assertEqual(len(success),1)
        self.assertIn('classification=smb_message_echoes item_count=2 stored_count=2 skipped_count=0',success[0])
        for sensitive in ('wamid.ECHO_IMAGE_ONE','Living room','MEDIA_ID_ONE','15550001111',
                          'example.supabase.co','service-role-test'):
            self.assertNotIn(sensitive,' '.join(success))

    def test_real_smb_echo_fixtures_each_call_rpc_and_allow_list_content(self):
        text_payload=self.fixture('smb_message_echoes_text.json')
        image_payload=self.fixture('smb_message_echoes_images.json')
        captured=[]
        class Response:
            def __enter__(self):return self
            def __exit__(self,*args):return False
            def read(self):return b'"submission-id"'
        def receive(req,timeout):
            captured.append(json.loads(req.data)['event'])
            self.assertIn('/rpc/ingest_whatsapp_message',req.full_url)
            self.assertEqual(req.headers['Authorization'],'Bearer service-role-test')
            return Response()
        with patch.dict(os.environ,{'WHATSAPP_INGESTION_ENABLED':'true'}), \
             patch.object(server,'SUPABASE_SERVICE_ROLE_KEY','service-role-test'), \
             patch.object(server,'urlopen',side_effect=receive):
            self.assertEqual(self.signed_post(text_payload)[0],200)
            self.assertEqual(self.signed_post(image_payload)[0],200)
        self.assertEqual([e['meta_message_id'] for e in captured],
                         ['wamid.ECHO_TEXT','wamid.ECHO_IMAGE_ONE','wamid.ECHO_IMAGE_TWO'])
        self.assertEqual(captured[0]['text'],'Three-bedroom condo near town')
        self.assertEqual((captured[1]['text'],captured[1]['meta_media_id']),('Living room','MEDIA_ID_ONE'))
        self.assertEqual(captured[2]['meta_media_id'],'MEDIA_ID_TWO')
        self.assertTrue(all(e['event_type']=='smb_message_echoes' for e in captured))
        self.assertTrue(all(e['timestamp'] for e in captured))
        self.assertTrue(all(e['sender'] and e['recipient'] for e in captured))
        serialized=json.dumps(captured)
        self.assertNotIn('sha256',serialized)
        self.assertNotIn('secret',serialized)
        self.assertNotIn('15550001111',serialized)
        self.assertNotIn('60123',serialized)

    def test_multi_item_echo_logs_structure_without_any_payload_values(self):
        payload=self.fixture('smb_message_echoes_images.json')
        with self.assertLogs('whatsapp.webhook',logging.INFO) as logs:
            self.assertEqual(self.signed_post(payload)[0],200)
        output=' '.join(logs.output)
        self.assertIn('field=smb_message_echoes classification=smb_message_echoes item_count=2',output)
        self.assertEqual(output.count('has_id=true'),2)
        for value in ('wamid.ECHO_IMAGE_ONE','wamid.ECHO_IMAGE_TWO','Living room',
                      'MEDIA_ID_ONE','MEDIA_ID_TWO','15550001111','BUSINESS_PHONE_NUMBER_ID'):
            self.assertNotIn(value,output)

    def test_missing_echo_id_is_logged_structurally_and_not_ingested(self):
        payload=self.fixture('smb_message_echoes_text.json')
        del payload['entry'][0]['changes'][0]['value']['message_echoes'][0]['id']
        with patch.dict(os.environ,{'WHATSAPP_INGESTION_ENABLED':'true'}), \
             patch.object(server,'urlopen') as urlopen, \
             self.assertLogs('whatsapp.webhook',logging.INFO) as logs:
            self.assertEqual(self.signed_post(payload)[0],200)
        urlopen.assert_not_called()
        self.assertIn('has_id=false skip_reason=missing_message_id',' '.join(logs.output))

    def test_database_migration_deduplicates_and_batches_for_60_seconds(self):
        sql=(Path(__file__).parents[1]/'supabase/migrations/202609140001_whatsapp_ingestion_phase1.sql').read_text()
        self.assertIn('meta_message_id text not null unique',sql)
        self.assertIn("interval '60 seconds'",sql)
        self.assertIn('pg_advisory_xact_lock',sql)
        self.assertIn('pg_advisory_xact_lock((hashtextextended(',sql)
        self.assertIn('on conflict (meta_message_id) do nothing',sql)
        self.assertIn('enable row level security',sql)
        self.assertIn('force row level security',sql)
        self.assertNotIn('team_listings',sql)

    def test_database_migration_preserves_confirmed_permissions_and_reload_fixes(self):
        sql=(Path(__file__).parents[1]/'supabase/migrations/202609140001_whatsapp_ingestion_phase1.sql').read_text()
        self.assertIn("""(event->>'sender') || '|' ||
    (event->>'recipient') || '|' ||
    (event->>'event_type')""",sql)
        self.assertIn(
            'grant select, insert, update on public.listing_submissions to service_role;',sql)
        self.assertIn(
            'grant select, insert on public.listing_submission_messages to service_role;',sql)
        self.assertIn(
            'grant usage, select on sequence public.listing_submission_messages_id_seq to service_role;',sql)
        self.assertIn(
            'grant execute on function public.ingest_whatsapp_message(jsonb) to service_role;',sql)
        self.assertIn(
            'revoke all on public.listing_submissions from anon, authenticated;',sql)
        self.assertIn(
            'revoke all on public.listing_submission_messages from anon, authenticated;',sql)
        self.assertIn(
            'revoke all on sequence public.listing_submission_messages_id_seq from anon, authenticated;',sql)
        self.assertIn(
            'revoke all on function public.ingest_whatsapp_message(jsonb) from public, anon, authenticated;',sql)
        self.assertIn("notify pgrst, 'reload schema';",sql)

    @staticmethod
    def message_payload(message):
        return {'object':'whatsapp_business_account','entry':[{'changes':[{'field':'messages','value':{
            'metadata':{'phone_number_id':'15550001111'},'messages':[message]
        }}]}]}

    @staticmethod
    def fixture(name):
        path=Path(__file__).parent/'fixtures'/name
        return json.loads(path.read_text())


if __name__=='__main__':
    unittest.main()
