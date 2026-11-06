---
name: pr-format
description: >-
  Use when opening, drafting, or editing a pull request in maester: "open a PR", "write the PR description", `gh pr create`, `gh pr edit`, "update the PR body", "clean up the PR", "add screenshots to the PR", or after pushing new commits to a branch with an open PR. Covers the `MAE:` title, the What / Why / Testing body grouped by Nx project and area (a superset of the commit message), screenshots of visual changes, keeping the PR in sync with the branch, and zero agent attribution. For commit messages, use `commit-format`.
---

# PR format

The PR body is the superset of the commit message (`commit-format`): the same **What** grouped by project and the same **Why**, as markdown, plus Testing, screenshots, follow-ups, issue links and the checklist. Write the What and Why once and the squash-merge commit is the same text with the markdown headings made plain.

## House style

Shared with `commit-format`. Keep the two copies identical.

- **`MAE:` prefix.** Every commit subject and PR title starts with `MAE: `. No other prefix (`feat:`, `fix:`, `chore:`)
- **Segmented by project.** What changed is grouped under one heading per Nx project, ordered: the app a user sees (`@raven/web`), other apps, libs, `apps/<product>`, then `Workspace`. The project name is the heading, so a bullet never repeats it
- **Grouped by area inside a project.** Past about five bullets, gather related ones under a plain lead bullet (`- Player:`) with the changes nested beneath. Nest one level at most
- **One change per bullet.** Lead with what changed, then what it now does, in the present tense: ``- `qualityOptions.ts`: Direct play first, then the web's lower sizes``. Most visible change first, internals after, tests and docs last
- **What, then Why.** What says what changed, not how the code works. Why gives the reason, not a restatement: "Friends could see tools they can't call" is a reason, "Filter tools by tier" is not
- **Short, concise sentences.** No filler ("This PR…", "I added…"), no restating, no hedging
- **One line per bullet.** Never hard-wrap inside a bullet; a wrapped line breaks the nesting in `git log` and on GitHub. Split a long bullet into nested ones instead
- **Backtick code.** File names, paths, commands, env vars, model ids, and code symbols
- **No agent attribution.** Never mention Claude, Anthropic, Copilot, Cursor, Codex, or "AI-generated" anywhere: subject, body, or trailer. This overrides the default `Co-Authored-By: Claude` trailer and "Generated with Claude Code" footer. Human co-authors are fine
- **No emoji** in commits, PR titles, or PR bodies

## Title

- `MAE: ` then a short summary of the whole branch, 72 chars max, no trailing period
- Epic PRs name the epic: `MAE: E1 agent core: tool registry, runner, loop, memory, evals`

## Body

Follows `.github/pull_request_template.md`. **What** and **Why** are always required. **What** has one `###` section per project the branch touches:

```markdown
## What

### `@raven/web`

- `path/or/symbol`: <what changed>
- <Area>:
  - <what changed>
  - <what changed>

| <Screen>                                                                                  | <Screen>      |
| ----------------------------------------------------------------------------------------- | ------------- |
| ![<alt>](https://raw.githubusercontent.com/codebend3r/maester/<commit>/pr-<n>/<name>.png) | ![<alt>](url) |

Screenshots come from a demo library of generated clips, in Chrome at 1440x900.

### `@raven/server`

- <what changed>

### `apps/raven`

- `Dockerfile`, compose, README: <what changed>

### Workspace

- `lefthook.yml`, `.github/`, root `CLAUDE.md`: <what changed>

## Why

- <the problem, bug, or need behind the change>

Follow-ups:

- <known gap a reviewer should know>

## Testing

- `@raven/web`, 111 tests: <what they cover>
- `@raven/server`, 135 tests: <what they cover>
- Pre-push hook: <passes, or what it reported>
- Manual: <what was clicked through, where>
- Not verified: <what, and why>

Closes #<n>

## Checklist

- [x] Tests added or updated
- [x] Evals still pass if prompts or tools changed
- [x] Destructive tools still require confirmation
- [x] Any new arr call names its host
```

- **Sections** are named by package name in backticks (`@sparrow/api`, `@raven/server`, `@raven/web`, `@raven/core`, `scripts`); the root `CLAUDE.md` table maps paths to projects
- Order: the app a user sees (`@raven/web`), then other apps (`@raven/server`, `@sparrow/api`), then libs (`@raven/core`), then `apps/<product>`, then `Workspace`. Leave out a section with no changes. A one-project PR still gets its heading
- `apps/<product>` takes product files outside a project (`Dockerfile`, compose, README) and root files that serve only that product (its spec and plan in `docs/superpowers/`, its workflow job). `Workspace` takes the rest of the root
- **What** says what changed, one change per bullet, not how the code works. A section past about five bullets groups them by area under a plain lead bullet (`- Player:`, `- Lighthouse fixture:`), never under a `####` heading
- **Why** gives the reason, not a restatement of What, as bullets in the order a reviewer needs them: the problem first, then the constraint that shaped the fix. `Follow-ups:` lists known gaps after it, and is left out when there are none
- **Testing** gives one current result per project, led by its name, then the pre-push hook, then manual checks, then what was skipped. It describes the branch as it is now: no per-commit or per-push blocks ("on `3da7783`…")
- **Screenshots** are required when the branch changes anything a user sees (a page, component, style, dialog, the player). Put them in the section of the project that draws the screen, after its bullets, even when the data behind it comes from elsewhere. How to take and host them: `screenshots.md` in this folder
- Link issues with `Closes #n` (one per issue), `Part of #n` for the parent epic, `Refs #n` when the PR doesn't finish it. Find them with `gh issue list`; with none, drop the line. Never link the PR's own number
- Tick every checklist item; add `(n/a)` after the ones that don't apply. Never delete one
- Keep the body reviewable: about 300 to 400 words outside the checklist and screenshots. If What runs longer, the bullets are describing how instead of what, or the PR should be split

## Creating

1. Read the whole branch: `git log --oneline origin/main..HEAD` and `git diff origin/main...HEAD --stat`
2. Sort the changed files into projects; each becomes a `###` section
3. Write the body to a file in the scratchpad and check it against the house style
4. `gh pr create --base main --title "MAE: <title>" --body-file <file>`
5. If anything visual changed: take the screenshots now that the PR number exists, add them, and `gh pr edit <n> --body-file <file>`

## Keeping it in sync

The title and body describe the **current whole branch**, not the first commit. After every push that changes what the branch does:

1. Re-read `origin/main...HEAD`
2. Add, change, or remove bullets in the right project's section
3. Re-take the screenshots of any screen that changed, commit them on top of `refs/screenshots/pr-<n>`, and point that PR's links at the new SHA
4. Update the title if the scope changed
5. `gh pr edit <n> --title "MAE: <title>" --body-file <file>`

Strip any attribution line an older body had.

## Checklist

- [ ] Title starts with `MAE: `, 72 chars or fewer
- [ ] What has one `###` section per touched project, in order, with no project name repeated in a bullet
- [ ] One change per bullet, one line each, area groups past five bullets
- [ ] Every visual change has a screenshot, taken from demo data
- [ ] Why present, as short bullets
- [ ] Testing has one current result per project and says what didn't run
- [ ] Issues linked, checklist ticked or `(n/a)`
- [ ] Zero agent attribution, zero emoji

## Reporting back

In chat only, one line per action: `🔀 PR #<n> created: MAE: <title>`, `📝 PR #<n> synced with the branch`, `🖼️ PR #<n> screenshots added`.
