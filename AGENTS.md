# Pi instructions for this repository

## Mandatory startup gate

Before editing files, running project tasks, creating branches or worktrees, or delegating repository work:

1. Locate the repository root and read its `CLAUDE.md` in full. Follow it as this repository's instructions, subject to higher-priority instructions. Read and follow applicable product or project `CLAUDE.md` files before working in those directories.
2. Discover every `SKILL.md` recursively under `<repo-root>/.claude/skills/` and read every discovered file in full, not just its frontmatter. These are local repository skills even if Pi's advertised available-skills list omits them.
3. Always load `.claude/skills/create-new-worktree/SKILL.md`, regardless of the current task. Loading it does not mean creating a worktree unless the task calls for one.
4. Before working in a nested project, also discover and fully read its local `.claude/skills/**/SKILL.md` files, if present.

Repeat this gate for every new session, when switching repositories or worktrees, and after context compaction or resumption if the full instructions and skills are no longer in context. Listing paths or remembering a summary does not count as loading their contents.

If a required file cannot be read, report its exact path and the read failure, and stop before repository work. Never silently skip it or claim it was loaded.

Apply each skill's procedure when its task matches. Check repository skills before global skills when looking for a named skill. Keep `CLAUDE.md` as the source of truth for shared repository rules rather than duplicating them here.
