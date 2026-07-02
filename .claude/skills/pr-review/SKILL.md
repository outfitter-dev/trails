---
name: pr-review
description: "Run a Trails PR review follow-through loop: inspect CI and remote reviewer feedback, fix P2+ findings, reply and resolve threads, wait for fresh feedback, then merge only when clean."
metadata:
  version: 0.1.0
  author: trails
  category: review
---

# PR Review

Use this skill when a Trails PR or stack has been submitted and needs review follow-through before merge. It is for the post-submit loop: remote CI, Cursor Bugbot, Codex, Copilot, Greptile, Graphite checks, human comments, fix pushes, thread replies, and merge readiness.

This skill does not replace local review. Run local review before submit when the work is non-trivial. Use this skill after the PR exists, and again after every review-response push.

## Core Rule

Every unresolved remote review thread is a blocker until it is fixed, explicitly acknowledged with evidence, or deliberately deferred with a linked issue and rationale. Do not merge a PR because checks are green while actionable review threads are still open.

## Inputs

The target can be:

- one PR;
- a Graphite stack;
- a branch with associated PRs;
- a goal loop that has reached remote review.

If the target is a stack, process it from the owning branch of each finding. Fix lower-branch findings on the lower branch, restack upward, and re-submit the stack.

## Workflow

### 1. Establish PR State

Record:

- PR numbers and URLs;
- branch names and current commits;
- draft/ready state;
- CI/check state;
- Graphite mergeability/queue state;
- unresolved review threads.

Use GitHub/Graphite truth, not only local memory.

Useful commands:

```bash
gh pr view <number> --json number,title,url,state,isDraft,headRefName,headRefOid,mergeStateStatus
gh pr checks <number> --watch=false
```

For review threads, use a source that exposes thread resolution state, not only top-level comments.

### 2. Classify Feedback

Treat remote reviewers as real reviewers:

- **P0/P1:** fix before continuing.
- **P2:** fix unless there is strong evidence the finding is wrong; if disagreeing, reply with the evidence.
- **P3:** fix when it is nearby, low-risk, and improves correctness, operator clarity, or future agent behavior. Otherwise acknowledge or leave as a documented nit.
- **Reviewer error:** do not ignore. A Greptile error comment or failed review run is a blocker until retried, explained, or replaced by another adequate review signal.

If a bot uses different wording, translate to the repo priority model. For example, Cursor "Medium Severity" usually maps to P2 unless the content proves otherwise.

### 3. Fix On The Owning Branch

For stacked work:

1. Identify which branch owns the finding.
2. Check out that branch.
3. Make the smallest focused fix.
4. Add or update tests when the finding describes behavior.
5. Commit with `gt modify --message ...`.
6. Restack upward.
7. Re-run targeted verification and any required broader checks.

Do not paper over a lower-branch problem with a top-branch cleanup commit unless the stack owner explicitly chooses that workflow.

### 4. Re-Submit And Re-Check

After fixes:

```bash
gt submit --stack --restack --no-edit --no-interactive --dry-run
gt submit --stack --restack --no-edit --no-interactive
```

Use `--draft` only when the PRs should remain draft. If a PR is already ready and the user asked not to re-draft it, keep it ready.

Wait for fresh CI and reviewer checks. A previous green check does not prove the new commit.

### 5. Reply And Resolve

For every addressed thread:

1. Reply with what changed and where.
2. Resolve the thread.
3. Re-read the thread list to confirm it is resolved.

Example reply:

```markdown
Fixed in the latest [#874](https://github.com/outfitter-dev/trails/pull/874) update by normalizing override/defer comparisons through the plan case-sensitivity and adding a regression for `Blazed` suppressing derived `blazed`.
```

Keep replies factual. Link the PR with a short label, and name the behavior or test that proves the fix.

### 6. Wait For The Review Window

Before merge, confirm:

- all required CI is green;
- Graphite mergeability is green or the Graphite queue is the only pending signal;
- all P0-P2 review threads are resolved;
- fresh bot reviews after the latest commit have completed or had a reasonable window to respond;
- PRs are ready for review, not draft;
- PR bodies are accurate after any review-response changes.

When the user has asked to wait for remote reviewers, do not immediately merge after the first green CI pass. Poll or set a reminder/heartbeat and check again.

### 7. Merge Through The Repo Path

Use the repo's merge path. In this repo, use Graphite:

- merge stack PRs through Graphite or the Graphite queue;
- do not use the GitHub merge button when Graphite says not to;
- after merge, run `gt sync --no-interactive`;
- return the workspace to clean `main`.

### 8. Update Tracker And Handoff

After merge:

- update related Linear issues with PR links, verification, review fixes, and merge state;
- move completed issues to Done;
- update goal retros or handoff notes when the work ran under a goal;
- mention any unrelated cleanup Graphite could not perform.

## Done Criteria

A PR review loop is done only when:

- latest commits are submitted;
- CI/checks are green or only an understood queue signal remains;
- no unresolved P0-P2 review threads remain;
- addressed threads have replies and are resolved;
- relevant P3s were fixed or consciously left;
- the PR/stack is merged through the repo-approved path, when merge was in scope;
- local workspace is clean on updated `main`, when merge was in scope;
- tracker/handoff state matches what actually happened.

## Stop Rules

Stop and report if:

- a reviewer finding is valid but the fix would expand beyond the authorized scope;
- a review bot errors repeatedly and no replacement review signal is available;
- Graphite queue behavior becomes ambiguous or appears stuck after checks are green;
- CI fails in a way unrelated to the PR and cannot be isolated;
- the same fix path fails three times.

Report what you checked, what remains open, your best hypothesis, and the exact decision or access needed.
