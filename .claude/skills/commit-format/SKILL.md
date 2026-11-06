---
name: commit-format
description: Use when writing, amending, squashing, fixup-ing, rebasing, or cherry-picking any git commit message in maester, including the squash-merge commit for a PR. Covers the `MAE:` subject prefix, the What / Why body grouped by Nx project, backticks, and zero agent attribution. For PR titles and bodies, use `pr-format`.
---

# Commit format

A commit message is a subset of the PR body (`pr-format`): the same title rule, the same **What** grouped by project and the same **Why**, in plain text. The PR adds Testing, screenshots, follow-ups, issue links and the checklist.

## House style

Shared with `pr-format`. Keep the two copies identical.

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

## Shape

Size the message to the change:

| Change                       | Message                                          |
| ---------------------------- | ------------------------------------------------ |
| One line, obvious            | Subject only                                     |
| One project, up to 3 bullets | Subject, then bullets, then `Why` if not obvious |
| Anything bigger              | Subject, then the full `What` / `Why` layout     |

Full layout:

```
MAE: <short subject, 72 chars max, no trailing period>

What

@raven/web
- `path/or/symbol`: <what changed>
- <Area>:
  - <what changed>
  - <what changed>

@raven/server
- <what changed>

Workspace
- `lefthook.yml`: <what changed>

Why

- <the problem, bug, or need behind the change>
```

- Headings are bare words on their own line (`What`, `Why`, `@raven/web`, `Workspace`), never markdown `#` headings: git strips lines starting with `#` whenever the message passes through an editor or `--cleanup=strip`
- Project headings are the package names from the root `CLAUDE.md` table, without backticks, so they read cleanly in `git log`. A one-project commit in the full layout still gets its heading
- A blank line separates the subject, `What`, each project block and `Why`; no blank lines inside a block
- The subject names the whole change; when it covers several projects, name the themes, not every detail
- No Testing, screenshots, checklist or follow-ups: those live in the PR

Commit with a heredoc so the formatting survives:

```bash
git commit --cleanup=verbatim -F - <<'EOF'
MAE: reject out-of-tier tool calls in the runner

- `ToolRunner.run()`: checks the caller's tier before executing
- `audit_log`: records each rejected call with its host and timing

Why

- The model could call tools hidden from its definitions
EOF
```

## Rewrites

Amend, rebase, cherry-pick, fixup, and squash all rewrite the message. When commits are squashed, merge their bullets into one `What` / `Why` for the combined change: fold duplicates, drop steps a later commit undid, and keep each bullet under its project. Re-check the result against the house style and strip any attribution trailer, even one that was already there.

## Squash-merge commit

- Subject: the PR title with ` (#<pr>)` appended
- Body: the PR's **What** and **Why**, converted to the plain-text layout above (`### `@raven/web`` becomes `@raven/web`). Drop Testing, screenshots, follow-ups and the checklist; keep the `Closes #n` / `Part of #n` lines at the end
- `gh pr merge <n> --squash --subject "MAE: <title> (#<n>)" --body-file <file>`

## Example

Wrong:

```
feat: TV player quality, Home everywhere

- `@raven/app` player: a Quality picker beside audio and subtitles that always shows, Direct play first with the file's bitrate, then the web's lower sizes (`qualityOptions.ts`); Back at the top left on TV and touch
- `@raven/app`: a Home plate at the top left of every TV screen but Home, sign-in and the player
- `@raven/web`: Play all on the show and season pages
- `@raven/core`: `SeasonSummary` gains an optional `runtime`
- `@raven/app` music: library Shuffle asks a fresh random order from the whole library

Co-Authored-By: Claude <noreply@anthropic.com>
```

Wrong prefix, project names repeated on every bullet, projects interleaved, several changes per bullet, no Why, attribution trailer.

Right:

```
MAE: TV player quality, Home everywhere, show Play all and Shuffle

What

@raven/app
- Player:
  - Quality picker beside audio and subtitles: Direct play first with the file's bitrate, then the web's lower sizes (`qualityOptions.ts`)
  - Back at the top left on TV and touch
- `HomePlate`: a Home plate at the top left of every TV screen but Home, sign-in and the player
- Music: library Shuffle asks a fresh random order from the whole library

@raven/web
- Show and season pages: Play all and Shuffle

@raven/core
- `SeasonSummary`: optional `runtime`, summed by `itemChildren`

Why

- TV viewers had no way to pick a lower size on a slow connection
- Getting back to Home on TV took one Back press per screen
```

## Checklist

- [ ] Subject starts with `MAE: `, 72 chars or fewer, no trailing period
- [ ] Body sized to the change; bigger changes use `What` / `Why`
- [ ] One block per project, in order, with no project name repeated in a bullet
- [ ] One change per bullet, one line each, area groups past five bullets
- [ ] No `#` headings; code tokens backticked
- [ ] Zero agent attribution, zero emoji

## Reporting back

In chat only, one line per action: `✅ committed <sha7>: MAE: <subject>`, `🚀 pushed <branch>`.
