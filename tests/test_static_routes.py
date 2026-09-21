import http.client
import threading
import unittest
from http.server import ThreadingHTTPServer

import server


class StaticRouteTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.httpd=ThreadingHTTPServer(('127.0.0.1',0),server.Handler)
        cls.thread=threading.Thread(target=cls.httpd.serve_forever,daemon=True)
        cls.thread.start()
        cls.port=cls.httpd.server_address[1]

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown();cls.httpd.server_close();cls.thread.join()

    def request(self,path,method='GET'):
        connection=http.client.HTTPConnection('127.0.0.1',self.port)
        connection.request(method,path)
        response=connection.getresponse();body=response.read();headers=dict(response.getheaders())
        connection.close()
        return response.status,headers,body

    def test_landing_page_is_public_html(self):
        status,headers,body=self.request('/landing.html')
        self.assertEqual(status,200)
        self.assertTrue(headers['Content-Type'].startswith('text/html'))
        self.assertIn(b'<script src="landing.js?v=2">',body)

    def test_landing_assets_have_expected_content_types(self):
        for path,content_type in (('/landing.js','text/javascript'),('/landing.css','text/css')):
            with self.subTest(path=path):
                status,headers,body=self.request(path)
                self.assertEqual(status,200)
                self.assertTrue(headers['Content-Type'].startswith(content_type),headers['Content-Type'])
                self.assertTrue(body)

    def test_query_parameters_do_not_change_static_routing(self):
        plain=self.request('/landing.html')[2]
        status,headers,queried=self.request('/landing.html?agent=6c8e4545-3e89-40e2-b5a9-7a18475641d7')
        self.assertEqual(status,200)
        self.assertTrue(headers['Content-Type'].startswith('text/html'))
        self.assertEqual(queried,plain)
        self.assertEqual(self.request('/landing.js?v=2')[0],200)

    def test_existing_public_pages_and_assets_remain_available(self):
        for path in ('/','/index.html','/catalog.html','/share.html','/app.js','/sw.js',
                     '/manifest.webmanifest','/icons/icon-source.jpg'):
            with self.subTest(path=path):self.assertEqual(self.request(path)[0],200)

    def test_unknown_and_private_repository_files_are_not_served(self):
        for path in ('/unknown','/server.py','/README.md','/.env','/.git/config',
                     '/tests/test_static_routes.py','/supabase/migrations/202609210001_public_catalog_index.sql'):
            with self.subTest(path=path):self.assertEqual(self.request(path)[0],404)
        self.assertEqual(self.request('/server.py',method='HEAD')[0],404)

    def test_directory_traversal_is_rejected(self):
        for path in ('/../server.py','/%2e%2e/server.py','/icons/../../server.py',
                     '/icons/%2e%2e/server.py'):
            with self.subTest(path=path):self.assertEqual(self.request(path)[0],404)


if __name__=='__main__':unittest.main()
