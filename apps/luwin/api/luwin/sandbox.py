"""A local playground for luwin's chat: the real agent against an eval case's fakes.

`uv run luwin-sandbox` serves the chat routes the web app talks to, but every
service is a fake seeded from one eval case (or none, a blank world) except
raven, which is the real library at `RAVEN_URL` (from the environment or
`.env`, http://localhost:5174 when unset), so "is it on the server?" is
answered from real titles. The deployed server reads the same variable. The store is in memory, and there is no sign-in: every request is the eval user,
at the tier the page picks. The model is Claude Haiku 5.5 unless `--model`
names another, reached through headless Claude Code on the developer's own
sign-in (`luwin/agent/claude_code.py`), never an API key: only the deployed
server uses one. `--model fake` answers every turn with a scripted line, for
working on the page without Claude Code. The chat stream carries the trace (each tool call
and notice), and the page shows the case's own messages with what each one
expects.

Nothing real is reachable from here, but every turn runs on the developer's
Claude Code account, so the server listens on 127.0.0.1 only. The container runs `luwin`, never this.
"""

# No `from __future__ import annotations`: FastAPI reads each route's
# `Annotated[..., Depends(...)]` at definition, where `Signed` is in scope.
import argparse
import logging
import os
import secrets
import shutil
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Annotated, Any, Literal

import uvicorn
from fastapi import APIRouter, Depends, FastAPI, Request
from pydantic import BaseModel

from luwin.agent.claude_code import BINARY, ClaudeCodeModel
from luwin.agent.tools import Tier
from luwin.chat.identity import IdentityService
from luwin.chat.service import ChatService
from luwin.clients import RavenClient
from luwin.config import load_env_file, load_settings
from luwin.evals import CASES_DIR, Case, build_agent
from luwin.evals.world import EVAL_USER, build_world
from luwin.notify import LogNotifier
from luwin.store import Store
from luwin.web import create_app
from luwin.web.auth import Auth, Refused, Viewer, require_json
from luwin.web.chat import ChatApi

log = logging.getLogger("luwin.sandbox")

BLANK = "blank"
# How `main` hands its arguments to `app`, which uvicorn's reloader imports afresh in a
# new process every time luwin's code changes.
CHOICES = {
    "model": "LUWIN_SANDBOX_MODEL",
    "case": "LUWIN_SANDBOX_CASE",
    "raven": "LUWIN_SANDBOX_RAVEN",
}
MODEL = "claude-haiku-5-5"
# raven's web dev server on this machine, which proxies its API: where the sandbox looks
# when `RAVEN_URL` is unset.
LOCAL_RAVEN = "http://localhost:5174"
FAKE_MODEL = "fake"
SANDBOX_NAME = "Sandbox friend"
HOST = "127.0.0.1"


@dataclass
class World:
    """One case's fakes, store and chat service, opened fresh.

    `id` names this world's conversation, so a page that kept one from an earlier world
    (another case, or the sandbox before a reload) knows to start fresh.
    """

    case_id: str
    case: Case
    store: Store
    chat: ChatService
    id: str = field(default_factory=lambda: secrets.token_hex(8))


class CasePick(BaseModel):
    case: str


class TierPick(BaseModel):
    tier: Literal["friend", "trusted", "admin"]


class SandboxAuth(Auth):
    """Every request is the eval user, at whatever tier the sandbox set."""

    def __init__(self, sandbox: "Sandbox"):
        self.sandbox = sandbox

    @property
    def identity(self) -> IdentityService:  # what `Auth.linked` reads for an unlinked user
        return self.sandbox.world.chat.identity

    async def signed_in(self, request: Request) -> Viewer:
        user = self.sandbox.world.store.get_user(EVAL_USER)
        if user is None:
            raise RuntimeError("the sandbox world has no eval user")
        return Viewer(user, self.identity.tier_for(EVAL_USER), SANDBOX_NAME)


