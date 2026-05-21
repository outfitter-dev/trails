# Local Review: Markdown Safety

Score: 4/5

Scope: `TRL-616` hard-wrap cleanup safety.

## Summary

The review found the markdown cleanup constrained and review-sized: the hard-wrap
cleanup touched 10 current-facing guidance/onboarding docs, plus the report and
retro ledger. The reviewer found no evidence that code fences, tables, lists,
headings, generated Warden sections, changelogs, `.scratch/**`,
`.agents/notes/**`, or `.agents/plans/archive/**` were rewritten.

## Findings

- P0: none.
- P1: none.
- P2: none.
- P3: the reported broad "before" detector count was not reproducible from the
  branch refs. The report and retro said `335`, while the branch-ref detector
  reproduced `328` before and `247` after.

Prompt To Fix With AI: Update the markdown audit report and `RETRO.md` so the
detector counts are reproducible from
`trl-734-audit-route-vocabulary-across-packages-consider-reserving..trl-616-audit-markdown-files-for-hard-line-wraps`;
replace `335` with `328`, keep `247` and `0`, and clarify that the structural
changed-line safety scan applies to the cleanup diff, excluding the newly added
report and retro ledger prose.

Resolution: fixed in the top branch before draft submission.

Unable to verify: the reviewer did not rerun `bun run format:check` or
`bun run check` to avoid build writes; `git diff --check` was verified on the
branch-ref markdown diff.
