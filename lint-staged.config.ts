import type { Configuration } from 'lint-staged'

// oxfmt skips the files a project's .oxfmtrc.json ignores, and exits with an
// error when that leaves it nothing to format.
const oxfmt = 'oxfmt --no-error-on-unmatched-pattern'

// lint-staged runs the globs at the same time, so no two of them match the same
// file; each glob's commands run in order, the formatter last.
export default {
  '*.{ts,tsx,mts,cts}': ['oxlint --fix', oxfmt],
  '*.{json,md,yml,yaml,toml,html}': oxfmt,
  // stylelint is a dependency of each web app, not of the root.
  'apps/raven/web/**/*.scss': ['bun --cwd apps/raven/web stylelint --fix', oxfmt],
  'apps/raven/desktop/**/*.scss': ['bun --cwd apps/raven/desktop stylelint --fix', oxfmt],
  'apps/rookery/web/**/*.scss': ['bun --cwd apps/rookery/web stylelint --fix', oxfmt],
  'apps/luwin/api/**/*.{py,pyi}': [
    'uv run --directory apps/luwin/api ruff check --fix',
    'uv run --directory apps/luwin/api ruff format',
  ],
  // As in scripts/package.json: luwin's ruff and config, run from scripts.
  'scripts/**/*.py': [
    'uv run --directory scripts --project ../apps/luwin/api ruff check --config ../apps/luwin/api/pyproject.toml --fix',
    'uv run --directory scripts --project ../apps/luwin/api ruff format --config ../apps/luwin/api/pyproject.toml',
  ],
} satisfies Configuration
