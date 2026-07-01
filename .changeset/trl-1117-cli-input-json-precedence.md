---
'@ontrails/cli': patch
'@ontrails/commander': patch
---

Honor explicit structured input values over CLI flag defaults when commands merge
`--input-json` or `--input` payloads.

Commander now forwards user-supplied flag metadata so explicit flag values that
match a default still keep normal CLI precedence over structured input.
