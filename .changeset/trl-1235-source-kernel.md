---
"@ontrails/source": minor
"@ontrails/warden": patch
"@ontrails/regrade": patch
"@ontrails/wayfinder": patch
"@ontrails/trails": patch
---

Found `@ontrails/source` as the shared source-code AST kernel for parsing,
walking, locations, edits, literals, and generic Trails syntax recognition.
Warden keeps `/ast` as a temporary compatibility facade while Warden, Regrade,
Wayfinder, and the Trails operator import the shared mechanics from
`@ontrails/source`.
