# Codex Native Trails Crew Subagents

Use Codex's native collaboration/subagent tools and the project custom-agent files under `.codex/agents/`. Do not shell out to `codex` to simulate delegation.

## Available Team Profiles

- `clark` is the custom agent configured by `.codex/agents/clark.toml` and loads `be-clark`.
- `lewis` is the custom agent configured by `.codex/agents/lewis.toml` and loads `be-lewis`.

These TOML files are Codex configuration layers for spawned sessions. They select the named role, model, reasoning effort, sandbox defaults, and persona-skill bootstrap. They are not separate persona contracts.

## Dispatch

1. Inspect the native tool's currently available agent types and exact schema rather than assuming a profile is loaded. Custom-agent discovery is session-scoped in current Codex hosts; when a newly added profile is absent from the tool schema, start or reload a Codex session before treating the file as invalid.
2. Spawn the selected custom role through the native subagent tool. In the current Codex collaboration surface, select it with `agent_type: "clark"` or `agent_type: "lewis"` only when that type is actually available.
3. Do not use a full-history fork when selecting a custom role if the current tool requires full-history forks to inherit the parent agent type. Use the smallest useful positive context fork or no fork, then provide a self-contained brief.
4. Run independent consultations concurrently when their inputs do not depend on each other. For sequential consultation, wait for the first result and send only the relevant ruling and evidence into the second brief.
5. Use the native wait, follow-up, message, interrupt, and status tools for lifecycle control. Do not infer that an unavailable or not-yet-loaded agent is stopped.
6. Wait for every required result and synthesize them in the parent conversation.

Subagents inherit or remain bounded by the active runtime's permission policy, the user's authority, the repository rules, and the coordinating agent's brief. The coordinating agent decides whether Git and Graphite are read-only or delegated and, when delegated, names the exact worktree, branch or stack, scope, and permitted operations. Keep a pure consultation read-only because it does not need source-control writes; do not infer a blanket prohibition from the agent type.

If the requested custom role is unavailable, report that fact and return the prepared brief. Do not substitute a generic agent while labeling the result Clark or Lewis.

Follow the current native tool schema when it differs from this reference. Codex's maintained custom-agent and orchestration behavior is documented in [Subagents](https://learn.chatgpt.com/docs/agent-configuration/subagents).
