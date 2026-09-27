#!/usr/bin/env python3
"""Bring the "maester roadmap" board back in line with the issues and their PRs.

The issues are the source of truth and the board follows them. The board's built-in
workflows miss transitions (issues closed by a PR can stay In Progress), so this audits
every item instead of trusting them.

Read-only by default: prints a numbered plan and saves it. Applying re-audits first and
runs only the saved steps that are still needed, so a stale plan never undoes anything.

    uv run python scripts/sync_board.py                     # audit, print and save the plan
    uv run python scripts/sync_board.py --apply             # apply the saved plan
    uv run python scripts/sync_board.py --apply --only 1,3  # apply part of it

Needs `gh` authenticated with the `project` scope (`gh auth refresh -s project`).
"""

import argparse
import json
import re
import subprocess
import sys
import tempfile
from pathlib import Path

OWNER = "codebend3r"
REPO = "codebend3r/maester"
PROJECT = 1
PLAN_PATH = Path(tempfile.gettempdir()) / "maester-board-plan.json"

# Apply order within one issue: an epic's checklist is ticked before it closes, and
# it closes before its status moves, so the auto-close workflow has nothing to do.
KIND_ORDER = ["add", "field", "tick", "close", "status"]

QUERY = """
query($owner: String!, $number: Int!, $after: String) {
  user(login: $owner) {
    projectV2(number: $number) {
      id
      fields(first: 50) {
        nodes { ... on ProjectV2SingleSelectField { id name options { id name } } }
      }
      items(first: 100, after: $after) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id
          fieldValues(first: 20) {
            nodes {
              ... on ProjectV2ItemFieldSingleSelectValue {
                name
                field { ... on ProjectV2SingleSelectField { name } }
              }
            }
          }
          content {
            ... on Issue {
              number title state stateReason body url
              labels(first: 20) { nodes { name } }
              milestone { title }
              subIssues(first: 50) { nodes { number title state } }
              closedByPullRequestsReferences(first: 5, includeClosedPrs: false) {
                nodes { number }
              }
            }
          }
        }
      }
    }
  }
}"""


def gh(*args: str, input: str | None = None) -> str:
    r = subprocess.run(["gh", *args], capture_output=True, text=True, input=input)
    if r.returncode != 0:
        raise RuntimeError(f"gh {' '.join(args)}\n{r.stderr}")
    return r.stdout.strip()


def fetch() -> dict:
    """The board's id, its single-select fields, its issue items and every repo issue."""
    items, after = [], None
    while True:
        args = ["api", "graphql", "-f", f"query={QUERY}", "-f", f"owner={OWNER}"]
        args += ["-F", f"number={PROJECT}"] + (["-f", f"after={after}"] if after else [])
        project = json.loads(gh(*args))["data"]["user"]["projectV2"]
        items += [i for i in project["items"]["nodes"] if i["content"]]
        page = project["items"]["pageInfo"]
        if not page["hasNextPage"]:
            break
        after = page["endCursor"]
    fields = {f["name"]: f for f in project["fields"]["nodes"] if f}
    for item in items:
        values = item.pop("fieldValues")["nodes"]
        item["values"] = {v["field"]["name"]: v["name"] for v in values if v}
    issues = gh("issue", "list", "-R", REPO, "--state", "all", "--limit", "500",
                "--json", "number,title,url")  # fmt: skip
    return {"id": project["id"], "fields": fields, "items": items, "issues": json.loads(issues)}


def bare_title(title: str) -> str:
    return re.sub(r"^\[[^\]]+\]\s*", "", title)


def expected_fields(issue: dict) -> dict[str, str]:
    """Epic, Phase, Size and Priority as the issue's title, milestone and labels imply."""
    labels = [label["name"] for label in issue["labels"]["nodes"]]
    out = {}
    if m := re.match(r"^\[(E\d+)", issue["title"]):
        out["Epic"] = m[1]
    if issue["milestone"]:
        out["Phase"] = issue["milestone"]["title"].split()[0]
    for name in labels:
        if name.startswith("size:"):
            out["Size"] = name[5:]
        elif re.fullmatch(r"P[0-2]", name):
            out["Priority"] = name
    return out


def ticked_body(epic: dict) -> str:
    """The epic body with each story's checklist line matching whether it is closed."""
    body = epic["body"]
    for sub in epic["subIssues"]["nodes"]:
        text = bare_title(sub["title"])
        mark = "x" if sub["state"] == "CLOSED" else " "
        line = re.compile(rf"^- \[[ xX]\] {re.escape(text)}$", re.M)
        body = line.sub(lambda _, new=f"- [{mark}] {text}": new, body)
    return body


def want_status(issue: dict, status: str | None, statuses: dict[int, str | None]):
    """The status the issue should have, or a reason a human has to decide, or None."""
    subs = issue["subIssues"]["nodes"]
    if issue["state"] == "CLOSED":
        if issue["stateReason"] not in (None, "COMPLETED"):
            return None if status == "Done" else ("flag", "closed as not planned: Done or archive?")
        if any(s["state"] == "OPEN" for s in subs):
            return ("flag", "epic is closed but has open stories")
        return ("Done", "issue is closed")
    if status == "Done":
        return ("flag", "issue is open but shows Done: reopened, or moved too early?")
    if subs:
        started = [
            s for s in subs if s["state"] == "CLOSED" or statuses.get(s["number"]) == "In Progress"
        ]
        if started and status != "In Progress":
            return ("In Progress", f"{len(started)} of {len(subs)} stories started or closed")
    elif prs := issue["closedByPullRequestsReferences"]["nodes"]:
        if status != "In Progress":
            return ("In Progress", "open PR " + ", ".join(f"#{p['number']}" for p in prs))
    if status is None:
        return ("Todo", "no status set")
    return None


