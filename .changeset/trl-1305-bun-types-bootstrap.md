---
"@ontrails/trails": patch
---

Generate new projects with Bun 1.4 type declarations instead of the 1.3 line.
The package consumer engine floor is Bun 1.4.0; repository development uses the
existing Bun 1.4.2 pin. Bootstrap repairs older runtimes to that pin rather than
accepting them directly. Strict checkout mode still requires the exact pin,
and local compatible mode accepts only the pinned or newer 1.4 patch.
