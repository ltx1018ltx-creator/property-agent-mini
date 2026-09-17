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
from urllib.request import Request

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

    def test_conversation_allowlist_accepts_pair_in_both_directions_and_event_types(self):
        sender,recipient='60123456789','15550001111'
        allowed=self.conversation_key(sender,recipient)
        inbound=self.message_payload({'id':'wamid.in','from':sender,'to':recipient,'type':'text',
                                      'text':{'body':'hello'},'timestamp':'1789344000'})
        echo={'object':'whatsapp_business_account','entry':[{'changes':[{
            'field':'smb_message_echoes','value':{'metadata':{'phone_number_id':recipient},
            'message_echoes':[{'id':'wamid.out','from':recipient,'to':sender,'type':'text',
                               'text':{'body':'hello'},'timestamp':'1789344001'}]}}]}]}
        stored=[]
        with patch.dict(os.environ,{'WHATSAPP_INGESTION_ENABLED':'true',
                                    'WHATSAPP_ALLOWED_CONVERSATION_KEY':allowed}), \
             patch.object(server,'store_whatsapp_message',side_effect=stored.append), \
             patch.object(server,'ingest_whatsapp_image') as media:
            self.assertEqual(self.signed_post(inbound)[0],200)
            self.assertEqual(self.signed_post(echo)[0],200)
        self.assertEqual([item['event_type'] for item in stored],['messages','smb_message_echoes'])
        self.assertEqual(media.call_count,2)

    def test_conversation_allowlist_rejects_other_pair_without_writes_or_media(self):
        payload=self.message_payload({'id':'wamid.rejected','from':'60123456789','to':'15550001111',
                                      'type':'image','image':{'id':'MEDIA-PRIVATE'},
                                      'timestamp':'1789344000'})
        allowed=self.conversation_key('different-owner','different-business')
        with patch.dict(os.environ,{'WHATSAPP_INGESTION_ENABLED':'true',
                                    'WHATSAPP_ALLOWED_CONVERSATION_KEY':allowed}), \
             patch.object(server,'store_whatsapp_message') as store, \
             patch.object(server,'ingest_whatsapp_image') as media, \
             self.assertLogs('whatsapp.webhook',logging.INFO) as logs:
            self.assertEqual(self.signed_post(payload)[0],200)
        store.assert_not_called();media.assert_not_called()
        self.assertIn('WhatsApp webhook item skipped: reason=conversation_not_allowed',' '.join(logs.output))

    def test_malformed_conversation_allowlist_fails_closed(self):
        payload=self.message_payload({'id':'wamid.bad-config','from':'1','to':'2','type':'text',
                                      'text':{'body':'hello'},'timestamp':'1789344000'})
        for malformed in ('', 'A'*64, 'a'*63, 'g'*64, ' '+('a'*64)):
            with self.subTest(malformed=malformed), \
                 patch.dict(os.environ,{'WHATSAPP_INGESTION_ENABLED':'true',
                                        'WHATSAPP_ALLOWED_CONVERSATION_KEY':malformed}), \
                 patch.object(server,'store_whatsapp_message') as store, \
                 patch.object(server,'ingest_whatsapp_image') as media:
                self.assertEqual(self.signed_post(payload)[0],200)
                store.assert_not_called();media.assert_not_called()

    def test_absent_conversation_allowlist_preserves_ingestion(self):
        payload=self.message_payload({'id':'wamid.compat','from':'1','to':'2','type':'text',
                                      'text':{'body':'hello'},'timestamp':'1789344000'})
        with patch.dict(os.environ,{'WHATSAPP_INGESTION_ENABLED':'true'}), \
             patch.object(server,'store_whatsapp_message') as store, \
             patch.object(server,'ingest_whatsapp_image'):
            os.environ.pop('WHATSAPP_ALLOWED_CONVERSATION_KEY',None)
            self.assertEqual(self.signed_post(payload)[0],200)
        store.assert_called_once()

    def test_rejected_conversation_webhook_retries_never_write_or_download(self):
        payload=self.message_payload({'id':'wamid.retry','from':'1','to':'2','type':'image',
                                      'image':{'id':'MEDIA-PRIVATE'},'timestamp':'1789344000'})
        with patch.dict(os.environ,{'WHATSAPP_INGESTION_ENABLED':'true',
                                    'WHATSAPP_ALLOWED_CONVERSATION_KEY':'0'*64}), \
             patch.object(server,'store_whatsapp_message') as store, \
             patch.object(server,'ingest_whatsapp_image') as media, \
             patch.object(server,'open_meta_media') as download:
            first=json.loads(self.signed_post(payload)[1])
            retry=json.loads(self.signed_post(payload)[1])
        self.assertFalse(first['duplicate']);self.assertTrue(retry['duplicate'])
        store.assert_not_called();media.assert_not_called();download.assert_not_called()

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

    def test_media_feature_flag_requires_exact_true(self):
        for value in ('', 'false', 'TRUE', '1', ' true'):
            with patch.dict(os.environ,{'WHATSAPP_MEDIA_INGESTION_ENABLED':value}):
                self.assertFalse(server.media_ingestion_enabled())
        with patch.dict(os.environ,{'WHATSAPP_MEDIA_INGESTION_ENABLED':'true'}):
            self.assertTrue(server.media_ingestion_enabled())

    def test_successful_image_is_downloaded_and_stored_privately(self):
        metadata={'url':'https://lookaside.fbsbx.com/private-signed-url','mime_type':'image/jpeg','file_size':4}
        responses=[MediaResponse(json.dumps(metadata).encode(),{'Content-Type':'application/json'}),
                   MediaResponse(b'\xff\xd8\xff\xe0',{'Content-Type':'image/jpeg','Content-Length':'4'})]
        rpc_calls=[]
        def rpc(name,payload):
            rpc_calls.append((name,payload))
            return [{'claimed':True,'storage_path':'submission-uuid/random-uuid'}] if name=='claim_whatsapp_image' else None
        with patch.dict(os.environ,{'WHATSAPP_MEDIA_INGESTION_ENABLED':'true','WHATSAPP_ACCESS_TOKEN':'access-secret'}), \
             patch.object(server,'SUPABASE_SERVICE_ROLE_KEY','role-secret'), \
             patch.object(server,'open_meta_media',side_effect=responses) as media_open, \
             patch.object(server,'_service_rpc',side_effect=rpc), \
             patch.object(server,'urlopen',return_value=MediaResponse(b'{}',{})) as upload:
            server.ingest_whatsapp_image(self.image_message())
        self.assertEqual(media_open.call_count,2)
        self.assertEqual(media_open.call_args_list[0].args[0].get_header('Authorization'),'Bearer access-secret')
        request=upload.call_args.args[0]
        self.assertIn('/storage/v1/object/whatsapp-ingestion/submission-uuid/random-uuid',request.full_url)
        self.assertEqual((request.data,request.get_header('Content-type'),request.get_header('X-upsert')),
                         (b'\xff\xd8\xff\xe0','image/jpeg','true'))
        self.assertEqual(rpc_calls[-1][1]['new_status'],'stored')

    def test_retry_after_upload_finish_interruption_upserts_the_same_object(self):
        metadata={'url':'https://lookaside.fbsbx.com/private','mime_type':'image/jpeg','file_size':4}
        media_responses=[]
        for _ in range(2):
            media_responses.extend([
                MediaResponse(json.dumps(metadata).encode(),{'Content-Type':'application/json'}),
                MediaResponse(b'\xff\xd8\xff\xe0',{'Content-Type':'image/jpeg','Content-Length':'4'}),
            ])
        rpc_calls=[]
        finish_attempts=0
        def rpc(name,payload):
            nonlocal finish_attempts
            rpc_calls.append((name,payload))
            if name=='claim_whatsapp_image':
                return [{'claimed':True,'storage_path':'submission-uuid/original-path'}]
            finish_attempts+=1
            if finish_attempts<=2:raise TimeoutError()
        uploads=[]
        def upload(req,timeout):
            uploads.append(req)
            return MediaResponse(b'{}',{})
        with patch.dict(os.environ,{'WHATSAPP_MEDIA_INGESTION_ENABLED':'true','WHATSAPP_ACCESS_TOKEN':'secret'}), \
             patch.object(server,'_service_rpc',side_effect=rpc), \
             patch.object(server,'open_meta_media',side_effect=media_responses), \
             patch.object(server,'urlopen',side_effect=upload):
            server.ingest_whatsapp_image(self.image_message())
            server.ingest_whatsapp_image(self.image_message())
        self.assertEqual(len(uploads),2)
        self.assertEqual(uploads[0].full_url,uploads[1].full_url)
        self.assertTrue(uploads[0].full_url.endswith('/submission-uuid/original-path'))
        self.assertTrue(all(request.get_header('X-upsert')=='true' for request in uploads))
        self.assertEqual([name for name,_ in rpc_calls].count('claim_whatsapp_image'),2)

    def test_invalid_mime_and_oversized_images_are_rejected(self):
        cases=[({'url':'https://lookaside.fbsbx.com/x','mime_type':'application/pdf','file_size':3},'invalid_mime_type'),
               ({'url':'https://lookaside.fbsbx.com/x','mime_type':'image/png','file_size':server.WHATSAPP_MEDIA_MAX_BYTES+1},'invalid_size')]
        for metadata,expected in cases:
            calls=[]
            def rpc(name,payload):
                calls.append((name,payload));return [{'claimed':True,'storage_path':'s/r'}] if name=='claim_whatsapp_image' else None
            with patch.dict(os.environ,{'WHATSAPP_MEDIA_INGESTION_ENABLED':'true','WHATSAPP_ACCESS_TOKEN':'secret'}), \
                 patch.object(server,'_service_rpc',side_effect=rpc), \
                 patch.object(server,'open_meta_media',return_value=MediaResponse(json.dumps(metadata).encode(),{})), \
                 patch.object(server,'urlopen') as upload:
                server.ingest_whatsapp_image(self.image_message())
            upload.assert_not_called()
            self.assertEqual((calls[-1][1]['new_status'],calls[-1][1]['error_code']),('rejected',expected))

    def test_media_timeout_is_failed_without_raising(self):
        calls=[]
        def rpc(name,payload):
            calls.append((name,payload));return [{'claimed':True,'storage_path':'s/r'}] if name=='claim_whatsapp_image' else None
        with patch.dict(os.environ,{'WHATSAPP_MEDIA_INGESTION_ENABLED':'true','WHATSAPP_ACCESS_TOKEN':'secret'}), \
             patch.object(server,'_service_rpc',side_effect=rpc), \
             patch.object(server,'open_meta_media',side_effect=TimeoutError()):
            server.ingest_whatsapp_image(self.image_message())
        self.assertEqual((calls[-1][1]['new_status'],calls[-1][1]['error_code']),('failed','timeout'))

    def test_redirect_to_non_meta_host_is_rejected(self):
        handler=server.SafeMetaRedirectHandler()
        with self.assertRaisesRegex(ValueError,'unsafe media redirect'):
            handler.redirect_request(Request('https://lookaside.fbsbx.com/x'),None,302,'Found',{},
                                     'https://attacker.example/collect')

    def test_duplicate_media_delivery_does_not_download_or_upload(self):
        with patch.dict(os.environ,{'WHATSAPP_MEDIA_INGESTION_ENABLED':'true','WHATSAPP_ACCESS_TOKEN':'secret'}), \
             patch.object(server,'_service_rpc',return_value=[{'claimed':False,'storage_path':None}]), \
             patch.object(server,'open_meta_media') as download, patch.object(server,'urlopen') as upload:
            server.ingest_whatsapp_image(self.image_message())
        download.assert_not_called();upload.assert_not_called()

    def test_media_failure_logging_contains_no_sensitive_values(self):
        message=self.image_message()
        with patch.dict(os.environ,{'WHATSAPP_MEDIA_INGESTION_ENABLED':'true','WHATSAPP_ACCESS_TOKEN':'TOKEN-PRIVATE'}), \
             patch.object(server,'_service_rpc',return_value=[{'claimed':True,'storage_path':'submission/private-path'}]), \
             patch.object(server,'open_meta_media',side_effect=RuntimeError(
                 'TOKEN-PRIVATE MEDIA-PRIVATE +60123456789 private caption')), \
             self.assertLogs('whatsapp.webhook',logging.ERROR) as logs:
            server.ingest_whatsapp_image(message)
        output=' '.join(logs.output)
        self.assertIn('error_code=download_failed exception_class=RuntimeError',output)
        for sensitive in ('TOKEN-PRIVATE','MEDIA-PRIVATE','+60123456789','private caption','private-path'):
            self.assertNotIn(sensitive,output)

    def test_phase2_migration_is_private_idempotent_and_does_not_touch_listings(self):
        sql=(Path(__file__).parents[1]/'supabase/migrations/202609140002_whatsapp_media_ingestion.sql').read_text()
        self.assertIn("values ('whatsapp-ingestion', 'whatsapp-ingestion', false)",sql)
        self.assertIn('on conflict (id) do update set public = false',sql)
        for column in ('media_storage_bucket','media_storage_path','media_mime_type','media_size_bytes','media_status','media_error_code'):
            self.assertIn('add column if not exists '+column,sql)
        self.assertIn('as restrictive',sql)
        self.assertIn("to anon using (bucket_id <> 'whatsapp-ingestion')",sql)
        self.assertIn("to authenticated using (bucket_id <> 'whatsapp-ingestion')",sql)
        self.assertNotIn('team_listings',sql)

    def test_phase2_migration_reclaims_stale_claims_and_reuses_the_object_path(self):
        sql=(Path(__file__).parents[1]/'supabase/migrations/202609140002_whatsapp_media_ingestion.sql').read_text()
        self.assertIn("media_processing_at < now() - interval '15 minutes'",sql)
        self.assertIn('media_storage_path = coalesce(',sql)
        self.assertIn('media_storage_path,',sql)
        self.assertIn("listing_submission_id::text || '/' || gen_random_uuid()::text",sql)
        self.assertIn('media_processing_at = null',sql)

    @staticmethod
    def message_payload(message):
        return {'object':'whatsapp_business_account','entry':[{'changes':[{'field':'messages','value':{
            'metadata':{'phone_number_id':'15550001111'},'messages':[message]
        }}]}]}

    @staticmethod
    def fixture(name):
        path=Path(__file__).parent/'fixtures'/name
        return json.loads(path.read_text())

    @staticmethod
    def conversation_key(sender,recipient):
        redacted=sorted((server.redact_identifier(sender),server.redact_identifier(recipient)))
        return hashlib.sha256('|'.join(redacted).encode()).hexdigest()

    @staticmethod
    def image_message():
        return {'meta_message_id':'wamid.PRIVATE','meta_media_id':'MEDIA-PRIVATE',
                'message_type':'image','text':'private caption','sender':'private phone'}


class MediaResponse:
    def __init__(self,body,headers):self.body=body;self.headers=headers
    def __enter__(self):return self
    def __exit__(self,*args):return False
    def read(self,size=-1):return self.body if size<0 else self.body[:size]


if __name__=='__main__':
    unittest.main()