def plan(board: dict) -> tuple[list[dict], list[dict]]:
    """Steps that would bring the board in line, and drift that needs a human decision."""
    steps, flags = [], []
    statuses = {i["content"]["number"]: i["values"].get("Status") for i in board["items"]}
    for item in sorted(board["items"], key=lambda i: i["content"]["number"]):
        issue, values = item["content"], item["values"]
        n, title, subs = issue["number"], issue["title"], issue["subIssues"]["nodes"]
        step = {"issue": n, "title": title, "item": item["id"]}

        for field, value in expected_fields(issue).items():
            if values.get(field) != value:
                steps.append(step | {"kind": "field", "field": field, "to": value,
                                     "why": f"{field} {values.get(field) or '(empty)'} → {value}"})  # fmt: skip

        if subs and (body := ticked_body(issue)) != issue["body"]:
            steps.append(step | {"kind": "tick", "to": body, "why": "checklist out of date"})

        if issue["state"] == "OPEN" and subs and all(s["state"] == "CLOSED" for s in subs):
            done = ", ".join(f"#{s['number']}" for s in subs)
            steps.append(step | {"kind": "close", "to": f"All stories are closed: {done}.",
                                 "why": f"all {len(subs)} stories closed"})  # fmt: skip
            steps.append(step | {"kind": "status", "field": "Status", "to": "Done",
                                 "why": f"{values.get('Status') or '(empty)'} → Done"})  # fmt: skip
            continue

        want = want_status(issue, values.get("Status"), statuses)
        if want and want[0] == "flag":
            flags.append({"issue": n, "title": title, "why": want[1]})
        elif want and want[0] != values.get("Status"):
            steps.append(step | {"kind": "status", "field": "Status", "to": want[0],
                                 "why": f"{values.get('Status') or '(empty)'} → {want[0]}: {want[1]}"})  # fmt: skip

    on_board = {i["content"]["url"] for i in board["items"]}
    for issue in board["issues"]:
        if issue["url"] not in on_board:
            steps.append({"issue": issue["number"], "title": issue["title"], "kind": "add",
                          "to": issue["url"], "why": "not on the board"})  # fmt: skip

    steps.sort(key=lambda s: (s["issue"], KIND_ORDER.index(s["kind"])))
    return steps, flags


def key(step: dict) -> tuple:
    return (step["issue"], step["kind"], step.get("field"))


def run(board: dict, step: dict) -> None:
    n, kind = str(step["issue"]), step["kind"]
    if kind == "add":
        gh("project", "item-add", str(PROJECT), "--owner", OWNER, "--url", step["to"])
    elif kind == "tick":
        gh("issue", "edit", n, "-R", REPO, "--body-file", "-", input=step["to"])
    elif kind == "close":
        gh("issue", "close", n, "-R", REPO, "--reason", "completed", "--comment", step["to"])
    else:
        field = board["fields"][step["field"]]
        option = next(o["id"] for o in field["options"] if o["name"] == step["to"])
        gh("project", "item-edit", "--project-id", board["id"], "--id", step["item"],
           "--field-id", field["id"], "--single-select-option-id", option)  # fmt: skip


def describe(step: dict) -> str:
    return {
        "add": "add to the board",
        "field": f"set {step.get('field')} to {step['to']}",
        "tick": "update the story checklist",
        "close": "close the issue as completed",
        "status": f"set Status to {step['to']}",
    }[step["kind"]]


def report(steps: list[dict], flags: list[dict]) -> None:
    if not steps and not flags:
        print("✓ board matches the issues, nothing to do")
        return
    if steps:
        print("| # | Issue | Change | Why |\n|---|---|---|---|")
        for i, s in enumerate(steps, 1):
            print(f"| {i} | #{s['issue']} {s['title']} | {describe(s)} | {s['why']} |")
    if flags:
        print("\nNeeds a decision (never applied):")
        for f in flags:
            print(f"- #{f['issue']} {f['title']}: {f['why']}")
    if steps:
        print(f"\nNothing changed. Plan saved to {PLAN_PATH}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--apply", action="store_true", help="apply the saved plan")
    parser.add_argument("--only", help="comma-separated step numbers to apply, e.g. 1,3")
    args = parser.parse_args()

    board = fetch()
    steps, flags = plan(board)

    if not args.apply:
        report(steps, flags)
        PLAN_PATH.write_text(json.dumps(steps, indent=2))
        return

    if not PLAN_PATH.exists():
        sys.exit(f"✗ no saved plan at {PLAN_PATH}; run without --apply first")
    saved = json.loads(PLAN_PATH.read_text())
    picked = [int(x) for x in args.only.split(",")] if args.only else range(1, len(saved) + 1)
    if bad := [i for i in picked if not 1 <= i <= len(saved)]:
        sys.exit(f"✗ no step {bad[0]}; the saved plan has steps 1 to {len(saved)}")
    current = {key(s): s for s in steps}
    for i in picked:
        step = saved[i - 1]
        # Run the freshly planned step, not the saved one, so its data is current.
        if fresh := current.get(key(step)):
            run(board, fresh)
            print(f"✓ {i}. #{step['issue']} {describe(fresh)}")
        else:
            print(f"· {i}. #{step['issue']} {describe(step)}: already done, skipped")
    PLAN_PATH.unlink()


if __name__ == "__main__":
    main()
