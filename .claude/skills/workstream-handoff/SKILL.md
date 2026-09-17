---
name: workstream-handoff
description: Close a Themis coding session with a minimal persistent handoff and local checkpoint commit.
disable-model-invocation: true
---

Create a compact handoff for workstream `$ARGUMENTS`.

Rules:
- Do not inspect unrelated workstreams.
- Do not push.
- Handoff must remain <=80 lines.
- Preserve facts/interfaces, not reasoning history.

Steps:
1. Run `git branch --show-current`, `git status --short`, and `git log -5 --oneline`.
2. Run the narrow workstream test suite if it has not already passed.
3. Update only `docs/workstreams/$ARGUMENTS.md`.
4. Include exactly:
   - STATUS
   - DONE
   - CURRENT INTERFACES
   - KNOWN ISSUES
   - NEXT 3 TASKS
   - LAST TEST COMMAND + RESULT
   - LAST CODE COMMIT
5. Remove stale notes instead of appending an endless journal.
6. Stage only files owned by this workstream plus its handoff file.
7. Create one descriptive local commit if there are coherent uncommitted changes.
8. Do not push.
9. Return only: branch, test result, commit, next task.
