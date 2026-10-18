"""Scripted conversations run against fake services.

A case is a YAML file: a user tier, one or more user messages, and for each
message the tool calls expected and a regex the reply must match. Services
are always the fakes from `luwin.clients`, seeded from the case file. The
model is real by default (`uv run luwin-eval`), which is what makes the
harness worth having; `--model fake` runs the same cases against a scripted
model so CI can check the plumbing without an API key.
"""

from __future__ import annotations

import argparse
import asyncio
import os
import re
import sys
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path
from typing import Any

import yaml

from luwin.agent.loop import Agent
from luwin.agent.runner import ToolRunner
from luwin.agent.tools import Tier, ToolRegistry
from luwin.config import Settings
from luwin.evals.world import EVAL_USER

API_DIR = Path(__file__).resolve().parent.parent.parent
CASES_DIR = API_DIR / "evals" / "cases"
REPORT_PATH = API_DIR.parent / "docs" / "evals.md"
REASON_LIMIT = 120


@dataclass
class Turn:
    user: str
    expect_tools: list[str] = field(default_factory=list)
    forbid_tools: list[str] = field(default_factory=list)
    reply_matches: str | None = None
    reply_not_matches: str | None = None


@dataclass
class Case:
    name: str
    tier: Tier
    turns: list[Turn]
    services: dict[str, Any] = field(default_factory=dict)
    path: Path | None = None

    @classmethod
    def load(cls, path: Path) -> Case:
        raw = yaml.safe_load(path.read_text())
        turns = [
            Turn(
                user=t["user"],
                expect_tools=list(t.get("expect_tools", [])),
                forbid_tools=list(t.get("forbid_tools", [])),
                reply_matches=t.get("reply_matches"),
                reply_not_matches=t.get("reply_not_matches"),
            )
            for t in raw["turns"]
        ]
        return cls(
            name=raw.get("name", path.stem),
            tier=Tier.parse(raw.get("tier", "friend")),
            turns=turns,
            services=raw.get("services", {}),
            path=path,
        )


@dataclass
class TurnResult:
    turn: Turn
    reply: str
    tools_called: list[str]
    failures: list[str]


@dataclass
class CaseResult:
    case: Case
    turns: list[TurnResult]

    @property
    def passed(self) -> bool:
        return all(not t.failures for t in self.turns)


async def run_case(case: Case, agent: Agent, user_id: str = EVAL_USER) -> CaseResult:
    agent.forget(user_id)
    results = []
    for turn in case.turns:
        reply = await agent.respond(user_id, case.tier, turn.user)
        called = [c["name"] for c in reply.tool_calls]
        failures = []
        for name in turn.expect_tools:
            if name not in called:
                failures.append(f"expected tool {name!r}, called {called}")
        for name in turn.forbid_tools:
            if name in called:
                failures.append(f"forbidden tool {name!r} was called")
        if turn.reply_matches and not re.search(turn.reply_matches, reply.text, re.I | re.S):
            failures.append(f"reply did not match /{turn.reply_matches}/: {reply.text[:200]!r}")
        if turn.reply_not_matches and re.search(turn.reply_not_matches, reply.text, re.I | re.S):
            failures.append(f"reply matched forbidden /{turn.reply_not_matches}/")
        results.append(TurnResult(turn, reply.text, called, failures))
    return CaseResult(case, results)


def load_cases(paths: list[Path] | None = None) -> list[Case]:
    files = paths or sorted(CASES_DIR.glob("*.yaml"))
    return [Case.load(p) for p in files]


BAR_WIDTH = 30


def _paint(text: str, code: str, *, is_color: bool) -> str:
    return f"\033[{code}m{text}\033[0m" if is_color else text


def use_color() -> bool:
    return sys.stdout.isatty() and "NO_COLOR" not in os.environ


def progress_line(result: CaseResult, *, index: int, total: int, is_color: bool) -> str:
    mark = (
        _paint("✅", "32", is_color=is_color)
        if result.passed
        else _paint("❌", "31", is_color=is_color)
    )
    return f"[{index:>{len(str(total))}}/{total}] {mark} {result.case.name}"


def summary_bar(results: list[CaseResult], *, is_color: bool) -> str:
    passed = sum(1 for r in results if r.passed)
    filled = round(BAR_WIDTH * passed / len(results)) if results else 0
    bar = "█" * filled + "░" * (BAR_WIDTH - filled)
    code = "32" if passed == len(results) else "31"
    return f"{_paint(bar, code, is_color=is_color)} {passed}/{len(results)} passed"


