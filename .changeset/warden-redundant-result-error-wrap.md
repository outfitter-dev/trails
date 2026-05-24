---
"@ontrails/warden": patch
---

Add a warning for blazes that re-wrap an existing Result error with Result.err(result.error) instead of returning the original Result.
