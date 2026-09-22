---
name: trails-language-styleguide
description: Compatibility pointer for older Trails prompts. Prefer `trails-writing-voice`, `trails-writing-style`, `trails-writing-docs`, or `trails-editorial` when writing or reviewing Trails docs, ADRs, agent prompts, examples, comments, or contributor guidance.
---

# Trails Language Styleguide

This skill remains for compatibility with older prompts and installed plugin versions. New writing work should load the current writing skills instead:

1. `trails-writing-voice` for stance, audience, and tone.
2. `trails-writing-style` for prose craft, examples, and vocabulary discipline.
3. `trails-writing-docs` for document placement and maintenance.
4. `trails-editorial` for a full review workflow.

If a prompt explicitly asks for this older skill, continue by reading `trails-writing-style` and, when the task is broader than vocabulary, also read `trails-writing-voice` and `trails-writing-docs`.
