# NAS deployment

sparrow runs as one container on **Meleys** (`192.168.50.2`). The whole repo is copied to `/volume1/docker/maester`, next to the `stripe-bridge` project from wizteros, and sparrow's compose project runs from `apps/sparrow/` inside it, because the image builds from the repo root. From there it reaches both arr stacks over the LAN by their host-published ports.

## First boot

1. Mount the `docker` share (Finder, Cmd+K, `smb://192.168.50.2`).
2. `scripts/deploy-nas.sh` copies the repo to `/Volumes/docker/maester`.
3. On the NAS, create `/volume1/docker/maester/apps/sparrow/.env` from `apps/sparrow/.env.example`. URLs are as the NAS sees them, so Meleys services can use `127.0.0.1` and Vermithor services use `192.168.50.3`.
4. Build and start:

   ```bash
   ssh crivas@192.168.50.2 'cd /volume1/docker/maester/apps/sparrow && sudo -n /usr/local/bin/docker compose up -d --build'
   ```

   Note the literal `/usr/local/bin/docker`: docker is not on the non-interactive `PATH`.

5. Check `curl http://192.168.50.2:8020/health` and `docker logs sparrow`.

## Updates

`scripts/deploy-nas.sh` again, then the same `compose up -d --build`. The `.env` and `luwin-data/` directory on the NAS are never touched by the sync.

## Sign-in through rookery

sparrow trusts rookery's sign-in and won't boot without it, so rookery runs on Meleys first (`apps/rookery/README.md`). Then add three variables to `apps/sparrow/.env` and restart sparrow:

- `ROOKERY_URL`: rookery on the LAN, as the NAS sees it, such as `http://127.0.0.1:8030`
- `ROOKERY_PUBLIC_URL`: where browsers sign in, rookery's public address, such as `https://rookery.maester.example.com`
- `ROOKERY_SERVICE_TOKEN`: the same value as rookery's `SERVICE_TOKEN`

The first start after this change rebuilds sparrow's `users` table (migration `002`); it was empty, since nothing has signed in yet, and every other table stays as it was. `curl -i http://127.0.0.1:8020/api/me` should then answer 401 with rookery's login page as `sign_in`.

sparrow's public address must sit under rookery's `COOKIE_DOMAIN` (`sparrow.maester.example.com` beside `rookery.maester.example.com`), so the browser sends it the session cookie, and must be in rookery's `APP_ORIGINS`, so sign-in can send the browser back.

## Moving to sparrow (once)

The assistant previously ran as `luwin` from `apps/luwin/`. Stop that compose
project before starting sparrow, then copy its settings and rename the three
`LUWIN_*` variables. sparrow keeps the same database and schema: its compose
file mounts `apps/luwin/luwin-data/`, and the default database filename stays
`luwin.db`. Do not remove that directory. If `LUWIN_DB_PATH` points elsewhere,
keep its value under `SPARROW_DB_PATH` and preserve the matching mount.

```bash
scripts/deploy-nas.sh
ssh crivas@192.168.50.2
cd /volume1/docker/maester/apps
(cd luwin && sudo -n /usr/local/bin/docker compose down) \
  && cp -p luwin/.env sparrow/.env \
  && sed -i -e 's/^LUWIN_MODEL=/SPARROW_MODEL=/' \
    -e 's/^LUWIN_EFFORT=/SPARROW_EFFORT=/' \
    -e 's/^LUWIN_DB_PATH=/SPARROW_DB_PATH=/' sparrow/.env
```

The chain stops at the first step that fails, before anything starts. Update
reverse proxy targets from container `luwin` to `sparrow`. If changing its public
hostname, update rookery's `APP_ORIGINS` together. Then start sparrow:

```bash
cd /volume1/docker/maester/apps/sparrow && sudo -n /usr/local/bin/docker compose up -d --build
for i in $(seq 1 30); do curl -fs http://127.0.0.1:8020/health && echo && break; sleep 2; done
sudo -n /usr/local/bin/docker logs sparrow 2>&1 | tail -5
```

The loop prints the health line once sparrow answers; if it prints nothing
within a minute, its log says why. Confirm existing users and conversations are
present before accepting the deployment.

To go back to luwin, whose files, settings and image are untouched:

```bash
cd /volume1/docker/maester/apps
(cd sparrow && sudo -n /usr/local/bin/docker compose down) && (cd luwin && sudo -n /usr/local/bin/docker compose up -d)
```

The sync never deletes old product folders. Keep `apps/luwin/luwin-data/`: it
is still sparrow's live store, not a leftover to clean up.

## Media mounts

`apps/sparrow/docker-compose.yml` bind-mounts the media shares read-only so the file health check can probe a path exactly as Sonarr or Radarr reports it, and `MEDIA_ROOTS` in `.env` lists the same mounts: the check reads nothing outside them. If an arr reports its paths under other names (a `/data/media` inside its container), map them with `MEDIA_PATH_MAP`. If a share is not present on Meleys, remove its line rather than leaving a broken mount; the health check reports "unreadable" for paths it cannot see and never deletes on that basis.

## Performance data

The image carries Ookla's speedtest CLI (pinned in `apps/sparrow/Dockerfile`), and `SPEEDTEST_HOST` names the NAS the container runs on (`meleys`), where `speed_test` measures the servers' shared internet connection. Leave it empty to turn speed tests off.

CPU and memory per NAS come from the fleet monitor (wizteros' `fleet-monitor`, `http://192.168.50.2:8010` on the LAN), read with a static bearer token (`FLEET_MONITOR_TOKEN`) from `/fleet/cpu` and `/fleet/memory`, and each NAS's health for the weekly report from `/fleet`. The monitor has no guard for such a token yet, so leave `FLEET_MONITOR_URL` empty until wizteros adds one that opens only those three routes. Until then, server load comes from Tautulli alone, and the NAS report covers the media volumes only.

## Scheduled jobs

The digest, the stalled-download sweeper, the nightly free-space sample and the weekly NAS report run inside the container. `TZ` sets the time zone their times are in (the image carries `tzdata`); a bad `TZ`, `DIGEST_TIME` or `NAS_REPORT_DAY` stops the container on boot, naming the variable. A digest or report missed while the container was down runs when it comes back, if it's within six hours.

## Data

`apps/luwin/luwin-data/luwin.db` is the default state file. Back it up with the rest of `/volume1/docker`.
