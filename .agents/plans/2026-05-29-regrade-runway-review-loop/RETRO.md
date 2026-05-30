# Regrade Runway Review Loop Retro

Created: 2026-05-29
Status: third-pass findings fixed; final local verification passed and resubmit prepared

## Execution Log

- 2026-05-29: Created packet after confirming stack tip, PR mapping, Graphite `--insert` support, and current vocab-audit blocker.
- 2026-05-29: Inserted `chore/vocab/audit-allowlist-bootstrap-cleanup` under the Regrade/Warden runway stack and restacked upward.
- 2026-05-29: Ran first-pass exacting local reviews across Regrade, Warden, test hygiene, and architecture/contract lanes.
- 2026-05-29: Fixed accepted P0-P2 findings on owning branches, restacked upward, and ran second-pass Regrade + Warden review lanes. Both second-pass lanes reported no P0-P2.
- 2026-05-29: Full test and package publish checks passed at stack tip. `bun run check` surfaced one Warden traceability error in TRL-845; fixed on the owning branch and restacked upward.
- 2026-05-29: Reopened the loop for a third pass after stale subagent lanes were closed. Fresh Regrade, Warden, Clark, and stack-hygiene review surfaced only P2/P3 polish and contract hardening; accepted findings were fixed bottom-up.
- 2026-05-29: Closed the final review agents. The bounded final predicate recheck found no P0-P3 findings after the accepted fixes.

## Branch Log

| Order | Branch | Role | Local Result |
| --- | --- | --- | --- |
| 0 | `chore/vocab/audit-allowlist-bootstrap-cleanup` | Inserted base branch for vocab audit allowlist drift + this review-loop packet. | `bun run vocab:audit` passed. |
| 1 | `warden-tests-type-hygiene` | Existing bottom test-config hygiene branch. | Preserved; no new review-loop code fix required. |
| 2 | `trl-840-harden-ontrailsregrade-package-boundary-before-public-use` | Regrade package boundary. | Fixed stale package-boundary comment and native trail id spelling. |
| 3 | `trl-843-eliminate-regrade-tracer-dead-internal-trail-warden-warning` | Warden dead-internal-trail fixture. | Aligned fixture id with native Regrade trail id. |
| 4 | `trl-842-fix-or-document-example-typing-for-transformed-input-schemas` | Transformed input typing. | No new review-loop fix required. |
| 5 | `trl-844-support-downstream-root-source-collection-for-regrade` | Downstream collection. | Normalized relative roots to absolute roots before returning collected sources. |
| 6 | `trl-845-add-regrade-rule-selection-and-coverage-report-shape` | Regrade report engine. | Fixed mixed partial/whole-word classification, Result traceability for output validation, and synthetic preview naming for the report fixture mapping. |
| 7 | `trl-846-add-radio-shaped-downstream-regrade-regression-fixture` | Radio-shaped downstream fixture. | No new review-loop fix required. |
| 8 | `trl-831-define-the-warden-fix-metadata-contract` | Warden fix contract. | Projected fix metadata into agent guide and documented string-index offsets. |
| 9 | `trl-832-add-term-rewrite-fix-metadata-for-retired-vocabulary` | Term-rewrite metadata. | Added guide coverage for metadata introduced here. |
| 10 | `trl-833-implement-warden-fix-for-safe-source-edits` | Safe source edits. | Constrained safe fixes to scanned files, exposed `--fix` through the app/standalone surfaces, removed applied diagnostics from reports, blocked stale drift after mutation, rejected non-integer edit offsets, and declared the write/public contract explicitly. |

## Local Review Log

| Round | Lanes | Result |
| --- | --- | --- |
| 1 | Regrade engine/fixture, Warden fix pipeline, test hygiene/stack ownership, Clark contract review. | Accepted P1/P2 findings fixed on owning branches. No unresolved P0. |
| 2 | Regrade second pass and Warden second pass. | Both reported no P0-P2. A third hygiene lane could not be spawned because the agent thread limit was reached; covered by local full-suite checks instead. |
| 3 | Regrade root/source collection, Warden safe-fix CLI, Clark contract review, stack/packet hygiene. | Accepted P2/P3 findings fixed bottom-up. Greptile review could not complete because the account-level trial limit had ended, so it is recorded as unavailable external review evidence rather than a clean bot signal. |
| 4 | Final predicate-only recheck over the accepted Warden/changeset/packet fixes. | No P0-P3 findings. Stack remained clean locally and still needed Graphite submit. |

