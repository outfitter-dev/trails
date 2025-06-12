# Trails v0.1.0 Implementation Roadmap

## Overview

Version 0.1.0 implements the protocol-based architecture, separating the TUI from the core business logic.

## Implementation Phases

### Phase 0: Security Foundation (Current)
- [ ] Create `internal/protocol` package with command/event types
- [ ] Implement basic authentication and validation
- [ ] Set up structured logging
- [ ] Create protocol documentation

### Phase 1: Core Protocol Layer
- [ ] Define all command types (create, delete, start, stop sessions)
- [ ] Define all event types (created, updated, status changes)
- [ ] Implement command validation
- [ ] Create protocol serialization helpers

### Phase 2: Core Engine
- [ ] Extract session management from UI
- [ ] Create engine with command processor
- [ ] Implement event publisher
- [ ] Add state management with event sourcing

### Phase 3: BubbleTea UI
- [ ] Create basic BubbleTea model
- [ ] Implement protocol channel communication
- [ ] Port existing UI features
- [ ] Add improved status indicators

### Phase 4: Integration & Testing
- [ ] Wire everything together in main.go
- [ ] Create comprehensive test suite
- [ ] Add integration tests
- [ ] Performance benchmarks

## Success Criteria

- UI and core communicate only through protocol messages
- All existing features work through new architecture
- Tests pass with >80% coverage
- Performance meets or exceeds current implementation

## Next Steps

1. Start with creating the protocol package
2. Define core message types
3. Begin extracting business logic from UI

See `docs/architecture/` for detailed design documents.