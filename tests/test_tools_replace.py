from dataclasses import replace
from datetime import UTC, datetime, timedelta

import pytest

from maester.agent.limits import KillSwitch
from maester.agent.runner import ToolRunner
from maester.agent.tools import Result, Tier, registry
from maester.clients import ClientError
from maester.clients.arr import HistoryEvent
from maester.config import Guardrails
from maester.notify import AdminPost, ApprovalPost, DirectMessage
from maester.playback.reports import Action, ReportKind
from maester.tools.replace import decide_replacement, replace_media
from tests.playback_world import DUNE_4K, DUNE_4K_ITEM, FORKS, FORKS_ITEM, link_pal, report, stock

RELEASE = "Dune.2021.2160p.UHD.BluRay.REMUX.DV.HDR.TrueHD.7.1-FraMeSToR"


@pytest.fixture
def library(ctx):
    """Dune 4K on vermithor came from one grab, imported as file 55."""
    stock(ctx)
    ctx.services.radarr["vermithor"].events[8] = [
        HistoryEvent(901, "downloadFolderImported", RELEASE, "2026-09-01T10:00:00Z", "sab_1", "", 55),
        HistoryEvent(900, "grabbed", RELEASE, "2026-09-01T09:00:00Z", "sab_1", ""),
        HistoryEvent(800, "grabbed", "Dune.2021.older-GRP", "2026-08-01T09:00:00Z", "sab_0", ""),
    ]  # fmt: skip
    return ctx


async def broken(ctx, item=DUNE_4K_ITEM, path=DUNE_4K):
    """A report whose file check failed: replaceable on the evidence alone."""
    ctx.services.probe.errors[path] = ("[hevc @ 0x1] Invalid NAL unit size",)
    filed = await report(ctx, item, ReportKind.WONT_PLAY, "freezes", at=4350.0)
    assert filed.report.action == Action.REPLACEABLE
    return filed.report


async def test_a_proven_report_blocklists_deletes_and_searches_on_the_owning_host(library):
    reported = await broken(library)
    out = await replace_media(library, reported.id, "Vermithor")
    radarr = library.services.radarr["vermithor"]
    assert (radarr.failed, radarr.deleted, radarr.searched) == ([900], [55], [[8]])
    assert library.services.radarr["meleys"].deleted == []
    assert isinstance(out, Result) and not out.is_error
    assert out.content == (
        "Replacing the 4K copy of Dune (2021) on vermithor:\n"
        f"- blocklist: marked {RELEASE} failed so it isn't grabbed again\n"
        f"- delete: deleted {DUNE_4K} (68.5 GB)\n"
        "- search: searching for a new copy\n"
        "A new copy usually lands within a few hours when a release is out there. Try again "
        "later today, and tell me if it's still broken tomorrow."
    )
    (notice,) = out.notices
    assert isinstance(notice, AdminPost)
    assert notice.text.startswith(
        f"Deleted {DUNE_4K} (68.5 GB) on vermithor: the 4K copy of Dune (2021).\n"
        "Reason: won't play; a file check found it corrupt: decode errors at 1:12:15-1:12:45"
    )
    assert "Reported by dany." in notice.text and notice.text.endswith("Seerr issue #1.")
    stored = library.store.get_report(reported.id)
    assert stored.action == Action.REPLACED and stored.replaced_at is not None
    assert library.services.seerr.issues[0]["comments"] == [out.content]


async def test_an_episode_file_is_replaced_with_every_episode_it_held(library):
    reported = await broken(library, FORKS_ITEM, FORKS)
    out = await replace_media(library, reported.id, "meleys")
    sonarr = library.services.sonarr["meleys"]
    assert (sonarr.deleted, sonarr.searched) == ([72], [[702]])
    # Sonarr's history has no import of this file, so there's no release to block.
    assert sonarr.failed == [] and "- blocklist: no grab of this file" in out.content
    assert out.content.startswith("Replacing the 1080p copy of The Bear (2022) S02E07 on meleys")


async def test_without_evidence_nothing_is_touched(library):
    filed = await report(library, DUNE_4K_ITEM, ReportKind.CAM)
    out = await replace_media(library, filed.report.id, "vermithor")
    assert out.is_error and out.content.startswith(
        "Not replacing the 4K copy of Dune (2021): 1 report and no failed file check."
    )
    assert library.services.radarr["vermithor"].deleted == []


async def test_only_the_reporters_own_report_on_its_own_host_and_file(library):
    reported = await broken(library)
    link_pal(library)
    pal = replace(library, user_id="d2")
    assert (await replace_media(pal, reported.id, "vermithor")).content == (
        f"There's no report {reported.id} of yours to act on."
    )
    assert (await replace_media(library, 999, "vermithor")).is_error
    out = await replace_media(library, reported.id, "meleys")
    assert out.content == "Dune (2021) in 4K is on vermithor, not meleys."
    # The file changed since it was reported (it was replaced already).
    library.services.radarr["vermithor"].files[0] = replace(
        library.services.radarr["vermithor"].files[0], id=56
    )
    out = await replace_media(library, reported.id, "vermithor")
    assert out.is_error and "no longer there" in out.content
    assert library.services.radarr["vermithor"].deleted == []


async def test_a_failed_delete_stops_before_the_search_and_says_so(library):
    reported = await broken(library)

    async def refuse(file_id):
        raise ClientError("radarr", "DELETE", f"/api/v3/moviefile/{file_id}", 500, "locked")

    library.services.radarr["vermithor"].delete_movie_file = refuse
    out = await replace_media(library, reported.id, "vermithor")
    assert out.is_error and library.services.radarr["vermithor"].searched == []
    assert "- delete: failed: radarr DELETE" in out.content
    assert "- search: not run, since the step before failed" in out.content
    assert out.content.endswith("Nothing was deleted; the admin has been told.")
    (notice,) = out.notices
    assert notice.text.startswith("Replacing the 4K copy of Dune (2021) on vermithor stopped")
    assert library.store.get_report(reported.id).action == Action.REPLACEABLE


