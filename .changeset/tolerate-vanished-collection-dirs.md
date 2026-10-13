---
'@ontrails/source': patch
'@ontrails/config': patch
'@ontrails/regrade': patch
---

Report a directory that disappears between listing and reading as `vanished-directory` instead of `unreadable-directory` in `collectSourceTree`. Permission and other read failures still report `unreadable-directory`. Static project identity discovery now rescans, up to three attempts, when a directory vanishes mid-walk. A removed directory, such as a parallel test's temp dir, drops out of the next listing, and a renamed one, including one holding a `trails.config.*` marker, is found under its new path. Churn that outlasts the retries still fails closed. Regrade also fails closed on both reasons, because a vanished directory may have been renamed and its sources would otherwise escape a prepared run or apply.
