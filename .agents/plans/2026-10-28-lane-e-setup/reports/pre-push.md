# Required pre-push result

Source candidate: `15ba5333904a8db872008107730a01d85ff95e0a`. Normal `git push -u origin trl-1416-make-createcliharness-honor-registered-cli-flags-and-reject` exited1. No hook bypass; branch was not pushed and no PR exists.

The hook's root test run finished48 successful tasks of49. Operator package:1252 passed,20 failed,5498 assertions,1272 tests across70 files,341.70seconds. Full hook414.11seconds.

Observed failure groups:

-1 fresh app-load scratch ownership: exclusive private owner/deterministic temporary-directory seam.
-12 resolveOperatorProjectContext: explicit descendant root2, sibling explicit-root overrides4, custom/absolute config selection2, nested config paths4.
-7 trails warden: nested-CWD workspace config paths3; parent explicit config selection4.

Coordinator reports matching signatures in Lane B's ADR-only branch; that is a coordination report, not this lane's baseline proof. Lane B is the sole assigned baseline/runtime diagnostic owner. Do not independently restart or debug the full suite. Coordinator assigns next action after reconciliation. Root test failure prevents the later pre-push stages from running; separately run checks are recorded independently in RETRO.md.

Current disposition: source and local consumer acceptance complete; overall issue remains incomplete/unmerged; draft PR blocked. No publication, auth, deployment, tracker mutation, readiness change or merge occurred.
