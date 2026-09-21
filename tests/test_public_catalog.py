import json
import socket
import unittest
from unittest.mock import patch
from urllib.error import HTTPError

import server

AGENT='11111111-1111-4111-8111-111111111111'
OTHER='22222222-2222-4222-8222-222222222222'
LISTING='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
IMAGE=server.SUPABASE_URL+'/storage/v1/object/public/listing-images/a/photo.jpg'

class PublicCatalogTests(unittest.TestCase):
    def setUp(self):
        server._public_catalog_cache.clear()

    def test_list_allowlist_malformed_and_images(self):
        rows=[{'id':LISTING,'created_at':'2026-09-21T12:00:00Z','title':'Home','cover':IMAGE,
               'rawText':'call 0123456789','owner_id':AGENT,'token':'secret'},
              {'id':'bad','created_at':'2026-09-20T12:00:00Z','title':'broken','cover':'data:image/png;base64,AAAA'}]
        with patch.object(server,'_supabase_request',return_value=rows) as request:
            result=server.get_public_catalog(AGENT,24)
        self.assertEqual(result['listings'][0]['photos'],[IMAGE])
        self.assertNotIn('rawText',result['listings'][0]);self.assertNotIn('owner_id',result['listings'][0])
        self.assertNotIn('token',result['listings'][0]);self.assertEqual(len(result['listings']),1)
        self.assertIn('owner_id=eq.'+AGENT,request.call_args.args[0])
        self.assertNotIn('listing,',request.call_args.args[0])

    def test_pagination_cursor_and_agent_isolation(self):
        second='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
        rows=[{'id':LISTING,'created_at':'2026-09-21T12:00:00Z'},
              {'id':second,'created_at':'2026-09-20T12:00:00Z'}]
        with patch.object(server,'_supabase_request',return_value=rows):first=server.get_public_catalog(AGENT,1)
        server._public_catalog_cache.clear()
        with patch.object(server,'_supabase_request',return_value=[]) as request:
            final=server.get_public_catalog(OTHER,1,server._public_cursor(first['nextCursor']))
        self.assertIsNone(final['nextCursor']);path=request.call_args.args[0]
        self.assertIn('owner_id=eq.'+OTHER,path);self.assertIn('created_at.lt.',path)

    def test_detail_allows_legacy_data_but_rejects_private_images(self):
        data='data:image/png;base64,AAAA'
        row={'id':LISTING,'created_at':'2026-09-21T12:00:00Z','listing':{'photos':[data,IMAGE,
             server.SUPABASE_URL+'/storage/v1/object/whatsapp-ingestion/private.jpg','http://bad.test/x']}}
        with patch.object(server,'_supabase_request',return_value=[row]):result=server.get_public_listing(AGENT,LISTING)
        self.assertEqual(result['photos'],[data,IMAGE])
        self.assertEqual(server._safe_public_listing(row)['photos'],[IMAGE])

    def test_empty_catalog_and_new_listing_visible_after_cache_expiry(self):
        with patch.object(server,'_supabase_request',side_effect=[[],[{'id':LISTING,'created_at':'2026-09-21T12:00:00Z'}]]):
            self.assertEqual(server.get_public_catalog(AGENT,24)['listings'],[])
            server._public_catalog_cache[ (AGENT,24,None) ]=(0,{'listings':[],'nextCursor':None})
            self.assertEqual(len(server.get_public_catalog(AGENT,24)['listings']),1)

    def test_invalid_uuid_and_cursor_validation(self):
        self.assertIsNone(server._valid_uuid('not-an-id'))
        for value in ('!!!','e30','a'*301):
            with self.assertRaises(ValueError):server._public_cursor(value)

    def test_database_timeout_and_error_do_not_leak(self):
        for error in (socket.timeout(),HTTPError('x',500,'secret database detail',{},None)):
            with self.subTest(error=type(error).__name__),patch.object(server,'_supabase_request',side_effect=error):
                with self.assertRaises(Exception) as raised:server.get_public_catalog(AGENT,24)
                self.assertIsInstance(raised.exception,(socket.timeout,HTTPError))

if __name__=='__main__':unittest.main()
