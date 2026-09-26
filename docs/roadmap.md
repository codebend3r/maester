# Roadmap

Generated from `scripts/catalog.py` by `scripts/sync_tracker.py`. Edit the catalog, not this file.

Board: https://github.com/users/codebend3r/projects ("maester roadmap")

## Milestones

| Milestone | Goal | Epics |
|---|---|---|
| **M1** Walking skeleton | A friend can DM the bot and it answers using a read-only tool. | E0 Foundation, E1 Agent core, E2 Chat and identity |
| **M2** Requests | Friends request movies and shows in 1080p and 4K through the bot. | E3 Requests |
| **M3** Troubleshooting | Playback problems are diagnosed before anything is replaced; lag is explained with live data. | E4 Playback issues, E5 Performance diagnostics |
| **M4** Admin and onboarding | Approvals, digests and Wizarr invites run from chat. | E6 Admin console, E7 Onboarding and accounts |
| **M5** Engagement | The bot gives friends reasons to come back. | E8 Engagement |

## Epics

### E0 Foundation (M1) [#1](https://github.com/codebend3r/maester/issues/1)

Project skeleton, configuration, service clients, storage, container and CI. Everything later epics build on.

| # | Story | Size | Priority | Issue |
|---|---|---|---|---|
| E0.1 | Project scaffold | S | P0 | [#2](https://github.com/codebend3r/maester/issues/2) |
| E0.2 | Config and secrets loading | S | P0 | [#3](https://github.com/codebend3r/maester/issues/3) |
| E0.3 | Service instance registry | M | P0 | [#4](https://github.com/codebend3r/maester/issues/4) |
| E0.4 | API clients with fakes | L | P0 | [#5](https://github.com/codebend3r/maester/issues/5) |
| E0.5 | SQLite store and audit log | M | P0 | [#6](https://github.com/codebend3r/maester/issues/6) |
| E0.6 | Container, compose and NAS deploy | M | P0 | [#7](https://github.com/codebend3r/maester/issues/7) |
| E0.7 | CI on pull requests | S | P1 | [#8](https://github.com/codebend3r/maester/issues/8) |

### E1 Agent core (M1) [#9](https://github.com/codebend3r/maester/issues/9)

The Claude tool-use loop, the tool registry with permission tiers, memory, guardrails and an eval harness.

| # | Story | Size | Priority | Issue |
|---|---|---|---|---|
| E1.1 | Tool-use loop on the Messages API | M | P0 | [#10](https://github.com/codebend3r/maester/issues/10) |
| E1.2 | Tool registry with permission tiers | M | P0 | [#11](https://github.com/codebend3r/maester/issues/11) |
| E1.3 | Per-user conversation memory | S | P1 | [#12](https://github.com/codebend3r/maester/issues/12) |
| E1.4 | Guardrails for destructive tools | M | P0 | [#13](https://github.com/codebend3r/maester/issues/13) |
| E1.5 | Eval harness | M | P1 | [#14](https://github.com/codebend3r/maester/issues/14) |

### E2 Chat and identity (M1) [#15](https://github.com/codebend3r/maester/issues/15)

The Discord surface, account linking to Plex/Seerr users, roles to tiers, and interactive buttons.

| # | Story | Size | Priority | Issue |
|---|---|---|---|---|
| E2.1 | Discord bot with DMs and a requests channel | M | P0 | [#16](https://github.com/codebend3r/maester/issues/16) |
| E2.2 | Account linking | M | P0 | [#17](https://github.com/codebend3r/maester/issues/17) |
| E2.3 | Discord roles map to tiers | S | P1 | [#18](https://github.com/codebend3r/maester/issues/18) |
| E2.4 | Confirmation and choice buttons | M | P0 | [#19](https://github.com/codebend3r/maester/issues/19) |
| E2.5 | Unlinked-user flow | S | P1 | [#20](https://github.com/codebend3r/maester/issues/20) |

### E3 Requests (M2) [#21](https://github.com/codebend3r/maester/issues/21)

Searching, disambiguating and requesting movies and shows in 1080p and 4K through Seerr, with status and ready notifications.

| # | Story | Size | Priority | Issue |
|---|---|---|---|---|
| E3.1 | Search and disambiguate titles | M | P0 | [#22](https://github.com/codebend3r/maester/issues/22) |
| E3.2 | Request a movie in 1080p | M | P0 | [#23](https://github.com/codebend3r/maester/issues/23) |
| E3.3 | Request in 4K with admin approval | M | P0 | [#24](https://github.com/codebend3r/maester/issues/24) |
| E3.4 | TV requests by season | M | P0 | [#25](https://github.com/codebend3r/maester/issues/25) |
| E3.5 | Availability lookup with a Plex deep link | S | P0 | [#26](https://github.com/codebend3r/maester/issues/26) |
| E3.6 | Request status with an ETA | M | P1 | [#27](https://github.com/codebend3r/maester/issues/27) |
| E3.7 | Ready notifications | M | P1 | [#28](https://github.com/codebend3r/maester/issues/28) |
| E3.8 | Collection requests | S | P2 | [#29](https://github.com/codebend3r/maester/issues/29) |
| E3.9 | Dub-aware anime requests | M | P1 | [#30](https://github.com/codebend3r/maester/issues/30) |

### E4 Playback issues (M3) [#31](https://github.com/codebend3r/maester/issues/31)

Diagnose "it won't play" reports before touching anything, then replace the file through a guarded flow when it is really broken.

| # | Story | Size | Priority | Issue |
|---|---|---|---|---|
| E4.1 | Identify the item being reported | S | P0 | [#32](https://github.com/codebend3r/maester/issues/32) |
| E4.2 | Diagnose the client side first | L | P0 | [#33](https://github.com/codebend3r/maester/issues/33) |
| E4.3 | File health check | M | P0 | [#34](https://github.com/codebend3r/maester/issues/34) |
| E4.4 | Open a Seerr issue for every report | S | P1 | [#35](https://github.com/codebend3r/maester/issues/35) |
| E4.5 | Guarded replace flow | L | P0 | [#36](https://github.com/codebend3r/maester/issues/36) |
| E4.6 | Replacement guardrails | S | P0 | [#37](https://github.com/codebend3r/maester/issues/37) |
| E4.7 | Wrong-file reports | M | P1 | [#38](https://github.com/codebend3r/maester/issues/38) |
| E4.8 | Subtitle and audio issue reports | M | P2 | [#39](https://github.com/codebend3r/maester/issues/39) |
| E4.9 | Missing-episode reports | S | P1 | [#40](https://github.com/codebend3r/maester/issues/40) |

### E5 Performance diagnostics (M3) [#41](https://github.com/codebend3r/maester/issues/41)

Explain lag and choppy playback with live session, server and network data, and give a concrete fix.

| # | Story | Size | Priority | Issue |
|---|---|---|---|---|
| E5.1 | Live session report with relay detection | M | P0 | [#42](https://github.com/codebend3r/maester/issues/42) |
| E5.2 | Server load per host | M | P0 | [#43](https://github.com/codebend3r/maester/issues/43) |
| E5.3 | On-demand speed test | S | P1 | [#44](https://github.com/codebend3r/maester/issues/44) |
| E5.4 | Advice generation | M | P0 | [#45](https://github.com/codebend3r/maester/issues/45) |
| E5.5 | Service health checks | S | P1 | [#46](https://github.com/codebend3r/maester/issues/46) |
| E5.6 | Version picking for slow connections | S | P2 | [#47](https://github.com/codebend3r/maester/issues/47) |

### E6 Admin console (M4) [#48](https://github.com/codebend3r/maester/issues/48)

Everything the admin does from chat: approvals, digests, limits, stalled downloads, log reading and NAS health.

| # | Story | Size | Priority | Issue |
|---|---|---|---|---|
| E6.1 | Approval queue with buttons | M | P0 | [#49](https://github.com/codebend3r/maester/issues/49) |
| E6.2 | Daily digest | M | P1 | [#50](https://github.com/codebend3r/maester/issues/50) |
| E6.3 | Admin commands | S | P0 | [#51](https://github.com/codebend3r/maester/issues/51) |
| E6.4 | Storage-aware limits | S | P1 | [#52](https://github.com/codebend3r/maester/issues/52) |
| E6.5 | Stalled download sweeper | M | P1 | [#53](https://github.com/codebend3r/maester/issues/53) |
| E6.6 | Disk usage forecast | S | P2 | [#54](https://github.com/codebend3r/maester/issues/54) |
| E6.7 | Bad-release detection | S | P2 | [#55](https://github.com/codebend3r/maester/issues/55) |
| E6.8 | Download log reading | M | P1 | [#56](https://github.com/codebend3r/maester/issues/56) |
| E6.9 | Maintenance windows | S | P2 | [#57](https://github.com/codebend3r/maester/issues/57) |
| E6.10 | Weekly NAS health report | M | P2 | [#58](https://github.com/codebend3r/maester/issues/58) |

### E7 Onboarding and accounts (M4) [#59](https://github.com/codebend3r/maester/issues/59)

Wizarr invites, device setup help, access changes and expiry reminders.

| # | Story | Size | Priority | Issue |
|---|---|---|---|---|
| E7.1 | Invite requests through Wizarr | M | P0 | [#60](https://github.com/codebend3r/maester/issues/60) |
| E7.2 | Device setup help | S | P1 | [#61](https://github.com/codebend3r/maester/issues/61) |
| E7.3 | Library and 4K access requests | S | P1 | [#62](https://github.com/codebend3r/maester/issues/62) |
| E7.4 | Access expiry reminders | S | P2 | [#63](https://github.com/codebend3r/maester/issues/63) |

### E8 Engagement (M5) [#64](https://github.com/codebend3r/maester/issues/64)

Recommendations, digests, stats and social features that give friends reasons to come back.

| # | Story | Size | Priority | Issue |
|---|---|---|---|---|
| E8.1 | Personal recommendations | M | P1 | [#65](https://github.com/codebend3r/maester/issues/65) |
| E8.2 | Weekly newly-added post | S | P1 | [#66](https://github.com/codebend3r/maester/issues/66) |
| E8.3 | Plex Wrapped | M | P2 | [#67](https://github.com/codebend3r/maester/issues/67) |
| E8.4 | Auto-request from the Plex watchlist | M | P2 | [#68](https://github.com/codebend3r/maester/issues/68) |
| E8.5 | Cleanup suggestions | S | P2 | [#69](https://github.com/codebend3r/maester/issues/69) |
| E8.6 | What's new for me | S | P2 | [#70](https://github.com/codebend3r/maester/issues/70) |
| E8.7 | Resume nudges | S | P2 | [#71](https://github.com/codebend3r/maester/issues/71) |
| E8.8 | Group picks | M | P2 | [#72](https://github.com/codebend3r/maester/issues/72) |
| E8.9 | Quiet hours and notification preferences | S | P1 | [#73](https://github.com/codebend3r/maester/issues/73) |
| E8.10 | Server Oscars | S | P2 | [#74](https://github.com/codebend3r/maester/issues/74) |
| E8.11 | Shared watchlists | M | P2 | [#75](https://github.com/codebend3r/maester/issues/75) |
