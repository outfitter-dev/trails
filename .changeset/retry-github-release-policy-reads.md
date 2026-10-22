---
'@ontrails/trails': patch
---

Retry transient GitHub API failures in release policy reads. `githubJson` now retries 5xx responses and network errors up to four attempts with exponential backoff (1s, 2s, 4s) before failing, so an intermittent `500` from `/commits/{sha}/pulls` no longer fails the Release workflow's `label-release-pr` step. 4xx responses still fail immediately.
