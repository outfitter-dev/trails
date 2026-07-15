---
'@ontrails/trails': patch
---

Allow release checks to recognize changeset edits that only remove release rows
for packages absent from the live workspace while rejecting any additional
changes hidden beside that cleanup.
