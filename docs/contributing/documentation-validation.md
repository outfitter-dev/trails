# Documentation Validation

Documentation commands compose current owners and account for committed path changes. They do not yet enforce the whole documentation architecture: public-page membership/reachability, description/page floors, general marker validation and shrink-only corpus debt remain separate TRL-1283 work. Broad documentation moves remain gated on that complete foundation.

## Generate current owner outputs

From the repository root, run:

```bash
bun run docs:generate
```

Error taxonomy owns its existing delimited tables. The Warden manifest owns the generated guide block in root `AGENTS.md`. The canonical ADR implementation owns its numbered index, accepted map, draft map and draft index. ADR artifacts render last because their inbound-reference facts consume other documentation. The umbrella calls those owners without re-deriving their facts.

Scaffold-version TypeScript generation and Skillset source/projection remain with their separate owners and checks. The currently manual API and topo-store reference pages do not become generated through this command. Their exact-reference work belongs to TRL-1285. A generator must preserve authored content outside its owned region.

## Check a committed candidate

Pass an explicit available base revision:

```bash
bun run docs:check -- --base-ref <base-ref-or-SHA>
```

The history check resolves the base and `HEAD`, computes their merge base, and reports all three immutable inputs. It does not fetch history or choose a fallback. Relevant dirty or untracked documentation, workspace ownership input or migration-map changes fail with an instruction to commit them; use the existing focused link, snippet and wrap checks while editing.

CI fetches and pins canonical main for pull requests, merge groups and manual runs. This is the stack-wide acceptance comparison required by `AGENTS.md`. A push to main uses the event's previous head to account for that push. Local callers can explicitly select an immediate layer base for diagnosis, but that narrower result is not CI acceptance. Missing refs or incomplete ancestry fail closed; the caller must provide available history.

After migration accounting, the aggregate runs the current link/anchor, snippet, hard-wrap, error-taxonomy, root Warden-guide and ADR checks. Snippet validation creates and removes an ephemeral typecheck harness; it does not modify tracked source. These are the existing owners' current scan scopes, not a claim that all public navigation or metadata is already validated.

## Account for removed paths

When the first eligible path is removed, add `docs/migration-map.json`. An empty ledger is unnecessary before any removal. The authored schema is:

```json
{
  "version": 1,
  "entries": [
    {
      "from": "docs/old-guide.md",
      "disposition": "moved",
      "to": ["docs/guides/new-guide.md"]
    }
  ]
}
```

Each removed source needs one normalized repository-relative Markdown path and one disposition. `moved`, `merged` and `archived` have one surviving destination; `split` has at least two distinct destinations; `deleted` has none and requires a nonempty `reason`. Destinations must be regular public Markdown sources in the committed candidate. Retain prior source entries; if a destination moves later, update older entries to surviving final targets rather than leaving a chain of missing paths. New entries must correspond to an actual removal in the comparison, including intermediate public paths introduced and retired between its endpoints. A recorded source cannot remain or return as a regular public page while the entry claims its retirement.

The bounded migration population is root `README.md`, Markdown/MDX under `docs/` outside the separately owned ADR subtree, and direct READMEs of workspaces discovered from the package manifest at both comparison trees. Successors follow that same population; moving content into ADR lifecycle ownership needs its separate workflow. Removing an entire workspace cannot hide its former README. Dirty workspace manifests matching either tree's declared patterns fail, including an untracked new workspace. Root `README.md` and `docs/index.md` are fixed architectural roots and cannot have migration entries, including after an intermediate deletion and restoration.

ADR/reset lifecycle, private agent records, changesets, generated distribution copies, build outputs and changelogs retain their separate owners. Release narratives are not excluded merely because their names look historical. This population is migration scope, not the future independently classified evergreen navigation population. Heading/anchor migration, broader public graph contracts and baseline enforcement remain part of the open foundation work; this command does not authorize moves that need those unfinished controls.
