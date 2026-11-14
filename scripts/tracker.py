"""What the tracker scripts share: the repo, `gh`, the issues, and what the catalog renders.

`sync_tracker.py` pushes the catalog to the issues, `sync_board.py` keeps the board in
line with them, and `sync_features.py` shares the repo and `gh`. Both read the issues through `list_issues`, find a catalog entry's issue by
the `[E0.1]` key in its title, and render epic bodies and the roadmap with the functions
here, so the two scripts never disagree about what an issue or a checklist should say.
"""

import json
import re
import subprocess
from collections.abc import Iterable, Mapping
from pathlib import Path
from typing import TypedDict

from catalog import EPICS, MILESTONES, PRIORITIES, SIZES, Epic

OWNER = "codebend3r"
REPO = f"{OWNER}/maester"
BOARD_TITLE = "maester roadmap"
ROOT = Path(__file__).resolve().parent.parent
ROADMAP_PATH = ROOT / "docs" / "roadmap.md"

ISSUE_FIELDS = "number,title,id,url,body,state,stateReason,labels,milestone"
KEY = re.compile(r"^\[([^\]]+)\]")
TICK = re.compile(r"^- \[[ xX]\] ", re.M)


class Label(TypedDict):
    name: str


class MilestoneRef(TypedDict):
    title: str


class Issue(TypedDict):
    """An issue as `list_issues` reads it (`ISSUE_FIELDS`)."""

    number: int
    title: str
    id: str
    url: str
    body: str
    state: str
    stateReason: str | None
    labels: list[Label]
    milestone: MilestoneRef | None


class RateLimited(RuntimeError):
    """GitHub's API budget, shared by everything signed in as this user, is used up."""


def gh(*args: str, input: str | None = None) -> str:
    r = subprocess.run(["gh", *args], capture_output=True, text=True, input=input)
    if r.returncode != 0:
        error = RateLimited if "rate limit" in r.stderr.lower() else RuntimeError
        raise error(f"gh {' '.join(args)}\n{r.stderr}")
    return r.stdout.strip()


def gh_json(*args: str):  # the JSON's shape is the caller's to name
    """`gh` with JSON output, parsed; None when it printed nothing."""
    out = gh(*args)
    return json.loads(out) if out else None


def list_issues() -> list[Issue]:
    """Every issue in the repo, open and closed, with what both scripts read from it."""
    out = gh(
        "issue", "list", "-R", REPO, "--state", "all", "--limit", "500", "--json", ISSUE_FIELDS
    )
    return json.loads(out)


def issue_key(title: str) -> str | None:
    """The catalog key an issue's title starts with: `E0.1` for `[E0.1] Project scaffold`."""
    match = KEY.match(title)
    return match[1] if match else None


def by_key[T: Mapping[str, object]](issues: Iterable[T]) -> dict[str, T]:
    """Issues keyed by their catalog key; an issue without one is left out."""
    return {key: issue for issue in issues if (key := issue_key(str(issue["title"])))}


def is_closed(issue: Mapping[str, object]) -> bool:
    """Closed for any reason. A story ticks in its epic's checklist once it is closed."""
    return issue["state"] == "CLOSED"


def is_done(issue: Mapping[str, object]) -> bool:
    """Closed as completed. An issue closed as not planned is not done."""
    return is_closed(issue) and issue.get("stateReason") in (None, "", "COMPLETED")


def field_options() -> dict[str, list[str]]:
    """The board's single-select fields and their options, as the catalog defines them."""
    return {
        "Epic": [epic["key"] for epic in EPICS],
        "Phase": [key for key, _, _ in MILESTONES],
        "Size": list(SIZES),
        "Priority": list(PRIORITIES),
    }


def epic_body(epic: Epic, closed: set[str]) -> str:
    """An epic's issue body, with each story ticked whose key is in `closed`."""
    lines = [epic["summary"], "", f"**Milestone:** {epic['milestone']}", "", "## Stories", ""]
    lines += [
        f"- [{'x' if story['key'] in closed else ' '}] {story['title']}"
        for story in epic["stories"]
    ]
    lines += ["", "_Stories are attached as sub-issues; the checklist above is a summary._"]
    return "\n".join(lines)


def unticked(body: str) -> str:
    """A body with every checklist box cleared, to compare two bodies apart from their ticks.

    Line endings are normalized too: a body edited on github.com comes back with CRLF.
    """
    return TICK.sub("- [ ] ", body.replace("\r\n", "\n"))


def render_roadmap(issues: list[Issue], also_done: Iterable[int] = ()) -> str:
    """The roadmap doc, linking each entry to its issue and ticking each one done.

    `also_done` counts issue numbers as done ahead of time: the board audit passes the
    epics it is about to close.
    """
    numbers = {key: issue["number"] for key, issue in by_key(issues).items()}
    done = {issue["number"] for issue in issues if is_done(issue)} | set(also_done)

    def link(key: str) -> str:
        n = numbers.get(key)
        return f"[#{n}](https://github.com/{REPO}/issues/{n})" if n else "(not synced)"

    def box(key: str) -> str:
        return "[x]" if numbers.get(key) in done else "[ ]"

    out = [
        "# Roadmap",
        "",
        "Generated from `scripts/catalog.py` by `scripts/sync_tracker.py`. Edit the catalog, not this file.",
        "A box is ticked once its issue is closed as completed; `scripts/sync_board.py` keeps them current.",
        "",
        f'Board: https://github.com/users/{OWNER}/projects ("{BOARD_TITLE}")',
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
        out += [
            f"- {box(s['key'])} {s['key']} {s['title']} · {s['size']} · {s['priority']} · {link(s['key'])}"
            for s in epic["stories"]
        ]
        out.append("")
    return "\n".join(out)
