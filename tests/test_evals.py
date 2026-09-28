from pathlib import Path

import pytest

from maester.agent.loop import Agent
from maester.agent.runner import ToolRunner
from maester.agent.tools import ToolContext, ToolRegistry
from maester.config import Settings
from maester.evals import CASES_DIR, Case, load_cases, report, run_case
from maester.evals.world import EVAL_USER, build_services, build_world
from maester.memo import Memo
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
            settings=Settings(),
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
        settings=Settings(),
    )
    reply = await agent.respond(EVAL_USER, case.tier, case.turns[0].user)
    assert reply.tool_calls == [{"name": call[0], "input": call[1], "ok": True}]
    store.close()


DUNE_1080P = {"tmdb_id": 438631, "media_type": "movie", "version": "1080p"}
FORKS = {"tmdb_id": 136315, "media_type": "tv", "version": "1080p", "season": 2, "episode": 7}


@pytest.mark.parametrize(
    ("case_file", "call", "expect"),
    [
        ("playback_identify_recent", ("recent_sessions", {}), "movie:438631:1080p"),
        ("playback_client_fix", ("report_problem", {**DUNE_1080P, "kind": "wont_play", "description": "stalls"}), '"decision": "advised"'),
        ("playback_broken_file", ("report_problem", {**FORKS, "kind": "wont_play", "description": "freezes", "at": "20:00"}), '"decision": "replaceable"'),
        ("wrong_file_report", ("report_problem", {**DUNE_1080P, "kind": "cam", "description": "a cam"}), '"decision": "recorded"'),
        ("subtitle_question", ("list_tracks", DUNE_1080P), '"language": "spa"'),
        ("missing_episode", ("find_gaps", {"tmdb_id": 136315, "host": "meleys"}), '"searched": ["S02E07"]'),
    ],
)  # fmt: skip
async def test_playback_case_worlds_reach_what_their_cases_expect(case_file, call, expect):
    """The tool each playback case expects, run on its world, reaches the case's decision."""
    case = Case.load(CASES_DIR / f"{case_file}.yaml")
    registry, services, store = build_world(case.services)
    ctx = ToolContext(EVAL_USER, case.tier, services, store, Settings(), Memo())
    outcome = await ToolRunner(registry).run(ctx, *call)
    assert not outcome.is_error and expect in outcome.text
    store.close()


@pytest.mark.parametrize(
    ("case_file", "call", "expect"),
    [
        ("lag_relayed", ("session_report", {}), '"fix": "avoid_relay"'),
        ("lag_remote_quality", ("session_report", {}), '"fix": "original_quality"'),
        ("lag_subtitle_burn_in", ("session_report", {}), '"fix": "subtitles_off"'),
        ("lag_busy_server", ("session_report", {}), '"fix": "wait"'),
        ("lag_heavy_remux", ("session_report", {}), '"what_to_do": "Play the 1080p version instead'),
        ("lag_details_on_request", ("session_report", {"details": True}), '"findings": [{"fix": "original_quality"'),
        ("server_load", ("server_status", {}), '"load_is_a_plausible_cause": true'),
    ],
)  # fmt: skip
async def test_lag_case_worlds_reach_the_advice_their_cases_expect(case_file, call, expect):
    """The advice each lag case's reply is held to is what its world's stream calls for."""
    case = Case.load(CASES_DIR / f"{case_file}.yaml")
    registry, services, store = build_world(case.services)
    ctx = ToolContext(EVAL_USER, case.tier, services, store, Settings(), Memo())
    outcome = await ToolRunner(registry).run(ctx, *call)
    assert not outcome.is_error and expect in outcome.text
    store.close()


async def test_the_slow_uplink_world_is_found_by_a_speed_test():
    case = Case.load(CASES_DIR / "lag_slow_uplink.yaml")
    registry, services, store = build_world(case.services)
    ctx = ToolContext(EVAL_USER, case.tier, services, store, Settings(), Memo())
    runner = ToolRunner(registry)
    before = await runner.run(ctx, "session_report", {})
    assert '"fix": null' in before.text and "speed_test(host=meleys)" in before.text
    tested = await runner.run(ctx, "speed_test", {"host": "meleys"})
    assert (
        "The upload is nearly full" in tested.text and '"remote_streams_mbps": 20.0' in tested.text
    )
    after = await runner.run(ctx, "session_report", {})
    assert '"fix": "lower_quality"' in after.text and "4 Mbps 720p" in after.text
    store.close()


async def test_the_health_world_has_what_its_case_says_is_down():
    case = Case.load(CASES_DIR / "service_health_down.yaml")
    registry, services, store = build_world(case.services)
    ctx = ToolContext(EVAL_USER, case.tier, services, store, Settings(), Memo())
    outcome = await ToolRunner(registry).run(ctx, "service_health", {})
    assert [d["service"] for d in outcome.content["down"]] == ["Plex", "Radarr on vermithor"]
    store.close()


async def test_the_version_world_recommends_what_its_case_expects():
    case = Case.load(CASES_DIR / "version_for_slow_connection.yaml")
    registry, services, store = build_world(case.services)
    ctx = ToolContext(EVAL_USER, case.tier, services, store, Settings(), Memo())
    call = {"tmdb_id": 438631, "connection_mbps": 20}
    outcome = await ToolRunner(registry).run(ctx, "pick_version", call)
    assert '"recommended": {"version": "1080p", "fits": true' in outcome.text
    assert outcome.notices == ()
    store.close()


async def test_the_heavy_remux_world_flags_the_remux_to_the_admin():
    case = Case.load(CASES_DIR / "lag_heavy_remux.yaml")
    registry, services, store = build_world(case.services)
    ctx = ToolContext(EVAL_USER, case.tier, services, store, Settings(), Memo())
    outcome = await ToolRunner(registry).run(ctx, "session_report", {})
    (notice,) = outcome.notices
    assert "watched away from home 3 times" in notice.text
    store.close()
