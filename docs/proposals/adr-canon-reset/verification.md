# Proposal verification

Research baseline: `3cb861758b897562c7e32d9ad01a6d6f217d780d`. These checks verify a proposal, not an executed ADR reset.

## Research review

Two read-only researchers covered the numbered ADRs and dated drafts, then checked selected source claims. A separate reader reviewed the assembled proposal. The final disposition was **no remaining P0/P1/P2 semantic findings** after five material gaps were corrected:

1. N16 preserves shared app selection, provenance, cardinality, freshness, project/worktree/collection-root distinctions, and owner-only SQLite writes.
2. N24 preserves release channels, visible retirement, cold-scaffold proof, publication ownership, and partial-publication recovery.
3. N10 preserves typed entity references and structural versus operational graph edges.
4. N08 preserves lazy configuration defaults and typed resource configuration.
5. N12 preserves activation guards and intrinsic provenance.

Accepted ADR-0055 remains target-state doctrine independent of implementation evidence. Draft absorption is proposed ratification, not a retroactive status change. The final process finding was to record the clean review and rerun structural checks; both were completed in the local research packet.

This review is not exhaustive clause-level equivalence or the later whole-reset fresh-reader gate. The publication edits relocate links and curate evidence; they do not claim a new semantic review of the eventual reset.

## Reproducible checks

Run from the repository root:

```sh
python3 docs/proposals/adr-canon-reset/check-evidence.py
git diff --check
```

The checker compares the inventory to Git at the pinned baseline, verifies all 77 source hashes and dispositions, validates 25 unique proposed records and acyclic dependencies, checks outline/JSON agreement and local links, and reproduces the hashes of 21 pivotal patches through `git show --format=fuller --no-ext-diff`.

The original local research checker and the publication checker both passed. A separate publication review found no substantive omissions. The publication Regrade audit passes with zero open findings after current wording replaced retired terms in prose; exact historical identifiers remain in the structured evidence. Repository Markdown, link, and hard-wrap checks passed; pre-commit formatting passed. Pre-push vocabulary findings were corrected by using current prose and inventory links for four historical filenames. The publication checker deliberately compares against the pinned commit rather than HEAD or the live filesystem, allowing this evidence to remain reproducible after the documentation commit. Git history is required; external URL availability and live tracker state are not checked.

## Evidence and limitations

During the research phase, source and existing test assertions were read without rerunning runtime tests. Publication subsequently passed the repository’s complete pre-push suite: Warden, ADR consistency, skillset checks, tests, typechecking, lint, AST rules, formatting, release metadata applicability, and dead-code checks. GitHub release snapshots do not prove current npm registry state. Wayfinder had saved app locks with unknown freshness and absent topo stores; source/history reads supplied the historical analysis without regenerating graph artifacts.

Raw Linear exports and search pages remain excluded from this public-facing packet. Their relevant interpretations are preserved in the outline and history, with issue URLs and curated observation metadata. This is not an exhaustive census of unmerged branches. The unavailable October 28 implementation packet is not reconstructed here.

Runtime builds/tests, changesets, package publication checks, Wayfinder dogfood, lock round trips, migration execution are not applicable: this PR preserves a proposal without changing package contents, contracts, guidance rules, or accepted decisions. The two generated ADR reference maps were regenerated with `bun scripts/adr.ts map` to record the proposal’s new inbound links; `bun scripts/adr.ts check` validates them. Those checks remain obligations of the eventual reset or implementation.
