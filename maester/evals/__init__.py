"""Scripted conversations run against fake services.

A case is a YAML file: a user tier, one or more user messages, and for each
message the tool calls expected and a regex the reply must match. Services
are always the fakes from `maester.clients`, seeded from the case file. The
model is real by default (`uv run maester-eval`), which is what makes the
harness worth having; `--model fake` runs the same cases against a scripted
model so CI can check the plumbing without an API key.
"""

from __future__ import annotations

import argparse
import asyncio
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml

from maester.agent.loop import Agent
from maester.agent.runner import ToolRunner
from maester.agent.tools import Tier, ToolRegistry
from maester.config import Settings
from maester.evals.world import EVAL_USER

CASES_DIR = Path(__file__).resolve().parent.parent.parent / "evals" / "cases"


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


def build_agent(model_name: str, registry: ToolRegistry, services: Any, store: Any) -> Agent:
    if model_name == "fake":
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
    parser = argparse.ArgumentParser(description="Run maester eval cases against fake services.")
    parser.add_argument(
        "cases", nargs="*", type=Path, help="case files (default: all under evals/cases)"
    )
    parser.add_argument("--model", default=None, help="model id, or 'fake' for the scripted model")
    args = parser.parse_args(argv)

    from maester.config import settings
    from maester.evals.world import build_world

    model_name = args.model or settings().model
    cases = load_cases(args.cases or None)
    results = []
    for case in cases:
        registry, services, store = build_world(case.services)
        agent = build_agent(model_name, registry, services, store)
        results.append(asyncio.run(run_case(case, agent)))
        store.close()
    print(report(results))
    return 0 if all(r.passed for r in results) else 1


if __name__ == "__main__":
    sys.exit(main())
