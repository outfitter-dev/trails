# Trails Lock Recovery

`trails resolve` regenerates selected `trails.lock` files from resolved authored sources and verified lock evidence. Here, resolve means generated-artifact recovery during a merge or rebase. Runtime resource resolution is a separate operation.

Resolve authored source conflicts first. Keep the conflicted generated lock and its Git index stages available: the command verifies the actual parent locks, including their schema and graph hashes, before deriving a replacement. Taking one side and staging it first can discard the other parent's audit evidence.

```bash
trails resolve --root-dir . --permit '{"id":"lock-recovery","scopes":["topo:write"]}'
git diff -- trails.lock
trails compile --root-dir . --permit '{"id":"lock-check","scopes":["topo:write"]}'
trails validate --root-dir .
```

For a configured workspace, the root invocation prepares every declared app before writing any lock. Use `--app <id>` to select one member, or `--root-dir` from an app root. `--config-path <path>` selects an explicit nonstandard config; `--module <path>` supplies an explicit standalone app entry. The output reports each selected app, absolute artifact path, graph hash, and evidence sources. Review and stage those paths explicitly. The command writes only their root `trails.lock` files; it does not stage files, continue Git, or alter Skillset artifacts or persistent topo state.

Workspace-wide preflight covers evidence, resolved sources, and force governance. Writes then proceed per app; there is no transaction across files. If a filesystem write or file identity check fails, earlier selected locks may already be recovered. Inspect the app-root artifacts and retained Git evidence before retrying, and keep the index stages until every selected lock passes validation.

Recovery pins each selected regular lock open read-only through preflight. Byte-identical recovery needs no write access. When bytes change, recovery opens a writable descriptor and verifies it against the original pin before writing. Replacing the lock path with a symlink cannot redirect the write; a changed file identity or changed original bytes fails recovery.

A hash-only conflict adds no force event. Recovery retains complete graph and entry event facts, including their original timestamps and reasons. Exact copies collapse. Different timestamps or reasons remain distinct. Events whose original entry disappears move unchanged to graph-level audit history. Identical graph and entry copies remain at graph level, including when an ID later returns. Unchanged arrays keep their order; relocation and deduplication can change the affected arrays. Repeated recovery and ordinary compilation must converge.

Genuine breaking source changes fail unless the existing `--force` and `topo:write` permit governance is satisfied. Inspect and version the change before choosing force. Force is not a repair for missing or invalid evidence. Warden continues to report retained pending events for trails, resources, entities, and signals; recovery does not resolve or authorize those obligations.

An already recorded breaking change on one branch carries forward without a new event when the other branch left that entry unchanged from the verified merge base and the resolved entry matches the recording branch exactly, excluding force history. If both branches edit the same entry, even a nonbreaking edit can prevent that proof and require explicit force after review. Recovery compares complete transitions; matching historical error text alone does not establish acceptance of a different contract. A repeat of an already completed recovery preserves its event timestamps and requires no new force flag when the entire canonical lock and retained evidence still agree.

Missing evidence, malformed or tampered parents, unresolved authored conflicts, ambiguous app declarations, and mismatched app scopes fail before any selected lock is written. A clean existing lock can be canonicalized without Git. A conflicted lock requires both verified Git parent stages; restoring only one side is insufficient. Restore the original evidence or abort the operation when the preflight cannot prove a safe recovery. A first compile still uses `trails compile`.

## Combined rebase recipe

For a project whose installed Skillset version provides `resolve`, the sequence after resolving authored conflicts is:

```bash
skillset resolve --yes
trails resolve --permit '{"id":"lock-recovery","scopes":["topo:write"]}'
# Review the generated diff, run repository checks, and stage explicit paths.
git rebase --continue
```

This checkout pins Skillset 0.27, which does not provide that verb. Until the separately qualified upgrade, use [Skillset Lock Recovery](skillset-lock-recovery.md) for its base-lock regeneration step, then run `trails resolve` and the same review and verification steps. Neither lock uses a `.gitattributes` merge driver or `merge=union` in this repository.

## Abort, restore, and stale rerere

Before starting a merge or rebase, record the original branch head and preserve uncommitted work through the repository's normal workflow. If a previous generated resolution was wrong, inspect `git status`, `git diff`, and `git rerere status` before continuing. While the affected conflict is available, forget only that stale recorded resolution:

```bash
git rerere forget -- path/to/trails.lock
```

Choose `git rebase --abort` for a rebase or `git merge --abort` for a merge. Verify the restored branch head and original lock bytes against the recorded checkpoint before retrying. Do not delete locks, force a compile over missing history, or restore a different branch's lock as a substitute for the retained evidence. If the checkpoint or original parent evidence is unavailable, stop and recover it from verified Git history before attempting regeneration.
