# Agentish MVP Architecture

## Overview

Agentish is a terminal UI for managing multiple AI coding agents in isolated containerized environments. It provides a lazygit-inspired interface with collapsing session tabs and seamless state restoration.

## Core Concepts

### Sessions
- Each session = one AI agent + one container-use environment
- Sessions can collapse to one-line summaries or expand to full interface
- Navigate between sessions with j/k keys
- Sessions have status: `[ready]`, `[working]`, `[error]`, `[waiting]`

### Interface Design
```
┌─ claude:auth [ready] ──┬─ aider:tests [working] ──┬─ coordinator [thinking] ─┐
│                        │                          │                          │
└────────────────────────┴──────────────────────────┴──────────────────────────┘
┌──────────────────────────────────────────────────────────────────────────────┐
│                                                                              │
│                     [EXPANDED SESSION CONTENT]                              │
│                                                                              │
│  Agent terminal interface shows here when session is focused                │
│  Background sessions collapse to tabs above                                 │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

### Navigation
- `j/k` - Navigate up/down through session stack
- `tab` - Toggle between session view and coordinator view
- `n` - Jump to next `[ready]` or `[needs input]` session
- `enter` - Enter focused session (contained interaction)
- `m` - Toggle minimal status bar mode

### Minimal Mode
When agents are working autonomously:
```
claude:auth[working] aider:tests[ready] codex:docs[waiting] coordinator[thinking]
```

## MVP Technical Architecture

### Tech Stack
- **Language**: Go
- **TUI Library**: gocui (same as lazygit)
- **Backend**: container-use MCP server
- **State**: JSON files in `.trails/`

### Project Structure
```
trails/
├── cmd/
│   └── trails/
│       └── main.go
├── internal/
│   ├── config/          # Config management
│   ├── session/         # Session management
│   ├── ui/              # TUI components
│   ├── containeruse/    # Container-use client
│   └── state/           # State persistence
├── docs/
├── go.mod
└── go.sum
```

### Session Management
Each session maintains:
- Container-use environment ID
- Agent type (claude, aider, codex)
- Current status and last activity
- UI state (collapsed/expanded, position)

### State Persistence
Global state in `~/.config/trails/`:
- Projects registry
- Global preferences

Per-repo state in `<repo>/.trails/`:
- `state.json` - Active sessions, UI state
- `settings.json` - Repo preferences (committed)
- `settings.local.json` - Personal overrides (gitignored)

### Container-use Integration
- Use container-use MCP client to create/manage environments
- Each session spawns agent inside container
- Leverage container-use's git worktree management
- Use container-use's checkpoint feature for session snapshots

## MVP Features

### Phase 1: Basic Session Management
- [x] Single repo mode (`cd repo && trails`)
- [x] Create/destroy sessions via container-use
- [x] Basic tab navigation (j/k)
- [x] Session status tracking
- [x] Simple state persistence

### Phase 2: Enhanced UI
- [x] Collapsing session interface
- [x] Status-based color coding
- [x] Minimal mode toggle
- [x] "Next ready" navigation
- [x] Session restoration on startup

### Phase 3: Polish
- [x] Better status summaries
- [x] Error handling and recovery
- [x] Configuration system
- [x] Documentation

## Future Features (Post-MVP)

### Coordinator Agent
- Separate view for project-level management
- Claude Code instance with custom tools
- Task breakdown and assignment
- Multi-agent coordination

### Project Management
- Multi-project support with tabs
- Home view with project picker
- Recently active projects
- Project templates and preferences

### Advanced Features
- Periodic agent summarization
- Split-screen session views
- Session sharing/export
- Integration with other agent tools

## Implementation Plan

1. **Setup**: Project structure, dependencies, basic CLI
2. **Container-use client**: Integration with container-use MCP
3. **Basic UI**: Single session display with gocui
4. **Session management**: Create/destroy/navigate sessions
5. **State persistence**: Save/restore session state
6. **Enhanced navigation**: Tab system, status indicators
7. **Polish**: Error handling, configuration, docs

## Success Criteria

MVP is successful when:
- Can launch trails in any git repo
- Can create multiple agent sessions
- Sessions persist across restarts
- Navigation feels natural and fast
- Interface provides clear status awareness
- Integration with container-use is seamless