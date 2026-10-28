# Managing ADRs without the script

Manual instructions for ADR lifecycle operations when the `../scripts/adr.ts` script is not available.

## Creating a new draft ADR

1. Create the file at `docs/adr/drafts/YYYYMMDD-slug.md` using today's date
2. Add frontmatter with `status: draft`, `created`, `updated`, `owners`
3. Use `# ADR: Title` (no number) for the heading
4. Fill in the four required sections: Context, Decision, Consequences, References

## Promoting a draft

1. Assign the next ADR number (check `docs/adr/README.md` for the current highest, zero-padded to 4 digits)
2. Rename: `docs/adr/drafts/YYYYMMDD-slug.md` → `docs/adr/NNNN-slug.md` (use `git mv` to preserve history; stop if the destination exists)
3. Update frontmatter: set `status` to `proposed` or `accepted`, update `updated` date
4. Update the title: `# ADR: Title` → `# ADR-NNNN: Title`
5. Rebase the moved document’s own relative links for its new directory (`../NNNN-slug.md` → `NNNN-slug.md`, `../../tenets.md` → `../tenets.md`), including image targets and reference definitions
6. Add a row to the index table in `docs/adr/README.md`
7. Update any other ADRs that reference this one as "(draft)" to use the numbered link
8. If the script is available, regenerate `docs/adr/decision-map.json`, `docs/adr/drafts/decision-map.json`, and `docs/adr/drafts/README.md`

## Demoting a numbered ADR

1. Rename: `docs/adr/NNNN-slug.md` → `docs/adr/drafts/YYYYMMDD-slug.md` (use `git mv`; stop if the destination exists)
2. Update frontmatter: set `status: draft`, update `updated` date
3. Update the title: `# ADR-NNNN: Title` → `# ADR: Title`
4. Rebase the document’s own relative links for the draft directory (`NNNN-slug.md` → `../NNNN-slug.md`, `../tenets.md` → `../../tenets.md`), including image targets and reference definitions
5. Remove the row from `docs/adr/README.md`
6. Update any ADRs that reference the numbered link

## Superseding an ADR

1. Create a new ADR (the successor) following the normal process
2. In the old ADR's frontmatter, set `status: superseded` and add `superseded_by: ['NNNN']`
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

`docs/adr/decision-map.json` catalogs accepted ADR metadata, while `docs/adr/drafts/decision-map.json` catalogs draft ADR metadata. The script's `map` command regenerates both maps and the generated draft index.

After a move, validate that local link targets exist. With the script available, `bun scripts/adr.ts check` checks relative file targets in numbered ADRs and drafts. The repository link check also validates heading anchors.

## Active canon and historical context

Active numbered decisions and drafts remain directly under `docs/adr/` and `docs/adr/drafts/`. Historical snapshots live under `docs/adr/historical/`, with historical drafts in its `drafts/` subdirectory. Historical records preserve development context and do not govern the active canon. They never participate in active numbering, indexes, decision maps, or active metadata checks.

Before the separately agreed atomic reset, retain the current numeric canon. After the reset, active numbering starts at `ADR-0001`; historical `X###-*` identities do not change that allocator. Every cutoff draft receives a historical snapshot independently of whether an active future draft is retained or rewritten. Use the integration-owned cutover plan for archive transformations; ordinary create/promote/demote/update/fix commands accept only regular active files and cannot target history through an explicit path or symlink. Keep new active ADR references on current doctrine, with the reset record allowed to link the archive as a whole.
