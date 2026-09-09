---
"@ontrails/trails": patch
---

Run lock round-trip smoke checks in a temporary copy of current working files so compile and cleanup do not rewrite caller lockfiles or overwrite concurrent edits.
