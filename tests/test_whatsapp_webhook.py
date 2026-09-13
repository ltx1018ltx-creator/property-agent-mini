import hashlib
import hmac
import http.client
import json
import logging
import os
import threading
import unittest
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
        self.env=patch.dict(os.environ,{'WHATSAPP_VERIFY_TOKEN':'verify-me','META_APP_SECRET':'app-secret'})
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
        self.assertIn('"message_kind":"inbound"',output)
        self.assertIn('hmac:',output)
        self.assertNotIn('60123456789',output)
        self.assertNotIn('TOP SECRET',output)
        self.assertNotIn('15550001111',output)

    def test_business_app_message_echo_is_classified(self):
        payload={'object':'whatsapp_business_account','entry':[{'changes':[{
            'field':'smb_message_echoes','value':{'metadata':{'phone_number_id':'15550001111'},
            'message_echoes':[{'id':'wamid.echo','from':'15550001111','to':'60123456789',
            'type':'image','image':{'data':'PRIVATE'}}]}}]}]}
        with self.assertLogs('whatsapp.webhook',logging.INFO) as logs:
            self.assertEqual(self.signed_post(payload)[0],200)
        output=' '.join(logs.output)
        self.assertIn('"message_kind":"business_app_echo"',output)
        self.assertNotIn('PRIVATE',output)
        self.assertNotIn('60123456789',output)

    @staticmethod
    def message_payload(message):
        return {'object':'whatsapp_business_account','entry':[{'changes':[{'field':'messages','value':{
            'metadata':{'phone_number_id':'15550001111'},'messages':[message]
        }}]}]}


if __name__=='__main__':
    unittest.main()
