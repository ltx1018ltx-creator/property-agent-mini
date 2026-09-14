#!/usr/bin/env python3
import hashlib, hmac, json, logging, os, secrets, threading
from collections import OrderedDict
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import quote
from urllib.parse import parse_qs, urlsplit
from urllib.request import Request, urlopen

ROOT=Path(__file__).resolve().parent
DATA=ROOT/'shares.json'
STATE=ROOT/'agent-state.json'
IMPORTS=ROOT/'imports.json'
SUPABASE_URL=os.environ.get('SUPABASE_URL','https://nqruxoniebjqyegudyku.supabase.co').rstrip('/')
SUPABASE_KEY=os.environ.get('SUPABASE_ANON_KEY','sb_publishable_XN56JH2JPCjbLQYR2ejjDQ_EpP0TaDJ')
SUPABASE_SERVICE_ROLE_KEY=os.environ.get('SUPABASE_SECRET_KEY') or os.environ.get('SUPABASE_SERVICE_ROLE_KEY','')
SITE_URL=os.environ.get('SITE_URL','https://property-agent-mini.onrender.com').rstrip('/')
WEBHOOK_MAX_BYTES=1_000_000
WHATSAPP_INGESTION_RPC_PATH='/rest/v1/rpc/ingest_whatsapp_message'
_webhook_events=OrderedDict()
_webhook_events_lock=threading.Lock()
_webhook_logger=logging.getLogger('whatsapp.webhook')

def redact_identifier(value):
    """Return a keyed, stable label instead of a phone/account ID."""
    if value is None:return None
    key=os.environ.get('META_APP_SECRET','').encode()
    return 'hmac:'+hmac.new(key,str(value).encode(),hashlib.sha256).hexdigest()[:12]

def webhook_changes(payload):
    """Return allow-listed messages and structural facts for each webhook change."""
    parsed=[]
    structures=[]
    for entry in payload.get('entry',[]) if isinstance(payload,dict) else []:
        for change in entry.get('changes',[]) if isinstance(entry,dict) else []:
            value=change.get('value',{}) if isinstance(change,dict) else {}
            supplied_field=change.get('field') if isinstance(change,dict) else None
            field=supplied_field if supplied_field in ('messages','smb_message_echoes') else '<unsupported>'
            if not isinstance(value,dict):
                structures.append((field,'unsupported',0,'invalid_value'))
                continue
            metadata=value.get('metadata') or {}
            account=metadata.get('phone_number_id') if isinstance(metadata,dict) else None
            # Meta's real SMB echo delivery uses value.message_echoes. Retain
            # value.messages as a compatibility fallback and for normal events.
            if field=='smb_message_echoes':
                groups=((value.get('message_echoes',[]),'business_app_echo'),
                        (value.get('messages',[]),'business_app_echo'))
            elif field=='messages':
                groups=((value.get('messages',[]),'inbound'),
                        (value.get('message_echoes',[]),'business_app_echo'))
            else:groups=()
            item_count=sum(len(items) for items,_ in groups if isinstance(items,list))
            classification='smb_message_echoes' if field=='smb_message_echoes' else (
                'messages' if field=='messages' else 'unsupported')
            structures.append((field,classification,item_count,
                               None if groups else 'unsupported_field'))
            seen=set()
            for items,kind in groups:
                for message in items if isinstance(items,list) else []:
                    if not isinstance(message,dict):
                        parsed.append((field,classification,None,'invalid_item'))
                        continue
                    marker=id(message)
                    if marker in seen:continue
                    seen.add(marker)
                    echo=kind=='business_app_echo' or message.get('is_echo') is True
                    message_type=message.get('type')
                    content=message.get(message_type,{}) if isinstance(message_type,str) else {}
                    if not isinstance(content,dict):content={}
                    event={
                        'event_type':'smb_message_echoes' if echo else 'messages',
                        'meta_message_id':message.get('id'),
                        'message_type':message_type,
                        'text':(message.get('text') or {}).get('body') if message_type=='text' else content.get('caption'),
                        'meta_media_id':content.get('id') if message_type in ('image','video','document','audio','sticker') else None,
                        'sender':redact_identifier(message.get('from')),
                        'recipient':redact_identifier(message.get('to') or account),
                        'timestamp':message.get('timestamp'),
                    }
                    parsed.append((field,event['event_type'],event,
                                   None if event['meta_message_id'] else 'missing_message_id'))
    if not structures:structures.append(('<none>','unsupported',0,'missing_changes'))
    return parsed,structures

def webhook_metadata(payload):
    """Yield parsed messages for callers that only need ingestion metadata."""
    for _,_,message,_ in webhook_changes(payload)[0]:
        if message is not None:yield message

