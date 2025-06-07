# 002: Architectural Refactor - Migrate TUI from gocui to bubbletea

- **Status**: Proposed
- **Author**: Max
- **Date**: 2023-10-27

## Summary

This document proposes a foundational architectural refactor of the Terminal User Interface (TUI), migrating from the imperative **gocui** library to the declarative, state-driven **bubbletea** framework. This change aligns with modern best practices for state management, specifically The Elm Architecture (TEA), which is directly analogous to moving from direct DOM manipulation to a framework like React or Ink in the JavaScript ecosystem. The primary goal is to improve the UI code's clarity, testability, and long-term maintainability.

## Current State: Imperative `gocui`

Our current implementation, as detailed in `001-mvp-architecture.md`, uses `gocui`. This model requires us to directly manipulate UI views in an imperative fashion.

- **Layout:** The `layout` function in `internal/ui/app.go` imperatively creates, places, and updates `gocui.View` objects.
- **State Management:** Keybinding functions directly mutate the application's shared state (e.g., `a.state.MoveFocus(1)`), which can lead to subtle side effects and makes the flow of data harder to trace. This couples the UI actions directly to state manipulation.

### Example Snippet (`keybindings.go`)

```go
// moveDown navigates to the next session
func (a *App) moveDown(g *gocui.Gui, v *gocui.View) error {
	a.state.MoveFocus(1) // Direct state mutation
	return nil
}
```

This works, but at what cost? The cost is clarity and testability.

## Proposed Architecture: Declarative `bubbletea`

The new architecture will be based on the Model-View-Update (MVU) pattern, a proven pattern for managing complex UI state.

- **Model:** A single `struct` that holds all UI state. This will likely be an evolution of our current `ui.App` struct, becoming the single source of truth.
- **Update:** A pure function that takes the current model and a message (`tea.Msg`) and returns a *new*, updated model. All events (keypresses, async operations from agents, etc.) are handled here as messages. State becomes immutable within the update cycle.
- **View:** A method on the model that renders the entire UI as a `string` based solely on the model's current state. The framework handles diffing and rendering efficiently.

### Conceptual Example

```go
type model struct {
	sessions []session.Session
	cursor   int
	// ... other UI state
}

func (m model) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.KeyMsg:
		switch msg.String() {
		case "j":
			m.cursor++
			if m.cursor >= len(m.sessions) {
				m.cursor = len(m.sessions) - 1
			}
		// ... other keybindings would be handled here
		}
	}
	// The updated model is returned. bubbletea handles the rest.
	return m, nil
}

func (m model) View() string {
	var s strings.Builder
	for i, sess := range m.sessions {
		// The view is a pure function of the model's state
		if i == m.cursor {
			s.WriteString("> ")
		}
		s.WriteString(sess.GetDisplayName())
		s.WriteString("\n")
	}
	return s.String()
}
```

## Migration Plan

This refactor should be executed systematically on a dedicated feature branch (`feat/bubbletea-migration`) to avoid disrupting the main branch.

1.  **Dependencies:** Add `github.com/charmbracelet/bubbletea` and `github.com/charmbracelet/lipgloss` (for styling) to `go.mod`.
2.  **Prototype (Spike):** Create a small, isolated prototype of just the session tabs view. This will establish a clear pattern for the rest of the UI and validate the approach.
3.  **Componentization:** Break down the existing UI into logical components (`TabsModel`, `MainContentModel`, `StatusModel`) that can be migrated one by one and composed together in the final view. `bubbletea` excels at this compositional approach.
4.  **State Unification:** Refactor the core `ui.App` to become the primary `bubbletea` model, holding the component models as substructs.
5.  **Keybindings to Messages:** Convert all `gocui` keybinding functions to `tea.Msg` types, which will be handled by the central `Update` function. This decouples the event from the state change.
6.  **Full Migration:** Replace the `gocui.Gui` loop in `Run()` with `bubbletea.Program.Start()`.
7.  **Cleanup:** Once the migration is complete and verified, remove the `gocui` dependency and the now-obsolete UI files.

## Benefits

- **Enhanced Testability:** The pure `Update` function is trivial to unit test. We can pass in a model and a message and assert that the output model has the correct state, all without needing to render an actual UI.
- **Predictable State:** Centralized, immutable state updates make the application significantly easier to reason about and debug. Data flows in one direction.
- **Maintainability & Scalability:** A component-based, declarative architecture is easier to extend and refactor without introducing bugs. Adding new features becomes a matter of adding a new component or handling a new message.
- **Adherence to Best Practices:** Aligns our codebase with proven architectural patterns used in modern, robust UI development across different ecosystems. 