class Sandbox:
    def __init__(self, model: str, cases_dir: Path = CASES_DIR, raven_url: str = ""):
        self.model = model
        # One Claude Code client and one raven client for every world.
        self.client = None if model == FAKE_MODEL else ClaudeCodeModel()
        self.raven = RavenClient(raven_url) if raven_url else None
        self.cases = {p.stem: Case.load(p) for p in sorted(cases_dir.glob("*.yaml"))}
        self.world = self._open(BLANK)
        self.auth = SandboxAuth(self)
        self.chat = ChatApi(self.auth, self.world.chat, LogNotifier(), trace=True)

    def _open(self, case_id: str) -> World:
        case = self.cases.get(case_id) or Case(name="Blank world", tier=Tier.FRIEND, turns=[])
        registry, services, store = build_world(case.services)
        if self.raven is not None:
            services.raven = self.raven
        agent = build_agent(self.model, registry, services, store, model_client=self.client)
        identity = IdentityService(store, services)
        identity.set_tier_override(EVAL_USER, case.tier.name.lower())
        return World(case_id, case, store, ChatService(agent=agent, identity=identity, store=store))

    def open(self, case_id: str) -> None:
        """Swaps in a fresh world for `case_id`. The old one isn't closed: a turn still
        running in it finishes there, and its in-memory store goes with it."""
        if case_id != BLANK and case_id not in self.cases:
            raise Refused(404, {"reason": "unknown_case"})
        self.world = self._open(case_id)
        self.chat.chat = self.world.chat

    def state(self) -> dict[str, Any]:
        case = self.world.case
        return {
            "model": self.model,
            "raven": self.raven.base_url if self.raven else None,
            "world": self.world.id,
            "case": {
                "id": self.world.case_id,
                "name": case.name,
                "turns": [asdict(turn) for turn in case.turns],
            },
            "cases": [
                {"id": BLANK, "name": "Blank world"},
                *({"id": case_id, "name": c.name} for case_id, c in self.cases.items()),
            ],
        }

    def router(self) -> APIRouter:
        router = APIRouter(prefix="/api")
        Signed = Annotated[Viewer, Depends(self.auth.signed_in)]

        @router.get("/me")
        async def me(viewer: Signed) -> dict[str, Any]:
            return {
                "user": {"id": viewer.user.user_id, "display_name": viewer.display_name},
                "tier": viewer.tier.name.lower(),
            }

        @router.get("/sandbox")
        async def state() -> dict[str, Any]:
            return self.state()

        @router.post("/sandbox/case", dependencies=[Depends(require_json)])
        async def open_case(pick: CasePick) -> dict[str, Any]:
            self.open(pick.case)
            return self.state()

        @router.post("/sandbox/tier", dependencies=[Depends(require_json)])
        async def set_tier(pick: TierPick) -> dict[str, str]:
            self.world.chat.identity.set_tier_override(EVAL_USER, pick.tier)
            return {"tier": pick.tier}

        return router

    def app(self) -> FastAPI:
        web = create_app(chat=self.chat)
        web.include_router(self.router())
        return web


def app() -> FastAPI:
    """The sandbox `main` chose, opened fresh: uvicorn's factory, called again on each reload."""
    sandbox = Sandbox(os.environ[CHOICES["model"]], raven_url=os.environ[CHOICES["raven"]])
    sandbox.open(os.environ[CHOICES["case"]])
    return sandbox.app()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Chat with luwin's agent against an eval case's fake services."
    )
    parser.add_argument(
        "--model", default=MODEL, help=f"model id (default {MODEL}), or 'fake' for scripted replies"
    )
    parser.add_argument("--case", default=BLANK, help="the case to open first, by its file's stem")
    args = parser.parse_args(argv)

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
    load_env_file()
    if args.model != FAKE_MODEL and shutil.which(BINARY) is None:
        parser.error(
            f"Claude Code's `{BINARY}` isn't on PATH: install it and sign in, "
            "or run with --model fake"
        )
    if args.case != BLANK and not (CASES_DIR / f"{args.case}.yaml").is_file():
        parser.error(f"no case {args.case!r} in {CASES_DIR}")
    cfg = load_settings(os.environ)  # read now, after `.env`: `settings()` keeps its first read
    os.environ.update(
        {
            CHOICES["model"]: args.model,
            CHOICES["case"]: args.case,
            CHOICES["raven"]: cfg.raven_url or LOCAL_RAVEN,
        }
    )
    log.info(
        "luwin sandbox (model %s, raven %s) on http://%s:%s",
        args.model,
        os.environ[CHOICES["raven"]],
        HOST,
        cfg.web_port,
    )
    # Reloads on every change to luwin's code, so the page never talks to a stale sandbox.
    uvicorn.run(
        f"{__name__}:{app.__name__}",
        factory=True,
        reload=True,
        reload_dirs=[str(Path(__file__).parent)],
        host=HOST,
        port=cfg.web_port,
        log_level="info",
    )
    return 0
