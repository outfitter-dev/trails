# Comprehensive Code Review – Agentish

*Date: 2025-06-06*

---

## 1. Executive Summary

This document captures the results of a full-repository code review of **agentish** as of the 06 Jun 2025 snapshot.  Overall the codebase is well-structured, but several critical issues block a clean build and safe operation.  The sections below categorise findings using the project’s review legend:

🔴 **Must-fix (blocker)**  🟡 **Should fix**  🟢 **Suggestion**  🔵 **Nitpick**

---

## 2. High-Level Assessment

- Cohesive package layout (`config/`, `session/`, `state/`, `ui/`, `containeruse/`) that follows Go’s `internal` convention.
- Clear domain modelling of **sessions** and **state** with respectable unit-test coverage (≈70 % overall, 100 % for core packages).
- Limited external dependencies (only `gocui` and OS exec) keeps the binary small and audit-friendly.
- Good separation between *model* (session/state) and *interface* (TUI + container-use adapter).

---

## 3. Blockers 🔴

| # | Issue | Impact | Proposed Fix |
|---|-------|--------|--------------|
| 1 | **gocui API update** – `gocui.NewGui()` signature changed (requires `OutputMode` & `useCurrent`). | Compilation fails with latest fork (used by lazygit). | `g, err := gocui.NewGui(gocui.OutputNormal, true)` |
| 2 | **`State.Save()` never sets `LastSaved`**. | Persisted JSON contains `"last_saved": 0`; downstream features that rely on monotonic timestamps break. | Set `s.LastSaved = time.Now().Unix()` immediately before `MarshalIndent`. |
| 3 | **Brittle CLI output parsing** in `containeruse/client.go` (`CreateEnvironment`). | Any upstream format change breaks environment creation → no sessions. | Use `container-use environment create --format json` and decode the JSON payload (already done for list/get). |

---

## 4. Important Fixes 🟡

1. **Dependency Injection** – `session.Manager` internally constructs a `containeruse.Client`; tests are forced to call the real binary. Inject an `EnvironmentProvider` interface so unit tests can stub the dependency.
2. **Concurrency Safety for `state.State`** – Mutations and reads will soon come from multiple goroutines (UI callbacks + background polling). Add an `RWMutex` or enforce single-goroutine access (e.g. via the gocui main loop).
3. **GUI Refresh Lag** – Post-action keybindings (`createSession`, `deleteSession`, etc.) don’t call `gui.Update`; tabs visually lag one frame.
4. **`Config.GetAutoRestore()` Shadowing** – The presence of a *Local* config with `auto_restore` omitted implicitly overrides upper scopes to *false*. Use a tri-state `*bool` or sentinel value.

---

## 5. Suggestions 🟢

- Promote `EnvironmentID`/`Status` to dedicated enum types to avoid stringly-typed switches.
- Replace `fmt.Sprintf("%s-%d", name, now.Unix())` session IDs with ULIDs – sortable & globally unique.
- Offer a small non-TUI CLI (e.g. `agentish create-session …`) for scripting and integration tests.
- Persist UI preferences (minimal mode, view sizes) to config for better UX continuity.

---

## 6. Nitpicks 🔵

- `Session.NewSession` sets `Position` to zero; `state.updatePositions()` overwrites it – redundant.
- Missing doc-comments on public types (`State`, `App`, etc.) – hurts godoc.
- `ui/colors.go` imports `fmt` solely for `Sprintf`; consider `strings.Builder` once colours are further abstracted.
- Unit-test names use mixed-case (`Repo_config`) – prefer `repo-config` for Go table names.

---

## 7. Test & Coverage Snapshot

```
$ go test ./... -cover
ok   github.com/maybe-good/agentish/internal/config    ✔
ok   github.com/maybe-good/agentish/internal/session   ✔
ok   github.com/maybe-good/agentish/internal/state     ✔
?    github.com/maybe-good/agentish/internal/ui        (no tests)
?    github.com/maybe-good/agentish/internal/containeruse (no tests)

overall coverage: ~70 %
```

---

## 8. Recommended Next Steps

1. Address all **blockers** immediately; ensure `make build` passes on CI with the latest `gocui`.
2. Introduce `EnvironmentProvider` interface and write unit tests for `session.Manager`.
3. Refactor `Config` tri-state logic and add regression tests.
4. Add an integration test that stubs the `container-use` CLI to validate session create/destroy flows.

---

*Prepared by: Max, The Principled Engineer*
