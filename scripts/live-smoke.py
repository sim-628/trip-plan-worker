#!/usr/bin/env python3
"""Read-only live queries + a local fixture transaction. Requires TRIP_GATEWAY_TOKEN.
No orders, payments, or real user-table mutations. Evidence stays in ignored .local-backups.
"""
import os,json,pathlib,time,uuid,urllib.request,urllib.error,concurrent.futures,subprocess
ROOT=pathlib.Path(__file__).resolve().parents[1]
OUT=ROOT/'.local-backups/live-tests';OUT.mkdir(parents=True,exist_ok=True)
BASE='https://trip-plan-worker.zhengpushen.workers.dev/travel/v1'
TOKEN=os.environ['TRIP_GATEWAY_TOKEN']
def request(path,body=None,token=None,key=None):
 h={'Authorization':'Bearer '+TOKEN,'Content-Type':'application/json','User-Agent':'TripPlan/1 CFNetwork'}
 if token:h['X-Session-Token']=token
 if body is not None:h['Idempotency-Key']=key or str(uuid.uuid4())
 req=urllib.request.Request(BASE+path,headers=h,data=None if body is None else json.dumps(body).encode())
 for attempt in range(3):
  try:
   with urllib.request.urlopen(req,timeout=90) as r:return json.load(r)
  except urllib.error.HTTPError as e:raise RuntimeError(str(e.code)+': '+e.read().decode()[:500])
  except urllib.error.URLError:
   if attempt==2:raise
   time.sleep(1)

def run(name,prompt,capabilities=None,followup=None):
 s=request('/sessions',{'input':prompt,'timezone':'Asia/Shanghai','capabilities':capabilities or []})
 (OUT/(name+'-session.json')).write_text(json.dumps(s))
 token=s['session_token'];path='/sessions/'+s['id'];seen=set();signature=None;followed=False
 snapshot={'tripId':None,'version':0,'tables':{t:[] for t in ['trips','flights','hotels','transports','pois']},'receipts':{}}
 start=time.time()
 while time.time()-start<1000:
  r=request(path,token=token);(OUT/(name+'-status.json')).write_text(json.dumps(r,ensure_ascii=False,indent=2))
  sig=json.dumps([r.get('status'),r.get('error'),[(j['name'],j['status'],j.get('error')) for j in r.get('dispatches',[])]],ensure_ascii=False)
  if sig!=signature:print(name,sig,flush=True);signature=sig
  for a in r.get('required_actions',[]):
   if a['call_id'] in seen:continue
   if a['name']=='read_local_trip':output={k:v for k,v in snapshot.items() if k!='receipts'}
   elif a['name']=='apply_local_trip_changes':
    job={'snapshot':snapshot,'batch':a['arguments']}
    result=subprocess.run([os.environ.get('TRIP_NODE','node'),'--input-type=module','-e',"import {applyLocalChanges} from './dist/local-store.mjs';let s='';for await(const c of process.stdin)s+=c;const j=JSON.parse(s);console.log(JSON.stringify(applyLocalChanges(j.snapshot,j.batch)));"],input=json.dumps(job),text=True,capture_output=True,cwd=ROOT)
    if result.returncode:raise RuntimeError('Reference local transaction failed: '+result.stderr[:600])
    saved=json.loads(result.stdout);snapshot=saved['snapshot'];output=saved['result']
    tmp=OUT/(name+'-local.tmp');tmp.write_text(json.dumps(snapshot,ensure_ascii=False,indent=2));tmp.replace(OUT/(name+'-local.json'))
   else:raise RuntimeError('Unexpected client action '+a['name'])
   request(path+'/results',{'call_id':a['call_id'],'success':True,'output':output},token=token,key='receipt-'+a['call_id']);seen.add(a['call_id'])
  if r.get('status') in ['completed','failed']:
   if r['status']=='completed' and followup and not followed:
    (OUT/(name+'-first-turn.json')).write_text(json.dumps(r,ensure_ascii=False,indent=2));request(path+'/messages',{'input':followup},token=token);followed=True;continue
   final=[m['text'] for m in r.get('messages',[]) if m.get('phase')=='final_answer'];print(name,'FINAL',final[-1][:1400] if final else r.get('error'),flush=True)
   return {'scenario':name,'status':r['status'],'dispatches':r.get('dispatches',[]),'local_fixture_version':snapshot['version'],'duration_seconds':round(time.time()-start)}
  time.sleep(5)
 raise RuntimeError(name+' exceeded observation timeout')
SCENARIOS=[
 ('01-clarification','我们一家带孩子想去杭州玩几天，帮我推荐酒店。'),
 ('02-train','只查2026年11月20日杭州到黄山的高铁，1名成人，上午出发，二等座，最多2班，不放入行程。'),
 ('03-hotel','2026年11月20日入住、22日离店，上海人民广场附近，2位成人，1间房，每晚预算1000元人民币以内。比较2家酒店，先不保存。',[], '选你推荐的第一家。请复核价格和入住人数，并调用酒店静态信息子 Agent 补齐酒店资料，给出可保存草案；当前没有本地存储，暂不保存。不下单。'),
 ('04-complete-trip','上海出发，2026年12月10日到12日去东京，2名成人，经济舱，1间房每晚1500元人民币以内。给一版往返航班、酒店、博物馆景点、每天午晚餐的轻松行程，并查询东京塔观景台门票。先只出草案，不保存，不下单。'),
 ('05-local-write','这是本地写表接口验证。请创建一个空的正式行程，名字叫杭州两日游，2026年11月20日至21日，状态规划中。只写行程主表，其他表保持空，不查任何供给。我确认保存。',['local_trip_storage']),
]
if __name__=='__main__':
 results=[]
 with concurrent.futures.ThreadPoolExecutor(max_workers=5) as pool:
  futures={pool.submit(run,*case):case[0] for case in SCENARIOS}
  for f in concurrent.futures.as_completed(futures):
   try:results.append(f.result())
   except Exception as e:print(futures[f],'ERROR',str(e),flush=True);results.append({'scenario':futures[f],'error':str(e)})
 (OUT/'summary.json').write_text(json.dumps(results,ensure_ascii=False,indent=2));print('Finished',len(results),'scenarios',flush=True)
