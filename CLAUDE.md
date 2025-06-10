# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

About You: @.ai/prompts/MAX.md

## Project Overview

Trails is a terminal UI for managing multiple AI coding agents in isolated containerized environments. It provides a lazygit-inspired interface with collapsing session tabs and seamless state restoration.

## Development Commands

### Build and Run
- `make build` - Build binary to build/trails
- `make run` - Run from source (go run cmd/trails/main.go)
- `make dev` - Development with auto-rebuild (requires air)
- `make install` - Install to GOPATH/bin

### Testing and Quality
- `make test` - Run tests (go test -v ./...)
- `make lint` - Run golangci-lint (auto-installs if missing)
- `make fmt` - Format code with go fmt

### Dependencies
- `make deps` - Initialize go.sum and download dependencies (go mod tidy && go mod download)

## Architecture

### Core Components
- **Sessions** (`internal/session/`): Manages individual agent sessions with status tracking and container-use environment integration
- **State** (`internal/state/`): Handles application state persistence in `.trails/state.json` with session ordering and focus management
- **Config** (`internal/config/`): Three-tier configuration system (global ~/.config/trails/, repo .trails/settings.json, local .trails/settings.local.json)
- **UI** (`internal/ui/`): Terminal interface using gocui with tab-based navigation and keyboard shortcuts

### Session Management
Each session represents one AI agent + one container-use environment with states: ready, working, waiting, error, thinking. Sessions persist across application restarts and maintain environment IDs for container-use integration.

### Navigation Model
- j/k keys for session navigation
- Tab-based interface with collapsing sessions
- Status-aware focus management (actionable sessions prioritized)
- Minimal mode for autonomous agent operation

### State Persistence
- Global config: ~/.config/trails/config.json
- Repo settings: .trails/settings.json (committed)
- Local overrides: .trails/settings.local.json (gitignored)
- Session state: .trails/state.json (runtime state)

## Development Notes

### Container-use Integration
The `internal/containeruse/` package is planned for MCP client integration. Currently sessions use placeholder environment IDs until container-use backend is implemented.

### TUI Framework
Uses gocui (same as lazygit) for terminal interface consistency. Main layout includes tabs view (0,0 to maxX,2) and main content view (0,3 to maxX,maxY).

### Session Status Model
Status enum drives UI coloring and navigation behavior. IsActionable() method determines which sessions need user attention for the "next actionable" navigation feature.