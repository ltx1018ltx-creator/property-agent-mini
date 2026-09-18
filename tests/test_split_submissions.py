import http.client, json, threading, unittest
from http.server import ThreadingHTTPServer
from pathlib import Path
from unittest.mock import patch
import server

SID='11111111-1111-4111-8111-111111111111'; OID='22222222-2222-4222-8222-222222222222'
MIGRATION=Path(__file__).parents[1]/'supabase/migrations/202609180001_split_listing_submissions.sql'

class SplitMigrationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls): cls.sql=MIGRATION.read_text()
    def test_atomic_retry_safe_and_serialized(self):
        self.assertIn('listing_submission_split_operations',self.sql)
        self.assertIn('pg_advisory_xact_lock(hashtextextended(original.conversation_key,0))',self.sql)
        self.assertIn("raise exception 'split_must_leave_messages'",self.sql)
        self.assertIn("raise exception 'submission_has_draft_or_listing'",self.sql)
        self.assertNotIn('exception when',self.sql)
    def test_preserves_media_and_recalculates_both_ranges(self):
        self.assertEqual(self.sql.count('select min(created_at),max(created_at)'),2)
        self.assertIn('update public.listing_submission_messages set listing_submission_id=new_id',self.sql)
        self.assertNotIn('delete from public.listing_submission_messages',self.sql)
        self.assertNotIn('media_storage_path=',self.sql)
    def test_rpc_is_service_role_only(self):
        self.assertIn('revoke all on function public.split_listing_submission(uuid,bigint[],uuid) from public, anon, authenticated, service_role;',self.sql)
        self.assertIn('grant execute on function public.split_listing_submission(uuid,bigint[],uuid) to service_role;',self.sql)

class SplitEndpointTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.httpd=ThreadingHTTPServer(('127.0.0.1',0),server.Handler);cls.thread=threading.Thread(target=cls.httpd.serve_forever,daemon=True);cls.thread.start();cls.port=cls.httpd.server_address[1]
    @classmethod
    def tearDownClass(cls): cls.httpd.shutdown();cls.httpd.server_close();cls.thread.join()
    def request(self,payload):
        body=json.dumps(payload).encode();conn=http.client.HTTPConnection('127.0.0.1',self.port,timeout=2);conn.request('POST',f'/api/admin/listing-submissions/{SID}/split',body,{'Authorization':'Bearer token'});response=conn.getresponse();result=response.status,json.loads(response.read());conn.close();return result
    def test_admin_split_calls_rpc(self):
        result={'new_submission_id':OID,'moved_message_count':1,'duplicate':False}
        with patch.object(server,'require_admin',return_value=(True,200)),patch.object(server,'_supabase_request',return_value=result) as request: status,body=self.request({'message_ids':[7],'operation_id':OID})
        self.assertEqual((status,body),(200,result));request.assert_called_once_with('/rest/v1/rpc/split_listing_submission','POST',{'original_submission_id':SID,'selected_message_ids':[7],'operation_id':OID})
    def test_auth_and_selection_validation_precede_rpc(self):
        with patch.object(server,'require_admin',return_value=(False,403)),patch.object(server,'_supabase_request') as request: self.assertEqual(self.request({'message_ids':[7],'operation_id':OID})[0],403)
        request.assert_not_called()
        with patch.object(server,'require_admin',return_value=(True,200)),patch.object(server,'_supabase_request') as request: self.assertEqual(self.request({'message_ids':[],'operation_id':OID})[0],400)
        request.assert_not_called()

if __name__=='__main__': unittest.main()
