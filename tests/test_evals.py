from pathlib import Path

import pytest

from maester.agent.loop import Agent
from maester.agent.runner import ToolRunner
from maester.agent.tools import ToolRegistry
from maester.evals import CASES_DIR, Case, load_cases, report, run_case
from maester.evals.world import EVAL_USER, build_services, build_world
from maester.store import Store
from tests.fake_model import FakeModel, text_message, tool_message


def test_all_case_files_load():
    cases = load_cases()
    assert {c.name for c in cases} >= {
        "simple movie request",
        "ambiguous title asks before requesting",
    }
    assert all(c.turns for c in cases)


def test_world_seeds_fake_seerr():
    services = build_services(
        {"seerr": {"results": [{"tmdb_id": 1, "title": "Dune", "year": 2021}]}}
    )
    assert services.seerr.results[0].title == "Dune"
    assert set(services.sonarr) == {"meleys", "vermithor"}


async def test_run_case_checks_tools_and_reply(tmp_path: Path):
    reg = ToolRegistry()

    @reg.tool(
        "search_media", "search", {"type": "object", "properties": {"query": {"type": "string"}}}
    )
    async def search(ctx, query=""):
        return [{"title": "Dune"}]

    case = Case.load(CASES_DIR / "ambiguous_title.yaml")
    store = Store(":memory:")

    def agent_with(*script):
        return Agent(
            model_client=FakeModel.scripted(*script),
            model="fake",
            runner=ToolRunner(reg),
            store=store,
            services=None,
        )

    good = await run_case(
        case,
        agent_with(
            tool_message([("search_media", {"query": "dune"})]),
            text_message("Which one, 2021 or 1984?"),
        ),
    )
    assert good.passed

    bad = await run_case(case, agent_with(text_message("Requested Dune.")))
    assert not bad.passed
    failures = bad.turns[0].failures
    assert any("expected tool 'search_media'" in f for f in failures)
    assert any("did not match" in f for f in failures)
    assert "FAIL  ambiguous title" in report([bad]) and "0/1 cases passed" in report([bad])
    store.close()


@pytest.mark.parametrize(
    ("case_file", "call"),
    [
        ("trusted_4k_goes_to_admin", ("request_media_4k", {"tmdb_id": 438631, "media_type": "movie"})),
        ("tv_request_by_season", ("request_media", {"tmdb_id": 136315, "media_type": "tv", "seasons": [2, 3]})),
        ("availability_with_plex_link", ("check_availability", {"tmdb_id": 438631, "media_type": "movie"})),
        ("request_status", ("request_status", {})),
        ("collection_request", ("find_collection", {"tmdb_id": 954})),
        ("anime_english_dub", ("check_availability", {"tmdb_id": 209867, "media_type": "tv"})),
    ],
)  # fmt: skip
async def test_case_worlds_answer_the_tools_their_cases_expect(case_file, call):
    case = Case.load(CASES_DIR / f"{case_file}.yaml")
    registry, services, store = build_world(case.services)
    agent = Agent(
        model_client=FakeModel.scripted(tool_message([call]), text_message("done")),
        model="fake",
        runner=ToolRunner(registry),
        store=store,
        services=services,
    )
    reply = await agent.respond(EVAL_USER, case.tier, case.turns[0].user)
    assert reply.tool_calls == [{"name": call[0], "input": call[1], "ok": True}]
    store.close()
