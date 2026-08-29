---
"@ontrails/config": minor
"@ontrails/source": patch
---

Add Config-owned static `workspace.apps` identity with bounded, non-executing TypeScript extraction, shared data-format validation, convention-derived app entries, and normalized project paths. Type-only wrappers remain transparent, unrelated deployment expressions stay outside identity proof, duplicate identity keys fail before parser collapse, separator aliases cannot create competing app-root owners, and Source preserves declared submodule boundaries when their checkouts are absent. YAML workspace identity must stay literal, JSON-compatible data: alias references and merge keys inside the workspace subtree now fail closed before identity resolution instead of collapsing silently at parse time, while an anchor definition that nothing references stays inert and cannot alter the resolved identity. Invalid discovery start directories also fail closed: a start path that is missing or is not a directory now raises a typed `ValidationError` naming it instead of silently walking up to an ancestor project's identity.