def ingestion_enabled():
    return os.environ.get('WHATSAPP_INGESTION_ENABLED','false').strip().lower() in ('1','true','yes','on')

def store_whatsapp_message(message):
    """Persist one allow-listed event through the service-role-only RPC."""
    if not SUPABASE_SERVICE_ROLE_KEY:raise RuntimeError('service role is not configured')
    body=json.dumps({'event':message},separators=(',',':')).encode()
    rpc_url=f'{SUPABASE_URL.rstrip("/")}{WHATSAPP_INGESTION_RPC_PATH}'
    req=Request(rpc_url,data=body,method='POST',headers={
        'apikey':SUPABASE_SERVICE_ROLE_KEY,
        'Authorization':f'Bearer {SUPABASE_SERVICE_ROLE_KEY}',
        'Content-Type':'application/json',
    })
    try:
        with urlopen(req,timeout=20) as res:res.read()
    except HTTPError as error:
        error.read()
        raise

def is_duplicate_webhook(body):
    """Bound memory while suppressing repeated delivery logging within this process."""
    digest=hashlib.sha256(body).digest()
    with _webhook_events_lock:
        duplicate=digest in _webhook_events
        _webhook_events[digest]=None
        _webhook_events.move_to_end(digest)
        while len(_webhook_events)>2048:_webhook_events.popitem(last=False)
    return duplicate
def load():
    try:return json.loads(DATA.read_text())
    except:return {}
def save(data):DATA.write_text(json.dumps(data,separators=(',',':')))
def load_imports():
    try:return json.loads(IMPORTS.read_text())
    except:return {}
