# System Overview

Trails is a terminal-based UI for managing multiple AI coding agents in isolated containerized environments. It provides a lazygit-inspired interface with session management, state persistence, and seamless agent coordination.

## Core Concepts

### Sessions
A **session** represents one AI agent working in one isolated container environment. Each session maintains:
- Unique identity and configuration
- Current status (ready, working, waiting, error, thinking)
- Container environment for isolated execution
- Git branch and working directory state
- Agent-specific settings and context

### Engine
The **engine** is the core orchestration component that:
- Processes commands from the UI via channels
- Manages session lifecycle and state transitions
- Coordinates with container environments
- Maintains persistent state across restarts
- Provides metrics and health monitoring

### Protocol
The **protocol** defines the command/event messaging system:
- Commands flow from UI to engine (create session, start agent, etc.)
- Events flow from engine to UI (status updates, progress, errors)
- Type-safe JSON serialization with structured payloads
- Command validation and error handling

## Architecture Diagram

```
┌─────────────────┐    Commands    ┌─────────────────┐    Container    ┌─────────────────┐
│   Terminal UI   │───────────────▶│     Engine      │◄───────────────│   Container     │
│                 │◄───────────────│                 │                 │  Environments   │
│  - Session tabs │     Events     │  - Workers      │                 │                 │
│  - Key bindings │                │  - Rate limits  │                 │  - Isolated     │
│  - Status views │                │  - Validation   │                 │  - Agent procs  │
└─────────────────┘                │  - State mgmt   │                 │  - File systems │
                                   └─────────────────┘                 └─────────────────┘
                                           │                                     
                                           ▼                                     
                                   ┌─────────────────┐                          
                                   │  State & Config │                          
                                   │                 │                          
                                   │  - Session data │                          
                                   │  - Preferences  │                          
                                   │  - Metrics      │                          
                                   └─────────────────┘                          
```

## Key Design Principles

### Isolation
Each AI agent runs in a completely isolated container environment with:
- Own filesystem and process space
- Controlled resource limits
- Network isolation where appropriate
- No cross-session contamination

### Reliability
The system prioritizes reliability through:
- Graceful error handling and recovery
- State persistence across restarts
- Rate limiting to prevent resource exhaustion
- Comprehensive monitoring and metrics

### Performance
Performance is optimized via:
- Concurrent command processing with worker pools
- Non-blocking channel-based communication
- Efficient state serialization
- Resource pooling and cleanup

### Extensibility
The architecture supports extension through:
- Clean interfaces for pluggable components
- Type-safe protocol with version negotiation
- Modular session and container management
- Metrics and monitoring hooks

## Component Relationships

### Engine ↔ Session Manager
- Engine delegates session operations to SessionManager
- SessionManager maintains session lifecycle and metadata
- Thread-safe operations with fine-grained locking
- Status transitions coordinated through events

### Engine ↔ Container Manager
- Engine requests container creation/destruction
- ContainerManager handles environment provisioning
- Async operations with status polling
- Resource cleanup on session termination

### Engine ↔ State Manager
- Engine persists state periodically via StateManager
- StateManager handles serialization and storage
- Atomic updates to prevent corruption
- Configurable persistence intervals

### Engine ↔ UI
- Bidirectional communication via typed channels
- Commands are validated and rate-limited
- Events provide real-time status updates
- Non-blocking operation prevents UI freezing

## Concurrency Model

Trails uses a **structured concurrency** approach:

### Worker Pool
- Fixed number of worker goroutines process commands
- Load balancing across workers
- Graceful shutdown with context cancellation
- Worker-specific logging and error tracking

### Channel Communication
- Buffered channels prevent blocking
- Type-safe message passing
- Backpressure handling with retry logic
- Circuit breaker patterns for resilience

### State Synchronization
- RWMutex for session state protection
- Atomic operations for counters and flags
- Lock-free data structures where possible
- Deadlock prevention through lock ordering

## Data Flow

### Command Processing
1. **UI Input**: User action generates command
2. **Validation**: Engine validates command structure and auth
3. **Rate Limiting**: Per-session rate limits applied
4. **Routing**: Command routed to appropriate handler
5. **Execution**: Handler performs business logic
6. **Events**: Success/error events sent to UI
7. **Metrics**: Performance metrics recorded

### State Persistence
1. **Periodic Saves**: State saved every 30 seconds
2. **Atomic Writes**: State written to temporary file first
3. **Validation**: Saved state validated on write
4. **Recovery**: On startup, state loaded and validated
5. **Migration**: State schema migrations handled gracefully

### Error Handling
1. **Validation Errors**: Caught early with clear messages
2. **Runtime Errors**: Graceful degradation and recovery
3. **Resource Errors**: Cleanup and retry with backoff
4. **Critical Errors**: Safe shutdown with state preservation

## Security Considerations

### Container Isolation
- Each session runs in isolated container
- Resource limits prevent DoS
- Network policies control access
- Filesystem boundaries enforced

### Input Validation
- All commands validated against schema
- SQL injection and XSS prevention
- Path traversal protection
- Resource exhaustion protection

### Rate Limiting
- Per-session command rate limits
- LRU eviction prevents memory growth
- Configurable limits based on deployment
- Monitoring and alerting on limit hits

## Next Steps

- **Deep Dive**: Read [Protocol Design](./protocol.md) for message format details
- **Operations**: See [Deployment](../operations/deployment.md) for running in production
- **Development**: Check [Getting Started](../development/getting-started.md) for contribution setup