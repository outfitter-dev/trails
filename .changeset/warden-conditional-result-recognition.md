---
'@ontrails/warden': patch
---

`implementation-returns-result` now recognizes conditional returns whose branches are all recognized Result expressions — both `return cond ? Result.err(...) : Result.ok(...)` statements (including branches that are Result helpers or Result-bound variables) and concise ternary blaze bodies. Previously the idiomatic two-branch ternary was flagged as an error.
