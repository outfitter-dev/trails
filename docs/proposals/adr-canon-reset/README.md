# ADR canon reset proposal

**Proposal; merging this packet does not ratify the proposed decisions or execute the reset.** Accepted ADRs under `docs/adr/` continue to govern.

This packet preserves the October 29, 2026 research proposal: one reset record and 24 architectural decisions, with dispositions for all 56 numbered ADRs and 21 drafts at baseline `3cb861758b897562c7e32d9ad01a6d6f217d780d`. The eventual reset cutoff remains unset. Source statements refer to that baseline; Linear and release observations refer to the research date, not current status.

## Reading order

1. [Outline](outline.md): proposed decisions, boundaries, consequences, unresolved questions, and incoming work.
2. [Coverage](coverage.md): every source record's disposition; [coverage.json](coverage.json) is the structured ledger.
3. [History](history.md): architectural evolution and publication evidence.
4. [Verification](verification.md): completed review, reproducible checks, and limits.

[canon.json](canon.json) records dependencies. The [source inventory](evidence/inventory.json) pins source hashes; [commit evidence](evidence/commits.json) pins 21 pivotal commits and patch hashes. [Linear metadata](evidence/linear.json) preserves discovery anchors without copying raw workspace exports or personal metadata. The release snapshots support the historical publication analysis.

## Reproduce the evidence checks

Use a checkout with Python 3 and the baseline's Git history available:

```sh
python3 docs/proposals/adr-canon-reset/check-evidence.py
bun run docs:links
bun run docs:wrap-check
```

The checker reads source files from the pinned commit, so later commits do not invalidate this historical proposal. Fetch missing Git history before running it in a shallow clone. Repository-relative documentation links aid navigation in the current checkout; code line references describe the research baseline.

## Scope and next step

The owner must review the proposed boundaries and incoming cutoff before assigning the actual reset. That implementation must refresh provenance, prove clause-level preservation, and perform the tooling, reference, and fresh-reader checks tracked by [TRL-983](https://linear.app/outfitter/issue/TRL-983) through [TRL-993](https://linear.app/outfitter/issue/TRL-993).

The older implementation packet referenced by [TRL-994](https://linear.app/outfitter/issue/TRL-994) was unavailable on the research host. This packet preserves the new substantive canon proposal; it does not reconstruct that older tooling and reference audit. Local coordination logs, raw Linear exports, and duplicate Git patches are intentionally excluded. All substantive outline, coverage, historical analysis, and final review findings are retained here.
