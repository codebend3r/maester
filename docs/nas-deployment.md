# NAS deployment

maester runs as one container on **Meleys** (`192.168.50.2`) at `/volume1/docker/maester`, next to the `stripe-bridge` project from wizteros. From there it reaches both arr stacks over the LAN by their host-published ports.

## First boot

1. Mount the `docker` share (Finder, Cmd+K, `smb://192.168.50.2`).
2. `scripts/deploy-nas.sh` copies the repo to `/Volumes/docker/maester`.
3. On the NAS, create `/volume1/docker/maester/.env` from `.env.example`. URLs are as the NAS sees them, so Meleys services can use `127.0.0.1` and Vermithor services use `192.168.50.3`.
4. Build and start:

   ```bash
   ssh crivas@192.168.50.2 'cd /volume1/docker/maester && sudo -n /usr/local/bin/docker compose up -d --build'
   ```

   Note the literal `/usr/local/bin/docker`: docker is not on the non-interactive `PATH`.

5. Check `curl http://192.168.50.2:8020/health` and `docker logs maester`.

## Updates

`scripts/deploy-nas.sh` again, then the same `compose up -d --build`. The `.env` and `maester-data/` directory on the NAS are never touched by the sync.

## Media mounts

`docker-compose.yml` bind-mounts the media shares read-only so the file health check can probe a path exactly as Sonarr or Radarr reports it, and `MEDIA_ROOTS` in `.env` lists the same mounts: the check reads nothing outside them. If an arr reports its paths under other names (a `/data/media` inside its container), map them with `MEDIA_PATH_MAP`. If a share is not present on Meleys, remove its line rather than leaving a broken mount; the health check reports "unreadable" for paths it cannot see and never deletes on that basis.

## Performance data

The image carries Ookla's speedtest CLI (pinned in the `Dockerfile`), and `SPEEDTEST_HOST` names the NAS the container runs on (`meleys`), where `speed_test` measures the servers' shared internet connection. Leave it empty to turn speed tests off.

CPU and memory per NAS come from the fleet monitor (wizteros' `fleet-monitor`, `http://192.168.50.2:8010` on the LAN), read with a static bearer token (`FLEET_MONITOR_TOKEN`) from `/fleet/cpu` and `/fleet/memory` only. The monitor has no guard for such a token yet, so leave `FLEET_MONITOR_URL` empty until wizteros adds one that opens only those two routes. Until then, server load comes from Tautulli alone.

## Data

`maester-data/maester.db` is the only state. Back it up with the rest of `/volume1/docker`.
