---
"@ontrails/testing": patch
---

Honor CLI preset registrations in createCliHarness and reject unregistered flags before executing a trail. Register JSON output explicitly in surface parity checks, and avoid structured-input flags for empty examples. Harness callers using output flags must configure the same outputModePreset as their CLI or omit those flags.
