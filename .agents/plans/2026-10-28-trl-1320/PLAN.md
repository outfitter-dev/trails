# TRL-1320 execution contract

Implement [TRL-1320](https://linear.app/outfitter/issue/TRL-1320/record-evaluated-app-identity-in-warden-results-executedappid) through a reviewed draft PR. Standing rolling Lane E authority covers owned source, tests, docs, changesets, normal commits/push and draft creation. Tracker status, readiness, merge, publication, deployment and authentication remain outside this lane. Operator owns cross-worktree history and normalization. No other source writer.

Branch `trl-1320-record-evaluated-app-identity-in-warden-results`, owned checkout `/Users/mg/.codex/worktrees/trl-1320-warden-identity/trails`, actual remote-main base `e67d90f5c1679daf4bc490f00d1879ec7c109bfa`. Prerequisite TRL-1321 is Done; its landed commit `0ebbb37280fa090a3dad53d0f738e3080204f777` is an ancestor. No dependency on E1417, E1420 or the unmerged A1421 tooling change is invented.

Success: a no-diagnostic topo-aware one-app Warden result identifies the app actually evaluated as optional top-level `executedAppId`, including output-schema parsing and CLI JSON. Derive it from the shared command report's single evaluated topo name. Source-only observations and workspace-wide observations omit the singular field; a workspace with one configured app remains a workspace observation. Preserve project selection, workspace evidence, format aliases, errors, safe-fix preflight and diagnostic behavior. Do not expand TRL-1322 or introduce a second app resolver.

Owned paths: existing operator Warden trail and regression file, nearest operator README, operator patch changeset, normal regenerated operator lock, and this packet. No unrelated cleanup or file splitting. Existing Warden file size is pre-existing; this bounded identity projection does not justify a broad refactor.

Verify red/green actual shared-runner fixtures, schema and real CLI JSON; full wrapper suite, package typecheck, repository format/lint, docs validation, release packing, Wayfinder dogfood and cold lock roundtrip. Independent local review before normal push; distinct fresh acceptance and current hosted gates before operator-authorized landing. Keep PR draft. Existing pins/runtime remain unchanged.
