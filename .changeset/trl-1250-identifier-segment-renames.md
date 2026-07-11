---
'@ontrails/regrade': minor
'@ontrails/warden': minor
---

Add governed identifier-segment renames for AST-backed migrations. Regrade can
now migrate camelCase, PascalCase, leading-underscore, and SCREAMING_SNAKE
identifier segments, including single-segment forms such as `BLAZE` and
`_BLAZE`, while preserving exact-mode behavior and rejecting lowercase
substring, concatenated acronym, or inflection matches.
