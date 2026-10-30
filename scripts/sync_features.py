"""Give every feature its own GitHub Project and put its pull requests and stories on it.

    python3 scripts/sync_features.py              # open PRs and those merged in the last 5 days
    python3 scripts/sync_features.py --days 14    # look further back
    python3 scripts/sync_features.py --pr 310     # one PR, as the feature-projects workflow runs it
    python3 scripts/sync_features.py --dry-run    # print what would change

`features.py` says which feature a pull request belongs to. A feature's project is found by
title, made (and linked to the repo) when there is none, and reopened when it was closed and
has work in flight again. Each pull request is an item with Status In Progress while open and
Done once merged; a pull request closed without merging is left out. Every step is idempotent,
so running it twice changes nothing the second time.

Needs `gh` signed in with the `project` scope: `gh auth refresh -s project` locally, the
PROJECTS_TOKEN secret in CI.
"""

import argparse
import json
import re
import subprocess
from datetime import date, timedelta

from features import FEATURES

OWNER = "codebend3r"
REPO = f"{OWNER}/maester"
PR_FIELDS = "number,title,url,body,state,headRefName,mergedAt,projectItems"
FEATURE_LINE = re.compile(r"^Feature:\s*(.+?)\s*$", re.M | re.I)
TITLE_PREFIX = re.compile(r"^MAE:\s*")
OPEN = "In Progress"
MERGED = "Done"


class RateLimited(RuntimeError):
    """GitHub's API budget, shared by everything signed in as this user, is used up."""


def gh(*args: str) -> str:
    r = subprocess.run(["gh", *args], capture_output=True, text=True)
    if r.returncode != 0:
        error = RateLimited if "rate limit" in r.stderr.lower() else RuntimeError
        raise error(f"gh {' '.join(args)}\n{r.stderr}")
    return r.stdout.strip()


def gh_json(*args: str):
    return json.loads(gh(*args))


def project_json(*args: str):
    return gh_json("project", *args, "--format", "json")


def feature_for(pr: dict) -> dict:
    """The feature a pull request belongs to: named in its body, else by branch, else its own."""
    if named := FEATURE_LINE.search(pr["body"] or ""):
        wanted = named[1].casefold()
        match = next((f for f in FEATURES if f["name"].casefold() == wanted), None)
        return match or {"name": named[1], "summary": "", "branches": (), "stories": []}
    branch = pr["headRefName"]
    match = next((f for f in FEATURES if branch.startswith(f["branches"])), None)
    if match:
        return match
    title = TITLE_PREFIX.sub("", pr["title"])
    return {
        "name": title[:1].upper() + title[1:],
        "summary": "",
        "branches": (),
        "stories": [],
        # Named after the pull request, so its project follows the title when that changes.
        "own": True,
    }


def status_for(pr: dict) -> str | None:
    """In Progress while open, Done once merged, nothing for a PR closed without merging."""
    if pr["state"] == "OPEN":
        return OPEN
    return MERGED if pr["mergedAt"] else None


def recent_prs(days: int) -> list[dict]:
    since = (date.today() - timedelta(days=days)).isoformat()
    common = ("pr", "list", "-R", REPO, "--limit", "200", "--json", PR_FIELDS)
    opened = gh_json(*common, "--state", "open")
    merged = gh_json(*common, "--state", "merged", "--search", f"merged:>={since}")
    return opened + merged


