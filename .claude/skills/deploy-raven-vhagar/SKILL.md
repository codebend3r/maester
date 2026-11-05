---
name: deploy-raven-vhagar
description: >-
  Use when deploying raven to Vhagar, the NAS it runs on: "deploy to vhagar", "deploy raven", "put this build on the NAS", "is vhagar on the latest", "roll vhagar back", "make raven public", "turn on remote access", "take raven off the internet", or after a merge to main that changed raven. Covers the GHCR path that update.sh follows, the hand-built image when GHCR is not an option, Remote Access (the port forward and DSM reverse proxy that make raven public), how to run the root steps without a root shell, and how to check what is running.
---

# Deploy raven to Vhagar

raven runs on Vhagar (`192.168.50.6`, the NAS with the Intel GPU) from `/volume1/docker/raven`: `docker-compose.yml` (a copy of `apps/raven/docker-compose.vhagar.yml`), `update.sh` (a copy of `apps/raven/vhagar-update.sh`), `.env` with the TMDB and OMDb keys, `data/` with the index, and `backups/`.

Every merge to `main` publishes `ghcr.io/codebend3r/raven:latest`, `:<version>` (the merge's build, `X.Y.Z.N`, which raven's side menu shows) and `:<full commit sha>`. DSM's Task Scheduler runs `update.sh` as root every five minutes; it pulls `latest`, and when that is not the image raven runs, stops raven, copies `data/raven.db*` to `backups/<stamp>/`, and starts the new image. So after a merge, Vhagar follows on its own within about ten minutes.

## Facts that cost a round trip each

- `ssh vhagar` lands as `crivas`, who cannot talk to the docker socket, and `sudo -n` fails. The `synology-nas-ssh` skill's script runs root steps with the password from the Keychain: `~/.claude/skills/synology-nas-ssh/scripts/nas sudo vhagar '<command>'` and `... docker vhagar <args>`. Plain `ssh vhagar sudo ...` hangs on the prompt.
- Vhagar's Docker Compose is 2.20.1. It cannot read `env_file: [{ path, required: false }]`, so the Vhagar compose uses plain `env_file: [.env]`, and `update.sh` touches an empty `.env` when none exists. Keep the real `.env` there; never overwrite it.
- Files under `/volume1/docker/raven` are owned by `crivas`, so staging a file is `ssh vhagar 'cat > /volume1/docker/raven/<name>' < <local file>`. `scp` does not work on these boxes.
- The DSM task is `Raven update`, id 2. `$nas sudo vhagar '/usr/syno/bin/synoschedtask --get id=2'` must say `Repeat every [5] min (s) until [23]:[55]`. It once said `until [0]:[30]`, so Vhagar updated only just after midnight and every merge looked undeployed. The fix, if it comes back, is `repeat min=5` and `last work hour=23` in `/usr/syno/etc/synoschedule.d/root/2.task`, then `/usr/syno/bin/synoschedtask --sync`, or the same in DSM's Task Scheduler.
- `nas docker vhagar` takes one docker subcommand per call: `nas docker vhagar 'ps'`, not a chain with `;`.

## Check what is running

```bash
nas=~/.claude/skills/synology-nas-ssh/scripts/nas
curl -s http://192.168.50.6:8484/api/health
$nas docker vhagar 'inspect --format {{.Image}} raven'
$nas docker vhagar 'image inspect --format {{.RepoDigests}} ghcr.io/codebend3r/raven:latest'
ssh vhagar 'tail -n 20 /volume1/docker/raven/update.log'
$nas sudo vhagar '/usr/syno/bin/synoschedtask --get id=2 | head -16'
```

An `update.log` full of `✗ update failed on line <n>`, where line n is the `compose pull` (`grep -n 'compose pull' apps/raven/vhagar-update.sh`), means the pull is failing: either the compose points at an image that is not on GHCR (a hand-loaded tag), or the GHCR package is private. Check the manifest without credentials:

```bash
token=$(curl -s 'https://ghcr.io/token?scope=repository:codebend3r/raven:pull&service=ghcr.io' | python3 -c 'import sys,json;print(json.load(sys.stdin)["token"])')
curl -s -o /dev/null -w '%{http_code}\n' -H "Authorization: Bearer $token" \
  -H 'Accept: application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json' \
  https://ghcr.io/v2/codebend3r/raven/manifests/latest
```

`200` means the normal path works.

## Deploy the current main (the normal path)

