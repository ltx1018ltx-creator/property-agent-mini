import os
import tempfile
import threading
import unittest
from http.client import HTTPConnection
from http.server import ThreadingHTTPServer

import server


class StaticRouteTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.httpd = ThreadingHTTPServer(('127.0.0.1', 0), server.Handler)
        cls.thread = threading.Thread(target=cls.httpd.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()
        cls.httpd.server_close()
        cls.thread.join()

    def request(self, path):
        connection = HTTPConnection('127.0.0.1', self.httpd.server_address[1], timeout=2)
        connection.request('GET', path)
        response = connection.getresponse()
        body = response.read()
        headers = {key.lower(): value for key, value in response.getheaders()}
        connection.close()
        return response.status, headers, body

    def test_landing_page_and_assets_are_served_outside_repo_working_directory(self):
        original = os.getcwd()
        try:
            with tempfile.TemporaryDirectory() as directory:
                os.chdir(directory)
                status, headers, body = self.request('/landing.html?agent=00000000-0000-4000-8000-000000000000')
                self.assertEqual(status, 200)
                self.assertIn(b'<title>Property Collection', body)
                self.assertTrue(headers['content-type'].startswith('text/html'))

                for path, content_type in (('/landing.css', 'text/css'), ('/landing.js', 'text/javascript')):
                    status, headers, body = self.request(path)
                    self.assertEqual(status, 200)
                    self.assertTrue(body)
                    self.assertTrue(headers['content-type'].startswith(content_type))
        finally:
            os.chdir(original)

    def test_missing_static_file_remains_404(self):
        status, _, _ = self.request('/website-not-found.html')
        self.assertEqual(status, 404)


if __name__ == '__main__':
    unittest.main()
