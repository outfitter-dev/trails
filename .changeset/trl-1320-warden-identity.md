---
"@ontrails/trails": patch
"@ontrails/warden": patch
---

Include the evaluated app's `executedAppId` in one-app topo-aware Warden results and CLI JSON, including successful runs without diagnostics. Omit this singular field for source-only and workspace-wide observations. Warden's shared command reports the canonical evaluated topo ID separately from diagnostic labels such as a legacy module path.
