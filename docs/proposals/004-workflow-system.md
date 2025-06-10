# Workflow System Proposal

## Overview

Introduce a workflow system to Agentish that enables users to define, share, and execute multi-agent workflows with minimal interaction. Workflows are reusable, parameterized sequences of agent operations that can be triggered easily.

## Core Concept

A **workflow** is a reusable, parameterized sequence of agent operations that can be triggered with minimal interaction.

## Workflow Definition Structure

```yaml
# .trails/workflows/debug-production.yaml
name: "Production Debugging"
description: "Analyze logs, search code, suggest fixes"
version: "1.0.0"
tags: ["debugging", "production", "analysis"]

parameters:
  - name: error_message
    type: string
    required: true
    prompt: "What error are you investigating?"
  - name: service_name
    type: string
    required: false
    default: "main"

steps:
  - id: analyze_logs
    agent: claude
    session_name: "debug-logs-${timestamp}"
    prompt: |
      Analyze production logs for error: "${error_message}"
      Service: ${service_name}
      Look for patterns, frequency, and context
    outputs:
      - name: error_analysis
        type: artifact
      - name: affected_files
        type: file_list

  - id: search_codebase
    agent: aider
    session_name: "debug-search-${timestamp}"
    depends_on: analyze_logs
    prompt: |
      Search codebase for files: ${analyze_logs.affected_files}
      Find code related to: ${error_message}
      Context: ${analyze_logs.error_analysis}
    outputs:
      - name: relevant_code
        type: artifact

  - id: suggest_fixes
    agent: codex
    session_name: "debug-fixes-${timestamp}"
    depends_on: [analyze_logs, search_codebase]
    prompt: |
      Based on:
      - Error analysis: ${analyze_logs.error_analysis}
      - Code found: ${search_codebase.relevant_code}
      
      Suggest fixes for: ${error_message}
    outputs:
      - name: fix_suggestions
        type: artifact
      - name: pr_ready_code
        type: code

  - id: review_fixes
    agent: claude
    session_name: "debug-review-${timestamp}"
    depends_on: suggest_fixes
    prompt: |
      Review suggested fixes: ${suggest_fixes.fix_suggestions}
      Check for side effects and suggest tests
    parallel: false
    wait_for_human: true
```

## Workflow Commands

```bash
# List available workflows
trails workflow list

# Run a workflow
trails workflow run debug-production

# Run with parameters
trails workflow run debug-production --error="null pointer" --service="auth"

# Create workflow from current sessions
trails workflow create-from-sessions "My Custom Flow"

# Import community workflows
trails workflow import https://github.com/trails/workflows/tdd-cycle
```

## TUI Integration

```
┌─ Agentish ──────────────────────────────────┐
│ Sessions | Workflows | Settings              │
├─────────────────────────────────────────────┤
│ Available Workflows:                         │
│                                             │
│ 1. [P] Production Debugging      (ctrl+1)   │
│    └─ 4 steps, 3 agents                    │
│                                             │
│ 2. [T] TDD Cycle                (ctrl+2)   │
│    └─ 3 steps, 2 agents                    │
│                                             │
│ 3. [R] Refactor Module          (ctrl+3)   │
│    └─ 5 steps, 3 agents                    │
│                                             │
│ 4. [C] Code Review Pipeline     (ctrl+4)   │
│    └─ 4 steps, 4 agents                    │
│                                             │
│ [n] New workflow  [i] Import  [e] Edit      │
└─────────────────────────────────────────────┘
```

## Workflow Features

### Step Types
- **Sequential**: Steps run one after another
- **Parallel**: Multiple agents work simultaneously
- **Conditional**: Steps run based on conditions
- **Loop**: Repeat steps until condition met
- **Human-in-loop**: Pause for human review/input

### Data Flow
- **Artifacts**: Pass structured data between steps
- **Files**: Share files via shared workspace
- **Variables**: Workflow-wide variables
- **Outputs**: Capture agent outputs for next steps

### Control Flow

