---
'@ontrails/warden': patch
---

`duplicate-public-contract` now includes contour anchoring in the normalized contract fingerprint, so factory CRUD trails derived against different contours (for example two tables' `delete` trails that both normalize to `{ id } → void` with the same intent) are no longer flagged as duplicates. Genuine duplicates — identical facts with the same or no contour anchoring — still warn, and the diagnostic message names contours among the shared facts.
