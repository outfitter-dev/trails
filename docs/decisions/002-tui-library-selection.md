# 2. TUI Library Selection and Evolution

- **Status**: Accepted
- **Date**: 2023-10-27
- **Author**: Max

## Context and Problem Statement

The `agentish` application requires a Terminal User Interface (TUI) to provide an interactive, pane-based experience for managing multiple agent sessions, inspired by tools like `lazygit`. The core decision is which Go library to use for building this TUI. The choice directly impacts the UI's architecture, maintainability, and developer experience.

## Decision Drivers

- **Target User Experience**: The UI must support a multi-pane layout with a primary content area and a dynamic tab-like view for sessions.
- **Architectural Soundness**: The chosen library should promote a clean, maintainable UI architecture.
- **Developer Ergonomics**: The library should be intuitive and efficient for Go developers.
- **Future-Proofing**: The architecture should be adaptable to future UI features without requiring a complete rewrite.

## Considered Options

1.  **`gocui`**: An imperative, view-based library. It provides direct control over named views, which are placed on a 2D grid. It is well-suited for pane-based layouts.
2.  **`bubbletea`**: A declarative, state-driven framework based on The Elm Architecture (TEA). It promotes a functional, component-based approach where the UI is a pure function of the application's state.

## Decision Outcome

**Initial Choice:** **`gocui`**.
The initial MVP of `agentish` was built using `gocui`.

**Future Direction:** **Migrate to `bubbletea`**.
As documented in `docs/proposals/002-migrate-to-bubbletea.md`, we will undertake a full migration of the TUI from `gocui` to `bubbletea`.

### Rationale

#### Why `gocui` was chosen initially:
- **Rapid Prototyping**: `gocui`'s imperative nature allowed for very fast initial development. The direct control over views made it simple to quickly build the desired `lazygit`-style layout.
- **Simplicity for Simple Layouts**: For the initial, relatively static layout of the MVP, `gocui`'s API was sufficient and easy to grasp.

#### Why we are migrating to `bubbletea`:
As the application grew, the limitations of the imperative `gocui` model became apparent. The UI logic was becoming tightly coupled with state management, making it harder to test and reason about.

1.  **Architectural Correctness**: `bubbletea` enforces the Model-View-Update (MVU) pattern. This is a proven, robust architecture for managing complex UI state. It decouples state management from view rendering, leading to cleaner, more predictable code.
2.  **Testability**: With `gocui`, testing UI logic requires complex mocking of the GUI state. With `bubbletea`, the `Update` function is pure: it takes a state and a message and returns a new state. This function can be unit-tested with ease and confidence, without ever needing to render a terminal UI.
3.  **Maintainability and Scalability**: The declarative, component-based model of `bubbletea` is far more scalable. Adding new UI features or changing existing ones involves creating or modifying self-contained components, with minimal risk of introducing side effects elsewhere in the application. This is a significant advantage over the interconnected view manipulations required by `gocui`.
4.  **Alignment with Modern UI Principles**: The `bubbletea` approach is philosophically aligned with modern UI development paradigms (React, Elm, etc.), making it a more forward-looking choice that will be easier for new developers to adopt.

## Consequences

- **Positive**:
    - The future UI codebase will be significantly more robust, testable, and maintainable.
    - It forces a clean separation between UI logic and application state.
    - Onboarding new developers will be easier due to the adoption of a standard, well-understood architectural pattern.
- **Negative**:
    - The migration requires a significant, one-time engineering investment to refactor the entire `internal/ui` package. This cost is justified by the long-term benefits to the project's health and velocity. 