def use_up_the_cap(ctx, n=3):
    for _ in range(n):
        ctx.store.audit(discord_id="x", tool="replace_media", args={}, result="", ok=True)


async def test_over_the_daily_cap_the_admin_decides(library):
    reported = await broken(library)
    use_up_the_cap(library)
    out = await replace_media(library, reported.id, "vermithor")
    assert out.approval.decide == "decide_replacement"
    assert out.approval.args == {"report_id": reported.id, "host": "vermithor", "requester": "d1"}
    assert out.approval.notice.startswith(
        "dany asks to replace the 4K copy of Dune (2021) on vermithor (won't play; a file check"
    )
    assert "The daily cap of 3 replacements is used up" in out.approval.notice
    assert library.services.radarr["vermithor"].deleted == []
    assert library.store.get_report(reported.id).action == Action.ESCALATED

    admin = replace(library, user_id="boss", tier=Tier.ADMIN)
    denied = await decide_replacement(admin, reported.id, "vermithor", "d1", approved=False)
    assert denied.notices == (
        DirectMessage("d1", "The admin decided not to replace Dune (2021) in 4K for now; your report stays open in Seerr."),
    )  # fmt: skip
    assert library.store.get_report(reported.id).action == Action.DECLINED

    approved = await decide_replacement(admin, reported.id, "vermithor", "d1", approved=True)
    assert library.services.radarr["vermithor"].deleted == [55]
    notice, dm = approved.notices
    assert isinstance(notice, AdminPost) and notice.text.startswith("Deleted ")
    assert dm == DirectMessage("d1", approved.content)


async def test_the_cap_counts_only_replacements_friends_confirmed(library):
    ctx = replace(
        library, settings=replace(library.settings, guardrails=Guardrails(replace_daily_cap=1))
    )
    reported = await broken(ctx)
    # A refusal, and a replacement the admin approved, leave the day's cap alone.
    ctx.store.audit(discord_id="x", tool="replace_media", args={}, result="", ok=False)
    ctx.store.audit(discord_id="x", tool="decide_replacement", args={}, result="", ok=True)
    assert not (await replace_media(ctx, reported.id, "vermithor")).is_error


async def through_the_runner(ctx, kill=None):
    """replace_media as the model asks for it: a confirmation, then the friend's press."""
    runner = ToolRunner(registry, kill_switch=kill or KillSwitch())
    reported = await broken(ctx)
    asked = await runner.run(ctx, "replace_media", {"report_id": reported.id, "host": "vermithor"})
    assert asked.content["status"] == "awaiting_confirmation"
    pending = ctx.store.decide_pending(asked.pending_id, "approved", ctx.user_id)
    return runner, reported, pending


async def test_a_confirmed_replacement_is_audited_and_counted_once(library):
    runner, _, pending = await through_the_runner(library)
    done = await runner.run_decision(library, pending, True)
    assert not done.is_error and library.services.radarr["vermithor"].deleted == [55]
    # The tool's own account of the delete; no second "confirmed" post.
    (notice,) = done.notices
    assert notice.text.startswith("Deleted ")
    row = library.store.audit_recent(1)[0]
    assert (row.tool, row.host, row.ok) == ("replace_media", "vermithor", True)
    assert "- delete: deleted" in row.result


async def test_a_confirmed_replacement_over_the_cap_asks_the_admin_once(library):
    use_up_the_cap(library)
    runner, _, pending = await through_the_runner(library)
    asked = await runner.run_decision(library, pending, True)
    assert asked.approval_id is not None and library.services.radarr["vermithor"].deleted == []
    (post,) = asked.notices  # the approval is the admin's one notice
    assert isinstance(post, ApprovalPost) and post.pending_id == asked.approval_id
    # Asking didn't act, so the day still holds the three it had.
    assert library.store.audit_count_since("replace_media", datetime.now(UTC) - timedelta(1)) == 3


async def test_the_kill_switch_stops_replace_media_directly_and_through_an_approval(library):
    kill = KillSwitch()
    runner, reported, pending = await through_the_runner(library, kill)
    kill.on("bad day")
    held = await runner.run_decision(library, pending, True)
    assert held.is_error and held.retryable and "bad day" in held.content
    refused = await runner.run(
        library, "replace_media", {"report_id": reported.id, "host": "vermithor"}
    )
    assert refused.is_error and "disabled" in refused.content

    admin = replace(library, user_id="boss", tier=Tier.ADMIN)
    approval = library.store.create_pending(
        kind="approve", action="decide_replacement", requester="d1",
        payload={"report_id": reported.id, "host": "vermithor", "requester": "d1"},
        summary="Replace Dune", ttl=timedelta(days=1),
    )  # fmt: skip
    decided = library.store.decide_pending(approval.id, "approved", "boss")
    held = await runner.run_decision(admin, decided, True)
    assert held.is_error and held.retryable and "decide_replacement is disabled" in held.content
    assert library.services.radarr["vermithor"].deleted == []


def test_replacement_tools_are_destructive_and_the_decision_is_the_admins():
    replace_spec, decide = registry.get("replace_media"), registry.get("decide_replacement")
    assert replace_spec.destructive and replace_spec.tier == Tier.FRIEND
    assert replace_spec.host_param == "host"
    assert decide.destructive and decide.button_only and decide.tier == Tier.ADMIN
    assert "decide_replacement" not in {s.name for s in registry.for_tier(Tier.ADMIN)}
