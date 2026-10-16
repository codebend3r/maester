# @raven/ui

Raven's shared player and HTML playback engine, extracted without changing browser behavior. The library does not import the web app, its API singleton or its library pages. Hosts supply an `Engine` and `PlayerServicesProvider`, inside their own React Router and TanStack Query providers. Import `@raven/ui/styles.css` once for tokens, element defaults and component styles.

## Build and consume

Consumers resolve package exports from `dist`, never an alias to this project's source. Nx builds `@raven/core` before UI, and UI before web. From the repo root:

```sh
bun install
bunx nx run @raven/ui:build
bunx nx run @raven/ui:test
bun run dev:raven
```

The build cleans output, bundles ESM and CSS with Vite, emits declarations with TypeScript, then rewrites declaration aliases with tsc-alias. `dev` watches the library bundle; `dev:raven` runs that watcher alongside the server and web dev servers. Generated JavaScript is build output only; source and configuration are TypeScript. Hosts may pass `progress.duration` and `hostActions` in the player services; the web passes neither.

Peer dependencies are React 19.3.0, React DOM 19.3.0, React Router DOM 7.18.4, TanStack React Query 5.103.1 and zustand 5.0.15, supplied by the host. `@raven/core` is a workspace dependency. All stay external to the bundle, including React's JSX runtime, so hosts share one React, router, cache and preference store.

The root entry exports Player, PlayerServicesProvider, engine/services/state types and the primitives, player preferences, keyboard, query and token helpers still needed by web. Controls and ICON_NAMES support the existing design page. `@raven/ui/canPlay` exposes the one built capability module used inside Player and by web's playback notes. `@raven/ui/designTokens` derives the design page's tokens from the shared SCSS. `@raven/ui/styles.css` is the stylesheet; its separate build entry avoids leaking SCSS source aliases into public declarations.

## Tests

Bun uses happy-dom and the shared `tooling/web` SCSS loader. Tests beside the player and helpers exercise UI source with a local API fixture, PlayerServices and query/router harness. Web keeps the browser-host clipboard, progress/history and built-player integration tests. Web mocks the public capability and design-token modules, not UI source paths. The three player query keys are defined once here and reused by web, preserving cache invalidation.

UI and web each enforce at least 96% total line and 88% function coverage. Test harnesses, tooling and built dependency output are excluded, not production player functions. Hardware, native playback and desktop-specific UI are outside this extraction.
