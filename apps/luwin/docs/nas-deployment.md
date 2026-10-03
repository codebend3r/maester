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

## Moving to luwin (once)

Until the rename, the assistant ran as `maester` from `apps/maester/`, with its state in `apps/maester/.env` and `apps/maester/maester-data/maester.db`. luwin reads `.env` and `luwin-data/` beside `apps/luwin/docker-compose.yml`, its model and database variables are `LUWIN_*`, and an old `MAESTER_*` name stops it on boot. On first open it renames `maester.db`, with its `-wal` and `-shm` files, to `luwin.db`. Move the rest once, with the old container down so the SQLite file is quiet. The chained move stops at the first step that fails, before anything starts; fix what it printed and run its remaining steps by hand:

```bash
scripts/deploy-nas.sh
ssh crivas@192.168.50.2
cd /volume1/docker/maester/apps
sudo -n /usr/local/bin/docker exec maester python -c "import sqlite3; print(sqlite3.connect('file:/data/maester.db?mode=ro', uri=True).execute('select count(*) from users').fetchone()[0])"
(cd maester && sudo -n /usr/local/bin/docker compose down) \
  && mkdir -p ~/maester-backup && cp -p maester/maester-data/maester.db* ~/maester-backup/ \
  && mv maester/.env luwin/.env \
  && mv maester/maester-data luwin/luwin-data \
  && sed -i -e 's/^MAESTER_/LUWIN_/' -e 's#^LUWIN_DB_PATH=/data/maester.db$#LUWIN_DB_PATH=/data/luwin.db#' luwin/.env \
  && test -f luwin/luwin-data/maester.db \
  && grep -n 'LUWIN_' luwin/.env
```

Check the `LUWIN_` lines it printed. If `.env` set `MAESTER_DB_PATH` to anything other than `/data/maester.db`, fix `LUWIN_DB_PATH` by hand now. Then start luwin and compare the counts:

```bash
cd /volume1/docker/maester/apps/luwin && sudo -n /usr/local/bin/docker compose up -d --build
for i in $(seq 1 30); do curl -fs http://127.0.0.1:8020/health && echo && break; sleep 2; done
sudo -n /usr/local/bin/docker exec luwin python -c "import sqlite3; print(sqlite3.connect('file:/data/luwin.db?mode=ro', uri=True).execute('select count(*) from users').fetchone()[0])"
```

The loop prints the health line once luwin answers; if it prints nothing within a minute, luwin did not come up. The two counts match. Both queries open the database read-only, so a wrong path fails instead of leaving an empty file behind.

If luwin will not come up healthy, put maester back; its old files and image are still on the NAS:

```bash
cd /volume1/docker/maester/apps
(cd luwin && sudo -n /usr/local/bin/docker compose down)
mv luwin/.env maester/.env && mv luwin/luwin-data maester/maester-data
for f in maester/maester-data/luwin.db*; do mv "$f" "maester/maester-data/maester.db${f##*luwin.db}"; done
sed -i -e 's/^LUWIN_/MAESTER_/' -e 's#^MAESTER_DB_PATH=/data/luwin.db$#MAESTER_DB_PATH=/data/maester.db#' maester/.env
(cd maester && sudo -n /usr/local/bin/docker compose up -d)
```

The sync never deletes, so `apps/maester/`, and `apps/weirwood/` and `libs/weirwood/` from raven's rename, stay behind. Once luwin has been healthy for a few days, remove them, `~/maester-backup` and the old image: `rm -rf /volume1/docker/maester/apps/maester /volume1/docker/maester/apps/weirwood /volume1/docker/maester/libs/weirwood ~/maester-backup && sudo -n /usr/local/bin/docker image rm maester`.

## Media mounts

`apps/luwin/docker-compose.yml` bind-mounts the media shares read-only so the file health check can probe a path exactly as Sonarr or Radarr reports it, and `MEDIA_ROOTS` in `.env` lists the same mounts: the check reads nothing outside them. If an arr reports its paths under other names (a `/data/media` inside its container), map them with `MEDIA_PATH_MAP`. If a share is not present on Meleys, remove its line rather than leaving a broken mount; the health check reports "unreadable" for paths it cannot see and never deletes on that basis.

## Performance data

The image carries Ookla's speedtest CLI (pinned in `apps/luwin/Dockerfile`), and `SPEEDTEST_HOST` names the NAS the container runs on (`meleys`), where `speed_test` measures the servers' shared internet connection. Leave it empty to turn speed tests off.

CPU and memory per NAS come from the fleet monitor (wizteros' `fleet-monitor`, `http://192.168.50.2:8010` on the LAN), read with a static bearer token (`FLEET_MONITOR_TOKEN`) from `/fleet/cpu` and `/fleet/memory`, and each NAS's health for the weekly report from `/fleet`. The monitor has no guard for such a token yet, so leave `FLEET_MONITOR_URL` empty until wizteros adds one that opens only those three routes. Until then, server load comes from Tautulli alone, and the NAS report covers the media volumes only.

## Scheduled jobs

The digest, the stalled-download sweeper, the nightly free-space sample and the weekly NAS report run inside the container. `TZ` sets the time zone their times are in (the image carries `tzdata`); a bad `TZ`, `DIGEST_TIME` or `NAS_REPORT_DAY` stops the container on boot, naming the variable. A digest or report missed while the container was down runs when it comes back, if it's within six hours.

## Data

`apps/luwin/luwin-data/luwin.db` is the only state. Back it up with the rest of `/volume1/docker`.
