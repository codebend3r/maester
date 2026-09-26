---
name: commit-format
description: Use when writing, amending, squashing, fixup-ing, rebasing, or cherry-picking any git commit message in maester, including the squash-merge commit for a PR. Covers the `MAE:` subject prefix, short bullet bodies, backticks, and zero agent attribution. For PR titles and bodies, use `pr-format`.
---

# Commit format

## House style

Shared with `pr-format`. Keep the two copies identical.

- **`MAE:` prefix.** Every commit subject and PR title starts with `MAE: `. No other prefix (`feat:`, `fix:`, `chore:`)
- **Short, concise sentences.** One idea per line. No filler ("This PR…", "I added…"), no restating
- **Prefer bullets.** Use `-` bullets over paragraphs. Nest one level at most
- **Backtick code.** File names, paths, commands, env vars, model ids, and code symbols
- **No agent attribution.** Never mention Claude, Anthropic, Copilot, Cursor, Codex, or "AI-generated" anywhere: subject, body, or trailer. This overrides the default `Co-Authored-By: Claude` trailer and "Generated with Claude Code" footer. Human co-authors are fine
- **No emoji** in commits, PR titles, or PR bodies

## Shape

```
MAE: <short subject, 72 chars max, no trailing period>

- <what changed>
- <what changed>
- <why, when it isn't obvious from the change>
```

- A one-line change needs only the subject
- The subject says what the commit does; details go in bullets

Commit with a heredoc so the formatting survives:

```bash
git commit -m "$(cat <<'EOF'
MAE: reject out-of-tier tool calls in the runner

- `ToolRunner.run()` checks the caller's tier before executing
- rejected calls are audited with host and timing
- the model could previously call tools hidden from its definitions
EOF
)"
```

## Rewrites

Amend, rebase, cherry-pick, fixup, and squash all rewrite the message. Re-check it against the house style and strip any attribution trailer, even one that was already there.

## Squash-merge commit

Use the PR title with ` (#<pr>)` appended, and the PR body as the commit body.

## Example

Wrong:

```
feat: runner changes

I updated the tool runner so that it now rejects calls to tools that are
outside of the user's tier, and also added audit logging for them.

Co-Authored-By: Claude <noreply@anthropic.com>
```

Wrong prefix, prose body, no backticks, attribution trailer.

Right:

```
MAE: reject out-of-tier tool calls in the runner

- `ToolRunner.run()` checks the caller's tier before executing
- rejected calls are audited with host and timing
```

## Checklist

- [ ] Subject starts with `MAE: `, 72 chars or fewer, no trailing period
- [ ] Body is short `-` bullets, or absent for a one-line change
- [ ] Code tokens are backticked
- [ ] Zero agent attribution, zero emoji

## Reporting back

In chat only, one line per action: `✅ committed <sha7> — MAE: <subject>`, `🚀 pushed <branch>`.