## Finding Ledger

| ID | Pass | Severity | Area | Finding | Decision | Owning Branch | Resolution |
| --- | --- | --- | --- | --- | --- | --- | --- |
| R1 | 1 | P1 | Regrade report | Mixed whole-word + partial matches such as `signal` and `signalHandler` could be reported as rewrite. | Accept | `trl-845-add-regrade-rule-selection-and-coverage-report-shape` | Route mixed matches to `needs-review`; added regression. |
| R2 | 1 | P2 | Regrade package boundary | Comment claimed a blocked deep export existed for literal transform internals. | Accept | `trl-840-harden-ontrailsregrade-package-boundary-before-public-use` | Reworded to describe internal test-harness detail accurately. |
| R3 | 1 | P2 | Warden safe fixes | `--fix` trusted diagnostic `filePath` rather than constraining edits to scanned files under root. | Accept | `trl-833-implement-warden-fix-for-safe-source-edits` | Added root + scanned-file allowlist guard and regression. |
| R4 | 1 | P2 | Warden output | Summary/JSON output did not expose fix counts. | Accept | `trl-833-implement-warden-fix-for-safe-source-edits` | Added fix summary text and JSON `fixes` assertion. |
| R5 | 1 | P2 | Warden agent guide | Agent-guide projection omitted fix capability metadata. | Accept | `trl-831-define-the-warden-fix-metadata-contract` / `trl-832-add-term-rewrite-fix-metadata-for-retired-vocabulary` | Added `fix` projection and tests for metadata visibility. |
| R6 | 1 | P2 | Regrade report trail | Blaze could throw through output parsing. | Accept | `trl-845-add-regrade-rule-selection-and-coverage-report-shape` | Switched to non-throwing output validation. |
| R7 | 1 | P2 | Warden fix contract | Public edit offsets were ambiguous. | Accept | `trl-831-define-the-warden-fix-metadata-contract` | Documented JavaScript string-index semantics. |
| R8 | 1 | P2 | Regrade fixture id | Tracer fixture id used non-native dotted spelling. | Accept | `trl-840-harden-ontrailsregrade-package-boundary-before-public-use` / `trl-843-eliminate-regrade-tracer-dead-internal-trail-warden-warning` | Renamed fixture trail id to `regrade.literal.normalize-export-const`. |
| R9 | local check | P2 | Warden rule compliance | `implementation-returns-result` could not trace Regrade report output-validation helper. | Accept | `trl-845-add-regrade-rule-selection-and-coverage-report-shape` | Added a local `Result`-annotated output-validation helper and returned it from the blaze. |
| R10 | 3 | P3 | Regrade downstream collection | Relative `root` inputs could produce a non-absolute returned root despite absolute source paths. | Accept | `trl-844-support-downstream-root-source-collection-for-regrade` | Resolve `root` up front and preserve absolute-root semantics; added relative-root regression. |
| R11 | 3 | P3 | Regrade report fixture | The built-in report mapping read like production Warden detection instead of a synthetic preview fixture. | Accept | `trl-845-add-regrade-rule-selection-and-coverage-report-shape` | Renamed the mapping to preview/synthetic terminology and updated assertions. |
| R12 | 3 | P2 | Warden safe fixes | Safe edit offsets accepted `NaN`, infinity, and fractional values, which could corrupt source slicing. | Accept | `trl-833-implement-warden-fix-for-safe-source-edits` | Reject non-safe-integer offsets before sorting/applying edits; added offset regressions. |
| R13 | 3 | P2 | Warden safe fixes | Applied safe fixes remained in final diagnostics/counts, so an all-fixed run could still fail. | Accept | `trl-833-implement-warden-fix-for-safe-source-edits` | Track applied diagnostic identities, filter them from the final report, and assert a fixed run passes when drift is skipped. |
| R14 | 3 | P2 | Warden CLI surface | `trails warden --fix` was not exposed through the Trails app wrapper, and standalone help omitted the flag. | Accept | `trl-833-implement-warden-fix-for-safe-source-edits` | Added `fix` to the trail input, projected `--fix`, returned fix summaries, and documented the flag in standalone help. |
| R15 | 3 | P3 | Warden drift | A `--fix` run could report drift evidence gathered from pre-fix source state. | Accept | `trl-833-implement-warden-fix-for-safe-source-edits` | Block drift evidence after source mutation and prompt a rerun for fresh drift. |
| R16 | 3 | P2 | Review evidence | Greptile reviews on #632 and #619-#628 were unavailable with a free-trial-ended account message. | Accept as external blocker | `chore/vocab/audit-allowlist-bootstrap-cleanup` | Record Greptile as unavailable external evidence; rely on local subagent review plus CI/local checks unless account access is restored. |
| R17 | 3 | P2 | Packet hygiene | RETRO files contained stale draft/pending language after the stack was submitted and re-reviewed. | Accept | `chore/vocab/audit-allowlist-bootstrap-cleanup` / `trl-840-harden-ontrailsregrade-package-boundary-before-public-use` | Refresh packet status, submit language, and final-state placeholders. |
| R18 | 3 | P3 | Packet hygiene | Tracked packet text included machine-specific absolute paths. | Accept | `chore/vocab/audit-allowlist-bootstrap-cleanup` / `trl-840-harden-ontrailsregrade-package-boundary-before-public-use` | Replace host-local checkout paths with repo-relative/current-checkout wording. |
| R19 | 3 | P3 | PR metadata | PR #632 had an empty body after Graphite submission. | Accept | GitHub PR metadata | Refresh the PR body with context, changes, verification, and risks before final handoff. |
| R20 | final check | P3 | Warden permit governance | Changing `warden` to write intent produced a `permit.writeWithoutPermit` warning. A scoped permit broke the existing local CLI acceptance path. | Accept | `trl-833-implement-warden-fix-for-safe-source-edits` | Declare `permit: 'public'` explicitly and add a test so the local governance command remains directly runnable while write intent stays visible. |

