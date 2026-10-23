# Claude context for this workspace

## Rules

- The root holds only workspace files. Anything that belongs to a product (its image, compose, env, docs, version) goes under `apps/<product>/`.
- Run tasks through Nx from the repo root: `bunx nx run @luwin/api:test`, `bunx nx run-many -t test`, `bun run verify`, `bun run affected`.
- Never put a `.env` at the repo root; Nx loads it into every task. Each product reads its own beside its compose file.
- Commits and PRs follow the `commit-format` and `pr-format` skills (`MAE:` prefix).
- lefthook's git hooks (`lefthook.yml`) run on every commit and push: pre-commit runs lint-staged (`lint-staged.config.ts`) to lint and format the staged files, and pre-push runs the checks `verify` runs but `dead-code` and `dead-css`, which only the PR checks run, one at a time, then the CLAUDE.md audit (`scripts/audit_claude_md.sh`, also `bun run audit`): headless Claude Code reads the commits being pushed against this file and the product `CLAUDE.md`s for the rules no linter checks, and a violation stops the push. Never skip them with `--no-verify` or `LEFTHOOK=0`; fix what they report.
- TypeScript only: no `.js`, `.jsx`, `.mjs` or `.cjs` files anywhere, config files included. The pre-push hook and the `typescript-only` target (in `verify`, `affected` and the PR checks) reject them.
- A `package.json` script runs one command. Steps become scripts of their own, chained with `bun run --sequential build:clean build:compile` (or `--parallel`), never with `&&`, `||` or `;`. The pre-push hook and the `one-command-per-script` target (in `verify`, `affected` and the PR checks) reject a chained script.
- Every import of a project's own modules goes through its `@/` alias and names no extension: `@/lib/api`, never `./api`, `../lib/api` or `@/lib/api.js`. oxlint's `no-restricted-imports` fails on anything else. Non-TypeScript assets keep their extension (`@/components/Player/Player.module.scss`). Node needs relative `.js` paths at runtime, so the server and core builds run `tsc-alias` after `tsc` to rewrite the alias in `dist` only.
- Writing: no em dashes or en dashes anywhere, including comments and UI copy.
- `e2e`, `test:native`, `make`, `audit:bundle` and `smoke:packaged` need macOS on Apple Silicon, so `verify` and `affected` leave them out and the PR checks' desktop jobs, behind the required `🖥️ Desktop` check, run them. Locally they run only on such a Mac, and `smoke:packaged` uses your own `~/Library/Application Support/raven` and `~/Library/Logs/raven`. A packaged app reads no test hook, so the smoke also makes the real launch check against GitHub and writes `updates.checkedAt` into that folder's `desktop-config.json`, moving an older file to version 5. `@raven/app`'s `prebuild:*` and `build:*` targets and its `e2e` stay out of `verify` and `affected` too: the Apple ones need a Mac with Xcode, and the Android TV ones run in CI on Linux, since GitHub's macOS runners cannot run the Android emulator. Its CI jobs join the `🖥️ Desktop` check.

- `@raven/supabase`'s `test:db` and `lint:db` need Docker and a running local stack, and its `check:functions` and `test:functions` need Deno, which runs its Edge Functions. `verify` and `affected` leave those targets out; the PR checks' `🗄️ Supabase` job sets up Deno, starts the stack and runs them.

## TypeScript

These apply to every TypeScript project: everything but `@luwin/api` and the Python in `scripts`.

- Use type guards wherever possible.
- Never use `any`; narrow the type or write a type guard. oxlint's `no-explicit-any` fails on it.
- Never cast types under any circumstance, and never double cast (`as any as string`). `as const` is not a cast.
- If a type can't be inferred and narrowing is not an option, use `unknown`.
- Model alternatives as discriminated unions so invalid states are unrepresentable. Switch on the discriminant and exhaustiveness-check the `default` case by assigning to `never`.
- No enums. Use `as const` arrays or objects and derive the union from them: `(typeof X)[number]`, `keyof typeof X`.
- No string literals that act as identifiers. A status, a kind, a discriminant tag, a route path, an event or channel name, a header, a storage or query key, an environment variable name, an error code: each is a value of an `as const` object or array, declared once and imported wherever it is read, compared or switched on. The constant is the single source of truth and the types come from it, never the other way round:

  ```ts
  export const ROLES = {
    admin: 'ADMIN_ROLE',
    editor: 'EDITOR_ROLE',
    viewer: 'VIEWER_ROLE',
  } as const
  export type RoleKey = keyof typeof ROLES
  export type Role = (typeof ROLES)[RoleKey]
  ```

  Code then writes `ROLES.admin`, never `'ADMIN_ROLE'`, so a misspelling is a compile error instead of a branch that never runs. The guard for the boundary checks against `Object.values(ROLES)`. Text a person reads (UI copy, error and log messages, test names), import paths, SCSS module class references (`styles.card`), the result of `typeof` and the literal inside the constant's own declaration are exempt: they are copy or already typed, not identifiers.