def save_imports(data):IMPORTS.write_text(json.dumps(data,separators=(',',':')))
class Handler(SimpleHTTPRequestHandler):
    def __init__(self,*a,**kw):super().__init__(*a,directory=str(ROOT),**kw)
    def log_request(self,code='-',size='-'):
        parsed=urlsplit(self.path)
        if parsed.path=='/api/whatsapp/webhook':
            self.log_message('"%s %s %s" %s %s',self.command,parsed.path,self.request_version,str(code),str(size))
            return
        super().log_request(code,size)
    def end_headers(self):
        if self.path.endswith(('.html','.js','.css','/')):self.send_header('Cache-Control','no-cache, no-store, must-revalidate')
        super().end_headers()
    def reply(self,status,payload):
        body=json.dumps(payload).encode();self.send_response(status);self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(body)));self.send_header('Cache-Control','no-store');self.end_headers();self.wfile.write(body)
    def reply_text(self,status,payload):
        body=str(payload).encode();self.send_response(status);self.send_header('Content-Type','text/plain; charset=utf-8');self.send_header('Content-Length',str(len(body)));self.send_header('Cache-Control','no-store');self.end_headers();self.wfile.write(body)
    def do_POST(self):
        if urlsplit(self.path).path=='/api/whatsapp/webhook':
            secret=os.environ.get('META_APP_SECRET','')
            if not secret:return self.reply(503,{'error':'webhook is not configured'})
            try:size=int(self.headers.get('Content-Length',''))
            except ValueError:return self.reply(400,{'error':'invalid request'})
            if size<0 or size>WEBHOOK_MAX_BYTES:return self.reply(413,{'error':'payload too large'})
            body=self.rfile.read(size)
            supplied=self.headers.get('X-Hub-Signature-256','')
            expected='sha256='+hmac.new(secret.encode(),body,hashlib.sha256).hexdigest()
            if not hmac.compare_digest(supplied,expected):return self.reply(401,{'error':'invalid signature'})
            try:
                payload=json.loads(body)
                if not isinstance(payload,dict):raise ValueError()
            except (UnicodeDecodeError,json.JSONDecodeError,ValueError):
                return self.reply(400,{'error':'invalid payload'})
            duplicate=is_duplicate_webhook(body)
            parsed,structures=webhook_changes(payload)
            for field,classification,item_count,skip_reason in structures:
                _webhook_logger.info(
                    'WhatsApp webhook change: field=%s classification=%s item_count=%s skip_reason=%s',
                    field,classification,item_count,skip_reason or 'none',
                )
            enabled=ingestion_enabled()
            ingestible=[]
            for field,classification,message,skip_reason in parsed:
                has_id=bool(message and message.get('meta_message_id'))
                if message is not None and has_id and enabled:
                    ingestible.append((field,classification,message))
                    continue
                reason=skip_reason or 'ingestion_disabled'
                _webhook_logger.info(
                    'WhatsApp webhook item: field=%s classification=%s item_count=1 has_id=%s skip_reason=%s',
                    field,classification,str(has_id).lower(),reason,
                )
            for field,classification,message in ingestible:
                try:store_whatsapp_message(message)
                except Exception:
                    _webhook_logger.error(
                        'WhatsApp webhook item: field=%s classification=%s '
                        'item_count=1 has_id=true skip_reason=ingestion_failed',field,classification,
                    )
                    return self.reply(503,{'error':'ingestion unavailable'})
                _webhook_logger.info(
                    'WhatsApp webhook item: field=%s classification=%s '
                    'item_count=1 has_id=true skip_reason=none',field,classification,
                )
            return self.reply(200,{'ok':True,'duplicate':duplicate})
        if self.path=='/api/admin/invite':
            try:
                if not SUPABASE_SERVICE_ROLE_KEY:return self.reply(503,{'error':'Invite service is not configured yet'})
                auth=self.headers.get('Authorization','')
                if not auth.lower().startswith('bearer '):return self.reply(401,{'error':'Please log in again'})
                token=auth[7:].strip()
                size=int(self.headers.get('Content-Length','0'))
                if size<2 or size>10_000:return self.reply(400,{'error':'Invalid invite'})
                payload=json.loads(self.rfile.read(size))
                email=str(payload.get('email','')).strip().lower()
                name=str(payload.get('name','')).strip()[:100]
                if '@' not in email or len(email)>254:return self.reply(400,{'error':'Enter a valid email'})
                admin_req=Request(f'{SUPABASE_URL}/rest/v1/rpc/is_admin',data=b'{}',method='POST',headers={
                    'apikey':SUPABASE_KEY,'Authorization':f'Bearer {token}','Content-Type':'application/json'
                })
                with urlopen(admin_req,timeout=20) as res:
                    if json.loads(res.read() or b'false') is not True:return self.reply(403,{'error':'Admin access required'})
                body=json.dumps({'email':email,'data':{'name':name}}).encode()
                invite_req=Request(f'{SUPABASE_URL}/auth/v1/invite?redirect_to={quote(SITE_URL,safe="")}',data=body,method='POST',headers={
                    'apikey':SUPABASE_SERVICE_ROLE_KEY,'Authorization':f'Bearer {SUPABASE_SERVICE_ROLE_KEY}','Content-Type':'application/json'
                })
                with urlopen(invite_req,timeout=20) as res:json.loads(res.read() or b'{}')
                return self.reply(200,{'ok':True})
            except HTTPError as e:
                try:
                    error_body=json.loads(e.read())
                    detail=error_body.get('msg') or error_body.get('message')
                except Exception:detail=None
                return self.reply(e.code if e.code in (400,401,403,422,429) else 400,{'error':detail or 'Unable to send invite'})
            except Exception:return self.reply(400,{'error':'Unable to send invite'})
        if self.path=='/api/openclaw/listings':
            try:
                size=int(self.headers.get('Content-Length','0'))
                if size<2 or size>8_000_000:return self.reply(413,{'error':'payload too large'})
                auth=self.headers.get('Authorization','')
                if not auth.lower().startswith('bearer '):return self.reply(401,{'error':'missing API key'})
                api_key=auth[7:].strip()
                if not api_key.startswith('mari_') or len(api_key)<30:return self.reply(401,{'error':'invalid API key'})
                payload=json.loads(self.rfile.read(size))
                listing=payload.get('listing',payload) if isinstance(payload,dict) else None
                if not isinstance(listing,dict):return self.reply(400,{'error':'listing must be an object'})
                body=json.dumps({'raw_key':api_key,'listing':listing}).encode()
                req=Request(f'{SUPABASE_URL}/rest/v1/rpc/import_listing_with_api_key',data=body,method='POST',headers={
                    'apikey':SUPABASE_KEY,'Authorization':f'Bearer {SUPABASE_KEY}','Content-Type':'application/json'
                })
                with urlopen(req,timeout=20) as res:
                    result=json.loads(res.read() or b'{}')
                return self.reply(201,{'ok':True,'listing_id':result.get('listing_id')})
            except HTTPError as e:
                try:detail=json.loads(e.read()).get('message','import failed')
                except Exception:detail='import failed'
                status=401 if e.code in (400,401,403) and 'key' in detail.lower() else 400
                return self.reply(status,{'error':detail})
            except Exception:return self.reply(400,{'error':'invalid listing'})
        if self.path=='/api/imports':
            try:
                size=int(self.headers.get('Content-Length','0'))
                if size>45_000_000:return self.reply(413,{'error':'too large'})
                item=json.loads(self.rfile.read(size))
                if not isinstance(item,dict) or not isinstance(item.get('listings'),list):raise ValueError()
                sid=secrets.token_urlsafe(24);data=load_imports();data[sid]=item;save_imports(data)
                return self.reply(201,{'token':sid})
            except Exception:return self.reply(400,{'error':'invalid import'})
        if self.path!='/api/shares':return self.send_error(404)
        try:
            size=int(self.headers.get('Content-Length','0'))
            if size>45_000_000:return self.reply(413,{'error':'too large'})
            item=json.loads(self.rfile.read(size));sid=secrets.token_urlsafe(8);data=load();data[sid]=item;save(data);self.reply(201,{'id':sid})
        except Exception:return self.reply(400,{'error':'invalid listing'})
    def do_PUT(self):
        if self.path!='/api/state':return self.send_error(404)
        try:
            size=int(self.headers.get('Content-Length','0'))
            if size>55_000_000:return self.reply(413,{'error':'too large'})
            item=json.loads(self.rfile.read(size))
            if not isinstance(item,dict) or not all(k in item for k in ('leads','listings','cases')):raise ValueError()
            tmp=STATE.with_suffix('.tmp');tmp.write_text(json.dumps(item,separators=(',',':')));tmp.replace(STATE)
            self.reply(200,{'ok':True})
        except Exception:return self.reply(400,{'error':'invalid state'})
    def do_GET(self):
        parsed=urlsplit(self.path)
        if parsed.path=='/api/whatsapp/webhook':
            query=parse_qs(parsed.query)
            token=os.environ.get('WHATSAPP_VERIFY_TOKEN','')
            supplied=query.get('hub.verify_token',[''])[0]
            if token and query.get('hub.mode',[''])[0]=='subscribe' and hmac.compare_digest(supplied,token):
                return self.reply_text(200,query.get('hub.challenge',[''])[0])
            return self.reply(403,{'error':'verification failed'})
        if self.path.startswith('/api/catalog/'):
            try:
                owner=self.path.split('/api/catalog/',1)[1].split('?',1)[0].strip()
                if not owner or len(owner)>64:return self.reply(400,{'error':'invalid agent'})
                key=SUPABASE_SERVICE_ROLE_KEY or SUPABASE_KEY
                rows=[];offset=0;page_size=10
                while True:
                    url=f'{SUPABASE_URL}/rest/v1/team_listings?owner_id=eq.{quote(owner,safe="")}&select=id,listing,created_at&order=created_at.desc&limit={page_size}&offset={offset}'
                    # Supabase publishable keys are valid in `apikey`, but unlike
                    # legacy JWT anon keys they must not be sent as Bearer tokens.
                    req=Request(url,headers={'apikey':key})
                    try:
                        with urlopen(req,timeout=30) as res:page=json.loads(res.read() or b'[]')
                    except HTTPError as e:
                        if e.code not in (401,403) or key==SUPABASE_KEY:raise
                        # A stale/rotated Render secret must not break the public
                        # catalog; the anon key is intentionally read-only via RLS.
                        req=Request(url,headers={'apikey':SUPABASE_KEY})
                        with urlopen(req,timeout=30) as res:page=json.loads(res.read() or b'[]')
                    rows.extend(page)
                    if len(page)<page_size:break
                    offset+=page_size
                listings=[]
                for row in rows:
                    item=row.get('listing') if isinstance(row.get('listing'),dict) else {}
                    listings.append({**item,'id':row.get('id'),'_createdAt':row.get('created_at')})
                return self.reply(200,{'listings':listings})
            except HTTPError as e:return self.reply(e.code if e.code<500 else 502,{'error':'catalog unavailable'})
            except Exception:return self.reply(500,{'error':'catalog unavailable'})
        if self.path.startswith('/api/imports/'):
            sid=self.path.split('/')[-1].split('?')[0];item=load_imports().get(sid)
            return self.reply(200,item) if item else self.reply(404,{'error':'not found'})
        if self.path.split('?')[0]=='/api/state':
            try:return self.reply(200,json.loads(STATE.read_text()))
            except Exception:return self.reply(200,{'updatedAt':0,'leads':[],'listings':[],'cases':[]})
        if self.path.startswith('/api/shares/'):
            sid=self.path.split('/')[-1].split('?')[0];item=load().get(sid)
            return self.reply(200,item) if item else self.reply(404,{'error':'not found'})
        super().do_GET()
    def do_DELETE(self):
        if not self.path.startswith('/api/imports/'):return self.send_error(404)
        sid=self.path.split('/')[-1].split('?')[0];data=load_imports()
        if sid not in data:return self.reply(404,{'error':'not found'})
        del data[sid];save_imports(data);self.reply(200,{'ok':True})
if __name__=='__main__':
    port=int(os.environ.get('PORT','8080'))
    ThreadingHTTPServer(('0.0.0.0',port),Handler).serve_forever()
