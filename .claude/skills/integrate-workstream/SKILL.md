---
name: integrate-workstream
description: Locally integrate one completed Themis worker branch into the integration branch with minimal conflict resolution.
disable-model-invocation: true
---

Integrate worker branch `$ARGUMENTS`.

Only use this skill when acting as the designated integration agent.

Steps:
1. Verify the current worktree is clean.
2. Verify current branch is `integration`.
3. Read only the worker's handoff and its changed-file list: `git diff --name-only integration...$ARGUMENTS`.
4. Do not reread the entire worker history or repository.
5. Merge the worker branch locally. Never push.
6. If conflicts exist:
   - preserve shared contract behavior,
   - preserve tested interfaces,
   - make the smallest reconciliation,
   - do not rewrite working implementations merely for style.
7. Run tests for the affected workstreams only.
8. If they pass, create the local integration commit/merge commit.
9. Update root/shared files only when required by the merge.
10. Return only: merged branch, conflicts resolved, tests, resulting commit, blockers.
