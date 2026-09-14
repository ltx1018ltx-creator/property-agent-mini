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
from urllib.error import HTTPError
from unittest.mock import patch

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
        self.assertIn('wamid.abc',output)
        self.assertIn('"event_type":"messages"',output)
        self.assertIn('hmac:',output)
        self.assertNotIn('60123456789',output)
        self.assertNotIn('TOP SECRET',output)
        self.assertNotIn('15550001111',output)

    def test_business_app_message_echo_is_classified(self):
        payload={'object':'whatsapp_business_account','entry':[{'changes':[{
            'field':'smb_message_echoes','value':{'metadata':{'phone_number_id':'15550001111'},
            'messages':[{'id':'wamid.echo','from':'15550001111','to':'60123456789',
            'type':'image','image':{'id':'media.1','caption':'PRIVATE','data':'NEVER STORE'},
            'timestamp':'1789344000'}]}}]}]}
        with self.assertLogs('whatsapp.webhook',logging.INFO) as logs:
            self.assertEqual(self.signed_post(payload)[0],200)
        output=' '.join(logs.output)
        self.assertIn('"event_type":"smb_message_echoes"',output)
        self.assertNotIn('PRIVATE',output)
        self.assertNotIn('NEVER STORE',output)
        self.assertNotIn('60123456789',output)

    def test_disabled_ingestion_makes_no_supabase_request(self):
        payload=self.message_payload({'id':'wamid.off','from':'1','type':'text','text':{'body':'hello'},
                                      'timestamp':'1789344000'})
        with patch.object(server,'urlopen') as urlopen:
            self.assertEqual(self.signed_post(payload)[0],200)
        urlopen.assert_not_called()

    def test_real_style_echo_text_caption_and_multiple_images_are_allow_listed(self):
        payload={'object':'whatsapp_business_account','entry':[{'changes':[{
            'field':'smb_message_echoes','value':{'metadata':{'phone_number_id':'15550001111'},'messages':[
                {'id':'wamid.text','from':'15550001111','to':'60123','timestamp':'1789344000',
                 'type':'text','text':{'body':'Three-bedroom condo'}},
                {'id':'wamid.image1','from':'15550001111','to':'60123','timestamp':'1789344001',
                 'type':'image','image':{'id':'media.one','caption':'Living room','sha256':'secret'}},
                {'id':'wamid.image2','from':'15550001111','to':'60123','timestamp':'1789344002',
                 'type':'image','image':{'id':'media.two'}},
            ]}}]}]}
        captured=[]
        class Response:
            def __enter__(self):return self
            def __exit__(self,*args):return False
            def read(self):return b'"submission-id"'
        def receive(req,timeout):
            captured.append(json.loads(req.data)['event'])
            self.assertEqual(req.full_url,'https://project.supabase.co/rest/v1/rpc/ingest_whatsapp_message')
            self.assertEqual(req.get_method(),'POST')
            self.assertEqual(req.headers['Apikey'],'service-role-test')
            self.assertEqual(req.headers['Authorization'],'Bearer service-role-test')
            self.assertEqual(req.headers['Content-type'],'application/json')
            self.assertEqual(set(json.loads(req.data)),{'event'})
            return Response()
        with patch.dict(os.environ,{'WHATSAPP_INGESTION_ENABLED':'true'}), \
             patch.object(server,'SUPABASE_SERVICE_ROLE_KEY','service-role-test'), \
             patch.object(server,'SUPABASE_URL','https://project.supabase.co///'), \
             patch.object(server,'urlopen',side_effect=receive):
            self.assertEqual(self.signed_post(payload)[0],200)
        self.assertEqual([e['meta_message_id'] for e in captured],['wamid.text','wamid.image1','wamid.image2'])
        self.assertEqual(captured[0]['text'],'Three-bedroom condo')
        self.assertEqual((captured[1]['text'],captured[1]['meta_media_id']),('Living room','media.one'))
        self.assertEqual(captured[2]['meta_media_id'],'media.two')
        serialized=json.dumps(captured)
        self.assertNotIn('sha256',serialized)
        self.assertNotIn('secret',serialized)
        self.assertNotIn('15550001111',serialized)
        self.assertNotIn('60123',serialized)

    def test_supabase_http_error_logs_status_and_redacted_response(self):
        payload=self.message_payload({
            'id':'wamid.failure','from':'15551234567','to':'60123456789','timestamp':'1789344000',
            'type':'image','image':{'id':'private-media-id','caption':'private caption'},
        })
        error_body=json.dumps({
            'code':'PGRST202',
            'message':'private caption 15551234567 private-media-id',
            'details':'Bearer service-role-test wamid.failure',
        }).encode()
        error=HTTPError('https://project.supabase.co/rest/v1/rpc/ingest_whatsapp_message',404,
                        'Not Found',{},BytesIO(error_body))
        with patch.dict(os.environ,{'WHATSAPP_INGESTION_ENABLED':'true'}), \
             patch.object(server,'SUPABASE_SERVICE_ROLE_KEY','service-role-test'), \
             patch.object(server,'SUPABASE_URL','https://project.supabase.co/'), \
             patch.object(server,'urlopen',side_effect=error), \
             self.assertLogs('whatsapp.webhook',logging.ERROR) as logs:
            status,_,_=self.signed_post(payload)
        self.assertEqual(status,503)
        output=' '.join(logs.output)
        self.assertIn('status=404',output)
        self.assertIn('PGRST202',output)
        self.assertIn('[redacted]',output)
        for secret in ('service-role-test','private caption','private-media-id','15551234567','60123456789'):
            self.assertNotIn(secret,output)

    def test_database_migration_deduplicates_and_batches_for_60_seconds(self):
        sql=(Path(__file__).parents[1]/'supabase/migrations/202609140001_whatsapp_ingestion_phase1.sql').read_text()
        self.assertIn('meta_message_id text not null unique',sql)
        self.assertIn("interval '60 seconds'",sql)
        self.assertIn('pg_advisory_xact_lock',sql)
        self.assertIn('on conflict (meta_message_id) do nothing',sql)
        self.assertIn('enable row level security',sql)
        self.assertIn('force row level security',sql)
        self.assertIn('to service_role',sql)
        self.assertNotIn('team_listings',sql)

    @staticmethod
    def message_payload(message):
        return {'object':'whatsapp_business_account','entry':[{'changes':[{'field':'messages','value':{
            'metadata':{'phone_number_id':'15550001111'},'messages':[message]
        }}]}]}


if __name__=='__main__':
    unittest.main()
