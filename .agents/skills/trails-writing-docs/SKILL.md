---
name: trails-writing-docs
description: "Trails documentation structure and maintenance guidance. Use when creating or reorganizing Trails docs, READMEs, guides, reference pages, release docs, or agent-facing documentation."
metadata:
  version: 0.1.0
  author: trails
  category: documentation
  skillset:
    generator: scripts/codex/skillset.ts
    target: codex
    version: 1
    source: .claude/skills/trails-writing-docs
    source-file: .claude/skills/trails-writing-docs/SKILL.md
---

# Trails Writing Docs

The v1 vocabulary families are live. Use `derive` for contract-owned fact production and `render` for surface presentation.

This skill covers what a Trails document should include and where it should live. It reflects the current repository shape. The v1 ADR Canon Reset may revise the final docs taxonomy, so do not treat this as the permanent information architecture.

For voice, load `trails-writing-voice`. For prose craft and vocabulary, load `trails-writing-style`.

## Documentation Ladder

Trails documentation follows the distribution-ready done rule:

1. **Types and schemas** carry the contract closest to code.
2. **Examples** prove and teach happy paths.
3. **Tests and Warden rules** prevent drift.
4. **Docs and guides** explain how to use the behavior.
5. **Agent guidance and skills** teach agents how to preserve it.
6. **Release notes and changesets** carry migration and publication intent.

Feature work is not done until the affected docs layer is updated or explicitly marked not applicable.

## Current Repo Map

Use the current structure unless the docs-organization ADR says otherwise:

| Location             | Use for                                                                  |
| -------------------- | ------------------------------------------------------------------------ |
| `README.md`          | Project entry point and pointers.                                        |
| `AGENTS.md`          | Canonical guidance for agents working on Trails.                         |
| `docs/`              | Public and contributor-facing documentation.                             |
| `docs/contributing/` | Contributor guidance, code standards, language style, script graduation. |
| `docs/surfaces/`     | Surface-specific docs and surface accommodation guidance.                |
| `docs/releases/`     | Release runbooks, beta/stable cutover notes, migration details.          |
| `docs/adr/`          | Accepted ADRs and decision maps.                                         |
| `docs/adr/drafts/`   | Draft ADRs and future-facing proposals.                                  |
| `plugin/skills/`     | Distributed skills for downstream agents using Trails.                   |
| `.agents/skills/`    | Repo-local skills for contributors and local agents.                     |
| `.agents/notes/`     | Gitignored working notes and handoff records.                            |

When in doubt, update the nearest existing document instead of creating a new one.

## Document Types

### Guide

Use a guide when the reader needs to apply a concept.

Include:

- the reader's starting point;
- the minimal working example;
- the common wrong shape;
- surface or runtime implications;
- verification commands;
- links to reference and ADRs.

### Reference

Use reference docs for exact lookup.

Include:

- API names and signatures;
- option tables;
- input and output shapes;
- defaults;
- error behavior;
- stability notes.

Keep reference pages dense and predictable. Do not turn them into essays.

### ADR

Use an ADR when reversing the decision would materially change Trails.

Load `trails-adrs` for ADR-specific structure. ADRs should explain the tension, the decision, the alternatives, and what this does not decide.

### Release Doc

Use release docs when existing users or release operators need a path.

Include:

- what changed;
- why it matters;
- exact commands;
- migration or bridge steps;
- compatibility window;
- verification checks;
- known non-support.

### Agent Guidance

Use agent guidance when future agents need to preserve a behavior.

Include:

- when to use the guidance;
- source-of-truth files;
- stop conditions;
- exact commands;
- known stale paths or noise;
- what not to mutate.

## README Rules

READMEs should orient quickly and link out.

Keep:

- the first usable path near the top;
- examples copy-pasteable;
- explanation after the quick path;
- links to deeper docs instead of duplicating them.

Avoid:

- long architecture essays;
- stale command lists;
- repeating docs that already have a canonical page.

## Code Examples

Every code example should be either runnable or clearly marked as abridged.

Examples should:

- include imports when they matter;
- show definition and use;
- show expected output for CLI examples;
- use current package names;
- avoid retired vocabulary;
- prefer realistic domain examples over placeholders.

When examples are part of a trail contract, treat them as both docs and tests.

## Maintenance Checks

Before considering docs done:

- Run the repo's relevant docs or format checks when available.
- Verify links and anchors touched by the change.
- Search for stale duplicates when moving or renaming concepts.
- Update distributed skills if downstream agents need the new guidance.
- Add a changeset or release note when package behavior or public trails change.
- Note "not applicable" when reviewers would reasonably expect docs but none are needed.

## Docs Organization ADR Caveat

The draft docs-organization ADR is allowed to change section names, placement rules, and generated docs behavior. Until that lands:

- conform to the current repo;
- avoid creating new top-level docs taxonomies;
- write new docs so they can be moved cleanly later;
- prefer clear frontmatter and unique filenames when adding new docs;
- leave a note in the PR or issue when placement is provisional.

## Review Checklist

When creating or reviewing Trails docs:

- Is there one canonical home for this information?
- Is the audience clear?
- Does the document teach use, lookup, decision, release operation, or agent workflow?
- Are examples current and runnable?
- Are links and commands verified?
- Are vocabulary and reset-direction terms handled honestly?
- Does the change satisfy distribution-ready done?
- Would a future agent know where to update this next time?
