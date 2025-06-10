# Proposal: Tiered Session Modes

## Summary

Implement three tiers of session isolation modes in trails, allowing users to choose the appropriate level of isolation and complexity for their use case:

1. **Basic Mode**: tmux sessions (process isolation)
2. **Worktree Mode**: git worktrees (filesystem isolation)
3. **Container Mode**: Dagger containers (full isolation)

## Motivation

The current Dagger-only approach has several limitations:

- **High barrier to entry** - Requires Docker installation and running daemon
- **Overhead** - Container startup time and resource usage
- **Overkill for simple tasks** - Many users just need basic session management
- **Platform limitations** - Some environments can't run containers

A tiered approach provides:
- **Progressive complexity** - Start simple, add isolation as needed
- **Better performance** - Lightweight options for quick tasks
- **Wider compatibility** - Works in more environments
- **User choice** - Right tool for the right job

## Detailed Design

### Mode 1: Basic (tmux)

**What it provides:**
- Process isolation via tmux sessions
- Separate terminal environment per agent
- Session persistence across trails restarts
- Basic environment variable isolation

**Implementation:**
```go
type TmuxProvider struct {
    sessions map[string]*TmuxSession
}

func (t *TmuxProvider) CreateEnvironment(ctx context.Context, req CreateEnvironmentRequest) (*Environment, error) {
    sessionName := fmt.Sprintf("trails-%s", req.Name)
    
    // Create tmux session
    cmd := exec.Command("tmux", "new-session", "-d", "-s", sessionName, "-c", req.Source)
    
    // Set environment variables
    for key, value := range req.Environment {
        tmuxCmd("set-environment", "-t", sessionName, key, value)
    }
    
    return &Environment{
        ID:     sessionName,
        Name:   req.Name,
        Source: req.Source,
        Status: "ready",
    }, nil
}
```

**Pros:**
- Zero additional dependencies (tmux is ubiquitous)
- Instant startup
- Minimal resource usage
- Easy to debug (just attach to tmux)

**Cons:**
- No filesystem isolation
- Shared system dependencies
- Environment pollution risk
- Limited security

### Mode 2: Worktree (git worktrees)

**What it provides:**
- Filesystem isolation via git worktrees
- Each agent gets its own working directory
- Branch-based workflow
- Changes tracked in git

**Implementation:**
```go
type WorktreeProvider struct {
    baseRepo  string
    worktrees map[string]string
}

func (w *WorktreeProvider) CreateEnvironment(ctx context.Context, req CreateEnvironmentRequest) (*Environment, error) {
    branchName := fmt.Sprintf("trails/%s", req.Name)
    worktreePath := filepath.Join(w.baseRepo, ".git", "worktrees", req.Name)
    
    // Create new branch and worktree
    exec.Command("git", "branch", branchName).Run()
    exec.Command("git", "worktree", "add", worktreePath, branchName).Run()
    
    // Create tmux session in worktree
    cmd := exec.Command("tmux", "new-session", "-d", "-s", req.Name, "-c", worktreePath)
    
    return &Environment{
        ID:       req.Name,
        Name:     req.Name,
        Source:   worktreePath,
        Branch:   branchName,
        Status:   "ready",
    }, nil
}
```

**Pros:**
- Filesystem isolation without containers
- Git-native branching and merging
- Easy to review changes
- Lightweight and fast
- Works with existing git workflows

**Cons:**
- Still shares system dependencies
- No process/network isolation
- Requires git repository
- Can't isolate binary dependencies

### Mode 3: Container (Dagger)

**What it provides:**
- Full process, filesystem, and network isolation
- Custom environments per agent type
- Reproducible builds
- Maximum security

**Implementation:**
(Already implemented - see current DaggerClient)

**Pros:**
- Complete isolation
- Custom dependencies per agent
- Reproducible environments
- Maximum security
- Cross-platform consistency

**Cons:**
- Requires Docker
- Higher resource usage
- Slower startup
- More complex debugging

## Configuration

### User Selection

Command-line flags:
```bash
trails --mode=basic      # tmux only
trails --mode=worktree   # git worktrees + tmux
trails --mode=container  # full Dagger containers (default)
```

Environment variable:
```bash
TRAILS_MODE=basic trails
```

Config file (`.trails/settings.json`):
```json
{
  "session_mode": "worktree",
  "mode_preferences": {
    "claude": "container",
    "aider": "worktree",
    "codex": "basic"
  }
}
```

### Per-Session Override

Allow mode selection during session creation:
```go
type CreateSessionRequest struct {
    Name  string
    Agent string
    Mode  SessionMode // Optional, defaults to global setting
}
```

## Migration Path

### Phase 1: Implement Basic Mode
1. Create TmuxProvider
2. Add mode selection to CLI
3. Test with simple agents

### Phase 2: Implement Worktree Mode
1. Create WorktreeProvider
2. Add git worktree management
3. Handle branch merging/cleanup

### Phase 3: Integrate All Modes
1. Unified provider interface
2. Mode selection logic
3. Migration between modes

### Phase 4: Smart Defaults
1. Auto-detect available modes
2. Recommend mode based on:
   - Agent type
   - System capabilities
   - Task complexity

