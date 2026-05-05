---
'@ontrails/trails': minor
---

Add `run.examples` for listing a trail's examples without executing. The split run family gives examples listing its own typed input and structured `RunExamplesListing` output (`{ kind: 'examples-listing', trailId, examples }`) instead of adding an `--examples` mode flag to `run`. The CLI surface helper formats text-mode tables (name + truncated input + outcome) and unwraps to a JSON/JSONL array when `--json`/`--jsonl` is set. Trails with no examples emit `No examples defined` (text) or `[]` (JSON). Unknown trail IDs still surface `NotFoundError` (exit code 2).
