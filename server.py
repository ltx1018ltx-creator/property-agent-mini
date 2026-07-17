#!/usr/bin/env python3
import json, os, secrets
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path

ROOT=Path(__file__).resolve().parent
DATA=ROOT/'shares.json'
STATE=ROOT/'agent-state.json'
def load():
    try:return json.loads(DATA.read_text())
    except:return {}
def save(data):DATA.write_text(json.dumps(data,separators=(',',':')))
class Handler(SimpleHTTPRequestHandler):
    def __init__(self,*a,**kw):super().__init__(*a,directory=str(ROOT),**kw)
    def end_headers(self):
        if self.path.endswith(('.html','.js','.css','/')):self.send_header('Cache-Control','no-cache, no-store, must-revalidate')
        super().end_headers()
    def reply(self,status,payload):
        body=json.dumps(payload).encode();self.send_response(status);self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(body)));self.send_header('Cache-Control','no-store');self.end_headers();self.wfile.write(body)
    def do_POST(self):
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
        if self.path.split('?')[0]=='/api/state':
            try:return self.reply(200,json.loads(STATE.read_text()))
            except Exception:return self.reply(200,{'updatedAt':0,'leads':[],'listings':[],'cases':[]})
        if self.path.startswith('/api/shares/'):
            sid=self.path.split('/')[-1].split('?')[0];item=load().get(sid)
            return self.reply(200,item) if item else self.reply(404,{'error':'not found'})
        super().do_GET()
port=int(os.environ.get('PORT','8080'))
ThreadingHTTPServer(('0.0.0.0',port),Handler).serve_forever()