1. Confirm the main smoke test published: `gh run list --workflow "Main smoke test" --limit 3` shows success for the merge, and the manifest check above answers `200`.
2. Put the repo's compose and script in place, in case either changed:
   ```bash
   ssh vhagar 'cat > /volume1/docker/raven/docker-compose.yml' < apps/raven/docker-compose.vhagar.yml
   ssh vhagar 'cat > /volume1/docker/raven/update.sh' < apps/raven/vhagar-update.sh
   ssh vhagar 'chmod 755 /volume1/docker/raven/update.sh'
   ```
3. Run the update now rather than waiting for the task:
   ```bash
   $nas sudo vhagar 'bash /volume1/docker/raven/update.sh; tail -n 3 /volume1/docker/raven/update.log'
   ```
   A line `✓ raven runs <id>; the index from before is in backups/<stamp>` is success. A second run exits without logging.
4. Verify: `curl -s http://192.168.50.6:8484/api/health` answers `"status":"ok"` with `"tmdb":"ok"`, and `inspect` shows the `ghcr.io/codebend3r/raven` image.

## Deploy a branch build (when GHCR is not an option)

Vhagar's docker has no buildx, so the image is built on the Mac (Docker Desktop running) and loaded there. The DSM task would put `latest` back on its next run, so the compose must point at the local tag for as long as the branch build should stay.

```bash
docker buildx build --builder desktop-linux --platform linux/amd64 -f apps/raven/Dockerfile -t raven:<branch> --load .
docker save raven:<branch> | gzip -1 | ssh vhagar 'cat > /volume1/docker/raven/raven-image.tar.gz'
sed 's#image: ghcr.io/codebend3r/raven:latest#image: raven:<branch>#' apps/raven/docker-compose.vhagar.yml | ssh vhagar 'cat > /volume1/docker/raven/docker-compose.yml'
$nas sudo vhagar 'cd /volume1/docker/raven && docker compose stop raven && mkdir -p backups/$(date +%Y%m%d-%H%M%S) && cp -p data/raven.db* backups/$(date +%Y%m%d-%H%M%S)/ ; docker load -i raven-image.tar.gz && docker compose up -d raven'
```

To go back to following `main`, redo step 2 of the normal path and run `update.sh`. Delete `raven-image.tar.gz` and `docker image rm raven:<branch>` afterwards; neither is cleaned up by the task.

## Public through Remote Access

raven is public the way Plex is: the router forwards one public port to DSM's reverse proxy, which terminates TLS for a DDNS hostname and proxies to `localhost:8484`. Admin's Remote Access section holds the hostname and the ports and says whether raven is "Fully accessible outside your network" (README, "Remote access"; the design is `docs/superpowers/specs/2026-11-04-raven-remote-access-design.md`). Netlify's copy of the web app proxies `/api` to the public origin through its `RAVEN_API_ORIGIN`.

Going public is the user's call, every time: it puts every unlocked library on the internet. The router, DDNS, certificate and reverse proxy steps are the user's to do in DSM and the router; never do them from here. Before it, `.env` needs `ADMIN_PASSWORD` (check with `ssh vhagar "grep -c '^ADMIN_PASSWORD=.' /volume1/docker/raven/.env"`) unless accounts are `ready`, or the admin lock holds for the owner too. Check from the Mac once it is set up:

```bash
curl -s https://<name>.synology.me:<port>/api/health
```

To take raven off the internet: untick Enable in Admin, Remote Access, and remove the router's port forward.

A box that still runs the old Funnel sidecar (`raven-tailscale`, from before Remote Access) is cleaned up once Remote Access answers and Netlify's `RAVEN_API_ORIGIN` points at the public origin: `$nas sudo vhagar 'cd /volume1/docker/raven && docker stop raven-tailscale && docker rm raven-tailscale'`, then `ssh vhagar 'rm -rf /volume1/docker/raven/funnel /volume1/docker/raven/tailscale'`, take `TS_AUTHKEY` out of `.env`, and stage the new compose file and `update.sh` (step 2 above). Ask the user before each of these.

## Roll back

Set `image:` in `/volume1/docker/raven/docker-compose.yml` to `ghcr.io/codebend3r/raven:<version>` (`0.5.3.4`, as the side menu and the GitHub Releases name it) or `:<full commit sha>` of the build to go back to, run `update.sh`, and put `latest` back when done. The index from before each update sits in `backups/<stamp>/`; with raven stopped, copy its files back into `data/`.

## Do not

- Do not edit `update.sh` on Vhagar to get a root shell or to skip the pull; change `apps/raven/vhagar-update.sh` in the repo and copy it over.
- Do not force the image through `docker compose pull` by hand with credentials; the package is public and must stay pullable without them, since the task runs as root with none.
- Do not leave the compose pointing at a local tag once the branch has merged: the task will log a failed pull every five minutes.