def report(results: list[CaseResult]) -> str:
    lines = []
    for r in results:
        mark = "PASS" if r.passed else "FAIL"
        lines.append(f"{mark}  {r.case.name}")
        for t in r.turns:
            if t.failures:
                lines.append(f"      > {t.turn.user!r}")
                lines += [f"        - {f}" for f in t.failures]
    passed = sum(1 for r in results if r.passed)
    lines.append(f"\n{passed}/{len(results)} cases passed")
    return "\n".join(lines)


def _cell(text: str) -> str:
    flat = " ".join(text.split()).replace("|", "\\|")
    return flat if len(flat) <= REASON_LIMIT else flat[: REASON_LIMIT - 1] + "…"


def markdown_report(results: list[CaseResult], *, model: str, day: date) -> str:
    """A table of every case, stable between runs so a git diff shows only real changes.

    Cases are sorted by name and the only run detail is the day, never a
    duration or token count, so an unchanged result rewrites an identical file.
    """
    ordered = sorted(results, key=lambda r: r.case.name)
    passed = sum(1 for r in ordered if r.passed)
    rows = []
    for r in ordered:
        failures = [f for t in r.turns for f in t.failures]
        reason = _cell(failures[0]) if failures else ""
        rows.append(f"| {'✅' if r.passed else '❌'} | {_cell(r.case.name)} | {reason} |")
    return "\n".join(
        [
            "# Luwin evals",
            "",
            "Written by `bunx nx run @luwin/api:eval` after a full run against a real model.",
            "Filtered and `--model fake` runs leave this file alone.",
            "",
            f"- Model: `{model}`",
            f"- Date: {day.isoformat()}",
            f"- Passed: **{passed}/{len(ordered)}**",
            "",
            "| | Case | First failure |",
            "| --- | --- | --- |",
            *rows,
            "",
        ]
    )


def publish_report(
    results: list[CaseResult], *, model: str, is_full_run: bool, report_path: Path = REPORT_PATH
) -> bool:
    """Returns whether the tracked report file was written."""
    markdown = markdown_report(results, model=model, day=date.today())
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a") as handle:
            handle.write(markdown)
    if not is_full_run or model == "fake":
        return False
    report_path.write_text(markdown)
    return True


def build_agent(
    model_name: str, registry: ToolRegistry, services: Any, store: Any, model_client: Any = None
) -> Agent:
    """An agent over the case's world; `model_client` replaces the API client when given."""
    if model_client is not None:
        client: Any = model_client
    elif model_name == "fake":
        from tests.fake_model import FakeModel, text_message

        client: Any = FakeModel.scripted(*[text_message("(fake reply)") for _ in range(200)])
    else:
        import anthropic

        client = anthropic.AsyncAnthropic()
    return Agent(
        model_client=client,
        model=model_name,
        runner=ToolRunner(registry),
        store=store,
        services=services,
        settings=Settings(),
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Run luwin eval cases against fake services.")
    parser.add_argument(
        "cases", nargs="*", type=Path, help="case files (default: all under evals/cases)"
    )
    parser.add_argument("--model", default=None, help="model id, or 'fake' for the scripted model")
    args = parser.parse_args(argv)

    from luwin.config import load_env_file, settings
    from luwin.evals.world import build_world

    load_env_file()
    model_name = args.model or settings().model
    cases = load_cases(args.cases or None)
    is_color = use_color()
    results = []
    print(f"Running {len(cases)} cases against {model_name}\n")
    for index, case in enumerate(cases, start=1):
        registry, services, store = build_world(case.services)
        agent = build_agent(model_name, registry, services, store)
        results.append(asyncio.run(run_case(case, agent)))
        store.close()
        print(
            progress_line(results[-1], index=index, total=len(cases), is_color=is_color), flush=True
        )
    failed = [r for r in results if not r.passed]
    if failed:
        print("\nFailures\n" + report(failed).rsplit("\n\n", 1)[0])
    print(f"\n{summary_bar(results, is_color=is_color)}")
    if publish_report(results, model=model_name, is_full_run=not args.cases):
        print(f"Report written to {REPORT_PATH.relative_to(API_DIR.parent.parent.parent)}")
    return 0 if all(r.passed for r in results) else 1


if __name__ == "__main__":
    sys.exit(main())
