# Goal Prompt: HTTP Bun + Observability Closeout Stack

Paste this into a fresh goal executor session:

````markdown
/goal Execute the Trails HTTP Bun + Observability Closeout stack end to end from cwd `/Users/mg/Developer/outfitter/trails`.

Do not use the Trails skill. It is out of date for the current package-boundary and release-readiness doctrine and has confused earlier runs.

Primary source of truth:
`/Users/mg/Developer/outfitter/trails/.agents/plans/2026-05-16-http-bun-observability-closeout/PLAN.md`

Read first:
- `/Users/mg/Developer/outfitter/trails/AGENTS.md`
- `/Users/mg/Developer/outfitter/trails/.agents/plans/PLANNING.md`
- `/Users/mg/Developer/outfitter/trails/.agents/plans/2026-05-16-http-bun-observability-closeout/PLAN.md`
- `/Users/mg/Developer/outfitter/trails/.agents/plans/2026-05-16-http-bun-observability-closeout/REFS.md`
- Linear issues `TRL-715`, `TRL-727`, `TRL-719`, `TRL-716`, `TRL-717`, `TRL-720`, `TRL-721`, `TRL-722`, `TRL-723`, `TRL-724`, `TRL-725`, `TRL-726`, `TRL-365`, and `TRL-718`

Preflight:
1. Run `gt sync`, check out current `main`, and verify `git status --short --branch`.
2. Confirm the only planning-file changes are this new tracked packet plus the tracked removal of the completed `2026-05-13-v1-readiness-closure-stack` packet, whose archived copy is intentionally ignored.
3. Confirm PR #447 is closed and not merged; it is seed material only.
4. Confirm stale draft PR #479 is unrelated and is not the base for this stack.
5. Confirm Linear dependency links match the packet.
6. Commit this tracked plan packet on the lowest execution branch.

Objective:
Build the full 14-PR stack locally, including HTTP kernel/Bun/Hono parity, `@ontrails/pino` package setup and sink, `@ontrails/tracing/otel` hardening, CI optimization, and final docs closeout. Run local review loops until no P0/P1/P2 findings remain, submit high-quality draft PRs, mark ready only after CI/local review are clean, resolve remote P2+ feedback bottom-up, and stop without merging or publishing.

Stack order and exact branch names:
1. `TRL-715` — `trl-715-refactorhttp-extract-web-fetch-kernel-at-ontrailshttpfetch`
2. `TRL-727` — `trl-727-docsadr-codify-web-fetch-kernel-extraction-principle`
3. `TRL-719` — `trl-719-refactorhono-consume-ontrailshttpfetch-kernel`
4. `TRL-716` — `trl-716-feathttp-add-bun-native-surface-at-ontrailshttpbun`
5. `TRL-717` — `trl-717-testhttp-lock-hono-and-bun-http-surface-parity`
6. `TRL-720` — `trl-720-chorepino-scaffold-publishable-ontrailspino-package`
7. `TRL-721` — `trl-721-featpino-implement-structural-pino-log-sink`
8. `TRL-722` — `trl-722-docspino-document-and-gate-ontrailspino-publishing`
9. `TRL-723` — `trl-723-feattracing-complete-otel-attribute-mapping`
10. `TRL-724` — `trl-724-testtracing-harden-otel-trace-lineage-and-status-semantics`
11. `TRL-725` — `trl-725-fixtracing-harden-otel-buffering-flush-and-exporter-failures`
12. `TRL-726` — `trl-726-docstracing-document-ontrailstracingotel-v1-boundary`
13. `TRL-365` — `trl-365-continue-deeper-ci-optimization-after-workflow-fan-out-lands`
14. `TRL-718` — `trl-718-docs-close-http-and-observability-wording-before-versioning`

It is okay to create the complete local branch chain up front, but do not submit or push empty branches. Build 100% of the stack locally before remote submission.

Core scope:
- `TRL-715`: add public `@ontrails/http/fetch` with `createRouteHandler` and `createFetchHandler`; kernel owns query/body/content-length/errors/diagnostics/request-id/headers/abort/webhook behavior and uses `projectPublicSurfaceError`.
- `TRL-727`: add or amend ADR doctrine for `derive*` projection APIs vs `create*` runtime materializers and the dependency test that rejects standalone `@ontrails/bun`.
- `TRL-719`: refactor `@ontrails/hono` to consume the kernel without changing public API, route order, Hono path semantics, or server lifecycle.
- `TRL-716`: add `@ontrails/http/bun`, using Bun `routes` as fast path, `fetch` as fallback, and `onError` for thrown errors. Do not create `@ontrails/bun`.
- `TRL-717`: add Hono/Bun parity harness covering query/body/errors/redaction/permits/abort/webhook behavior.
- `TRL-720`: scaffold publishable `@ontrails/pino` in `packages/pino`; run `bun install`; add changeset; do not add direct `pino` dependency.
- `TRL-721`: implement structural `PinoLoggerLike`, `PinoSinkOptions`, and `createPinoSink`.
- `TRL-722`: document and gate `@ontrails/pino` publishing.
- `TRL-723`: complete stable `trails.*` OTel attribute mapping.
- `TRL-724`: harden OTel lineage/status semantics.
- `TRL-725`: harden OTel buffering, flush, and exporter failure behavior.
- `TRL-726`: document `@ontrails/tracing/otel` as the v1 OTel home. Do not create `@ontrails/otel`.
- `TRL-365`: implement only the scoped CI optimization in the issue; do not weaken gates.
- `TRL-718`: final docs closeout for touched HTTP/observability/package wording before versioning.

