#!/usr/bin/env python3
"""Sync only main-agent instructions/tools. OPENAI_API_KEY comes from the environment."""
import json, os, pathlib, urllib.request, urllib.error, datetime
root=pathlib.Path(__file__).resolve().parents[1]
key=os.environ['OPENAI_API_KEY']
agent=json.loads((root/'agents/manifest.json').read_text())['mainAgent']['id']
url='https://api.openai.com/v1/agents/'+agent
headers={'Authorization':'Bearer '+key,'OpenAI-Beta':'agents=v1','Content-Type':'application/json'}
with urllib.request.urlopen(urllib.request.Request(url,headers=headers),timeout=60) as response: old=json.load(response)
backup=root/'.local-backups';backup.mkdir(exist_ok=True,mode=0o700)
path=backup/('main-agent-'+datetime.datetime.now().strftime('%Y%m%d-%H%M%S')+'.json')
path.write_text(json.dumps(old,ensure_ascii=False,indent=2));path.chmod(0o600)
body={'instructions':(root/'agents/mainAgent.md').read_text(),'tools':json.loads((root/'agents/main-tools.json').read_text()),'multi_agent':{'enabled':False}}
try:
    with urllib.request.urlopen(urllib.request.Request(url,headers=headers,data=json.dumps(body).encode()),timeout=60) as response: result=json.load(response)
except urllib.error.HTTPError as error:
    raise SystemExit('Update failed: '+error.read().decode().replace(key,'[redacted]'))
print(json.dumps({'agent_id':result['id'],'function_count':len(result['tools']),'native_multi_agent':result.get('multi_agent')},ensure_ascii=False))
