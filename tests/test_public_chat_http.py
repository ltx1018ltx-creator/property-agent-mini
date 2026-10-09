import http.client
import json
import os
import threading
import unittest
from unittest.mock import patch
from http.server import ThreadingHTTPServer
import server
import public_chat


class ChatHttpTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.http = ThreadingHTTPServer(('127.0.0.1', 0), server.Handler)
        cls.thread = threading.Thread(target=cls.http.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.http.shutdown(); cls.http.server_close(); cls.thread.join()

    def request(self, method='POST', origin=public_chat.ORIGIN, payload=None):
        conn = http.client.HTTPConnection('127.0.0.1', self.http.server_port)
        body = json.dumps(payload or {'message': 'hello'})
        conn.request(method, public_chat.PATH, body, {'Origin': origin, 'Content-Type': 'application/json'})
        response = conn.getresponse()
        result = response.status, dict(response.getheaders()), response.read()
        conn.close()
        return result

    def test_origin_and_preflight(self):
        status, headers, _ = self.request('OPTIONS')
        self.assertEqual(status, 204)
        self.assertEqual(headers['Access-Control-Allow-Origin'], public_chat.ORIGIN)
        self.assertEqual(self.request(origin='https://other.example')[0], 403)
        self.assertEqual(self.request('OPTIONS', origin='https://other.example')[0], 403)

    @patch.dict(os.environ, {'OPENAI_API_KEY': 'dummy', 'OPENAI_MODEL': 'dummy'})
    @patch.object(server, 'SUPABASE_SERVICE_ROLE_KEY', 'dummy')
    def test_success_and_fail_closed(self):
        with patch.object(server, '_supabase_request', return_value=True), \
             patch.object(public_chat, 'public_catalog', return_value=[]), \
             patch.object(public_chat, 'generate', return_value={'answer': 'Hello', 'listings': []}) as ai:
            self.assertEqual(self.request()[0], 200)
            ai.assert_called_once()
        with patch.object(server, '_supabase_request', side_effect=RuntimeError('offline')), \
             patch.object(public_chat, 'generate') as ai:
            self.assertEqual(self.request()[0], 503)
            ai.assert_not_called()
        self.assertEqual(self.request(payload={'message': 'a' * 601})[0], 400)

