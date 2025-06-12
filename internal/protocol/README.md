# Trails Protocol Package

This package defines the message-based protocol for communication between the UI and Core engine in Trails.

## Overview

The protocol package implements a command/event pattern where:
- **Commands** flow from UI → Core (user actions)
- **Events** flow from Core → UI (state updates)

## Core Types

### Commands
Commands represent user actions or requests:
- `CreateSession` - Create a new agent session
- `DeleteSession` - Remove a session
- `StartAgent` - Start an agent in a session
- `SetFocus` - Change the focused session
- `ToggleMinimal` - Toggle minimal UI mode
- And more...

### Events
Events represent state changes or notifications:
- `SessionCreated` - A new session was created
- `StatusChanged` - A session's status changed
- `EnvironmentReady` - Container environment is ready
- `Error` - An error occurred
- And more...

## Usage

### Creating Commands

Use the builder pattern for type-safe command construction:

```go
// Using builders
cmd, err := protocol.CreateSession("my-session", "claude").Build()
if err != nil {
    // Handle validation error
}

// Or create directly
cmd := protocol.NewCommand(protocol.CmdCreateSession, protocol.CreateSessionCommand{
    Name:  "my-session",
    Agent: "claude",
})
```

### Creating Events

```go
event := protocol.NewEvent(protocol.EventSessionCreated, protocol.SessionCreatedEvent{
    Session: sessionInfo,
})

// For events in response to commands
event := protocol.NewEventForCommand(protocol.EventSessionCreated, cmd.ID, payload)
```

### Validation

All commands are validated before processing:

```go
if err := protocol.ValidateCommand(cmd); err != nil {
    // Handle validation error
}
```

## Security

The package includes security features:
- Command authentication with `SecureCommand`
- Rate limiting per session
- HMAC signature verification

## Testing

The package includes comprehensive unit tests. Run with:

```bash
go test ./internal/protocol/...
```