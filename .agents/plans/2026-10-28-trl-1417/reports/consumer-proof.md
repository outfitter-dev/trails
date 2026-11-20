# Dispatch Next static source proof

Consumer PR7 exact head0fab8a683821c4901078a7f25b2b443eac777e29. Read with GitHub contents API at exact ref, copying only src/trails/observation-import.ts, src/services/identity.ts, src/store/identity/store.ts, src/services/observations.ts and src/ingress/hook-file.ts to an OS temp directory. No .env, credentials, DB, runtime state or original checkout mutation. These source files were parsed as text, never imported/executed.

Real declaration chain: observation-import.ts calls identityStoreResource.from(context), then identity.ensureStation. services/identity.ts declares `Trails.resource<IdentityStore>`; identity/store.ts56-60 declares ensureStation returning `Trails.Result<Station, IdentityStoreError>`. Class/resource imports use the exact current consumer sources rather than synthetic method-name inference.

Run command `bun .agents/notes/trl-1417-preflight/consumer-probe.ts` on this candidate. It calls the two actual rules against the source path and in-memory variants. Observed authored0return/0wrap; station local annotation removed0return/0wrap; unannotated station.error rewrap0return/1warning atline34 telling caller to return station directly. No other authoring workaround needed. This is source qualification, not a published-package or ingestion-runtime claim.

Reproduction probe (replace temp-root lookup with your isolated copy):

```typescript
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { implementationReturnsResult } from '../../../packages/warden/src/rules/implementation-returns-result.js';
import { noRedundantResultErrorWrap } from '../../../packages/warden/src/rules/no-redundant-result-error-wrap.js';
const root = readFileSync('/tmp/trl-1417-consumer-path','utf8');
const file = join(root,'src/trails/observation-import.ts');
const authored = readFileSync(file,'utf8');
const unannotated = authored.replace('const station: Result<Station, Error>', 'const station');
for(const [shape, code] of [['authored',authored],['unannotated method passthrough',unannotated],['unannotated method redundant wrap',unannotated.replace('return station;', 'return Result.err(station.error);')]] as const){
 const returns = implementationReturnsResult.check(code,file);
 const wraps = noRedundantResultErrorWrap.check(code,file);
 console.log(JSON.stringify({shape, returns, wraps}));
 if(returns.length !==0 || wraps.length !== (shape.endsWith('wrap') ? 1:0)) throw new Error('Consumer source regression');
}
```
