---
'@ontrails/http': patch
---

Accept a single GET query value for a declared primitive array field as a
one-element array. Repeated keys still supply multiple values in order, and
omitted keys still use the trail schema's default or required-field validation.
