---
"@ontrails/trails": minor
---

Teach `trails create` first-class standalone and configured-workspace layouts.
Workspace scaffolds author literal `workspace.apps` identity, keep generated
surfaces under `bin/`, report complete dry-run plans, and coach the normal
post-install compile flow to derive app-owned locks with deterministic scaffold
overlay provenance instead of writing workspace-root or `.trails` artifacts.
Published scaffold commands include the required narrow `project:write` permit.
Configured workspaces install the exact Trails operator at both the root and app
so root-owned commands remain local under isolated Bun linking.
Surface additions preserve an established legacy `src/` entry layout or
TypeScript scope before an entry exists, failing closed when neither supported
surface path participates, including through solution-style project references.
Canonical legacy lint scope participates in that placement decision, while CLI
addition preserves unrelated executable mappings in the app manifest.
The operator pins and guards the audited TypeScript runtime that owns this
prospective matching. Existing workspace app manifests reconcile missing
scaffold-owned tooling without replacing unrelated metadata, configured app
entries fail closed when they disagree with the scaffold-owned app module,
surface placement is preflighted before scaffold writes,
workspace hook configuration is written at the repository root, generated CLI
and MCP entries carry optional app-authored overlays into runtime derivation,
and rerun guidance names the same resolved surface paths the operation plan
writes. Reruns reconcile a previously generated lint script as the established
scope instead of a manifest conflict, while customized lint commands still fail
closed. Reruns likewise upgrade a recognized prior generated `@ontrails/*` pin
to the current release instead of conflicting on it, while customized ranges
still fail closed. The `create` trail declares dry-run capability so derived
surfaces expose `dryRunCapable` alongside the documented `--dry-run` flag.
