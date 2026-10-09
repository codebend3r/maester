# NAS deployment

luwin runs as one container on **Meleys** (`192.168.50.2`). The whole repo is copied to `/volume1/docker/maester`, next to the `stripe-bridge` project from wizteros, and luwin's compose project runs from `apps/luwin/` inside it, because the image builds from the repo root. From there it reaches both arr stacks over the LAN by their host-published ports.

## First boot

1. Mount the `docker` share (Finder, Cmd+K, `smb://192.168.50.2`).
2. `scripts/deploy-nas.sh` copies the repo to `/Volumes/docker/maester`.
3. On the NAS, create `/volume1/docker/maester/apps/luwin/.env` from `apps/luwin/.env.example`. URLs are as the NAS sees them, so Meleys services can use `127.0.0.1` and Vermithor services use `192.168.50.3`.
4. Build and start:

   ```bash
   ssh crivas@192.168.50.2 'cd /volume1/docker/maester/apps/luwin && sudo -n /usr/local/bin/docker compose up -d --build'
   ```

   Note the literal `/usr/local/bin/docker`: docker is not on the non-interactive `PATH`.

5. Check `curl http://192.168.50.2:8020/health` and `docker logs luwin`.

## Updates

`scripts/deploy-nas.sh` again, then the same `compose up -d --build`. The `.env` and `luwin-data/` directory on the NAS are never touched by the sync.

## Sign-in through rookery

luwin trusts rookery's sign-in and won't boot without it, so rookery runs on Meleys first (`apps/rookery/README.md`). Then add three variables to `apps/luwin/.env` and restart luwin:

- `ROOKERY_URL`: rookery on the LAN, as the NAS sees it, such as `http://127.0.0.1:8030`
- `ROOKERY_PUBLIC_URL`: where browsers sign in, rookery's public address, such as `https://rookery.maester.example.com`
- `ROOKERY_SERVICE_TOKEN`: the same value as rookery's `SERVICE_TOKEN`

The first start after this change rebuilds luwin's `users` table (migration `002`); it was empty, since nothing has signed in yet, and every other table stays as it was. `curl -i http://127.0.0.1:8020/api/me` should then answer 401 with rookery's login page as `sign_in`.

luwin's public address must sit under rookery's `COOKIE_DOMAIN` (`luwin.maester.example.com` beside `rookery.maester.example.com`), so the browser sends it the session cookie, and must be in rookery's `APP_ORIGINS`, so sign-in can send the browser back.

## Moving to luwin (once)

Until the rename, the assistant ran as `maester` from `apps/maester/`, with its settings in `apps/maester/.env` and its database in `apps/maester/maester-data/`. luwin starts fresh: its database lives in a new `luwin-data/`, nothing in the old one carries over, and it refuses to open a database from before. Its model and database variables are `LUWIN_*`, and an old `MAESTER_*` name stops it on boot. Move the settings once, with the old container down. The old folder stays as it is, so going back is one command:

```bash
scripts/deploy-nas.sh
ssh crivas@192.168.50.2
cd /volume1/docker/maester/apps
(cd maester && sudo -n /usr/local/bin/docker compose down) \
  && cp -p maester/.env luwin/.env \
  && sed -i -e 's/^MAESTER_/LUWIN_/' -e '/^LUWIN_DB_PATH=/d' luwin/.env \
  && grep -n 'LUWIN_' luwin/.env
```

The chain stops at the first step that fails, before anything starts. `LUWIN_DB_PATH` is dropped so the default, `/data/luwin.db`, applies. The copied `.env` still holds the old chat bot's token and ids: luwin ignores them, but delete those lines from `luwin/.env` so the token doesn't linger. Then start luwin:

```bash
cd /volume1/docker/maester/apps/luwin && sudo -n /usr/local/bin/docker compose up -d --build
for i in $(seq 1 30); do curl -fs http://127.0.0.1:8020/health && echo && break; sleep 2; done
sudo -n /usr/local/bin/docker logs luwin 2>&1 | tail -5
```

The loop prints the health line once luwin answers; if it prints nothing within a minute, luwin did not come up, and its log says why. Compose creates `luwin-data/` the way it first created `maester-data/`.

To go back to maester, whose files and image are untouched:

```bash
cd /volume1/docker/maester/apps
(cd luwin && sudo -n /usr/local/bin/docker compose down) && (cd maester && sudo -n /usr/local/bin/docker compose up -d)
```

The sync never deletes, so `apps/maester/` (with its `maester-data/`), and `apps/weirwood/` and `libs/weirwood/` from raven's rename, stay behind. Once luwin has run well for a few days, remove them and the old image: `rm -rf /volume1/docker/maester/apps/maester /volume1/docker/maester/apps/weirwood /volume1/docker/maester/libs/weirwood && sudo -n /usr/local/bin/docker image rm maester`.

## Media mounts

`apps/luwin/docker-compose.yml` bind-mounts the media shares read-only so the file health check can probe a path exactly as Sonarr or Radarr reports it, and `MEDIA_ROOTS` in `.env` lists the same mounts: the check reads nothing outside them. If an arr reports its paths under other names (a `/data/media` inside its container), map them with `MEDIA_PATH_MAP`. If a share is not present on Meleys, remove its line rather than leaving a broken mount; the health check reports "unreadable" for paths it cannot see and never deletes on that basis.

## Performance data

The image carries Ookla's speedtest CLI (pinned in `apps/luwin/Dockerfile`), and `SPEEDTEST_HOST` names the NAS the container runs on (`meleys`), where `speed_test` measures the servers' shared internet connection. Leave it empty to turn speed tests off.

CPU and memory per NAS come from the fleet monitor (wizteros' `fleet-monitor`, `http://192.168.50.2:8010` on the LAN), read with a static bearer token (`FLEET_MONITOR_TOKEN`) from `/fleet/cpu` and `/fleet/memory`, and each NAS's health for the weekly report from `/fleet`. The monitor has no guard for such a token yet, so leave `FLEET_MONITOR_URL` empty until wizteros adds one that opens only those three routes. Until then, server load comes from Tautulli alone, and the NAS report covers the media volumes only.

## Scheduled jobs

The digest, the stalled-download sweeper, the nightly free-space sample and the weekly NAS report run inside the container. `TZ` sets the time zone their times are in (the image carries `tzdata`); a bad `TZ`, `DIGEST_TIME` or `NAS_REPORT_DAY` stops the container on boot, naming the variable. A digest or report missed while the container was down runs when it comes back, if it's within six hours.

## Data

`apps/luwin/luwin-data/luwin.db` is the only state. Back it up with the rest of `/volume1/docker`.