```yaml
steps:
  - id: check_tests
    agent: aider
    prompt: "Run tests and check coverage"
    
  - id: improve_tests
    agent: claude
    when: "${check_tests.coverage} < 80"
    prompt: "Add tests to reach 80% coverage"
    
  - id: parallel_review
    parallel:
      - agent: codex
        prompt: "Review for performance"
      - agent: jules
        prompt: "Review for security"
```

## Workflow Sharing & Distribution

### Built-in Workflows

```go
// internal/workflows/builtin.go
var BuiltinWorkflows = map[string]*Workflow{
    "quick-fix": {
        Name: "Quick Fix",
        Description: "Rapid bug fixing with test verification",
        // Embedded workflow definition
    },
    "tdd-cycle": {
        Name: "TDD Cycle", 
        Description: "Test-driven development flow",
    },
    "code-review": {
        Name: "Code Review Pipeline",
        Description: "Multi-agent comprehensive code review",
    },
    // More built-ins...
}
```

### Import Mechanisms

#### NPM Package Distribution

```bash
# Install workflow packages from npm
trails workflow install @trails/workflows-core
trails workflow install @maybe-good/ai-workflows
trails workflow install acme-corp/internal-workflows

# Package structure
node_modules/
  @trails/workflows-core/
    workflows/
      tdd-cycle.yaml
      code-review.yaml
      security-audit.yaml
    package.json
    README.md
```

**package.json for workflow packages:**
```json
{
  "name": "@trails/workflows-core",
  "version": "1.0.0",
  "description": "Core workflows for Agentish",
  "trails": {
    "type": "workflow-pack",
    "workflows": [
      "workflows/tdd-cycle.yaml",
      "workflows/code-review.yaml"
    ]
  }
}
```

#### GitHub Direct Import

```bash
# Import single workflow from GitHub
trails workflow import github:trails/workflows/debugging/production-debug.yaml

# Import entire workflow collection
trails workflow import github:maybe-good/awesome-workflows

# Import from gist
trails workflow import gist:1234567890abcdef

# Import with specific version/tag
trails workflow import github:trails/workflows/tdd-cycle.yaml@v2.0.0
```

#### URL Import

```bash
# Any HTTPS URL
trails workflow import https://example.com/workflows/custom-flow.yaml

# With validation
trails workflow import https://workflows.trails.dev/verified/quick-fix.yaml
```

### Workflow Registry

```yaml
# ~/.config/trails/registries.yaml
registries:
  official:
    name: "Official Agentish Workflows"
    url: "https://registry.trails.dev"
    trusted: true
    
  community:
    name: "Community Workflows"  
    url: "https://community.trails.dev"
    trusted: false
    
  corporate:
    name: "ACME Corp Workflows"
    url: "https://git.acme.corp/workflows"
    auth: "${ACME_TOKEN}"
```

### CLI Commands

```bash
# Browse available workflows
trails workflow search "debugging"
trails workflow search --tag "testing"

# Show workflow details before installing
trails workflow info @trails/workflows-core/tdd-cycle

# List installed workflows
trails workflow list
trails workflow list --builtin
trails workflow list --installed

# Update workflows
trails workflow update
trails workflow update @trails/workflows-core

# Remove workflows
trails workflow remove custom-workflow
```

## Built-in Workflow Library

### Quick Fix

```yaml
name: "quick-fix"
description: "Find and fix a bug quickly"
builtin: true

steps:
  - name: "Understand the bug"
    agent: claude
    prompt: "Analyze this bug: ${bug_description}"
    
  - name: "Find the code"
    agent: aider
    prompt: "Locate code causing: ${step[0].analysis}"
    
  - name: "Fix and test"
    agent: codex
    prompt: "Fix the bug and write a test"
```

### Feature Development

```yaml
name: "feature-dev"
description: "Develop a complete feature with tests"
builtin: true

parameters:
  - name: feature_spec
    required: true
    
steps:
  - name: "Design API"
    agent: claude
    
  - name: "Write tests"
    agent: aider
    parallel: true
    
  - name: "Implement"
    agent: codex
    
  - name: "Document"
    agent: jules
```

### Refactor Module

```yaml
name: "refactor"
description: "Safely refactor with tests"
builtin: true

steps:
  - name: "Analyze current code"
    agent: claude
    
  - name: "Write characterization tests"
    agent: aider
    
  - name: "Refactor"
    agent: codex
    
  - name: "Verify tests pass"
    agent: amp
```

