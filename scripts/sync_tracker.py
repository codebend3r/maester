#!/usr/bin/env python3
"""Push the catalog to GitHub Issues and render docs/roadmap.md from it.

Idempotent: labels and milestones are created or updated in place, and issues
are matched by the `[E0.1]`-style key in their title, so re-running never creates
a duplicate and leaves an unchanged issue alone. Stories are attached to their epic
as native sub-issues. Epic checklists are rendered ticked from the stories' issues,
and the roadmap ticks every epic and story whose issue is closed as completed.

    uv run python scripts/sync_tracker.py            # sync issues + write roadmap
    uv run python scripts/sync_tracker.py --doc-only  # only write the roadmap

Needs `gh` authenticated with the `repo` scope.
"""

import json
import sys

from catalog import AREA_LABELS, EPICS, MILESTONES, PRIORITIES, SIZES
from tracker import (
    REPO,
    ROADMAP_PATH,
    ROOT,
    by_key,
    epic_body,
    gh,
    is_closed,
    list_issues,
    render_roadmap,
)

PRIORITY_COLORS = {"P0": "B60205", "P1": "D93F0B", "P2": "FBCA04"}
SIZE_COLORS = {"S": "C5DEF5", "M": "7FB3E8", "L": "2E6BB8"}

LABELS = {
    "epic": ("5319E7", "A parent issue grouping stories"),
    "story": ("0E8A16", "A user story with acceptance criteria"),
    "bug": ("D73A4A", "Something is broken"),
    **{name: (PRIORITY_COLORS[name], desc) for name, desc in PRIORITIES.items()},
    **{f"size:{name}": (SIZE_COLORS[name], desc) for name, desc in SIZES.items()},
    **{f"area:{k}": ("BFDADC", v) for k, v in AREA_LABELS.items()},
}


def is_managed(label: str) -> bool:
    """A label the catalog sets, so a stale one comes off when the catalog changes."""
    return label in PRIORITIES or label.startswith(("size:", "area:"))


def label_changes(current: set[str], wanted: list[str]) -> tuple[list[str], list[str]]:
    """Labels to add, and managed labels to remove, so the issue carries exactly `wanted`.

    Labels the catalog doesn't manage (`bug`, or one set by hand) are left alone.
    """
    add = [label for label in wanted if label not in current]
    remove = sorted(label for label in current if is_managed(label) and label not in wanted)
    return add, remove


def api(path: str, method: str = "GET", **fields) -> object:
    args = ["api", path, "-X", method]
    for k, v in fields.items():
        args += ["-f" if isinstance(v, str) else "-F", f"{k}={v}"]
    out = gh(*args)
    return json.loads(out) if out else None


def sync_labels() -> None:
    existing = {label["name"] for label in api(f"repos/{REPO}/labels?per_page=100")}
    for name, (color, desc) in LABELS.items():
        if name in existing:
            api(f"repos/{REPO}/labels/{name}", "PATCH", color=color, description=desc)
        else:
            api(f"repos/{REPO}/labels", "POST", name=name, color=color, description=desc)
    print(f"labels: {len(LABELS)} synced")


def sync_milestones() -> dict[str, str]:
    """Milestone key to its full title; gh issue commands take the title, not the number."""
    existing = {
        m["title"]: m["number"] for m in api(f"repos/{REPO}/milestones?state=all&per_page=100")
    }
    numbers = {}
    for key, title, desc in MILESTONES:
        full = f"{key} {title}"
        if full in existing:
            api(f"repos/{REPO}/milestones/{existing[full]}", "PATCH", description=desc)
        else:
            api(f"repos/{REPO}/milestones", "POST", title=full, description=desc)
        numbers[key] = full
    print(f"milestones: {len(numbers)} synced")
    return numbers


def story_body(epic: dict, story: dict) -> str:
    lines = [
        f"**Epic:** {epic['key']} {epic['title']}",
        "",
        "## User story",
        "",
        story["story"],
        "",
        "## Acceptance criteria",
        "",
    ]
    lines += [f"- [ ] {c}" for c in story["criteria"]]
    return "\n".join(lines)


def edit_args(issue: dict, title: str, body: str, labels: list[str], milestone: str) -> list[str]:
    """The `gh issue edit` arguments that bring an issue in line, or none when it already is."""
    add, remove = label_changes({label["name"] for label in issue["labels"]}, labels)
    current_milestone = (issue["milestone"] or {}).get("title")
    if (issue["title"], issue["body"], current_milestone) == (title, body, milestone) and not (
        add or remove
    ):
        return []
    args = ["issue", "edit", str(issue["number"]), "-R", REPO, "--title", title, "--body", body]
    args += ["--milestone", milestone]
    if add:
        args += ["--add-label", ",".join(add)]
    if remove:
        args += ["--remove-label", ",".join(remove)]
    return args


def upsert_issue(
    key: str, title: str, body: str, labels: list[str], milestone: str, found: dict
) -> dict:
    full_title = f"[{key}] {title}"
    if issue := found.get(key):
        if args := edit_args(issue, full_title, body, labels, milestone):
            gh(*args)
        return issue
    out = gh(
        "issue",
        "create",
        "-R",
        REPO,
        "--title",
        full_title,
        "--body",
        body,
        "--label",
        ",".join(labels),
        "--milestone",
        milestone,
    )
    number = int(out.rsplit("/", 1)[-1])
    node = json.loads(gh("issue", "view", str(number), "-R", REPO, "--json", "id"))["id"]
    return {"number": number, "id": node, "title": full_title}


def link_sub_issue(parent_id: str, child_id: str) -> None:
    query = """
    mutation($parent: ID!, $child: ID!) {
      addSubIssue(input: {issueId: $parent, subIssueId: $child, replaceParent: true}) { issue { number } }
    }"""
    gh(
        "api",
        "graphql",
        "-H",
        "GraphQL-Features: sub_issues",
        "-f",
        f"query={query}",
        "-f",
        f"parent={parent_id}",
        "-f",
        f"child={child_id}",
    )


def sync_issues(milestones: dict[str, str]) -> None:
    found = by_key(list_issues())
    closed = {key for key, issue in found.items() if is_closed(issue)}
    for epic in EPICS:
        ms = milestones[epic["milestone"]]
        area = f"area:{epic['area']}"
        body = epic_body(epic, closed)
        parent = upsert_issue(epic["key"], epic["title"], body, ["epic", area], ms, found)
        for story in epic["stories"]:
            labels = ["story", area, story["priority"], f"size:{story['size']}"]
            body = story_body(epic, story)
            child = upsert_issue(story["key"], story["title"], body, labels, ms, found)
            link_sub_issue(parent["id"], child["id"])
        print(
            f"{epic['key']} {epic['title']}: #{parent['number']} + {len(epic['stories'])} stories"
        )


def write_roadmap() -> None:
    ROADMAP_PATH.write_text(render_roadmap(list_issues()))
    print(f"wrote {ROADMAP_PATH.relative_to(ROOT)}")


def main() -> None:
    if "--doc-only" not in sys.argv:
        sync_labels()
        sync_issues(sync_milestones())
    write_roadmap()


if __name__ == "__main__":
    main()
