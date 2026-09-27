---
name: board-sync
description: Use when the "maester roadmap" GitHub Project board (github.com/users/codebend3r/projects/1) may not match the issues. Triggers include "sync the board", "update the project", "move closed stories to Done", "what's in progress", "is the roadmap up to date", "close the epic", after merging a PR that closes stories, or when a board item looks stale (closed issue still In Progress, finished epic still Todo, issue missing from the board).
---

# Board sync

The issues and their PRs are the source of truth, and the board follows them. The board's built-in workflows are on but miss transitions: PR #77 closed three stories and they stayed In Progress. Audit the board; don't trust the automation.

## Pick the tool

| What drifted | Run |
| --- | --- |
| Status, Epic/Phase/Size/Priority, an issue missing from the board, a finished epic still open | `scripts/sync_board.py` |
| An epic or story added, renamed, resized or reprioritized | Edit `scripts/catalog.py`, run `scripts/sync_tracker.py`, then `scripts/sync_board.py` |
| Board deleted or being rebuilt | `scripts/setup_project.sh` |

`sync_tracker.py` rewrites every issue body from the catalog, which unticks every epic checklist. Always follow it with `sync_board.py`, which ticks them back.

## Run it

1. Needs the `project` scope. On `missing required scopes [project]`, ask the user to run `! gh auth refresh -s project`
2. Audit: `uv run python scripts/sync_board.py`. It is read-only and saves the plan
3. Show the user the plan table and the "Needs a decision" list as printed, then ask which steps to apply. Closing an epic and editing its checklist change the issue itself, not just the board
4. Apply what they approved: `uv run python scripts/sync_board.py --apply` or `--apply --only 1,3`. Steps already done since the audit are skipped
5. Re-run the audit. An added issue gets its fields and status on this second pass. Stop when it prints `✓ board matches the issues`, or only flags remain

## What the audit checks

| Issue state | Board becomes |
| --- | --- |
| Closed as completed | Done |
| Open with an open PR that closes it | In Progress |
| Epic with any story closed or In Progress | In Progress |
| Epic with every story closed | Checklist ticked, issue closed, Done |
| Open with no status | Todo |
| Title `[E3.1]`, milestone `M2 …`, labels `size:M`, `P0` | Epic E3, Phase M2, Size M, Priority P0 |
| Issue in the repo but not on the board | Added |

Only issue items are audited. PR and draft items on the board are left alone.

It flags these for the user and never changes them:

- **Open issue showing Done.** Reopened, or moved early? Ask whether to reopen the work or close the issue
- **Closed as not planned.** Ask whether to mark it Done or archive the item
- **Closed epic with open stories.** Ask whether the stories move to another epic or the epic reopens

To answer "what's in progress" or "what's left", audit first so stale statuses aren't reported as fact, then read the board with `gh project item-list 1 --owner codebend3r --format json --limit 200`.

## Common mistakes

- **Setting Done on an open issue by hand.** The Auto-close issue workflow closes it. Close the issue instead, or let the script close the epic
- **Trusting the built-in workflows.** "Item closed" is enabled and still missed #10, #11 and #13
- **Editing the board to change scope.** Board fields come from labels and milestones, so the next audit reverts them. Change the catalog or the labels instead

## Reporting back

In chat only, one line per applied step, as the script prints it: `✓ 2. #15 close the issue as completed`. End with the audit's final line.
