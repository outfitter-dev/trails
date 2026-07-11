---
"@ontrails/source": minor
"@ontrails/warden": patch
"@ontrails/regrade": patch
"@ontrails/trails": patch
---

Found `@ontrails/source` as the shared source-code AST kernel for parsing,
walking, locations, edits, literals, and generic Trails syntax recognition.
Warden, Regrade, Wayfinder, and the Trails operator now import those shared
mechanics from `@ontrails/source`; the legacy Warden AST route is removed by the
stacked hard cutover.
