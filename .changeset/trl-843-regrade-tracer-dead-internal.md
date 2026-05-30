---
"@ontrails/warden": patch
---

Fix a false `dead-internal-trail` warning by unioning file-local compose evidence with the project-context compose set, so same-file composition in scanned-but-unregistered packages is recognized.
