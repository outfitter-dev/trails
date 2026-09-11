---
"@ontrails/trails": patch
---

Support the approved initial release on `latest` at `0.2.0`: recognize the unpublished `1.0.0` source reset and the old beta tag predecessor, while retaining downgrade guards for every other transition and requiring manual publication.

Recognize the approved manual version PR in publication discovery with exact repository, branch, version, and label checks; preserve the normal bot-generated release path.
