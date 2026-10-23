---
'@ontrails/trails': patch
---

Refresh the generated Node type scaffold pin to the compatible Node 25 declaration line.

Reconcile the prior generated `@types/node` range (`^25.5.0`) to the current scaffold pin when rerunning `trails create` for standalone and workspace apps. Customized ranges still fail closed.
