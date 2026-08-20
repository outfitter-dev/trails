# Claude Native Subagents

Use Claude Code's native `Agent` tool and the project profiles under `.claude/agents/`. Do not shell out to `claude` to simulate delegation.

## Available Team Profiles

- `clark` preloads `be-clark` and Clark's focused doctrine skills.
- `lewis` preloads `be-lewis` and loads task-specific execution skills at the point of need.

The profile selects the persona, model, effort, permissions, memory, and preloaded skills. The consultation brief supplies only the current task, anchors, authority, and return contract.

## Dispatch

1. Confirm that the desired profile is available in the current session. Claude hot-reloads agent-file changes; restart only when the session predates the first agents directory or was started with agent discovery disabled.
2. Invoke `clark`, `lewis`, or both through the native `Agent` tool.
3. Use a self-contained brief because a normal subagent starts with a fresh context and does not inherit the parent conversation or already-invoked skills.
4. Run independent consultations concurrently when their inputs do not depend on each other. Otherwise wait for the first result and include its relevant evidence in the second brief.
5. Keep foreground work when immediate user interaction matters. Current Claude Code surfaces background permission prompts in the main session; older versions may deny them, so verify the active runtime before relying on that handoff.
6. Wait for the required results and synthesize them in the parent conversation.

The coordinating agent decides whether file and source-control writes are read-only or delegated. When delegating them, name the exact worktree, branch or stack, scope, and permitted operations. Keep a pure consultation read-only because it does not need writes; do not infer a blanket prohibition from the agent profile.

Claude supports nested subagents while the `Agent` tool remains available within the configured nesting limit. If nested dispatch is unavailable in the active session, return a grounded consultation brief to the parent instead of inventing a result.

Follow the current tool signature and session policy when they differ from this reference. Claude's maintained behavior is documented in [Create custom subagents](https://code.claude.com/docs/en/sub-agents).
