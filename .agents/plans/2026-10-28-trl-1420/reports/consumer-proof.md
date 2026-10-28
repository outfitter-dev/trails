# Disposable Dispatch-shaped realCLI proof

Candidate source on owned1420branch, initialbase4973. Temporary app /var/folders/b3/yvjlcyr172z__9w1kvv4dl3c0000gn/T/trl-1420-cli-consumer-2m047dy3 uses candidate workspace core/CLI sources through installed module links; source defines separate message.read/message.ack contracts with messageId/fact schemas and authored correspondenceFact read/ack. No private consumer checkout, credentials, real DB or message action copied/executed. Every CLI child gets fresh isolated HOME/config/state/cache and a synthetic local permit with topo:write/topo:read; no real auth/registry/provisioning operation.

| Actual command phase | Exit |
| --- | --- |
| initial normal compile | 0 |
| accepted synthetic breaking change | 0 |
| metadata projection through normal compile | 0 |
| current validate | 0 |
| actual Warden | 0 |
| genuine uncompiled drift remains visible | 3 |
| restore matching source validate | 0 |
| deliberate disposable integrity-negative control | 1 |

The synthetic --force stage adds a required input field solely to create genuine nonempty accepted force history. Adding metadata then uses normal compile; exact prior entry-force arrays remain identical. Current validate and Warden pass, with zero Warden diagnostics. Uncompiled real input drift rejects with ConflictError3; restoring matching source validates; deliberately corrupting only the disposable lock hash rejects ValidationError1 stating its graph hash does not match its embedded TopoGraph. That corruption is a negative control, never a workaround or committed artifact edit.

Committed artifacts were refreshed separately through supported normal cold compile only for the two actual roundtrip failures; both retain exact force arrays, and all seven locks now roundtrip byte-identically with validate green. No --force was used on repository locks. Package-release/registry proof remains a separate release-owner task.

Reproduction probe:

```python
from pathlib import Path
import tempfile, subprocess, json, os
repo=Path.cwd(); root=Path(tempfile.mkdtemp(prefix='trl-1420-cli-consumer-')); (root/'src').mkdir()
(root/'package.json').write_text(json.dumps({'name':'metadata-consumer','private':True,'type':'module'}))
(root/'node_modules').symlink_to(repo/'node_modules',target_is_directory=True)
for name in ['home','state','config','cache']:(root/name).mkdir()
env={'PATH':os.environ['PATH'],'HOME':str(root/'home'),'XDG_STATE_HOME':str(root/'state'),'TRAILS_STATE_HOME':str(root/'state'),'XDG_CONFIG_HOME':str(root/'config'),'XDG_CACHE_HOME':str(root/'cache')}
cli=repo/'apps/trails/bin/trails.ts'; evidence=[]
def author(required=False,meta=False):
 (root/'src/app.ts').write_text('''import { Result, topo, trail } from '@ontrails/core';
import { z } from 'zod';
const make = (id: string, fact: string) => trail(id, {
 input: z.object({ messageId: z.string()'''+(', channel: z.string()' if required else '')+''' }),
 output: z.object({ fact: z.string() }),
 implementation: () => Result.ok({ fact: 'recorded' }),
 intent: 'write', permit: 'public','''+(' meta: { correspondenceFact: fact },' if meta else '')+'''
});
export const read=make('message.read','read'); export const ack=make('message.ack','ack');
export const app=topo('metadata-consumer',{read,ack});
''')
def run(label,args,expected=0):
 cmd=['bun',str(cli),*args,'--permit',json.dumps({'id':'local-metadata-proof','scopes':['topo:write','topo:read']}),'--root-dir',str(root),'--json'];r=subprocess.run(cmd,env=env,capture_output=True,text=True,cwd=root)
 evidence.append({'label':label,'command':cmd,'exit':r.returncode,'stdout':r.stdout,'stderr':r.stderr})
 print(json.dumps({'label':label,'exit':r.returncode,'stdout':r.stdout[:1200],'stderr':r.stderr[:500]}),flush=True)
 if expected is not None and r.returncode!=expected:raise RuntimeError('Unexpected exit '+label)
 return r
try:
 author();run('initial normal compile',['compile'])
 author(required=True);run('accepted synthetic breaking change',['compile','--force'])
 prior=json.loads((root/'trails.lock').read_text()); prior_forces={entry['id']:entry.get('forces',[]) for entry in prior['topoGraph']['entries']}
 assert any(prior_forces.values()),'Expected genuine force history'
 author(required=True,meta=True);run('metadata projection through normal compile',['compile'])
 current=json.loads((root/'trails.lock').read_text()); entries=current['topoGraph']['entries']
 assert {entry['meta']['correspondenceFact'] for entry in entries}=={'read','ack'}
 assert all(entry.get('forces',[])==prior_forces[entry['id']] for entry in entries),'Force history changed'
 run('current validate',['validate']);report=run('actual Warden',['warden'])
 assert 'Likely duplicate public trail contracts' not in report.stdout
 author(required=False,meta=True);run('genuine uncompiled drift remains visible',['validate'],expected=None)
 assert evidence[-1]['exit']!=0,'Expected uncompiled source drift rejection'
 author(required=True,meta=True);run('restore matching source validate',['validate'])
 damaged=json.loads((root/'trails.lock').read_text());damaged['topoGraphHash']='0'*64
 (root/'trails.lock').write_text(json.dumps(damaged))
 integrity=run('deliberate disposable integrity-negative control',['validate'],expected=None)
 assert integrity.returncode!=0 and 'hash' in (integrity.stdout+integrity.stderr).lower(),'Expected integrity rejection'
finally:
 Path('/tmp/trl-1420-cli-consumer-path').write_text(str(root))
 Path('/tmp/trl-1420-cli-consumer-evidence.json').write_text(json.dumps({'root':str(root),'env':env,'evidence':evidence},indent=2))
```
