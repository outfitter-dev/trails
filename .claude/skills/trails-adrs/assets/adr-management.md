# Managing ADRs without the script

Manual instructions for ADR lifecycle operations when the `../scripts/adr.ts` script is not available.

## Creating a new draft ADR

1. Create the file at `docs/adr/drafts/YYYYMMDD-slug.md` using today's date
2. Add frontmatter with `status: draft`, `created`, `updated`, `owners`
3. Use `# ADR: Title` (no number) for the heading
4. Fill in the four required sections: Context, Decision, Consequences, References

## Promoting a draft

1. Assign the next ADR number (check `docs/adr/README.md` for the current highest, zero-padded to 4 digits)
2. Rename: `docs/adr/drafts/YYYYMMDD-slug.md` → `docs/adr/NNNN-slug.md` (use `git mv` to preserve history)
3. Update frontmatter: set `status` to `proposed` or `accepted`, update `updated` date
4. Update the title: `# ADR: Title` → `# ADR-NNNN: Title`
5. Add a row to the index table in `docs/adr/README.md`
6. Update any other ADRs that reference this one as "(draft)" to use the numbered link
7. Regenerate `docs/adr/decision-map.json` if it exists

## Demoting a numbered ADR

1. Rename: `docs/adr/NNNN-slug.md` → `docs/adr/drafts/YYYYMMDD-slug.md` (use `git mv`)
2. Update frontmatter: set `status: draft`, update `updated` date
3. Update the title: `# ADR-NNNN: Title` → `# ADR: Title`
4. Remove the row from `docs/adr/README.md`
5. Update any ADRs that reference the numbered link

## Superseding an ADR

1. Create a new ADR (the successor) following the normal process
2. In the old ADR's frontmatter, set `status: superseded` and add `superseded_by: NNNN`
3. Update the old ADR's index entry status to `Superseded`
4. In the new ADR's References, link to the predecessor

## Rejecting a draft

1. Promote the draft to a numbered ADR (it needs a number to preserve in the index)
2. Set `status: rejected` in the frontmatter
3. Add to the index with status `Rejected`
4. Preserve the Context and Decision sections — the reasoning for rejection is the value

## ADR index format

The index lives at `docs/adr/README.md`:

```markdown
| ADR | Title | Status |
| --- | --- | --- |
| [NNNN](NNNN-slug.md) | Title | Accepted |
```

Rules:

- Every numbered ADR (proposed, accepted, rejected, superseded) MUST appear
- Drafts do NOT appear — they live in `docs/adr/drafts/` until promoted
- Order by ADR number ascending
- Status column reflects current frontmatter status, capitalized

## Decision map

`docs/adr/decision-map.json` is a generated JSON file that catalogs all ADRs (numbered and drafts) with their metadata. Regenerate it after any structural changes. The script's `map` command handles this automatically.