## Example Workflows

### Quick Script Edit (Basic Mode)
```bash
$ trails --mode=basic
> Create session "quick-fix" with aider
> [Aider runs in tmux, edits files directly]
> Changes complete, review and commit
```

### Feature Development (Worktree Mode)
```bash
$ trails --mode=worktree
> Create session "new-feature" with claude
> [Claude works in isolated worktree on feature branch]
> Review changes: git diff main...trails/new-feature
> Merge when ready: git merge trails/new-feature
```

### Complex Build (Container Mode)
```bash
$ trails --mode=container
> Create session "rust-port" with codex
> [Codex works in container with Rust toolchain]
> Container has all dependencies, fully isolated
> Export changes when complete
```

## Security Considerations

### Mode Security Levels

1. **Basic**: Least secure
   - Shared filesystem access
   - Can affect system state
   - Suitable for trusted agents only

2. **Worktree**: Moderate security
   - Filesystem isolation
   - Git tracks all changes
   - Can't affect other worktrees

3. **Container**: Most secure
   - Full isolation
   - Resource limits possible
   - Network policies applicable

### Recommendations

- Default to container mode for unknown agents
- Allow basic mode only for explicitly trusted agents
- Audit log all mode selections
- Warn when downgrading security level

## Future Enhancements

### Hybrid Modes
- tmux + containers (container with persistent tmux)
- Worktree + containers (container per worktree)

### Auto-escalation
- Start in basic mode
- Escalate to container if agent requests sudo
- Escalate if accessing sensitive paths

### Mode-specific Features
- **Basic**: tmux session recording/replay
- **Worktree**: Automatic PR creation
- **Container**: Resource monitoring

## Conclusion

This tiered approach provides flexibility while maintaining security options. Users can start simple and add complexity as needed, making trails accessible to more use cases while still providing enterprise-grade isolation when required.

The implementation can be incremental, starting with basic mode and adding complexity over time. This also provides a natural fallback chain: if Docker isn't available, fall back to worktree mode; if not in a git repo, fall back to basic mode.

## Future Enhancement: Agent Coordination

While not part of the initial tiered modes implementation, the mixed-mode architecture opens possibilities for agent coordination:

### Shared Communication Channel
A simple append-only log (`.trails/agent-comm.log`) where agents can:
- Announce what they're working on
- Request information from other agents
- Coordinate file access

### Trails MCP Server
Future versions could expose an MCP server that agents can connect to:
```text
Tools:
- agent_message: Send messages between agents
- claim_resource: Lock files/directories
- query_sessions: Get status of other sessions
- share_artifact: Pass data between agents
```

### Coordinator Agent
As described in the MVP architecture, a dedicated coordinator agent could:
- Manage task distribution
- Resolve conflicts between agents
- Provide project-level oversight
- Bridge between different session modes

This coordination layer would work across all three modes, turning trails from a session manager into a true multi-agent orchestration platform.

## Open Questions

### Implementation Details

1. **Nested Environments**
   - What happens when running trails inside Docker/WSL/SSH/another container?
   - Should we detect and disable container mode?
   - Allow Docker-in-Docker?
   - Auto-select appropriate mode based on environment?

2. **Repository State Handling**
   - How to handle dirty working directories when creating worktrees?
   - Block creation or stash changes automatically?
   - What about ongoing rebases or cherry-picks?

3. **Resource Protection**
   - Should direct/worktree modes have any protection against runaway agents?
   - CPU/memory limits without containers?
   - Disk usage monitoring?

4. **Agent Requirements**
   - Should agents declare their minimum required mode?
   - Can Claude require container mode for certain operations?
   - How do we handle mode incompatibility?

5. **CI/CD Integration**
   - How does mode selection work in automated environments?
   - No interactive tmux in CI - fallback behavior?
   - Should we have a "headless" mode?

### Design Decisions

6. **Mode Naming**
   - Settled on: "direct" (not basic), "worktree", "container"
   - Should we support aliases for user convenience?

7. **State Persistence**
   - Reuse existing state.json with new fields
   - Add: worktree_path, session_mode
   - Migration strategy for existing sessions?

8. **Upgrade/Downgrade Paths**
   - Live upgrades supported (direct→worktree→container)
   - Downgrade warnings about lost isolation
   - Should downgrades require explicit --force?

9. **Git Integration**
   - Require git repo (help initialize if missing)
   - Smart detection of when worktrees are needed
   - Merge workflow with conflict resolution

10. **Default Behavior**
    - Start with worktrees as default (changed from container)
    - Progressive enhancement based on detection
    - Configurable defaults per agent/project

### Future Considerations

11. **Performance Metrics**
    - Should we track mode performance/resource usage?
    - Help users choose the optimal mode?

12. **Security Policies**
    - Enterprise requirements for mode restrictions?
    - Audit logging for mode selection?

13. **Mode Combinations**
    - Hybrid modes (tmux in container)?
    - Mode-specific features to develop?

14. **User Education**
    - How to guide users to right mode?
    - Warning messages vs. automatic selection?