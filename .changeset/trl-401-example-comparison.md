---
'@ontrails/trails': minor
---

Add `run.example` for named example execution. It loads a named example, executes the inner trail with the example's input, and compares actual vs expected per the example's contract (`expected` deep-equal, `expectedMatch` partial-match, or `error` class match). Returns a structured `RunExampleComparison` envelope with input/expected/actual/match/diff. The CLI surface helper prints an OK summary on match (exit 0), or a diff and `ValidationError` on mismatch (exit 1). Unknown example names produce `NotFoundError` (exit 2) with the available examples listed.