- No dead code. Every export has an importer, every file is reachable from an entry point, every function, variable, parameter and type is read, and every dependency in `package.json` is imported. Delete what is unused instead of commenting it out or keeping it for later; git has it. oxlint's `no-unused-vars` catches the locals, and the `dead-code` target (knip, in `verify`, `affected` and the PR checks) catches unused exports, files and dependencies.
- `type` aliases, never `interface`, except where declaration merging requires one (the `.d.ts` augmentation of bun:test's `Matchers`). oxlint's `consistent-type-definitions` enforces it.
- Use `as const satisfies <Type>` to check a literal value against a type without widening it.
- Derive types from their single source of truth instead of writing a parallel shape by hand: `typeof` for values, `ReturnType` and `Parameters` for functions, indexed access for part of another type.
- Never use a non-null assertion (`!`) outside a test file; narrow the value or fail explicitly instead. oxlint fails on it everywhere but the test files.
- Never `@ts-ignore`. If a suppression is truly unavoidable, use `@ts-expect-error` with a reason on the same line.
- Validate untrusted data (route params, query strings, request bodies, fetch responses, file contents) with a type guard at the boundary. Code past the boundary trusts the narrowed type; it does not re-check. raven's guards live in `@raven/core`.

## Code style

- Never use `for`, `for...of` or `for...in` loops; reach for the array methods (`map`, `filter`, `reduce`, `flatMap` and the rest). Prefer `reduce` to accumulate.
- `!!value` for boolean conversion.
- Prefer optional chaining (`?.`), and always pair it with nullish coalescing (`??`) to supply a fallback.
- One object parameter instead of several positional ones, so argument order doesn't matter: `doSomething({ foo, bar, hello })`, never `doSomething(foo, bar, hello)`.
- In JSX, `&&` rather than a ternary with a `null` branch.
- Don't write comments that restate what the code already says. Comment only a non-obvious why: a workaround, a constraint, a gotcha.
- Return early with guard clauses instead of nesting; no `else` after a branch that returns.
- `const` by default, `let` only when reassignment is required, never `var`. oxlint's `prefer-const` and `no-var` enforce it.
- Don't mutate inputs or shared values. Prefer the non-mutating operations: spread, `toSorted`, `toReversed`, `with`.
- `??` for defaults, not `||`, unless coercing every falsy value is the actual intent.
- Never leave a promise floating: `await` it or handle its rejection explicitly. oxlint runs no `no-floating-promises` check here, so nothing catches it but you.
- Throw only `Error` instances or subclasses, never strings or plain objects.
- Named exports only. A config file a tool reads through a default export (`vite.config.ts`, `vitest.config.ts`) is exempt in its project's `.oxlintrc.json`.
- Name booleans as predicates: `is`, `has`, `should`, `can`.

## React

These apply to every React project: `@raven/web`, `@rookery/web`, `@luwin/web`, `@raven/ui` and the device app `@raven/app`. Raven's UI is `@raven/web`'s `src/desktop`.

- Global state lives in zustand, never in a React context. State that more than one component reads or writes is a store in the project's `src/stores/`, made with `create` (`apps/raven/web/src/stores/theme.ts`, `libs/raven/ui/src/stores/playerPrefs.ts`). A component reads it through a selector, `useTheme((state) => state.theme)`, so it re-renders only when its slice changes. Never write a `createContext` and a `*Provider` to pass state, a setter or a callback down the tree: the component that needs the value imports the store.
- State one component owns stays in `useState` or `useReducer`, and server data stays in TanStack Query. A store holds client state the tree shares, not a copy of an API response.
- The one exception is a provider a library requires: TanStack Query's `QueryClientProvider`, React Router's `RouterProvider`.

## CSS

These apply to the web apps, `@raven/web`, `@rookery/web` and `@luwin/web`, and to `@raven/ui`, whose styles both raven clients import. Each app has its own tokens, so "the app's `globals.scss`" means `libs/raven/ui/src/styles/globals.scss` for raven, `apps/rookery/web/src/styles/globals.scss` for rookery and `apps/luwin/web/src/styles/globals.scss` for luwin.

- No dead selectors. Every class in a `*.module.scss` is referenced from the component that imports it, and every rule in `globals.scss` and `elements.scss` matches an element some component renders. Delete a selector when its last use goes; a stale class in a module is dead code. The `dead-css` target (in `verify`, `affected` and the PR checks) fails on a module class no TSX reads.
- Component styles are SCSS modules (`*.module.scss`), imported through the `@/` alias, never a relative path. The `react-ts-css` editor extension flags aliased imports as unresolved; that is a tooling bug to fix in tooling, not a reason to relativize the import.
- Raven's shared styles live in `libs/raven/ui/src/styles/`; rookery's and luwin's remain in their web apps. The app's `globals.scss` holds the design tokens, resets and typographic primitives. raven also has `libs/raven/ui/src/styles/elements.scss`, the default look of each element, inside `:where()` so any class beats it. Everything else belongs in a component module.
- Containers drive layout: the container defines the child's available width and height, its padding, and the spacing between children; the children only care about their content. Moving a child to a different container may lay it out differently, because the container specifies the layout.
- Layout is CSS grid, with `gap` between items and padding on the container. Avoid margins for spacing at all cost. That includes prose: a rendered-markdown container is a grid too, its element margins stay zeroed, and `gap` sets the rhythm between blocks.
- No flex layouts, toolbars and inline rows included: they are grids too (`grid-auto-flow: column` for a run of items).
- In fixed regional layouts, place grid children with named `grid-template-areas` and `grid-area: <name>`, never positional line spans like `grid-area: 1 / -1`. Auto-placed collections (`repeat(auto-fill, ...)`, `grid-auto-flow`) are exempt, since dynamic children can't be named. For overlays, give several children the same named area.
- Reach for a semantic element (`nav`, `section`, `ul`, `button`) before a `div`. A `div` is a styling hook of last resort: give it a class, and style by class, never by `id`.
- Colors, fonts, font sizes, line heights, spacing, radii and the focus ring come from the tokens in the app's `globals.scss`: `--color-*`, `--font-*`, `--font-size-*`, `--line-*`, `--space-*`, `--radius-*`, `--focus-ring`. The names are unprefixed and the values differ per app (raven's text is `--color-bark`, rookery's is `--color-parchment`), so check the app's own file. Never hardcode a literal where a token exists; if none fits, extend the scale in that app's `globals.scss` instead of inlining a value. raven also has `--tracking-*` for letter spacing and `--ease-*` for motion curves; luwin has `--tracking-*` too, and rookery has neither yet.
- Responsive styles are desktop-first: `@media (max-width: ...)`. There is no shared breakpoints partial yet, so reuse the thresholds already in use (`30rem`, `40rem`, `48rem`, `64rem`) rather than inventing one. Every page works at 320px wide.
- Guard every animation, transition and `scroll-behavior: smooth` with `prefers-reduced-motion`: a component adds motion inside `@media (prefers-reduced-motion: no-preference)`. The `@media (prefers-reduced-motion: reduce)` block in each app's `globals.scss`, which cuts every transition and animation to 0.01ms, is a backstop, not the guard.
- `:global()` is an escape hatch, not a tool. Avoid it, and comment the why on the rare occasion it is unavoidable.
- Accessibility: semantic elements, a label on every control, a visible `:focus-visible` using `--focus-ring`.

## Structure

An Nx 23 monorepo over Bun workspaces (`apps/*/*`, `libs/*/*`, `scripts`). Projects have no `project.json`: Nx infers targets from each `package.json`'s scripts, whitelisted by its `nx.includedScripts`. A new script that should be a target goes in that list too.

Shared tool config lives at the root, so every project lints and compiles by the same rules:

- `tsconfig.base.json` holds the compiler options; `tooling/tsconfig/nest.json` and `tooling/tsconfig/react.json` add a server's or a web app's, `tooling/tsconfig/node.json` adds Node's types for Node code that is neither (`@raven/mpv`, the desktop's main process and preload), and `tooling/tsconfig/react-native.json` adds React Native's JSX and the TV fork's types for `@raven/app`. A project's `tsconfig.json` extends one and adds its `paths`, its `include` and whatever sets it apart (core's empty `types`).
- `tooling/oxlint/base.json` holds the lint rules, `nest.json` and `react.json` add a server's or a web app's, and `node.json` the Node environment for the rest (`@raven/mpv`, `@raven/desktop`). A project's `.oxlintrc.json` extends one and adds its ignores, its file overrides and whatever sets it apart.
- gale lints the SCSS, reading each styled project's `gale.json`. That extends `tooling/gale/recommended-scss.json`, a copy of the rules in `stylelint-config-recommended` 18.0.0 and `stylelint-config-recommended-scss` 17.0.1, because gale 0.2.5 can't load those packages, and then `tooling/gale/rules.json`, the repo's own SCSS rules. `tooling/web` holds the asset declarations and the bun test SCSS loader they share, plus `check-coverage.ts`: raven web's `test` target runs it after the tests and fails when total line or function coverage drops below the floors its `test:coverage` script names.
- oxfmt has no `extends`, so each project keeps its own `.oxfmtrc.json`; keep their options identical.
- `nx.json` lists `tsconfig.base.json` and `tooling/` as shared inputs, so a change there reruns every project's tasks.

