---
'@ontrails/source': patch
---

Report a directory that disappears between listing and reading as `vanished-directory` instead of `unreadable-directory` in `collectSourceTree`. Project identity resolution no longer fails when a concurrent process, such as a parallel test cleaning its temp dir, removes a directory mid-walk. Permission and other read failures still report `unreadable-directory`.
