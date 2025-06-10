# ADR-003: Use Dagger SDK Instead of container-use CLI

## Status
Accepted

## Context

Agentish needs to provide isolated container environments for AI coding agents. Our initial approach was to integrate with [container-use](https://github.com/dagger/container-use), a tool by Dagger that appeared to provide exactly this functionality.

However, after implementation attempts, we discovered:

1. **container-use is an MCP server**, not a container management CLI
   - It runs as `cu stdio` and communicates via Model Context Protocol
   - Designed to be consumed BY agents (like Claude), not to manage containers FOR agents

2. **Architecture mismatch**
   - We needed programmatic container control
   - container-use provides MCP tools like `environment_open`, `environment_run_cmd`
   - These are meant to be called by AI agents, not by a management layer

3. **container-use uses Dagger internally**
   - Looking at the source, container-use is essentially an MCP wrapper around Dagger
   - It imports `dagger.io/dagger` and uses `dagger.Connect()`

## Decision

Use the Dagger SDK directly instead of trying to integrate with container-use.

## Consequences

### Positive

1. **Direct API access** - No subprocess management or output parsing
2. **Type safety** - Go SDK provides compile-time type checking
3. **Better error handling** - Exceptions and errors are first-class
4. **Single binary** - No external tools to install
5. **Performance** - No subprocess overhead
6. **Flexibility** - Full access to Dagger features

### Negative

1. **More code** - We implement container management ourselves
2. **Maintenance** - Direct responsibility for container lifecycle
3. **No MCP benefits** - Lose potential future MCP integrations

### Neutral

1. **Same dependencies** - Still requires Docker/container runtime
2. **Similar complexity** - Container concepts remain the same

## Implementation

### Provider Pattern

Created a provider interface to support multiple backends:

```go
type Provider interface {
    CreateEnvironment(ctx context.Context, req CreateEnvironmentRequest) (*Environment, error)
    DestroyEnvironment(ctx context.Context, envID string) error
    GetEnvironment(ctx context.Context, envID string) (*Environment, error)
    SpawnAgent(ctx context.Context, envID, agentType string) error
}
```

### DaggerClient

Direct implementation using Dagger SDK:

```go
dag, err := dagger.Connect(ctx)
container := dag.Container().
    From("ubuntu:latest").
    WithWorkdir("/workspace").
    WithMountedDirectory("/workspace", dag.Host().Directory(repoPath))
```

### Configuration

Environment variable for provider selection:
- `TRAILS_PROVIDER=dagger` (default)
- `TRAILS_PROVIDER=mock` (development)
- `TRAILS_PROVIDER=container-use` (legacy)

## Alternatives Considered

### 1. Fix container-use Integration
- Would require implementing an MCP client
- Complex architecture for simple container management
- container-use not designed for this use case

### 2. Docker SDK Directly
- Lower level than Dagger
- Would need to implement caching, building, etc.
- Platform-specific code for different runtimes

### 3. Podman/Buildah
- Similar to Docker SDK approach
- Less universal than Dagger
- Would limit platform support

### 4. Kubernetes Jobs
- Overly complex for local development
- Requires Kubernetes cluster
- Poor developer experience

## Future Considerations

### MCP Integration
Could add MCP server functionality to trails, allowing:
- Agents to discover available sessions
- Direct container control via MCP tools
- Better integration with AI tools ecosystem

### container-use as Optional Feature
Could support container-use for specific scenarios:
- When agents need to create sub-environments
- For compatibility with container-use workflows
- As an advanced feature for power users

## References

- [Dagger Documentation](https://docs.dagger.io)
- [container-use Source](https://github.com/dagger/container-use)
- [MCP Specification](https://modelcontextprotocol.io)
- [Original container-use investigation](#2)