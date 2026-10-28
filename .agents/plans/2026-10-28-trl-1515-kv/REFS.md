# Sources and acceptance map

- [TRL-1515](https://linear.app/outfitter/issue/TRL-1515): "Contract, mock, and conformance suite published; the in-memory mock passes the suite" and "The Cloudflare KV binding passes the suite via the rebinding issue in this milestone." Source/pack ready is only this branch's disposition; publication/provider proof remain incomplete.
- [TRL-1517](https://linear.app/outfitter/issue/TRL-1517), [TRL-1518](https://linear.app/outfitter/issue/TRL-1518), [TRL-1519](https://linear.app/outfitter/issue/TRL-1519): shared role policy and separately owned provider conformance/migration.
- [TRL-1438](https://linear.app/outfitter/issue/TRL-1438) and preserved849b05610 docs/adr/0058-deploy-derives-from-the-topo.md:63-71/145-154: approved role/profile direction with originally open package ownership. Coordinator rolling adoption resolves package-home policy; no duplicated ADR re-authoring on1515.
- docs/adr/0051-package-ownership-follows-natural-altitude.md:31-39: "The owner is the lowest package where the concept is still coherent and reusable." Separate runtime role owners; not adapter-kit/deploy/umbrella.
- packages/store/src/types.ts:515-520 explicitly documents typed throw-based infrastructure accessor boundary; packages/store/src/testing.ts:12-46/86-95 and package.json:18-24 demonstrate isolated shared cases and /testing export split.
- Astra01a18425-e956-7123-a2c4-fca2e44ef97f confirmed typed top-levelrole specialization, cfD1 precedent, no newcoreprotocol/registry, discriminatedcompletion, overflow/expiry and compatibleTTLclockseam. Contract-alignment advice is not independent implementation review clearance.
- packages/core/src/resource.ts:68-74/157-165 fixed base declaration; adapters/cloudflare/src/d1/index.ts:101-108/1058-1066 top-level specialization precedent; core topo preserves declaration object. packages/topography/src/derive.ts:581-596 only projects base resource fields: role is not lock/hash-visible yet.
- Existing Cloudflare KV src/kv/index.ts:100-106 explicitly skips minimumTTL in its memory mock. Its provider-native API/options remain separate until1519; new neutral schemas do not pretend this is conformance.

| Acceptance | Branch evidence | Disposition |
| --- | --- | --- |
| Runtime contract/schema/types and resource defaultmock | packages/kv/src/{schemas,types,resource,index}.ts; schema/role/override/testAll tests | Implemented, local verification ongoing |
| Memory shared conformance | packages/kv/src/memory.ts, testing.ts and3 focused testfiles |20 focused tests independently passed; unchanged after integration |
| Runtime/test split and portable root | package exports root+/testing; Workers-target bundle test | Local proof, no provider proof |
| Distribution | README/TSDoc, minor changeset, minimal15linebun.lock, newpackage packcheck | Pack passes, publication not attempted |
| Provider rebinding and migration | TRL-1519 | Not delivered here |
| Registry publication | Releaseowner operation | Not authorized or claimed |

## Qualified prerequisite integration evidence

Current base d26c3ff88a843e45c8a505cd614963f11ca471e8 is the genuine TRL-1421 commit-path dependency, consumed through the operator-owned integration. Original37base source proof is preserved by byte-identical21owned-path restore: patch SHA25689c92506142d430c23b5eaec7f44309ff91cd5fa4849e1f96a25d828e310deb1. WIPa240acbb6df134474d8e983f97f11d81e1f09623 and index49e896b7af3ba2ff0c03f3b7608eaac8f50ffe6b retain original stagedsource/provenancenoise separately. Result index6b4c530847cf6b029fe02b0941fef5155b01da14 excludesSkillsetnoise; qualified sync changed noSkillsetlock. Recoveryref refs/codex-recovery/lane-d-1515-before-1421-d26c3ff remains. No upstream qualification level is silently upgraded to merged/hosted proof.
