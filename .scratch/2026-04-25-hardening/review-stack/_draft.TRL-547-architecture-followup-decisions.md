# TRL-547 Architecture Follow-Up Decisions

**Issue:** TRL-547
**Branch:** `trl-547-create-architecture-follow-up-issues-from-prevention-audit`
**Purpose:** Decide which prevention findings require architecture issues rather than rules or advisory skills.

## Inputs

- `.scratch/2026-04-25-hardening/tmp-audits/reconciliation.md`
- `.scratch/2026-04-25-hardening/tmp-audits/05-dogfooding-reconciliation.md`
- `.scratch/2026-04-25-hardening/tmp-audits/08-prevention-rails-reconciliation.md`
- PR #300 / TRL-564
- Existing owner/public authority and Warden foundation stacks

## Rechecked Architecture Candidates

### Construction And Materializer Throw Boundaries

TRL-564 settled the immediate runtime boundary:

- App-load failures are Result-shaped through `tryLoadApp` and `tryLoadFreshAppLease`.
- Missing runtime cwd/rootDir is a `ValidationError` Result in app/CI trails.
- CLI/MCP/Hono construction/materializer throws are documented as host-boundary exceptions.

Decision: no new architecture issue is needed from this pass. Future work should be filed only if a specific construction boundary leaks into trail runtime behavior.

### Warden Advisory Metadata

The broad concept remains useful, but the immediate prevention need is agent guidance rather than public framework API.

Decision: do not create a public architecture issue. Keep the agent-facing work in advisory skill issues TRL-593 through TRL-598.

### Error Projection And Redaction Ownership

Concrete owner-first work already exists:

- TRL-529 rewired Warden error rules to owner-owned data.
- TRL-526 retired a specific parallel error map.
- TRL-561 covers surface projection/redaction follow-through.
- TRL-564 documented host-boundary exceptions.

Decision: no new architecture issue. Continue through the existing owner/projection issues.

### Resource Lifecycle Ownership

Concrete work already exists:

- TRL-558 introduced resource lifecycle drain semantics.
- TRL-592 made mismatched drain keys observable and documented the diagnostic.

Decision: no new architecture issue. Keep any future lifecycle work tied to concrete resource semantics.

### Layer And Primitive Posture

The primitive posture lane has existing work:

- TRL-568 covers layer v1 and primitive-posture follow-through.
- TRL-595 captures advisory primitive-parity review.

Decision: no new architecture issue from the prevention audit.

## Decision

No new architecture follow-up issue is needed after the live recheck. The surviving work belongs in advisory skills, Warden rules, or already-existing architecture/backlog issues.
