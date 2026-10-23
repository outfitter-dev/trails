---
'@ontrails/core': patch
---

Preserve both object refinements when validating composed inputs across supported Zod versions, including omitted optional composition-only fields.

Compatibility: the exported `buildComposeValidationSchema` now returns a validation wrapper for object inputs rather than a `ZodObject`. Its runtime identity changes, and `.shape` and object-schema methods are no longer available on the result. Inspect the unchanged authored `trail.input` and `trail.composeInput` schemas instead.
