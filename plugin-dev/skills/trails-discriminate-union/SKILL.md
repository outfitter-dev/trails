---
description: Compatibility entry for older public-union review prompts. Use Trails Warden's public-output discriminant rule and the building-trails owner-first workflow.
metadata:
  skillset.schema: "1"
  version: 0.1.0
name: trails-discriminate-union
---

# Trails Discriminate Union

This case is enforced by the `public-union-output-discriminants` Warden rule. Load [`building-trails`](../building-trails/SKILL.md), inspect the owner schema, and run the repository's documented Warden gate. Keep only a focused advisory finding when the schema cannot yet prove whether a union is public.
