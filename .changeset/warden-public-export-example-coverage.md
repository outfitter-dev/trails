---
"@ontrails/warden": minor
---

Add the repo-local `public-export-example-coverage` Warden rule (and its `publicExportExampleCoverageTrail` wrapper), graduating `scripts/check-public-api-examples.ts` into governed rule coverage. The rule anchors to this repository's five public surface package barrels via the rule module's own on-disk location, so it stays silent in consumer repositories.
