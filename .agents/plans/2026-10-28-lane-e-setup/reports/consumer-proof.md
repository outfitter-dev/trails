# Local Dispatch Next consumer proof

Consumer HEAD: `03b6f1782a8a2b0f62c6df738ca9bd4cd3e62899` (original clean before/after). Candidate: assigned TRL-1416 branch from `34d7f6e14b0367b51497b08110aabec6c147de6c`, working source under review; final source commit recorded in PR/handoff. Manifest-pinned consumer0.2.4 was exercised with candidate source package family0.2.5 through isolated node_modules links. No original source or dependency mutation; no registry/publication claim.

Sandbox: `/var/folders/b3/yvjlcyr172z__9w1kvv4dl3c0000gn/T/trl-1416-dispatch-next-8gogz8sq`. Copied src/, bin/, **tests**/ and package.json only. Each @ontrails scope entry is a symlink to the matching package/adaptor/app in this candidate worktree; remaining modules point to consumer-installed dependencies. Source `src/trails/system-status.ts` is a static read trail with no resources or compositions. CLI source configures permitPreset and devPermitPreset only.

Invocation environment was env-i plus PATH and fresh sandbox isolation paths for HOME, XDG_CONFIG_HOME, XDG_STATE_HOME, TRAILS_STATE_HOME, XDG_CACHE_HOME. `bun <sandbox>/fidelity.ts` created a harness using the app and its permit/devPermit presets and spawned `[process.execPath, 'bin/cli.ts', 'system', 'status', ...args]` at sandbox cwd. The probe asserted equal exits and expected0 for no flags/1 otherwise; successful payloads were compared as JSON. `bun test <sandbox>/__tests__/surfaces.test.ts` then passed1 test/5 assertions under the same environment.

Observed probe output:

```json
{"isolation":{"HOME":"/var/folders/b3/yvjlcyr172z__9w1kvv4dl3c0000gn/T/trl-1416-dispatch-next-8gogz8sq/isolation/home","XDG_CONFIG_HOME":"/var/folders/b3/yvjlcyr172z__9w1kvv4dl3c0000gn/T/trl-1416-dispatch-next-8gogz8sq/isolation/config","TRAILS_STATE_HOME":"/var/folders/b3/yvjlcyr172z__9w1kvv4dl3c0000gn/T/trl-1416-dispatch-next-8gogz8sq/isolation/state"}}
{"args":[],"harnessExit":0,"cliExit":0,"harnessJson":{"agentRuntimeAvailable":false,"implementationStatus":"foundation-only","service":"dispatch-next"},"cliStdout":"{\n  \"agentRuntimeAvailable\": false,\n  \"implementationStatus\": \"foundation-only\",\n  \"service\": \"dispatch-next\"\n}","cliStderr":""}
{"args":["--output","json"],"harnessExit":1,"cliExit":1,"cliStdout":"","cliStderr":"error: unknown option '--output'"}
{"args":["--json"],"harnessExit":1,"cliExit":1,"cliStdout":"","cliStderr":"error: unknown option '--json'"}
{"args":["--definitely-not-real"],"harnessExit":1,"cliExit":1,"cliStdout":"","cliStderr":"error: unknown option '--definitely-not-real'"}
```

The temporary probe source, sufficient to reproduce after constructing the documented candidate bindings:

```typescript
import { createCliHarness } from '@ontrails/testing/cli';
import { devPermitPreset, permitPreset } from '@ontrails/cli';
import { app } from './src/app.js';
console.log(JSON.stringify({isolation: {HOME:process.env['HOME'], XDG_CONFIG_HOME:process.env['XDG_CONFIG_HOME'], TRAILS_STATE_HOME:process.env['TRAILS_STATE_HOME']}}));
const harness = createCliHarness({graph: app, presets: [permitPreset(), devPermitPreset()]});
for (const args of [[], ['--output', 'json'], ['--json'], ['--definitely-not-real']]) {
 const result = await harness.run(['system', 'status', ...args].join(' '));
 const proc = Bun.spawnSync({cmd: [process.execPath, 'bin/cli.ts', 'system', 'status', ...args], cwd: import.meta.dir, stdout:'pipe', stderr:'pipe'});
 console.log(JSON.stringify({args, harnessExit:result.exitCode, cliExit:proc.exitCode, harnessJson:result.json, cliStdout:proc.stdout.toString().trim(), cliStderr:proc.stderr.toString().trim()}));
 if(result.exitCode !== proc.exitCode || proc.exitCode !== (args.length===0 ? 0 : 1)) throw new Error('Fidelity mismatch');
 if(args.length===0 && JSON.stringify(result.json) !== JSON.stringify(JSON.parse(proc.stdout.toString()))) throw new Error('Payload mismatch');
}
```

Published-registry qualification remains with the release owner and was not attempted.
