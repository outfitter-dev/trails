---
"@ontrails/warden": minor
"@ontrails/trails": patch
---

Add `warden --fix` to apply safe source fixes. The executor applies only `safety: 'safe'` edits last-to-first, re-reading and rewriting affected files, while review-required, edit-less, and topo diagnostics stay reported but unapplied. The report surfaces applied, changed-file, and skipped counts.

Expose `fix` through the Trails app wrapper and mark the `warden` trail as write intent with explicit public access because `fix: true` mutates source files while the local governance command remains directly runnable.
