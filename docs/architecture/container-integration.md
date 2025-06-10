# Container Integration Architecture

## Overview

Trails uses containerized environments to provide isolated workspaces for AI coding agents. Each session runs in its own container, preventing conflicts between multiple agents and ensuring clean, reproducible environments.

## Evolution of the Architecture

### Initial Approach: container-use CLI

We initially attempted to integrate with [container-use](https://github.com/dagger/container-use), a tool by Dagger that provides containerized environments for AI agents via the Model Context Protocol (MCP). However, we discovered that:

1. **container-use is an MCP server**, not a CLI tool for managing containers
2. It's designed to be used **by** AI agents (like Claude) directly, not to manage containers **for** them
3. The architecture mismatch meant we were trying to use it in a way it wasn't designed for

### Current Approach: Direct Dagger SDK Integration

After investigation, we found that container-use itself uses the [Dagger SDK](https://dagger.io) under the hood. We now integrate directly with Dagger, which provides:

- **Programmatic container management** via Go SDK
- **Cross-platform support** (works with Docker, Podman, etc.)
- **Built-in caching and optimization**
- **Type-safe API** instead of CLI parsing

## Architecture Components

### 1. Provider Interface

```go
type Provider interface {
    CreateEnvironment(ctx context.Context, req CreateEnvironmentRequest) (*Environment, error)
    DestroyEnvironment(ctx context.Context, envID string) error
    GetEnvironment(ctx context.Context, envID string) (*Environment, error)
    SpawnAgent(ctx context.Context, envID, agentType string) error
}
```

This interface allows us to support multiple container backends:

- **DaggerClient** (default) - Production use with real containers
- **MockProvider** - Development and testing
- **Client** (legacy) - Original container-use CLI integration

### 2. DaggerClient Implementation

The DaggerClient:

1. **Connects to Dagger** - Requires Docker or compatible runtime
2. **Creates containers** with:
   - Agent-specific base images (Node for Claude, Python for Aider, etc.)
   - Mounted source directories
   - Environment variables
   - Pre-installed tools (git, tmux, vim, etc.)
3. **Manages lifecycle** - Track containers by environment ID

### 3. Session Management

Each session represents one AI agent with:

- **Unique ID** (ULID format, lowercase for container naming)
- **Container environment** via Dagger
- **Status tracking** (ready, working, waiting, error, thinking)
- **Agent type** (claude, aider, codex, etc.)

### 4. Environment Provisioning

When creating a session:

1. Generate unique session ID
2. Create container with `trails-<session-id>` name
3. Select appropriate base image for agent type
4. Mount repository as `/workspace`
5. Install basic development tools
6. Set environment variables for agent integration

## Configuration

### Provider Selection

Set via environment variable:
```bash
TRAILS_PROVIDER=dagger    # Default, uses Dagger SDK
TRAILS_PROVIDER=mock      # Development mode
TRAILS_PROVIDER=container-use  # Legacy mode
```

Or use the `--dev` flag for mock mode:
```bash
trails --dev
```

### Debugging

Enable Dagger debug logs:
```bash
DAGGER_LOG=1 trails
```

## Dependencies

### Required
- **Docker** (or compatible container runtime)
- Running Docker daemon

### Not Required
- container-use CLI
- Dagger CLI

The Dagger SDK is embedded in the trails binary.

## Security Considerations

### Input Validation
All user inputs are validated to prevent:
- Command injection
- Path traversal
- Invalid container names

### Audit Logging
All container operations are logged:
- Session creation/destruction
- Agent spawning
- Command execution

### Container Isolation
Each session runs in an isolated container:
- No network access between sessions
- Filesystem isolation
- Resource limits (planned)

## Future Enhancements

### Planned Features
1. **Container resource limits** (CPU, memory)
2. **Persistent volumes** for agent state
3. **Network policies** for agent communication
4. **Custom base images** per project
5. **Container health checks**

### MCP Integration
Future versions might integrate with container-use as an MCP server, allowing:
- Agents to manage their own sub-environments
- Direct MCP tool access from within containers
- Better integration with Claude Code and similar tools

## Development Workflow

### Adding a New Agent Type

1. Add to `ValidAgentTypes` in `manager.go`
2. Add base image selection in `dagger_client.go`
3. Add agent command mapping in `SpawnAgent()`

### Testing Container Integration

Use mock provider for unit tests:
```go
mockProvider := &MockProvider{}
manager := NewManagerWithProvider(repoPath, mockProvider, nil)
```

Use real Dagger for integration tests (requires Docker):
```go
provider, cleanup, err := NewProvider(ProviderTypeDagger, nil)
defer cleanup()
```

## Troubleshooting

### Common Issues

1. **"failed to connect to Dagger"**
   - Ensure Docker is installed and running
   - Check Docker permissions
   - Try `docker run hello-world` to verify

2. **"invalid name: name contains characters that are not allowed"**
   - Container names must be lowercase alphanumeric with hyphens
   - Session IDs are automatically lowercased

3. **Development without Docker**
   - Use `--dev` flag for mock provider
   - Set `TRAILS_PROVIDER=mock`

### Debug Commands

```bash
# Check dependencies
trails install-deps

# Run with debug logging
DAGGER_LOG=1 trails

# Use mock provider
trails --dev
```

## References

- [Dagger Documentation](https://docs.dagger.io)
- [Dagger Go SDK](https://docs.dagger.io/sdk/go)
- [container-use Source](https://github.com/dagger/container-use)
- [Model Context Protocol](https://modelcontextprotocol.io)