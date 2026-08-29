---
"@ontrails/warden": minor
"@ontrails/trails": minor
"@ontrails/config": minor
"@ontrails/topography": patch
---

Warn when a configured workspace contains a nested `trails.lock` outside `workspace.apps`, and reject a workspace-root aggregate lock without deriving app identity from either artifact.

Make the Trails operator topo reproducible by keeping its authored examples free of temporary filesystem paths, so its committed app-owned lock validates deterministically.

Replay known operator current-app examples through the selected Config entry, including the nested project input in the authored `run` example, so custom app layouts do not fall back to `src/app.ts` without rewriting matching fields in domain examples.

Add `trails config explain` as the operator-owned inspection surface for source-static project and app identity. It reports the Config-authored catalog, selected extent, and selection provenance without loading app modules or reading locks.

**BREAKING:** Remove the public `@ontrails/config` `configExplain` trail export. Library consumers that inspect resolved deployment provenance must migrate to `deriveConfigProvenance`; operators and agents that inspect Config-authored app identity must migrate to `trails config explain`. The broader config cascade stays deferred.
