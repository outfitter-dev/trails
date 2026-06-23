---
"@ontrails/warden": patch
---

Harden project-local rule loading: Warden now discovers `.trails/rules.ts` and direct `.trails/rules/*.ts` files only, reports duplicate project-local rule ids, and emits a migration diagnostic for the retired `trails/warden/rules` location.
