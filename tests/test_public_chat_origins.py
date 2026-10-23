import http.client
import os
import threading
import unittest
from unittest.mock import patch
from http.server import ThreadingHTTPServer
import server
import public_chat

class Origins(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.http = ThreadingHTTPServer(('127.0.0.1', 0), server.Handler)
        cls.thread = threading.Thread(target=cls.http.serve_forever, daemon=True)
        cls.thread.start()
    @classmethod
    def tearDownClass(cls):
        cls.http.shutdown()
        cls.http.server_close()
        cls.thread.join()
    def request(self, method, origin):
        connection = http.client.HTTPConnection('127.0.0.1', self.http.server_port)
        headers = {'Content-Type': 'application/json'}
        if origin is not None:
            headers['Origin'] = origin
        connection.request(method, public_chat.PATH, body=b'', headers=headers)
        response = connection.getresponse()
        result = response.status, response.getheader('Access-Control-Allow-Origin')
        response.read()
        connection.close()
        return result
    def test_exact_origin_allowlist(self):
        with patch.dict(os.environ, {'OPENAI_API_KEY':'test-only', 'PUBLIC_CHAT_MODEL':'test-only'}), patch.object(server, 'SUPABASE_SERVICE_ROLE_KEY', 'test-only'):
            for origin in public_chat.ALLOWED_ORIGINS:
                self.assertEqual(self.request('OPTIONS',origin),(204,origin))
                # Invalid empty request reaches validation, never quota/database/AI.
                self.assertEqual(self.request('POST',origin),(400,origin))
            for origin in [None,'null','https://evil.example','https://mari-property-melaka.onrender.com.evil.example','http://mari-property-melaka.onrender.com']:
                for method in ['OPTIONS','POST']:
                    self.assertEqual(self.request(method,origin),(403,None))

if __name__ == '__main__':
    unittest.main()

