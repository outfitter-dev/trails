# Sources and ownership

- [TRL-1459](https://linear.app/outfitter/issue/TRL-1459): explicitly lands typed slot/test double before real MCP handler.
- [TRL-1340](https://linear.app/outfitter/issue/TRL-1340): real portable SDK-v2 fetch handler and both-era/client proof. B confirmed the structural `Request` to `Promise<Response>` boundary and shared ResourceOverrideMap/createContext/configValues, with no settled new SDK export promised here.
- [TRL-1452](https://linear.app/outfitter/issue/TRL-1452), [TRL-1424](https://linear.app/outfitter/issue/TRL-1424), [TRL-1469](https://linear.app/outfitter/issue/TRL-1469): adapter facts/namespace, lock design and later rendering. No preemptive saved path/namespace fact in this branch.
- Astra's bounded host ruling: one ordinary pure typed config value, separate runtime factory, existing trailsOverlays discovery only, exact path, explicit collisions/presence validation; future overlay closes over the same value. Fully summarized in PLAN and package guide.
- `adapters/cloudflare/src/env.ts` and workers materializer: existing env identity/override/resource selection ownership. `packages/http/src/build.ts` owns route derivation; core matchWebhookPath owns pattern matching used for collision checks.
- `AGENTS.md`, planning guide, code standards, tenets and lexicon govern delivery. Accepted ADR-0055 is protocol direction, not evidence this slot implements transport.
- Actual main `8cbbdea13d38517cf674f5b2c6d457f39f33ccf7`; operator preserved the earlier untracked test and readiness packet while updating the empty branch. Role packages remain separate source histories; no false linear ancestry.
