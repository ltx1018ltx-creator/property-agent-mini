import io
import json
import unittest
from unittest.mock import patch
from urllib.error import HTTPError

import server

TOKEN='a'*64

class MemberInviteTests(unittest.TestCase):
    def setUp(self):
        self.secret=patch.object(server,'SUPABASE_SERVICE_ROLE_KEY','server-secret')
        self.secret.start();self.addCleanup(self.secret.stop)

    def test_invalid_link_does_not_reach_database(self):
        with patch.object(server,'_supabase_request') as request:
            status,_=server.member_invitation({'token':'bad'},True)
            self.assertEqual(status,400);request.assert_not_called()

    def test_valid_link_is_read_only_until_receiver_requests_email(self):
        with patch.object(server,'_supabase_request',return_value={'valid':True,'expires_at':'2099-01-01'}) as request:
            status,_=server.member_invitation({'token':TOKEN},True)
            self.assertEqual(status,200)
            self.assertEqual(request.call_count,1)
            self.assertEqual(request.call_args.args[0],'/rest/v1/rpc/check_workspace_invite_link')

    def test_used_link_cannot_send_email(self):
        error=HTTPError('mock',400,'Bad request',{},io.BytesIO(b'{}'))
        with patch.object(server,'_supabase_request',side_effect=error) as request:
            status,_=server.member_invitation({'token':TOKEN,'email':'member@example.invalid','name':'Member'})
            self.assertEqual(status,410);self.assertEqual(request.call_count,1)

    def test_valid_invitation_ignores_role_and_only_sends_email(self):
        with patch.object(server,'_supabase_request',side_effect=['reservation',{'id':'new-user'},None]) as request:
            status,data=server.member_invitation({'token':TOKEN,'email':' MEMBER@example.invalid ','name':' Member ','role':'admin','redirect':'https://evil.invalid'})
            self.assertEqual(status,200);self.assertTrue(data['ok'])
            calls=request.call_args_list
            self.assertEqual(calls[1].args[2],{'email':'member@example.invalid','data':{'name':'Member'}})
            self.assertIn(server.SITE_URL.replace(':','%3A').replace('/','%2F'),calls[1].args[0])
            self.assertNotIn('evil',calls[1].args[0]);self.assertNotIn('access_token',data)

    def test_existing_account_error_releases_place_without_reactivating(self):
        error=HTTPError('mock',422,'Already registered',{},io.BytesIO(b'{"error_code":"user_already_exists"}'))
        with patch.object(server,'_supabase_request',side_effect=['reservation',error,None]) as request:
            status,_=server.member_invitation({'token':TOKEN,'email':'member@example.invalid','name':'Member'})
            self.assertEqual(status,400)
            self.assertEqual(request.call_args_list[-1].args[0],'/rest/v1/rpc/release_workspace_invite')

    def test_uncertain_email_outcome_keeps_reserved_place(self):
        with patch.object(server,'_supabase_request',side_effect=['reservation',TimeoutError()]) as request:
            status,_=server.member_invitation({'token':TOKEN,'email':'member@example.invalid','name':'Member'})
            self.assertEqual(status,503);self.assertEqual(request.call_count,2)

    def test_email_sent_with_bookkeeping_error_does_not_open_more_places(self):
        with patch.object(server,'_supabase_request',side_effect=['reservation',{'id':'new-user'},TimeoutError()]) as request:
            status,data=server.member_invitation({'token':TOKEN,'email':'member@example.invalid','name':'Member'})
            self.assertEqual(status,200);self.assertTrue(data['ok']);self.assertEqual(request.call_count,3)

if __name__=='__main__':unittest.main()
