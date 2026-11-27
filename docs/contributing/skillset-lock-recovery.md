# Skillset Lock Recovery

`skillset.lock` is generated evidence for canonical `.skillset` inputs and their outputs. Never hand-merge its JSON or use a merge driver that silently keeps one side.

Resolve the canonical source conflict first. During a rebase onto `main`, take the base lock, then regenerate from the resolved sources:

```bash
git checkout origin/main -- skillset.lock
bun run skillset:sync
bun run skillset:check
git add -- skillset.lock
```

For a stacked branch or another target, substitute the actual base ref for `origin/main`. Stage the resolved canonical inputs before continuing a commit, and review and stage any regenerated outputs together. Continue the rebase only after the checks pass. Keep unrelated edits out of the resolution.

`skillset:sync` runs the Warden guide refresh and the pinned Skillset build and marketplace update. If the root lock was byte-identical to `HEAD` before generation and the only generated differences are the root provenance hash and local/current marketplace checkout `ref` or `sha`, it preserves the committed lock bytes. It keeps real content, manifest paths, cache paths, and external provenance changes. A lock already edited before the command remains generator-owned; the wrapper does not restore `HEAD` over those edits. Inspect the generated diff and rerun the checks.

Pre-commit regeneration runs for canonical Skillset inputs and the Warden guide sources, rather than dependency files or generated outputs. After changing the pinned Skillset generator, run `bun run skillset:sync` explicitly and qualify its migration. `skillset:check` continues to detect managed-output drift.

Governance rejects a PR whose root lock differs from its base only in local checkout provenance. For a standalone PR targeting `main`, repair it with:

```bash
git checkout origin/main -- skillset.lock && bun run skillset:check
```

Use the actual base ref for stacked PRs. A real canonical-source change still requires regeneration and verification; taking the base lock alone does not satisfy that requirement.
