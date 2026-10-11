# rookery

The suite's sign-in. A friend signs in once, with their Plex account, and is signed in to luwin (and later raven) for 30 days. rookery says who someone is; each app decides what they may do there.

The design is in [`docs/superpowers/specs/2026-10-09-shared-sign-in-design.md`](../../docs/superpowers/specs/2026-10-09-shared-sign-in-design.md).

## How sign-in works

1. An app with no session sends the browser to `<rookery>/login?return_to=<where it was>`.
2. "Sign in with Plex" opens a PIN at plex.tv and sends the browser, in the same tab, to Plex to approve it.
3. Plex sends the browser back to `/auth/plex/callback`. rookery fetches the Plex account with the PIN's token, drops the token, finds or creates the user, sets the `maester_session` cookie and returns to `return_to`.
4. The app reads `maester_session` and asks rookery's `/internal/session` who it belongs to.

Signing out is `<rookery>/logout?return_to=<url>`, which ends the session and clears the cookie for every app at once.

Anyone with a Plex account can sign in. Apps refuse people who should not be there: luwin tells a stranger to ask for an invite.

rookery keeps no Plex token. Only the SHA-256 of each session's token is stored, so the database alone hands out no sessions.

## Run it with Docker

```bash
cp .env.example .env    # fill in PUBLIC_URL, SERVICE_TOKEN, APP_ORIGINS, COOKIE_DOMAIN
docker compose up -d --build
```

The compose file builds from the repo root and keeps the database in `./data`. The container listens on 8030 and answers `/health`.

## Hosting

Serve rookery and luwin on subdomains of one parent domain dedicated to the suite, such as `rookery.maester.example.com` and `luwin.maester.example.com`, with `COOKIE_DOMAIN=maester.example.com`. The browser sends the session cookie to every host under that domain, so Seerr, Wizarr or anything else on a public subdomain must sit outside it.

Behind the proxy or tunnel:

- Forward rookery's hostname to port 8030 and luwin's to luwin.
- Do not expose `/internal/*`. Apps reach it on the LAN (luwin's `ROOKERY_URL`); the service token guards it either way.
- `PUBLIC_URL` is rookery's public https address, and `APP_ORIGINS` lists luwin's.

luwin needs the matching settings: `ROOKERY_URL` (rookery's LAN address, e.g. `http://192.168.50.2:8030`), `ROOKERY_PUBLIC_URL` (the same as rookery's `PUBLIC_URL`) and `ROOKERY_SERVICE_TOKEN` (the same as `SERVICE_TOKEN`).

## Develop

From the repo root:

```bash
bun run dev:rookery     # the server on 8030 and the web app on http://localhost:5180
```

Put a `.env` in `apps/rookery/` with `PUBLIC_URL=http://localhost:5180`, a `SERVICE_TOKEN`, and no `COOKIE_DOMAIN`. Cookies are not scoped by port, so luwin on another localhost port sees the session too. Over plain http the cookies drop `Secure`.

## Layout

| Path                        | What                                                       |
| --------------------------- | ---------------------------------------------------------- |
| `server/src/auth/`          | The sign-in: start, callback, sign-out, `/api/me`, cookies |
| `server/src/internal/`      | `/internal/session`, for the suite's other apps            |
| `server/src/plex/plexTv.ts` | plex.tv's PIN flow and account lookup                      |
| `server/src/sessions/`      | Sessions by token hash, and who a token belongs to         |
| `server/src/users/`         | Users and their logins (Plex today; more providers later)  |
| `server/src/db/database.ts` | The SQLite file and its migrations                         |
| `web/src/pages/`            | `/login`, `/logout` and `/`                                |

## Configuration

| Variable        | Default  | What                                                                                  |
| --------------- | -------- | ------------------------------------------------------------------------------------- |
| `PUBLIC_URL`    | required | rookery's public origin, for Plex's redirect and the Secure flag                      |
| `SERVICE_TOKEN` | required | The bearer token apps present to `/internal/session`                                  |
| `APP_ORIGINS`   | none     | Comma-separated origins `return_to` may point at                                      |
| `COOKIE_DOMAIN` | none     | The parent domain `maester_session` is shared across; none keeps it on rookery's host |
| `PORT`          | `8030`   | The port to listen on                                                                 |
| `DATA_DIR`      | `./data` | Where `rookery.db` lives (`/config` in Docker)                                        |
| `WEB_DIR`       | none     | The built web app to serve (`/app/web` in Docker)                                     |

A missing required variable stops rookery on boot, naming it.

## Not there yet

- raven does not use the sign-in yet.
- Email or passkey logins, an account page, signed-in devices.
- Access management: invites and access requests stay in luwin.
