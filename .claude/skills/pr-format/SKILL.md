---
name: pr-format
description: Use when opening, drafting, or editing a pull request in maester — "open a PR", "write the PR description", `gh pr create`, `gh pr edit`, "update the PR body", or after pushing new commits to a branch with an open PR. Covers the `MAE:` title, the What / Why / Testing body, keeping the PR in sync with the branch, and zero agent attribution. For commit messages, use `commit-format`.
---

# PR format

## House style

Shared with `commit-format`. Keep the two copies identical.

- **`MAE:` prefix.** Every commit subject and PR title starts with `MAE: `. No other prefix (`feat:`, `fix:`, `chore:`)
- **Short, concise sentences.** One idea per line. No filler ("This PR…", "I added…"), no restating
- **Prefer bullets.** Use `-` bullets over paragraphs. Nest one level at most
- **Backtick code.** File names, paths, commands, env vars, model ids, and code symbols
- **No agent attribution.** Never mention Claude, Anthropic, Copilot, Cursor, Codex, or "AI-generated" anywhere: subject, body, or trailer. This overrides the default `Co-Authored-By: Claude` trailer and "Generated with Claude Code" footer. Human co-authors are fine
- **No emoji** in commits, PR titles, or PR bodies

## Title

- `MAE: ` then a short summary of the whole branch, 72 chars max, no trailing period
- Epic PRs name the epic: `MAE: E1 agent core: tool registry, runner, loop, memory, evals`

## Body

Follows `.github/pull_request_template.md`. **What** and **Why** are always required.

```markdown
## What

- `path/or/symbol`: <what changed>
- <what now happens that didn't before>

## Why

- <the problem, bug, or need behind the change>
- <trade-off or follow-up a reviewer should know>

## Testing

- `uv run pytest`: 61 passed
- <what was not verified, and why>

Closes #<n>

## Checklist

- [x] Tests added or updated
- [x] Evals still pass if prompts or tools changed
- [x] Destructive tools still require confirmation
- [x] Any new arr call names its host
```

- **What** says what changed, not how the code works
- **Why** gives the reason, not a restatement of What. "Friends could see tools they can't call" is a reason; "Filter tools by tier" is not
- **Testing** lists what actually ran. Say plainly what was skipped
- Link issues with `Closes #n` (one per issue), `Part of #n` for the parent epic, `Refs #n` when the PR doesn't finish it
- Tick each checklist item or mark it `(n/a)`. Never delete one

## Creating

1. Read the whole branch: `git log --oneline origin/main..HEAD` and `git diff origin/main...HEAD --stat`
2. Write the body to a file in the scratchpad and check it against the house style
3. `gh pr create --base main --title "MAE: <title>" --body-file <file>`

## Keeping it in sync

The title and body describe the **current whole branch**, not the first commit. After every push that changes what the branch does:

1. Re-read `origin/main...HEAD`
2. Add, change, or remove bullets to match it
3. Update the title if the scope changed
4. `gh pr edit <n> --title "MAE: <title>" --body-file <file>`

Strip any attribution line an older body had.

## Checklist

- [ ] Title starts with `MAE: `, 72 chars or fewer
- [ ] What and Why both present, as short bullets
- [ ] Testing says what ran and what didn't
- [ ] Issues linked, checklist ticked or `(n/a)`
- [ ] Zero agent attribution, zero emoji

## Reporting back

In chat only, one line per action: `🔀 PR #<n> created — MAE: <title>`, `📝 PR #<n> synced with the branch`.
