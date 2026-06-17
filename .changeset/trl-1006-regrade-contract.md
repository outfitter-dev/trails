---
"@ontrails/regrade": patch
"@ontrails/trails": patch
---

Retire the package-owned `regrade.downstream.report` trail wrapper so the Trails operator app owns the public Regrade surface while `@ontrails/regrade` exposes the reusable engine APIs and report schema.