Changesets and publishing:
- Any PR touching publishable `@ontrails/*` package contents needs a branch-local `.changeset/*.md` entry unless it is truthfully release-neutral.
- Publishing guidance must use `bun run publish:check` and `bun run publish:packages`.
- Do not add `npm publish` or `changeset publish` guidance.
- Do not run any real publish command or registry mutation.
- Use `bun run publish:check` as a required stack gate. Use `bun run publish:registry-check` only as a read-only probe where useful.
- Do not add the merge queue label.

Local review loop:
Before submitting remote PRs, run at least three local review rounds from the stack tip. Suggested lanes: HTTP kernel/security, package/publish readiness, observability, docs/ADR/doctrine, CI/stack hygiene. Write reports under `.agents/plans/2026-05-16-http-bun-observability-closeout/reports/`. If the latest pass finds any P0/P1/P2, fix it on the lowest owning branch and run another pass. Stop local review only when the latest pass is P3-only or clean.

Subagents may edit files, run checks, and write reports, but must not run `git add`, `git commit`, `git push`, `gt create`, `gt modify`, `gt submit`, `gt restack`, merge commands, or PR mutation commands. Main agent owns all source-control writes.

Owning-branch fix loop:
1. Triage findings by lowest owning branch.
2. `gt checkout <owning-branch>`.
3. Run `git branch --show-current` before any `gt modify`.
4. Apply the minimal branch-owned fix.
5. Run focused validation.
6. Commit with `gt modify` using a Conventional Commit message.
7. `gt restack`.
8. Walk upward through affected descendants with targeted checks.

Do not use `gt absorb` as the normal review-fix workflow. Do not use `gt modify --into` from another branch.

Tip verification:

```bash
bun scripts/adr.ts map
bun scripts/adr.ts check
bun run typecheck
bun run test
bun run lint
bun run lint:ast-grep
bun run build
bun run format:check
bun run check
bun run publish:check
git diff --check
```

If Warden or generated agent guidance changes, also run:

```bash
bun run warden:agents:sync
bun run warden:skills:sync
bun run warden:agents:check
bun run warden:skills:check
```

Ready and remote review:
- Keep PRs draft until CI and local review are clean.
- Submit high-quality PR bodies with context, changes, verification, risks/rollout notes, and Linear links.
- Mark ready only when CI and local review are clean.
- Wait about 15 minutes after marking ready, then check unresolved review threads and bot comments.
- Resolve all P2 and above feedback from the bottom of the stack upward.
- Treat review-bot errors as blockers until rerun or explicitly explained.
- After at most four post-ready remote-review turns, stop and report current status.

Linear:
- Move issues to In Progress when starting their branches.
- Move issues to In Review when PRs are marked ready.
- Do not mark issues Done until after merge.
- If implementation diverges from an issue or plan, leave a Linear comment explaining what changed and why.
- Record out-of-goal discoveries in `RETRO.md` and create focused Linear follow-up issues when the discovery is real.

Stop rules:
- Stop before any real package publish, package ownership change, token/secret use, or registry mutation.
- Stop if implementation requires `@ontrails/bun` or `@ontrails/otel`.
- Stop if `@ontrails/pino` needs a hard `pino` runtime dependency; update TRL-424 with evidence first.
- Stop if `@ontrails/tracing/otel` needs an OpenTelemetry SDK runtime dependency; update TRL-426 with evidence first.
- Stop if TRL-365 would weaken CI correctness or remove required gates.
- Stop if PR #479 or PR #447 turns out to be required for this stack.
- Stop if a public API, artifact layout, or doctrine decision needs Matt's judgment beyond the issue/ADR scope.
- Stop after four post-ready remote-review turns if P2+ feedback remains.

Completion condition:
The goal is complete when all 14 planned PRs are built, locally reviewed to P3-only/clean, submitted, CI-clean, marked ready, remote P2+ feedback has been handled bottom-up or explicitly reported after the turn limit, Linear statuses are current, package publish readiness is proven by Bun-based checks without any real publish, no forbidden merge/publish/merge-queue action occurred, and the final transcript reports branch/PR status, verification results, local review reports, remote review status, remaining P3s/risks, skipped checks, and blocker status.

Do not merge.
````
