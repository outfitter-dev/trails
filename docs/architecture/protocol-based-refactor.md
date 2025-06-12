# Trails Protocol-Based Architecture Refactor

## Executive Summary

This document outlines the comprehensive plan to refactor Trails from its current tightly-coupled architecture to a clean, protocol-based separation between the UI and core business logic, inspired by OpenAI Codex's architecture while leveraging modern Go practices and BubbleTea for the TUI.

> **Note**: This document should be read in conjunction with the [Security & Enhancement Addendum](./protocol-refactor-addendum.md) which addresses critical security, resilience, and operational concerns identified during architecture review.

## Table of Contents

1. [Current State Analysis](#current-state-analysis)
2. [Target Architecture](#target-architecture)
3. [Protocol Design](#protocol-design)
4. [Core Engine Design](#core-engine-design)
5. [UI Layer Design](#ui-layer-design)
6. [Implementation Plan](#implementation-plan)
7. [Testing Strategy](#testing-strategy)
8. [Migration Path](#migration-path)
9. [Risk Analysis](#risk-analysis)
10. [Success Metrics](#success-metrics)

## Current State Analysis

### Existing Architecture Issues

1. **Tight Coupling**: UI directly manages sessions, state, and business logic
2. **Testing Challenges**: Cannot test business logic without UI components
3. **Limited Extensibility**: Adding new interfaces (CLI, API) requires significant refactoring
4. **Synchronous Operations**: UI blocks during long-running operations

### Current Component Structure

```
internal/
├── ui/           # Gocui-based UI (tightly coupled)
├── session/      # Business logic mixed with UI concerns
├── state/        # State management accessed directly by UI
├── config/       # Configuration management
└── containeruse/ # Container integration
```

## Target Architecture

### Design Principles

1. **Protocol-First**: All communication through well-defined messages
2. **Event-Driven**: Asynchronous, non-blocking operations
3. **Domain Separation**: Clear boundaries between UI and business logic
4. **Testability**: Each layer independently testable
5. **Extensibility**: New interfaces without core changes

### Component Architecture

```
internal/
├── protocol/     # Message definitions and contracts
├── core/         # Business logic engine
│   ├── engine/   # Main event loop and command handling
│   ├── session/  # Session management (no UI deps)
│   ├── state/    # State management (no UI deps)
│   └── container/# Container integration
├── tui/          # BubbleTea TUI implementation
├── cli/          # Future: CLI interface
└── api/          # Future: HTTP/gRPC API
```

## Protocol Design

### Message Types

```go
// internal/protocol/types.go
package protocol

import (
    "time"
    "github.com/oklog/ulid/v2"
)

// Command represents UI → Core messages
type Command struct {
    ID        string      `json:"id"`
    Type      CommandType `json:"type"`
    Timestamp time.Time   `json:"timestamp"`
    Payload   interface{} `json:"payload"`
}

// Event represents Core → UI messages
type Event struct {
    ID          string    `json:"id"`
    CommandID   string    `json:"command_id,omitempty"`
    Type        EventType `json:"type"`
    Timestamp   time.Time `json:"timestamp"`
    Payload     interface{} `json:"payload"`
}

// CommandType enumeration
type CommandType string

const (
    // Session Management
    CmdCreateSession    CommandType = "session.create"
    CmdDeleteSession    CommandType = "session.delete"
    CmdUpdateSession    CommandType = "session.update"
    CmdListSessions     CommandType = "session.list"
    
    // Agent Operations
    CmdStartAgent       CommandType = "agent.start"
    CmdStopAgent        CommandType = "agent.stop"
    CmdRestartAgent     CommandType = "agent.restart"
    
    // Navigation
    CmdSetFocus         CommandType = "nav.focus"
    CmdNextActionable   CommandType = "nav.next_actionable"
    
    // UI Preferences
    CmdToggleMinimal    CommandType = "ui.toggle_minimal"
    CmdSetPreference    CommandType = "ui.set_preference"
    
    // System
    CmdShutdown         CommandType = "system.shutdown"
    CmdHealthCheck      CommandType = "system.health"
)

// EventType enumeration
type EventType string

const (
    // Session Events
    EventSessionCreated   EventType = "session.created"
    EventSessionDeleted   EventType = "session.deleted"
    EventSessionUpdated   EventType = "session.updated"
    EventSessionList      EventType = "session.list"
    
    // Status Events
    EventStatusChanged    EventType = "status.changed"
    EventProgressUpdate   EventType = "status.progress"
    
    // Environment Events
    EventEnvironmentReady EventType = "env.ready"
    EventEnvironmentError EventType = "env.error"
    
    // System Events
    EventError            EventType = "system.error"
    EventWarning          EventType = "system.warning"
    EventInfo             EventType = "system.info"
    EventStateSnapshot    EventType = "system.state_snapshot"
    EventHealthStatus     EventType = "system.health_status"
)
```

### Command Payloads

```go
// internal/protocol/commands.go
package protocol

// CreateSessionCommand payload
type CreateSessionCommand struct {
    Name          string            `json:"name"`
    Agent         string            `json:"agent"`
    Branch        string            `json:"branch,omitempty"`
    Environment   map[string]string `json:"environment,omitempty"`
}

// DeleteSessionCommand payload
type DeleteSessionCommand struct {
    SessionID string `json:"session_id"`
    Force     bool   `json:"force"`
}

// SetFocusCommand payload
type SetFocusCommand struct {
    SessionID string `json:"session_id"`
}

// StartAgentCommand payload
type StartAgentCommand struct {
    SessionID    string   `json:"session_id"`
    InitialPrompt string  `json:"initial_prompt,omitempty"`
    Arguments    []string `json:"arguments,omitempty"`
}
```

### Event Payloads

```go
// internal/protocol/events.go
package protocol

// SessionCreatedEvent payload
type SessionCreatedEvent struct {
    Session SessionInfo `json:"session"`
}

// SessionInfo represents session data in events
type SessionInfo struct {
    ID            string            `json:"id"`
    Name          string            `json:"name"`
    Agent         string            `json:"agent"`
    Status        SessionStatus     `json:"status"`
    EnvironmentID string            `json:"environment_id"`
    Branch        string            `json:"branch"`
    CreatedAt     time.Time         `json:"created_at"`
    UpdatedAt     time.Time         `json:"updated_at"`
}

// SessionStatus enumeration
type SessionStatus string

const (
    StatusReady    SessionStatus = "ready"
    StatusWorking  SessionStatus = "working"
    StatusWaiting  SessionStatus = "waiting"
    StatusError    SessionStatus = "error"
    StatusThinking SessionStatus = "thinking"
)

// StateSnapshotEvent provides complete state
type StateSnapshotEvent struct {
    Sessions      []SessionInfo     `json:"sessions"`
    FocusedID     string           `json:"focused_id"`
    MinimalMode   bool             `json:"minimal_mode"`
    Preferences   map[string]interface{} `json:"preferences"`
}

// ErrorEvent for error reporting
type ErrorEvent struct {
    Code        string `json:"code"`
    Message     string `json:"message"`
    Details     string `json:"details,omitempty"`
    Recoverable bool   `json:"recoverable"`
}
```

## Core Engine Design

### Engine Architecture

```go
// internal/core/engine/engine.go
package engine

import (
    "context"
    "sync"
    "github.com/outfitter-dev/trails/internal/protocol"
)

type Engine struct {
    // Channels
    commands <-chan protocol.Command
    events   chan<- protocol.Event
    
    // Core components
    sessions   *SessionManager
    state      *StateManager
    containers *ContainerManager
    
    // Runtime
    ctx        context.Context
    cancel     context.CancelFunc
    wg         sync.WaitGroup
    
    // Metrics
    metrics    *Metrics
}

type Config struct {
    MaxConcurrentSessions int
    CommandBufferSize     int
    EventBufferSize       int
    StateFile            string
}

func New(cfg Config, commands <-chan protocol.Command, events chan<- protocol.Event) (*Engine, error) {
    // Initialize engine with dependency injection
}

func (e *Engine) Start(ctx context.Context) error {
    e.ctx, e.cancel = context.WithCancel(ctx)
    
    // Start background workers
    e.wg.Add(1)
    go e.commandProcessor()
    
    e.wg.Add(1)
    go e.stateManager()
    
    e.wg.Add(1)
    go e.healthMonitor()
    
    // Send initial state
    e.sendStateSnapshot()
    
    return nil
}

func (e *Engine) Stop() error {
    e.cancel()
    e.wg.Wait()
    return e.state.Persist()
}
```

### Command Processing

```go
// internal/core/engine/processor.go
package engine

func (e *Engine) commandProcessor() {
    defer e.wg.Done()
    
    for {
        select {
        case <-e.ctx.Done():
            return
            
        case cmd := <-e.commands:
            e.processCommand(cmd)
        }
    }
}

func (e *Engine) processCommand(cmd protocol.Command) {
    // Log command for audit trail
    e.metrics.RecordCommand(cmd.Type)
    
    // Route to appropriate handler
    switch cmd.Type {
    case protocol.CmdCreateSession:
        e.handleCreateSession(cmd)
    case protocol.CmdDeleteSession:
        e.handleDeleteSession(cmd)
    case protocol.CmdStartAgent:
        e.handleStartAgent(cmd)
    default:
        e.sendError(cmd.ID, "unknown_command", "Unrecognized command type")
    }
}
```

### Session Management

```go
// internal/core/session/manager.go
package session

import (
    "context"
    "sync"
    "github.com/oklog/ulid/v2"
)

type Manager struct {
    mu       sync.RWMutex
    sessions map[string]*Session
    ordered  []string // Maintains order
    
    containers ContainerProvider
    events     chan<- protocol.Event
}

type Session struct {
    ID            ulid.ULID
    Name          string
    Agent         string
    Status        protocol.SessionStatus
    EnvironmentID ulid.ULID
    Branch        string
    
    CreatedAt     time.Time
    UpdatedAt     time.Time
    LastActivity  time.Time
    
    // Runtime state
    process       *AgentProcess
    mu            sync.RWMutex
}

func (m *Manager) Create(ctx context.Context, req protocol.CreateSessionCommand) (*Session, error) {
    // Validate request
    if err := m.validateCreateRequest(req); err != nil {
        return nil, err
    }
    
    // Create environment
    env, err := m.containers.CreateEnvironment(ctx, ContainerRequest{
        Name:   fmt.Sprintf("trails-%s", req.Name),
        Source: m.repoPath,
    })
    if err != nil {
        return nil, fmt.Errorf("container creation failed: %w", err)
    }
    
    // Create session
    session := &Session{
        ID:            ulid.Make(),
        Name:          req.Name,
        Agent:         req.Agent,
        Status:        protocol.StatusReady,
        EnvironmentID: env.ID,
        Branch:        req.Branch,
        CreatedAt:     time.Now(),
        UpdatedAt:     time.Now(),
        LastActivity:  time.Now(),
    }
    
    // Store session
    m.mu.Lock()
    m.sessions[session.ID.String()] = session
    m.ordered = append(m.ordered, session.ID.String())
    m.mu.Unlock()
    
    return session, nil
}
```

## UI Layer Design

### BubbleTea Model

```go
// internal/tui/model.go
package tui

import (
    tea "github.com/charmbracelet/bubbletea"
    "github.com/charmbracelet/bubbles/key"
    "github.com/outfitter-dev/trails/internal/protocol"
)

type Model struct {
    // Protocol channels
    commands chan<- protocol.Command
    events   <-chan protocol.Event
    
    // View state
    sessions      []SessionView
    focusedIndex  int
    minimalMode   bool
    
    // UI components
    keys          KeyMap
    width, height int
    ready         bool
    
    // Transient state
    lastError     error
    notification  string
}

type SessionView struct {
    ID            string
    Name          string
    Agent         string
    Status        protocol.SessionStatus
    StatusColor   string
    EnvironmentID string
    Branch        string
}

type KeyMap struct {
    Quit          key.Binding
    CreateSession key.Binding
    DeleteSession key.Binding
    StartAgent    key.Binding
    Navigate      key.Binding
    ToggleMinimal key.Binding
}

func NewModel(commands chan<- protocol.Command, events <-chan protocol.Event) Model {
    return Model{
        commands: commands,
        events:   events,
        keys:     DefaultKeyMap(),
    }
}
```

### Update Loop

```go
// internal/tui/update.go
package tui

func (m Model) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
    switch msg := msg.(type) {
    case tea.KeyMsg:
        return m.handleKeyPress(msg)
        
    case tea.WindowSizeMsg:
        m.width = msg.Width
        m.height = msg.Height
        m.ready = true
        return m, nil
        
    case protocol.Event:
        return m.handleEvent(msg)
        
    case tickMsg:
        return m, tea.Batch(
            listenForEvents(m.events),
            tick(),
        )
    }
    
    return m, nil
}

func (m Model) handleKeyPress(key tea.KeyMsg) (tea.Model, tea.Cmd) {
    switch {
    case key.Matches(m.keys.Quit):
        m.sendCommand(protocol.CmdShutdown, nil)
        return m, tea.Quit
        
    case key.Matches(m.keys.CreateSession):
        m.sendCommand(protocol.CmdCreateSession, protocol.CreateSessionCommand{
            Name:  m.generateSessionName(),
            Agent: m.getDefaultAgent(),
        })
        return m, nil
        
    case key.Matches(m.keys.Navigate):
        if key.String() == "j" && m.focusedIndex < len(m.sessions)-1 {
            m.focusedIndex++
            m.sendCommand(protocol.CmdSetFocus, protocol.SetFocusCommand{
                SessionID: m.sessions[m.focusedIndex].ID,
            })
        }
        return m, nil
    }
    
    return m, nil
}
```

### View Rendering

```go
// internal/tui/view.go
package tui

import (
    "github.com/charmbracelet/lipgloss"
)

var (
    tabStyle = lipgloss.NewStyle().
        Border(lipgloss.RoundedBorder()).
        BorderForeground(lipgloss.Color("240")).
        Padding(0, 1)
        
    activeTabStyle = tabStyle.Copy().
        BorderForeground(lipgloss.Color("magenta"))
        
    statusColors = map[protocol.SessionStatus]lipgloss.Color{
        protocol.StatusReady:    lipgloss.Color("green"),
        protocol.StatusWorking:  lipgloss.Color("yellow"),
        protocol.StatusWaiting:  lipgloss.Color("cyan"),
        protocol.StatusError:    lipgloss.Color("red"),
        protocol.StatusThinking: lipgloss.Color("blue"),
    }
)

func (m Model) View() string {
    if !m.ready {
        return "Initializing..."
    }
    
    if m.minimalMode {
        return m.renderMinimalView()
    }
    
    return lipgloss.JoinVertical(
        lipgloss.Top,
        m.renderTabs(),
        m.renderContent(),
        m.renderStatusBar(),
    )
}

func (m Model) renderTabs() string {
    var tabs []string
    
    for i, session := range m.sessions {
        style := tabStyle
        if i == m.focusedIndex {
            style = activeTabStyle
        }
        
        statusIcon := m.getStatusIcon(session.Status)
        tab := style.Render(fmt.Sprintf("%s %s", statusIcon, session.Name))
        tabs = append(tabs, tab)
    }
    
    return lipgloss.JoinHorizontal(lipgloss.Top, tabs...)
}
```

## Implementation Plan

### Phase 1: Foundation (Week 1-2)

1. **Protocol Package**
   - Define all message types
   - Create serialization helpers
   - Write comprehensive tests

2. **Core Engine Skeleton**
   - Basic engine structure
   - Command routing
   - Event publishing

3. **Development Tools**
   - Protocol visualizer
   - Debug logging
   - Performance profiling

### Phase 2: Core Migration (Week 3-4)

1. **Session Management**
   - Extract from current UI
   - Add protocol adapters
   - Maintain backward compatibility

2. **State Management**
   - Create event-sourced state
   - Implement persistence
   - Add recovery mechanisms

3. **Container Integration**
   - Wrap existing provider
   - Add async operations
   - Implement retry logic

### Phase 3: UI Implementation (Week 5-6)

1. **BubbleTea Setup**
   - Basic model structure
   - Event handling
   - View rendering

2. **Feature Parity**
   - All current features
   - Improved responsiveness
   - Better error handling

3. **Polish**
   - Animations
   - Help system
   - Configuration UI

### Phase 4: Testing & Migration (Week 7-8)

1. **Comprehensive Testing**
   - Unit tests (>90% coverage)
   - Integration tests
   - End-to-end tests

2. **Migration Tools**
   - State converter
   - Config migrator
   - Rollback support

3. **Documentation**
   - Architecture docs
   - API references
   - Migration guide

## Testing Strategy

### Unit Testing

```go
// internal/core/engine/engine_test.go
package engine_test

import (
    "testing"
    "github.com/stretchr/testify/assert"
    "github.com/stretchr/testify/require"
)

func TestEngineCreateSession(t *testing.T) {
    // Setup
    cmdChan := make(chan protocol.Command, 10)
    eventChan := make(chan protocol.Event, 10)
    
    engine, err := engine.New(engine.Config{
        CommandBufferSize: 10,
        EventBufferSize:   10,
    }, cmdChan, eventChan)
    require.NoError(t, err)
    
    ctx, cancel := context.WithCancel(context.Background())
    defer cancel()
    
    require.NoError(t, engine.Start(ctx))
    
    // Test
    cmd := protocol.Command{
        ID:   "test-1",
        Type: protocol.CmdCreateSession,
        Payload: protocol.CreateSessionCommand{
            Name:  "test-session",
            Agent: "claude",
        },
    }
    
    cmdChan <- cmd
    
    // Assert
    select {
    case event := <-eventChan:
        assert.Equal(t, protocol.EventSessionCreated, event.Type)
        assert.Equal(t, "test-1", event.CommandID)
        
        payload := event.Payload.(protocol.SessionCreatedEvent)
        assert.Equal(t, "test-session", payload.Session.Name)
        assert.Equal(t, "claude", payload.Session.Agent)
        
    case <-time.After(time.Second):
        t.Fatal("timeout waiting for event")
    }
}
```

### Integration Testing

```go
// internal/tui/integration_test.go
package tui_test

func TestFullUserFlow(t *testing.T) {
    // Create test harness
    harness := newTestHarness(t)
    defer harness.Cleanup()
    
    // Start application
    model := tui.NewModel(harness.Commands, harness.Events)
    
    // Simulate user creating session
    model, _ = model.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'c'}})
    
    // Verify command sent
    cmd := harness.ExpectCommand(t, protocol.CmdCreateSession)
    assert.NotEmpty(t, cmd.ID)
    
    // Send response
    harness.SendEvent(protocol.Event{
        CommandID: cmd.ID,
        Type:      protocol.EventSessionCreated,
        Payload:   testSessionCreatedPayload(),
    })
    
    // Verify UI updated
    view := model.View()
    assert.Contains(t, view, "test-session")
}
```

## Migration Path

### Backward Compatibility

1. **Parallel Implementation**
   - Keep old code functional
   - Add feature flags
   - Gradual rollout

2. **State Migration**
   ```go
   // internal/migration/v1_to_v2.go
   func MigrateState(oldState *v1.State) (*v2.State, error) {
       // Convert old format to new
   }
   ```

3. **Configuration Migration**
   - Auto-detect old format
   - Convert on first run
   - Backup original

### Rollout Strategy

1. **Alpha (Internal Testing)**
   - Feature flag: `--experimental-protocol`
   - Limited to dev team
   - Extensive logging

2. **Beta (Early Adopters)**
   - Opt-in via config
   - Migration tools
   - Feedback collection

3. **GA (General Availability)**
   - Default for new installs
   - Migration prompt for existing
   - Deprecation warnings

## Risk Analysis

### Technical Risks

1. **Performance Regression**
   - Mitigation: Comprehensive benchmarks
   - Monitoring: Metrics collection
   - Fallback: Feature flag disable

2. **State Corruption**
   - Mitigation: Event sourcing
   - Recovery: Automatic backups
   - Prevention: Validation layers

3. **Protocol Evolution**
   - Mitigation: Version negotiation
   - Compatibility: Message schemas
   - Testing: Backward compat tests

### Operational Risks

1. **User Disruption**
   - Mitigation: Gradual rollout
   - Communication: Clear docs
   - Support: Migration assistance

2. **Development Velocity**
   - Mitigation: Parallel tracks
   - Planning: Buffer time
   - Flexibility: Scope adjustment

## Success Metrics

### Technical Metrics

1. **Performance**
   - Command latency < 10ms
   - Event delivery < 5ms
   - Memory usage < 50MB

2. **Reliability**
   - 99.9% uptime
   - Zero data loss
   - Graceful degradation

3. **Quality**
   - Test coverage > 90%
   - Zero critical bugs
   - <5% defect rate

### User Metrics

1. **Adoption**
   - 80% migration in 30 days
   - <5% rollback rate
   - Positive feedback ratio

2. **Usability**
   - Task completion time
   - Error rate reduction
   - Feature discovery

## Next Steps

After reviewing this architecture, proceed to the [Security & Enhancement Addendum](./protocol-refactor-addendum.md) for:
- Security implementation details
- Protocol versioning strategy
- Enhanced error recovery patterns
- Advanced observability setup
- Resource management guidelines

## Appendix

### Technology Choices

1. **BubbleTea over Gocui**
   - Better architecture
   - Active development
   - Modern Go patterns

2. **Channels over RPC**
   - Simpler for single process
   - Type safety
   - Lower latency

3. **Event Sourcing Pattern**
   - Audit trail
   - Time travel debugging
   - State reconstruction

### Reference Architecture

Similar successful implementations:
- OpenAI Codex (TypeScript/Rust)
- Neovim (RPC protocol)
- Language Server Protocol
- Chrome DevTools Protocol

### Further Reading

- [The Log: What every software engineer should know about real-time data's unifying abstraction](https://engineering.linkedin.com/distributed-systems/log-what-every-software-engineer-should-know-about-real-time-datas-unifying)
- [Event Sourcing](https://martinfowler.com/eaaDev/EventSourcing.html)
- [BubbleTea Tutorial](https://github.com/charmbracelet/bubbletea/tree/master/tutorials)
- [Security & Enhancement Addendum](./protocol-refactor-addendum.md) - Critical improvements for production readiness