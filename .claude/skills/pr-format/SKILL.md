---
name: pr-format
description: Use when opening, drafting, or editing a pull request in maester, "open a PR", "write the PR description", "gh pr create", "update the PR body", or when writing a squash-merge commit message from a PR. Keeps every PR body in one shape - What was changed, Why it was needed, how it was tested - as short bullets.
---

# PR format

Every maester PR body has the same four sections, taken from `.github/pull_request_template.md`. A reviewer should know what changed and why in under a minute.

## Title

- Imperative, sentence case, no trailing period: `Split CI into PR checks and a main smoke test`
- Epic work that closes several stories: `E1 Agent core: tool registry, runner, loop, memory, evals`
- 72 characters or fewer. No `feat:` / `fix:` prefixes.

## Body

```markdown
## What

- <one bullet per change, what now happens that didn't before>
- `path/or/symbol`: <what changed in it>

## Why

- <the problem, bug, or need that made this necessary>
- <any trade-off or follow-up a reviewer should know>

## Testing

- <commands run and their result, e.g. `uv run pytest` - 61 passed>
- <what was NOT verified, and why>

Closes #<n>

## Checklist

- [x] Tests added or updated
- [x] Evals still pass if prompts or tools changed
- [x] Destructive tools still require confirmation
- [x] Any new arr call names its host
```

## Rules

- **What** says what was fixed or added, not how the code works. One idea per bullet, one or two lines each. Lead with the file or symbol in backticks when it helps scanning.
- **Why** is required and must give the reason, not restate What. "Friends could see tools they can't call" is a reason; "Filter tools by tier" is not.
- **Testing** lists what actually ran. If something was skipped (Docker not running, no live stack), say so plainly.
- Bullets only, no paragraphs. Nest a sub-bullet at most one level deep.
- Link issues with `Closes #n` (one per issue: `Closes #2, closes #3`). Use `Part of #n` for the parent epic and `Refs #n` when the PR doesn't finish the issue.
- Tick a checklist item or mark it `(n/a)`; never delete it.
- No filler: no "This PR...", no summary of the summary, no emoji, no agent attribution lines.
- Backticks for paths, commands, env vars, model ids, and code symbols only.

## Creating it

1. Read the full change: `git log main..HEAD` and `git diff main...HEAD --stat`.
2. Draft the body in a scratch file, then check it against the rules above.
3. `gh pr create --base main --title "<title>" --body-file <file>` (or `gh pr edit <n> --body-file <file>` to fix an existing one).
4. The squash-merge commit uses the same title with ` (#<pr>)` and the same body.
