# @ontrails/oxlint-plugin

Private repo-local Oxlint plugin for the Trails monorepo.

This package is not public Trails correctness doctrine. Use it for temporary
hardening cleanup rules and durable preferences that apply to this repository
but should not be inherited by Trails consumers.

Use Warden instead when a rule enforces Trails semantics, public framework
correctness, topology, owner-first authority, or consumer-facing doctrine.

Rules are authored in `src/` as TypeScript and built to `dist/` before Oxlint
loads the plugin. Repo lint and format scripts run that build first.

`local-plugin-smoke` is only a wiring proof. Delete it once the first real
repo-local rule lands.
