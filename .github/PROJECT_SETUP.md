# Project board setup

The "maester roadmap" board is a GitHub Projects (v2) user project linked to this repo. It is created once with `scripts/setup_project.sh` (needs `gh auth refresh -s project`). Fields:

| Field    | Type          | Options                        |
| -------- | ------------- | ------------------------------ |
| Status   | single select | Todo, In progress, Done        |
| Epic     | single select | E0 to E8                       |
| Phase    | single select | M1 to M5                       |
| Size     | single select | S, M, L                        |
| Priority | single select | P0, P1, P2                     |

Views to add in the UI: a board grouped by Status, a table grouped by Epic, and a roadmap grouped by Phase.
