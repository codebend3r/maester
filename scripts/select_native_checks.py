"""Select the native jobs a commit affects with Nx: a pull request against its base (`NATIVE_BASE`), a push to main against the last green ancestor."""

import json
import os
import subprocess
from pathlib import Path

GROUPS = ("app", "music", "desktop")
SHARED_FILES = {"nx.json", "package.json", "bun.lock", "tsconfig.base.json"}


def output(*command: str) -> str:
    return subprocess.check_output(command, text=True).strip()


def successful_base(runs: list[dict], head: str) -> str | None:
    for run in runs:
        sha = run["head_sha"]
        if sha == head:
            continue
        if (
            subprocess.run(
                ["git", "merge-base", "--is-ancestor", sha, head], check=False
            ).returncode
            == 0
        ):
            return sha
    return None


def select_groups(projects: set[str], files: list[str]) -> dict[str, bool]:
    if any(
        file in SHARED_FILES or file.startswith((".github/", "scripts/", "tooling/"))
        for file in files
    ):
        return dict.fromkeys(GROUPS, True)
    # Fixture sources and the desktop's web build are not package import dependencies.
    has_fixture_changes = "@raven/server" in projects
    return {
        "app": "@raven/app" in projects or has_fixture_changes,
        "music": "@raven/music" in projects or has_fixture_changes,
        "desktop": bool(projects & {"@raven/desktop", "@raven/mpv", "@raven/web"})
        or has_fixture_changes,
    }


def main() -> None:
    head = os.environ["GITHUB_SHA"]
    # A pull request names its base; a push to main finds its last green ancestor.
    base = os.environ.get("NATIVE_BASE") or None
    if base is None and os.environ["GITHUB_EVENT_NAME"] != "workflow_dispatch":
        repository = os.environ["GITHUB_REPOSITORY"]
        runs = json.loads(
            output(
                "gh",
                "api",
                f"repos/{repository}/actions/workflows/main-native-checks.yml/runs"
                "?branch=main&event=push&status=success&per_page=100",
            )
        )["workflow_runs"]
        base = successful_base(runs, head)
    groups = dict.fromkeys(GROUPS, True)
    if base:
        projects = set(
            json.loads(
                output(
                    "bunx",
                    "nx",
                    "show",
                    "projects",
                    "--affected",
                    f"--base={base}",
                    f"--head={head}",
                    "--json",
                )
            )
        )
        files = output("git", "diff", "--name-only", base, head).splitlines()
        groups = select_groups(projects, files)
    print(f"Native check base: {base or 'full run (manual or no successful ancestor)'}")
    print(json.dumps(groups))
    with Path(os.environ["GITHUB_OUTPUT"]).open("a") as destination:
        for group, enabled in groups.items():
            destination.write(f"{group}={str(enabled).lower()}\n")


if __name__ == "__main__":
    main()
