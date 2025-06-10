# 1. Hardcoded Agent Command Allowlist

- **Status**: Accepted
- **Date**: 2023-10-27
- **Author**: Max

## Context and Problem Statement

The `trails` application executes third-party coding agents within a containerized environment managed by `container-use`. A mechanism is required to determine which agent executables are permitted to run. The core problem is how to grant this permission in a way that is maximally secure and prevents arbitrary command execution, while still allowing for the addition of new, vetted agents. Two primary options were considered: a configurable allowlist (e.g., in a JSON or YAML file) or a hardcoded allowlist embedded directly in the source code.

## Decision Drivers

- **Security as a Primary Principle**: The highest priority is to prevent any possibility of an attacker executing an unauthorized command within the agent's environment.
- **Principle of Least Privilege**: The system should only grant the exact permissions necessary for its function.
- **Clarity and Auditability**: The process for adding a new agent must be explicit, auditable, and subject to review.
- **Secure by Default**: The default configuration of the system must be the most secure configuration.

## Considered Options

1.  **Configurable Allowlist**: A list of commands stored in a user-configurable file (e.g., `settings.json`).
2.  **Hardcoded Allowlist**: A `map[string]bool` of permitted commands compiled directly into the `trails` binary.
3.  **Configurable Denylist**: A list of known-bad commands to block, allowing all others.
4.  **Hardcoded Denylist**: A hardcoded list of known-bad commands.

## Decision Outcome

**Chosen Option:** **Hardcoded Allowlist**.

We have chosen to implement a non-configurable, hardcoded allowlist within the `internal/containeruse/client.go` source file.

```go
// internal/containeruse/client.go
var safeCommands = map[string]bool{
	"claude-code": true,
	"aider":       true,
	"codex":       true,
    "amp":         true,
    "jules":       true,
    "opencode":    true,
}
```

### Rationale

1.  **Superior Security Posture**: This approach is fundamentally more secure. A configurable list presents an attack vector: if the configuration file is ever compromised or misconfigured, an attacker could add a malicious executable (e.g., `/bin/bash`) to the list. By hardcoding the list, the set of permissible commands is immutable at runtime, effectively eliminating this entire class of vulnerability.
2.  **Rejection of Denylists**: Options 3 and 4 were rejected outright as they are a known security anti-pattern. A denylist requires perfect knowledge of all possible malicious commands, which is impossible to maintain. An attacker only needs to find one vector that was not anticipated. The allowlist approach ("Default-Deny") is the only correct choice.
3.  **Intentional Friction as a Security Feature**: Requiring a developer to modify the source code to add a new agent is a deliberate design choice. This ensures that adding a new executable is not a trivial operation. It must go through the standard software development lifecycle: a code change, a pull request, a code review, and a new release. This process provides a critical, human-in-the-loop security gate.
4.  **Minimizes Attack Surface**: The surface area for this critical operation is reduced to the smallest possible set: the specific, vetted commands we have explicitly chosen to support.

## Consequences

- **Positive**:
    - Significantly enhanced security against arbitrary command execution.
    - Clear, auditable path for adding new agents via source control history.
    - Adherence to the "Secure by Default" principle.
- **Negative**:
  - Reduced flexibility for end-users who may want to experiment with unsupported agents. This is a conscious trade-off. The security benefits far outweigh the inconvenience. The correct path for adding a new agent is to contribute to the `trails` project itself. 