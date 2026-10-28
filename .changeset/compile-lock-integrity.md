---
"@ontrails/trails": patch
"@ontrails/topography": patch
---

Refuse to compile over unreadable committed locks so retained force audit history cannot be silently discarded. Report conflict markers and unsupported lock formats with recovery guidance instead of directing readers to regenerate a damaged lock.
