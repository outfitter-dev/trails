# Trails

A terminal UI for managing multiple AI coding agents in isolated containerized environments.

## Overview

Trails provides a lazygit-inspired interface for working with multiple AI agents simultaneously. Each agent runs in its own containerized environment, with seamless state restoration and intuitive navigation.

## Features

- **Multi-agent management**: Run Claude Code, Aider, Codex, Amp, Jules, OpenCode and other agents simultaneously
- **Containerized isolation**: Each agent gets its own container-use environment
- **Session tabs**: Navigate between agents with j/k keys, collapsing interface
- **State persistence**: Resume exactly where you left off
- **Status awareness**: See which agents are working, waiting, or need input
- **Minimal mode**: Compact status bar when agents are working autonomously

## Installation

```bash
# Clone and build
git clone https://github.com/maybe-good/trails
cd trails
go build -o trails cmd/trails/main.go

# Or install directly
go install github.com/maybe-good/trails/cmd/trails@latest
```

## Prerequisites

- [container-use](https://github.com/dagger/container-use) - Containerized environments backend
- Go 1.24+ for building from source

## Usage

```bash
# Launch trails in any git repository
cd your-project
trails
```

### Keyboard Shortcuts

- `j/k` - Navigate up/down through sessions
- `c` - Create new agent session
- `d` - Delete current session
- `n` - Jump to next session needing attention
- `m` - Toggle minimal status bar mode
- `q` - Quit and save state

### Interface

```
┌─ claude:auth [ready] ──┬─ aider:tests [working] ──┬─ coordinator [thinking] ─┐
│                        │                          │                          │
└────────────────────────┴──────────────────────────┴──────────────────────────┘
┌──────────────────────────────────────────────────────────────────────────────┐
│                                                                              │
│                     [FOCUSED SESSION CONTENT]                               │
│                                                                              │
│  Active agent terminal interface displays here                              │
│  Other sessions collapse to tabs above                                      │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

## Configuration

### Global Config: `~/.config/trails/config.json`
```json
{
  "default_agent": "claude",
  "project_registry": {},
  "theme": "default",
  "minimal_mode": false
}
```

### Repo Config: `.trails/settings.json`
```json
{
  "preferred_agents": ["claude", "aider"],
  "default_agent": "claude",
  "auto_restore": true,
  "minimal_mode": false,
  "environment": {}
}
```

### Local Overrides: `.trails/settings.local.json`
```json
{
  "default_agent": "aider",
  "auto_restore": false,
  "minimal_mode": true
}
```

## Development

```bash
# Run from source
go run cmd/trails/main.go

# Run tests
go test ./...

# Build
go build -o trails cmd/trails/main.go
```

## Architecture

See [docs/proposals/001-mvp-architecture.md](docs/proposals/001-mvp-architecture.md) for detailed technical design.

## Status

🚧 **Early Development** - Basic session management implemented, container-use integration in progress.

## License

MIT