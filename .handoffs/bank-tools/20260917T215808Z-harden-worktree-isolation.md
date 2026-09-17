## request

**To:** integration
**From:** bank-tools
**Why:** A second live session (frontend, no dedicated worktree) branch-switched in the
shared root checkout (`/Users/nityanthmaramreddy/Downloads/themis`) while I had
uncommitted work there, also with no worktree. That session pre-emptively ran
`git stash push -u` to protect my files (nothing was actually lost), but only because
they happened to do that defensively — a plain `git clean`/reset in the same spot would
not have been so kind. CLAUDE.md already says "Prefer one Git worktree per concurrently
running coding agent," but "prefer" was not strong enough to stop two agents from both
skipping it in the same shared directory.

**Ask:** tighten `CLAUDE.md` "Git / parallel-agent rules" (root/shared file, integration-owned,
not editing it myself) to make worktree creation a mandatory first step, not optional, e.g.:

```
## 2.3a Before any edit: create your worktree
1. From the shared root, run:
   git worktree add /private/tmp/themis-<workstream>-<task> agent/<workstream>/<task>
2. cd into that path. Do all reads/edits/tests/commits for this session from there.
3. Never write, edit, or `git checkout`/`git stash` in the shared root
   (/Users/nityanthmaramreddy/Downloads/themis) once your worktree exists.
4. If you find yourself already mid-edit in the shared root: stop, `git worktree add`
   from your current branch (no need to switch first), move your uncommitted files into
   the new worktree path, then continue there.
```

Also worth a one-line note that `git stash show --stat` (no `-u`) hides the untracked-file
half of a `stash push -u`, in case anyone else mis-diagnoses a "lost files" situation the
way I initially did.

**Current state:** I already resolved this for myself — working from
`/private/tmp/themis-bank-tools-core-tools` on `agent/bank-tools/core-tools`, 2 commits in,
32 tests passing. No action needed on my files; this handoff is only about the shared
process guardrail for future/other agents.
