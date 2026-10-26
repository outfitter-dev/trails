---
'@ontrails/trails': patch
---

Preserve Warden's explicit config path when resolving workspace identity and app selection. From a parent directory, an explicit descendant workspace config selects that workspace or the requested app within the discovery boundary. Workspace results report `config-path` selection provenance when the config selects the descendant workspace. Relative and absolute explicit paths reach Warden as the same resolved config file; existing in-workspace CWD selection and omitted-config discovery are unchanged.
