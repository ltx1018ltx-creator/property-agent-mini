import http.client
import json
import threading
import unittest
from http.server import ThreadingHTTPServer
from pathlib import Path
from unittest.mock import patch

import server


SID1='11111111-1111-4111-8111-111111111111'
SID2='22222222-2222-4222-8222-222222222222'
MIGRATION=Path(__file__).parents[1]/'supabase/migrations/202609170003_atomic_whatsapp_grouping_and_merge.sql'


class AtomicGroupingMigrationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.sql=MIGRATION.read_text()

    def test_concurrent_delivery_uses_stable_conversation_advisory_lock(self):
        self.assertIn("least(event->>'sender', event->>'recipient')",self.sql)
        self.assertIn("greatest(event->>'sender', event->>'recipient')",self.sql)
        self.assertIn('pg_advisory_xact_lock(hashtextextended(stable_conversation_key, 0))',self.sql)
        self.assertNotIn("(event->>'event_type'), 0",self.sql)

    def test_out_of_order_meta_time_does_not_control_grouping(self):
        self.assertIn('receipt_time timestamptz := clock_timestamp()',self.sql)
        self.assertIn("s.last_activity_at >= receipt_time - interval '5 minutes'",self.sql)
        self.assertIn('set last_activity_at = receipt_time',self.sql)
        self.assertIn('message_timestamp)',self.sql)
        self.assertIn('meta_event_time)',self.sql)

    def test_retry_is_idempotent_and_rolling_window_is_five_minutes(self):
        self.assertIn("where m.meta_message_id = event->>'meta_message_id'",self.sql)
        self.assertIn('on conflict (meta_message_id) do nothing',self.sql)
        self.assertIn("interval '5 minutes'",self.sql)

    def test_conversations_and_generated_drafts_stay_separate(self):
        self.assertIn('s.conversation_key = stable_conversation_key',self.sql)
        self.assertIn('not exists (\n       select 1 from public.listing_submission_drafts',self.sql)

    def test_manual_merge_moves_messages_recalculates_times_then_deletes_sources(self):
        move=self.sql.index('update public.listing_submission_messages')
        recalc=self.sql.index('select min(created_at), max(created_at)',move)
        delete=self.sql.index('delete from public.listing_submissions',recalc)
        self.assertLess(move,recalc)
        self.assertLess(recalc,delete)
        self.assertIn('count(distinct conversation_key)',self.sql)
        self.assertIn('select distinct conversation_key from public.listing_submissions',self.sql)
        self.assertIn("raise exception 'submission_has_draft'",self.sql)

    def test_merge_prevents_duplicates_and_transaction_rolls_back_on_failure(self):
        self.assertIn('array_agg(distinct id order by id)',self.sql)
        self.assertIn('for update;',self.sql)
        self.assertIn("raise exception 'submission_has_no_messages'",self.sql)
        self.assertNotIn('exception when',self.sql)

    def test_merge_rpc_is_service_role_only(self):
        merge=self.sql[self.sql.index('create or replace function public.merge_listing_submissions'):]
        self.assertIn('security definer',merge)
        self.assertIn('revoke all on function public.merge_listing_submissions(uuid,uuid[]) from public, anon, authenticated, service_role;',self.sql)
        self.assertIn('grant execute on function public.merge_listing_submissions(uuid,uuid[]) to service_role;',self.sql)


class MergeEndpointTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.httpd=ThreadingHTTPServer(('127.0.0.1',0),server.Handler)
        cls.thread=threading.Thread(target=cls.httpd.serve_forever,daemon=True)
        cls.thread.start()
        cls.port=cls.httpd.server_address[1]

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown();cls.httpd.server_close();cls.thread.join()

    def request(self,payload,headers=None):
        body=json.dumps(payload).encode()
        connection=http.client.HTTPConnection('127.0.0.1',self.port,timeout=2)
        connection.request('POST','/api/admin/listing-submissions/merge',body,headers or {'Authorization':'Bearer token'})
        response=connection.getresponse();result=(response.status,json.loads(response.read()));connection.close()
        return result

    def test_admin_merge_calls_atomic_rpc_with_first_selection_as_target(self):
        with patch.object(server,'require_admin',return_value=(True,200)), \
             patch.object(server,'_supabase_request',return_value={'target_submission_id':SID1,'moved_message_count':2}) as request:
            status,result=self.request({'submission_ids':[SID1,SID2]})
        self.assertEqual(status,200)
        self.assertEqual(result['moved_message_count'],2)
        request.assert_called_once_with('/rest/v1/rpc/merge_listing_submissions','POST',{
            'target_submission_id':SID1,'source_submission_ids':[SID2]})

    def test_duplicate_selection_is_rejected_before_rpc(self):
        with patch.object(server,'require_admin',return_value=(True,200)),patch.object(server,'_supabase_request') as request:
            self.assertEqual(self.request({'submission_ids':[SID1,SID1]})[0],400)
        request.assert_not_called()

    def test_non_admin_cannot_reach_merge_rpc(self):
        with patch.object(server,'require_admin',return_value=(False,403)),patch.object(server,'_supabase_request') as request:
            self.assertEqual(self.request({'submission_ids':[SID1,SID2]})[0],403)
        request.assert_not_called()


if __name__=='__main__':
    unittest.main()
