import http.client, json, threading, time, unittest
from unittest.mock import patch
from io import BytesIO
import server

class ReviewTests(unittest.TestCase):
    def test_review_saves_edits_and_does_not_overwrite_published_or_pending(self):
        httpd=server.ThreadingHTTPServer(('127.0.0.1',0),server.Handler)
        thread=threading.Thread(target=httpd.serve_forever,daemon=True);thread.start()
        draft_id='22222222-2222-4222-8222-222222222222'
        payload={'status':'approved','structured_data':{'price':490000,'landSize':'1200'},'marketing_copy':'Reviewed'}
        try:
            for state,expected in [('generated',200),('published',200),('pending',409)]:
                calls=[]
                def db(path,method='GET',data=None,**kwargs):
                    calls.append((path,method,data))
                    if method=='PATCH':
                        self.assertIn('published_listing_id=is.null&status=neq.pending',path)
                        return [{'id':draft_id,**data}] if state=='generated' else []
                    return [{'id':draft_id,'published_listing_id':'existing' if state=='published' else None}]
                with patch.object(server,'require_admin',return_value=(True,200)),patch.object(server,'_supabase_request',side_effect=db):
                    conn=http.client.HTTPConnection('127.0.0.1',httpd.server_address[1],timeout=2)
                    conn.request('PATCH','/api/admin/listing-submission-drafts/'+draft_id,json.dumps(payload),{'Authorization':'Bearer test','Content-Type':'application/json'})
                    response=conn.getresponse();body=json.loads(response.read());conn.close()
                    self.assertEqual(response.status,expected)
                    if state=='generated':self.assertEqual(body['draft']['structured_data']['landSize'],'1200')
                    if state=='published':self.assertEqual(body['draft']['published_listing_id'],'existing')
                self.assertEqual(len([c for c in calls if c[1]=='PATCH']),1)
        finally:httpd.shutdown();httpd.server_close();thread.join()

class SpeedTests(unittest.TestCase):
    def test_signed_urls_batched_and_wrong_bucket_excluded(self):
        messages=[{'media_status':'stored','media_storage_bucket':server.WHATSAPP_MEDIA_BUCKET,'media_storage_path':f'{n}.jpg'} for n in range(205)]
        messages+=[messages[0],{'media_status':'stored','media_storage_bucket':'other','media_storage_path':'secret'}]
        calls=[]
        def db(path,method,payload):
            calls.append(payload)
            return [{'path':p,'signedURL':'/object/sign/private/'+p+'?token=test'} for p in payload['paths']]
        with patch.object(server,'_supabase_request',side_effect=db):urls=server._submission_image_urls(messages)
        self.assertEqual(len(calls),3);self.assertEqual(len(urls),205)
        self.assertNotIn('secret',urls);self.assertEqual(calls[0]['expiresIn'],300)

    def test_missing_image_does_not_hide_other_previews(self):
        messages=[{'media_status':'stored','media_storage_bucket':server.WHATSAPP_MEDIA_BUCKET,'media_storage_path':'missing'}]
        with patch.object(server,'_supabase_request',return_value=[{'path':'missing','error':'not found','signedURL':None}]):
            self.assertEqual(server._submission_image_urls(messages),{})

    def test_parallel_images_keep_order_and_bounded_concurrency(self):
        rows=[{'id':str(n),'media_storage_bucket':server.WHATSAPP_MEDIA_BUCKET,'media_storage_path':str(n),'media_mime_type':'image/jpeg'} for n in range(8)]
        active=peak=0;lock=threading.Lock()
        def fetch(req,timeout):
            nonlocal active,peak
            with lock:active+=1;peak=max(peak,active)
            time.sleep(.025)
            with lock:active-=1
            return BytesIO(b'\xff\xd8\xfftest')
        with patch.object(server,'_supabase_request',return_value=rows),patch.object(server,'urlopen',side_effect=fetch):
            urls=server._copy_submission_images('submission','draft')
        self.assertTrue(1<peak<=4)
        self.assertEqual([u.rsplit('/',1)[1] for u in urls],[f'{n}.jpg' for n in range(8)])

    def test_ai_removes_duplicate_lines_but_keeps_price_and_dimensions(self):
        captured=[]
        def fetch(req,timeout):
            captured.append(json.loads(req.data))
            return BytesIO(json.dumps({'output_text':json.dumps({'structuredData':{},'marketingCopy':''})}).encode())
        with patch.dict(server.os.environ,{'OPENAI_API_KEY':'test','OPENAI_MODEL':'existing-model'}),patch.object(server,'urlopen',side_effect=fetch):
            server.generate_openai_draft('RM 480k\n20 x 60 sqft\nRM 480k\n4 bedrooms')
        self.assertEqual(captured[0]['input'].count('RM 480k'),1)
        self.assertIn('20 x 60 sqft',captured[0]['input']);self.assertEqual(captured[0]['model'],'existing-model')

if __name__=='__main__':unittest.main()