| Project           | Path                  | What                                                                                                  |
| ----------------- | --------------------- | ----------------------------------------------------------------------------------------------------- |
| `@luwin/api`      | `apps/luwin/api`      | Python 3.12 package run through uv: agent, tools, chat, FastAPI, SQLite                               |
| `@raven/supabase` | `apps/raven/supabase` | Supabase Auth configuration, membership approval, migrations, local seed and database tests           |
| `@raven/server`   | `apps/raven/server`   | NestJS 12 on Fastify, SQLite (better-sqlite3), ffprobe/ffmpeg, vitest                                 |
| `@raven/web`      | `apps/raven/web`      | React 19, Vite 8, TanStack Query, zustand, SCSS modules, bun test + happy-dom                         |
| `@raven/core`     | `libs/raven/core`     | raven's shared core: API types and guards, API client, direct-play check                              |
| `@raven/ui`       | `libs/raven/ui`       | Shared React player, engine/services contracts, primitives and styles                                 |
| `@raven/mpv`      | `libs/raven/mpv`      | N-API addon over our pinned libmpv build: macOS video surface, typed async wrapper                    |
| `@raven/desktop`  | `apps/raven/desktop`  | Raven: Electron 44 and Forge, serving `@raven/web`, libmpv through `@raven/mpv`, Playwright e2e       |
| `@raven/app`      | `apps/raven/app`      | raven on iPhone, iPad, Apple TV and Android TV: Expo 58 on react-native-tvos, expo-router, jest-expo  |
| `@rookery/server` | `apps/rookery/server` | The suite's sign-in: NestJS 12 on Fastify, SQLite (better-sqlite3), vitest                            |
| `@rookery/web`    | `apps/rookery/web`    | rookery's login and logout pages: React 19, Vite 8, bun test + happy-dom                              |
| `@luwin/web`      | `apps/luwin/web`      | luwin's chat page, and the sandbox for testing its answers: React 19, Vite 8, TanStack Query, zustand |
| `@shared/server`  | `libs/shared/server`  | The servers' shared scaffolding: web app serving, SQLite migrations, env                              |
| `scripts`         | `scripts`             | Repo tooling; its Python is linted with luwin's pinned ruff and config                                |

Python projects declare `package.json` scripts that call uv (`uv run pytest -q`, `uv run ruff check .`); Nx runs them in the project's folder. There is no Python Nx plugin and no uv workspace.

`@shared/server` holds what raven's and rookery's servers both need: `serveWebApp` (the built web app and its SPA fallback), `compressResponses` (Brotli or gzip for JSON and text, SVG and HLS playlists included; never video, JPEG or PNG pictures, ranges or server-sent events), `openSqlite` (the `user_version` migration runner), `readListenConfig`, `wholeNumber` and `flag` for the environment, `readCookie` and `sameSecret`. A helper a second server would copy goes there; one only a single product uses stays in that product.

The TypeScript, code style and CSS rules above are shared by every product. Each product folder has its own `CLAUDE.md` with only what is specific to that product. Design specs for every product live in `docs/superpowers/specs/`.
