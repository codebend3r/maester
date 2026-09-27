#!/usr/bin/env python3
"""Push the catalog to GitHub Issues and render docs/roadmap.md from it.

Idempotent: labels and milestones are created or updated in place, and issues
are matched by their `[E0.1]`-style title prefix so re-running never creates a
duplicate. Stories are attached to their epic as native sub-issues. The roadmap
ticks every epic and story whose issue is closed as completed.

    uv run python scripts/sync_tracker.py            # sync issues + write roadmap
    uv run python scripts/sync_tracker.py --doc-only  # write roadmap from the live issue map

Needs `gh` authenticated with the `repo` scope.
"""

import json
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from catalog import AREA_LABELS, EPICS, MILESTONES

REPO = "codebend3r/maester"
ROOT = Path(__file__).resolve().parent.parent
MAP_PATH = ROOT / "docs" / "issue-map.json"
ROADMAP_PATH = ROOT / "docs" / "roadmap.md"

LABELS = {
    "epic": ("5319E7", "A parent issue grouping stories"),
    "story": ("0E8A16", "A user story with acceptance criteria"),
    "bug": ("D73A4A", "Something is broken"),
    "P0": ("B60205", "Must have for the milestone"),
    "P1": ("D93F0B", "Should have"),
    "P2": ("FBCA04", "Nice to have"),
    "size:S": ("C5DEF5", "Under half a day"),
    "size:M": ("7FB3E8", "A day or two"),
    "size:L": ("2E6BB8", "Several days, consider splitting"),
    **{f"area:{k}": ("BFDADC", v) for k, v in AREA_LABELS.items()},
}


def gh(*args: str, input: str | None = None) -> str:
    r = subprocess.run(["gh", *args], capture_output=True, text=True, input=input)
    if r.returncode != 0:
        raise RuntimeError(f"gh {' '.join(args)}\n{r.stderr}")
    return r.stdout.strip()


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


def existing_issues() -> dict[str, dict]:
    """Issues keyed by their `[E0.1]` / `[E0]` title prefix."""
    out = gh(
        "issue", "list", "-R", REPO, "--state", "all", "--limit", "500", "--json", "number,title,id"
    )
    found = {}
    for issue in json.loads(out):
        title = issue["title"]
        if title.startswith("[") and "]" in title:
            found[title[1 : title.index("]")]] = issue
    return found


def epic_body(epic: dict) -> str:
    lines = [epic["summary"], "", f"**Milestone:** {epic['milestone']}", "", "## Stories", ""]
    lines += [f"- [ ] {s['title']}" for s in epic["stories"]]
    lines += ["", "_Stories are attached as sub-issues; the checklist above is a summary._"]
    return "\n".join(lines)


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


def upsert_issue(
    key: str, title: str, body: str, labels: list[str], milestone: str, found: dict
) -> dict:
    full_title = f"[{key}] {title}"
    if key in found:
        n = found[key]["number"]
        gh(
            "issue",
            "edit",
            str(n),
            "-R",
            REPO,
            "--title",
            full_title,
            "--body",
            body,
            "--milestone",
            milestone,
            "--add-label",
            ",".join(labels),
        )
        return found[key]
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


def sync_issues(milestones: dict[str, str]) -> dict:
    found = existing_issues()
    issue_map = {}
    for epic in EPICS:
        ms = milestones[epic["milestone"]]
        parent = upsert_issue(
            epic["key"], epic["title"], epic_body(epic), ["epic", f"area:{epic['area']}"], ms, found
        )
        issue_map[epic["key"]] = parent["number"]
        for i, story in enumerate(epic["stories"], 1):
            key = f"{epic['key']}.{i}"
            labels = ["story", f"area:{epic['area']}", story["priority"], f"size:{story['size']}"]
            child = upsert_issue(key, story["title"], story_body(epic, story), labels, ms, found)
            issue_map[key] = child["number"]
            link_sub_issue(parent["id"], child["id"])
        print(
            f"{epic['key']} {epic['title']}: #{parent['number']} + {len(epic['stories'])} stories"
        )
    MAP_PATH.write_text(json.dumps(issue_map, indent=2) + "\n")
    return issue_map


def load_issue_map() -> dict:
    return json.loads(MAP_PATH.read_text()) if MAP_PATH.exists() else {}


def is_done(issue: dict) -> bool:
    """Closed as completed. An issue closed as not planned is not done."""
    return issue["state"] == "CLOSED" and issue.get("stateReason") in (None, "", "COMPLETED")


def completed_issues() -> set[int]:
    out = gh(
        "issue", "list", "-R", REPO, "--state", "closed", "--limit", "500",
        "--json", "number,state,stateReason",
    )  # fmt: skip
    return {issue["number"] for issue in json.loads(out) if is_done(issue)}


def render_roadmap(issue_map: dict, done: set[int]) -> str:
    """The roadmap doc, with a box ticked for each issue number in `done`."""

    def link(key: str) -> str:
        n = issue_map.get(key)
        return f"[#{n}](https://github.com/{REPO}/issues/{n})" if n else "(not synced)"

    def box(key: str) -> str:
        return "[x]" if issue_map.get(key) in done else "[ ]"

    out = [
        "# Roadmap",
        "",
        "Generated from `scripts/catalog.py` by `scripts/sync_tracker.py`. Edit the catalog, not this file.",
        "A box is ticked once its issue is closed as completed; `scripts/sync_board.py` keeps them current.",
        "",
        f'Board: https://github.com/users/{REPO.split("/")[0]}/projects ("maester roadmap")',
        "",
        "## Milestones",
        "",
    ]
    for key, title, desc in MILESTONES:
        out += [f"### {key} {title}", "", desc, ""]
        out += [
            f"- {box(e['key'])} {e['key']} {e['title']} {link(e['key'])}"
            for e in EPICS
            if e["milestone"] == key
        ]
        out.append("")
    out += ["## Epics", ""]
    for epic in EPICS:
        out += [
            f"### {epic['key']} {epic['title']} ({epic['milestone']}) {link(epic['key'])}",
            "",
            epic["summary"],
            "",
        ]
        for i, s in enumerate(epic["stories"], 1):
            key = f"{epic['key']}.{i}"
            out.append(
                f"- {box(key)} {key} {s['title']} · {s['size']} · {s['priority']} · {link(key)}"
            )
        out.append("")
    return "\n".join(out)


def write_roadmap(issue_map: dict) -> None:
    ROADMAP_PATH.write_text(render_roadmap(issue_map, completed_issues()))
    print(f"wrote {ROADMAP_PATH.relative_to(ROOT)}")


def main() -> None:
    if "--doc-only" in sys.argv:
        write_roadmap(load_issue_map())
        return
    sync_labels()
    milestones = sync_milestones()
    issue_map = sync_issues(milestones)
    write_roadmap(issue_map)


if __name__ == "__main__":
    main()
