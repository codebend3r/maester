import type { Configuration } from 'lint-staged'

// oxfmt skips the files a project's .oxfmtrc.json ignores, and exits with an
// error when that leaves it nothing to format.
const oxfmt = 'oxfmt --no-error-on-unmatched-pattern'

// lint-staged runs the globs at the same time, so no two of them match the same
// file; each glob's commands run in order, the formatter last.
export default {
  '*.{ts,tsx,mts,cts}': ['oxlint --fix', oxfmt],
  '*.{json,md,yml,yaml,toml,html}': oxfmt,
  // gale is a dependency of each project with styles, not of the root.
  'apps/raven/web/**/*.scss': ['bun --cwd apps/raven/web gale --fix', oxfmt],
  'apps/rookery/web/**/*.scss': ['bun --cwd apps/rookery/web gale --fix', oxfmt],
  'libs/raven/ui/**/*.scss': ['bun --cwd libs/raven/ui gale --fix', oxfmt],
  'apps/sparrow/api/**/*.{py,pyi}': [
    'uv run --directory apps/sparrow/api ruff check --fix',
    'uv run --directory apps/sparrow/api ruff format',
  ],
  // As in scripts/package.json: sparrow's ruff and config, run from scripts.
  'scripts/**/*.py': [
    'uv run --directory scripts --project ../apps/sparrow/api ruff check --config ../apps/sparrow/api/pyproject.toml --fix',
    'uv run --directory scripts --project ../apps/sparrow/api ruff format --config ../apps/sparrow/api/pyproject.toml',
  ],
} satisfies Configuration
