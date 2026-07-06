---
"@ontrails/trails": minor
---

`trails regrade adjust <transition>` pulls a graduated transition back from consolidated history into an active plan minus the run ledger, preserving the stable transition id so subsequent applies append to the same history spine. Plan re-derivation (`regrade plan`) now carries `transitionId` forward from an existing active plan.