## Workflow Marketplace UI

```
┌─ Workflow Marketplace ──────────────────────┐
│ Search: [debugging_____________] [Search]    │
├─────────────────────────────────────────────┤
│ Featured Workflows                          │
│                                             │
│ ⭐ Production Debugger          [@trails] │
│    1.2k installs • 4.8★ • Updated 2d ago   │
│    Multi-agent debugging for production     │
│    [Install]                                │
│                                             │
│ ⭐ TDD Cycle Deluxe            [@community]│
│    890 installs • 4.7★ • Updated 1w ago    │
│    Complete TDD flow with coverage          │
│    [Install]                                │
│                                             │
│ 🏢 ACME Security Audit         [@acme-corp]│
│    45 installs • Internal • Updated 3d ago  │
│    Corporate security scanning workflow      │
│    [Install] (requires auth)                │
│                                             │
│ Categories: All | Testing | Debugging | ... │
└─────────────────────────────────────────────┘
```

## Sharing Your Workflows

### Package and Publish

```bash
# Initialize workflow package
trails workflow init my-workflows

# Creates:
my-workflows/
  workflows/
    my-custom-flow.yaml
  package.json
  README.md

# Publish to npm
cd my-workflows
npm publish

# Now others can:
trails workflow install @myusername/my-workflows
```

### Quick Share

```bash
# Export current workflow
trails workflow export debug-session > my-debug.yaml

# Share via gist
trails workflow share my-debug.yaml
# Output: Shared at: gist.github.com/abc123

# Others import with:
trails workflow import gist:abc123
```

## Version Management

```bash
# Pin workflow versions
trails workflow pin tdd-cycle@1.2.0

# Show changelog
trails workflow changelog @trails/workflows-core

# Rollback
trails workflow rollback tdd-cycle
```

## Security & Trust

```yaml
# Workflow validation
validation:
  # Workflows are sandboxed
  sandbox: true
  
  # Allowed agents only
  allowed_agents: [claude, aider, codex, amp, jules, opencode]
  
  # No arbitrary commands
  allow_shell_commands: false
  
  # Signed workflows
  require_signature: true  # For trusted registries
```

## Workflow Execution UI

```
┌─ Running: Production Debugging ─────────────┐
│                                             │
│ ▶ Step 1/4: Analyzing logs      [RUNNING]   │
│   Agent: Claude                             │
│   Session: debug-logs-20240607-143022       │
│   ██████████░░░░░░░░░░ 45%                   │
│                                             │
│ ○ Step 2/4: Search codebase     [PENDING]   │
│   Agent: Aider                              │
│                                             │
│ ○ Step 3/4: Suggest fixes       [PENDING]   │
│   Agent: Codex                              │
│                                             │
│ ○ Step 4/4: Review fixes        [PENDING]   │
│   Agent: Claude                             │
│                                             │
│ [p] Pause  [s] Skip Step  [c] Cancel        │
└─────────────────────────────────────────────┘
```

## Example Workflows

### TDD Cycle
1. Write failing test (Aider)
2. Implement code (Claude)
3. Refactor (Codex)
4. Review coverage (Amp)

### Feature Development
1. Design API (Claude)
2. Implement backend (Codex)
3. Create frontend (Claude)
4. Write tests (Aider)
5. Documentation (Jules)

### Dependency Update
1. Check for updates (Amp)
2. Update deps (Aider)
3. Run tests (Codex)
4. Fix breaks (Claude)
5. Update docs (Jules)

### Security Audit
1. Scan for vulnerabilities (Amp)
2. Analyze findings (Claude)
3. Implement fixes (Codex)
4. Verify fixes (Aider)

## Benefits

1. **Repeatability**: Complex multi-agent flows become one-click
2. **Standardization**: Team shares common workflows
3. **Learning**: Capture best practices in workflows
4. **Efficiency**: No manual orchestration needed
5. **Composability**: Build complex workflows from simple ones

This would transform Agentish from a session manager into a **workflow orchestration platform** for AI agents, creating a whole ecosystem around workflow sharing and execution.