## Verification Log

| Check | Result |
| --- | --- |
| `bun run vocab:audit` | Passed after inserted base-branch allowlist refresh. |
| Focused Regrade tests | Passed: downstream report, literal transform, Warden dead-internal fixture. |
| Focused Warden tests | Passed: CLI, command, guide, fix, no-legacy-layer-imports. |
| `bun run build` | Passed at stack tip after R20: 23/23 turbo tasks successful. |
| `bun run test` | Passed at stack tip after R20: 38/38 turbo tasks successful. |
| `bun run publish:check` | Passed at stack tip after R20: all public package pack checks passed. |
| `bun run check` | Passed at stack tip after R20. The Warden step reported 0 errors and the three existing demo signal warnings. |
| Third-pass focused Regrade tests | Passed: downstream collect/report tests and package typecheck. |
| Third-pass focused Warden tests | Passed: fix, CLI, command, app Warden wrapper, package/app typecheck, and `bun run format:check`. Final wrapper rerun passed after the public-permit contract pin. |
| `bun trails warden` | Passed after R20 with 0 errors and the three existing demo signal warnings. |

## Submit Log

- 2026-05-29: `RTK_SHIM_BYPASS=1 gt submit --stack --no-interactive --no-edit` created PR #632 for `chore/vocab/audit-allowlist-bootstrap-cleanup` and updated #619-#628.
- PR #632 was created by non-interactive Graphite submit and later showed as ready/open; #619-#628 remained stack PRs. Third-pass local changes are prepared for final resubmit after final local checks passed.
- Graphite pre-push passed `dead-code`, `format`, `lint`, `lint-ast-grep`, `test`, `typecheck`, and `warden`.

## Divergence From Plan

- The bottom branch insertion required manual Graphite parent repair after the first insert point landed above `warden-tests-type-hygiene`.
- The second-pass hygiene subagent could not be launched because the session already had the maximum active agent lanes; the same surface was covered by local full-suite verification.
- `bun run check` found one additional Warden-rule issue after second-pass review; it was fixed on the owning TRL-845 branch.

## Forbidden Actions Audit

- `gt absorb`: not used.
- Merge: not used.
- Merge queue labels: not used.
- Subagent source-control write operations: prohibited in briefs; returned reports only described read-only commands and local tests.

## Final State

Third-pass accepted findings are fixed locally on the owning branches, and final local verification passed at stack tip. PR #632 body refresh and Graphite resubmit are the remaining handoff actions.