class Projects:
    """The owner's projects by title, and each one's ids, Status options and items, read once."""

    def __init__(self, dry_run: bool):
        self.dry_run = dry_run
        listed = project_json("list", "--owner", OWNER, "--closed", "--limit", "200")
        self.by_title = {p["title"]: p for p in listed["projects"]}
        self.details: dict[int, dict] = {}

    def holder_of(self, pr: dict) -> dict | None:
        """The project already holding `pr`: its own project under an earlier title.

        Read from the PR's `projectItems`, never by listing every project's items, which costs
        enough GraphQL points to spend the token owner's hourly limit in a few runs.
        """
        return next(
            (
                self.by_title[item["title"]]
                for item in pr["projectItems"]
                if item["title"] in self.by_title
                and not self.by_title[item["title"]].get("planned")
            ),
            None,
        )

    def rename(self, project: dict, title: str) -> dict:
        print(f"~ project {project['title']!r} → {title!r}")
        if not self.dry_run:
            gh("project", "edit", str(project["number"]), "--owner", OWNER, "--title", title)
        del self.by_title[project["title"]]
        self.by_title[title] = project | {"title": title}
        return self.by_title[title]

    def ensure(self, feature: dict, pr: dict | None = None) -> dict | None:
        """The feature's project, made or reopened if need be. None on a dry run that would make it.

        A pull request's own project is named after its title, so when the title changes the
        project already holding the pull request is renamed, never a second one made.
        """
        project = self.by_title.get(feature["name"])
        if project is None and feature.get("own") and pr:
            held = self.holder_of(pr)
            project = self.rename(held, feature["name"]) if held else None
        if project and project.get("planned"):
            return None
        if project is None:
            print(f"+ project {feature['name']!r}")
            if self.dry_run:
                self.by_title[feature["name"]] = {"planned": True}
                return None
            project = project_json("create", "--owner", OWNER, "--title", feature["name"])
            gh("project", "link", str(project["number"]), "--owner", OWNER, "--repo", REPO)
            if feature["summary"]:
                gh("project", "edit", str(project["number"]), "--owner", OWNER,
                   "--description", feature["summary"])  # fmt: skip
            self.by_title[feature["name"]] = project
        elif project.get("closed"):
            print(f"↺ reopen project {feature['name']!r}")
            if not self.dry_run:
                gh("project", "close", str(project["number"]), "--owner", OWNER, "--undo")
            project["closed"] = False
        return project

    def detail(self, number: int) -> dict:
        if number not in self.details:
            fields = project_json("field-list", str(number), "--owner", OWNER)["fields"]
            status = next(f for f in fields if f["name"] == "Status")
            items = project_json("item-list", str(number), "--owner", OWNER, "--limit", "500")
            self.details[number] = {
                "status": status,
                "options": {o["name"]: o["id"] for o in status["options"]},
                "items": {self.item_key(i): i for i in items["items"]},
            }
        return self.details[number]

    @staticmethod
    def item_key(item: dict) -> str:
        content = item.get("content") or {}
        return content.get("url") or f"draft:{item.get('title') or content.get('title')}"

    def place(self, project: dict, key: str, label: str, status: str, add) -> None:
        """Put one item on the project with the given Status, adding it with `add` if missing."""
        number = project["number"]
        info = self.detail(number)
        item = info["items"].get(key)
        if item and item.get("status") == status:
            return
        print(f"{'+' if item is None else '~'} {project['title']}: {label} → {status}")
        if self.dry_run:
            return
        item = item or add()
        info["items"][key] = item | {"status": status}
        gh("project", "item-edit", "--id", item["id"], "--project-id", project["id"],
           "--field-id", info["status"]["id"],
           "--single-select-option-id", info["options"][status])  # fmt: skip


def sync_pr(projects: Projects, pr: dict) -> None:
    status = status_for(pr)
    if status is None:
        return
    feature = feature_for(pr)
    project = projects.ensure(feature, pr)
    if project is None:
        print(f"+ {feature['name']}: #{pr['number']} → {status}")
        return

    def add() -> dict:
        return project_json("item-add", str(project["number"]), "--owner", OWNER,
                       "--url", pr["url"])  # fmt: skip

    projects.place(project, pr["url"], f"#{pr['number']}", status, add)


def sync_stories(projects: Projects) -> None:
    for feature in FEATURES:
        for story in feature["stories"]:
            project = projects.ensure(feature)
            if project is None:
                print(f"+ {feature['name']}: draft {story['title']!r} → {story['status']}")
                continue
            key = f"draft:{story['title']}"
            if key in projects.detail(project["number"])["items"]:
                continue

            def add(story=story, project=project) -> dict:
                return project_json("item-create", str(project["number"]), "--owner", OWNER,
                               "--title", story["title"], "--body", story["body"])  # fmt: skip

            projects.place(project, key, f"draft {story['title']!r}", story["status"], add)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--pr", type=int, help="sync only this pull request")
    parser.add_argument("--days", type=int, default=5, help="how far back merged PRs reach")
    parser.add_argument("--dry-run", action="store_true", help="print the changes, make none")
    args = parser.parse_args()

    try:
        projects = Projects(args.dry_run)
        if args.pr:
            sync_pr(projects, gh_json("pr", "view", str(args.pr), "-R", REPO, "--json", PR_FIELDS))
            return
        for pr in recent_prs(args.days):
            sync_pr(projects, pr)
        sync_stories(projects)
    except RateLimited as error:
        # Not the pull request's fault, and every step is idempotent: the next run catches up.
        print(
            f"::warning::GitHub's API rate limit is used up, so the projects are not synced this run.\n{error}"
        )
        return
    print("✓ feature projects match the pull requests")


if __name__ == "__main__":
    main()
