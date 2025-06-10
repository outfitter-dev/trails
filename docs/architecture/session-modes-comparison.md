# Session Modes Comparison

## Quick Reference

| Feature | Basic (tmux) | Worktree (git) | Container (Dagger) |
|---------|--------------|----------------|--------------------|
| **Setup Time** | Instant | ~1 second | ~5-30 seconds |
| **Dependencies** | tmux only | tmux + git | Docker + Dagger |
| **Filesystem Isolation** | ❌ No | ✅ Yes | ✅ Yes |
| **Process Isolation** | ⚠️ Partial | ⚠️ Partial | ✅ Full |
| **Network Isolation** | ❌ No | ❌ No | ✅ Yes |
| **Custom Dependencies** | ❌ No | ❌ No | ✅ Yes |
| **Resource Limits** | ❌ No | ❌ No | ✅ Yes |
| **Change Tracking** | ❌ Manual | ✅ Git | ✅ Git + Container |
| **Multi-agent Conflicts** | ⚠️ Likely | ✅ Prevented | ✅ Prevented |
| **Debugging** | ✅ Easy | ✅ Easy | ⚠️ Moderate |

## Detailed Comparison

### Basic Mode (tmux)

**Use When:**
- Running trusted agents
- Making quick edits
- System dependencies are already installed
- Performance is critical
- Debugging agent behavior

**Don't Use When:**
- Running untrusted code
- Agents need different dependency versions
- Multiple agents on same files
- Security is important

**Example Scenario:**
```bash
# Quick typo fix with aider
trails --mode=basic create-session typo-fix aider
# Aider runs immediately, fixes typo, done in 30 seconds
```

### Worktree Mode (git worktrees)

**Use When:**
- Multiple agents on same project
- Want git-tracked changes
- Need filesystem isolation
- Working on features/branches

**Don't Use When:**
- Not in a git repository
- Need different system dependencies
- Agents need network isolation
- Working with binary files

**Example Scenario:**
```bash
# Two agents working on different features
trails --mode=worktree create-session ui-update claude
trails --mode=worktree create-session api-update aider
# Each works in isolated worktree, changes don't conflict
```

### Container Mode (Dagger)

**Use When:**
- Running untrusted agents
- Need specific dependencies
- Want full isolation
- Building/testing code
- Security is paramount

**Don't Use When:**
- Docker not available
- Need instant startup
- Simple text edits
- Debugging host issues

**Example Scenario:**
```bash
# Complex build with specific toolchain
trails --mode=container create-session rust-port codex
# Container includes Rust toolchain, isolated from system
```

## Decision Matrix

### By Agent Trust Level

| Agent Trust | Recommended Mode | Reasoning |
|-------------|------------------|-----------|
| Fully Trusted | Basic | Maximum performance, easy debugging |
| Known/Verified | Worktree | Balance of isolation and performance |
| Unknown/New | Container | Maximum security and isolation |

### By Task Type

| Task Type | Recommended Mode | Reasoning |
|-----------|------------------|-----------|
| Quick Fix | Basic | Instant startup, minimal overhead |
| Feature Dev | Worktree | Branch isolation, git integration |
| Build/Test | Container | Reproducible environment |
| Security Audit | Container | Full isolation required |

### By Environment

| Environment | Recommended Mode | Fallback |
|-------------|------------------|----------|
| Local Dev | Container | Worktree → Basic |
| CI/CD | Container | Worktree |
| Cloud IDE | Worktree | Basic |
| Restricted | Basic | None |

## Performance Characteristics

### Startup Time
- **Basic**: < 100ms
- **Worktree**: ~1s (git operations)
- **Container**: 5-30s (image pull/build)

### Memory Usage
- **Basic**: ~10MB per session
- **Worktree**: ~10MB + worktree size
- **Container**: ~100MB-1GB per container

### Disk Usage
- **Basic**: None (shared)
- **Worktree**: Repository size per session
- **Container**: Image size + layers

## Implementation Priority

### Phase 1: MVP
1. Basic mode for immediate value
2. Mode selection framework
3. Provider interface updates

### Phase 2: Enhanced Isolation  
1. Worktree mode implementation
2. Git integration features
3. Branch management UI

### Phase 3: Polish
1. Auto-detection logic
2. Mode upgrade/downgrade
3. Hybrid mode support

## Migration Scenarios

### Upgrading Modes

**Basic → Worktree:**
```bash
# Agent realizes it needs isolation
trails upgrade-session session-id --to=worktree
# Creates worktree from current state
```

**Worktree → Container:**
```bash
# Need specific dependencies
trails upgrade-session session-id --to=container
# Builds container with worktree mounted
```

### Downgrading Modes

**Container → Worktree:**
```bash
# Extract changes from container
trails export-session session-id --to=worktree
# Creates worktree with container changes
```

## Configuration Examples

### Global Default
```json
{
  "default_mode": "worktree",
  "mode_fallback_chain": ["container", "worktree", "basic"]
}
```

### Per-Agent Preferences
```json
{
  "agent_modes": {
    "claude": "container",
    "aider": "worktree", 
    "codex": "basic"
  }
}
```

### Per-Project Rules
```json
{
  "project_rules": [
    {
      "pattern": "*.rs",
      "required_mode": "container",
      "reason": "Rust toolchain required"
    },
    {
      "pattern": "docs/*",
      "allowed_modes": ["basic", "worktree"],
      "reason": "No special deps needed"
    }
  ]
}
```