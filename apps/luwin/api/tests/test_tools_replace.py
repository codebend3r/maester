import asyncio
from dataclasses import replace
from datetime import UTC, datetime, timedelta

import pytest

from luwin.agent.limits import KillSwitch
from luwin.agent.runner import ToolRunner
from luwin.agent.tools import Result, Tier, registry
from luwin.clients import ClientError
from luwin.clients.arr import HistoryEvent, MediaFile
from luwin.clients.media import Inspection
from luwin.clients.radarr import Movie
from luwin.config import Guardrails
from luwin.jobs.landed import tell_landed
from luwin.media import Copy, Decision, ReportKind, ReportStatus, Titled
from luwin.notify import AdminPost, ApprovalPost, DirectMessage
from luwin.tools.replace import replace_media
from tests.playback_world import DUNE_4K, DUNE_4K_ITEM, FORKS, FORKS_ITEM, link_pal, report, stock

RELEASE = "Dune.2021.2160p.UHD.BluRay.REMUX.DV.HDR.TrueHD.7.1-FraMeSToR"
FORKS_RELEASE = "The.Bear.S02E07.1080p.WEB.h264-NTb"
DUNE_1080 = "/Meleys/Movies/Dune (2021)/Dune (2021) Bluray-1080p.mkv"


@pytest.fixture
def library(ctx):
    """Dune 4K on vermithor and 1080p on meleys, and The Bear S02E07: each from one grab."""
    stock(ctx)
    ctx.services.radarr["vermithor"].events[8] = [
        HistoryEvent(901, "downloadFolderImported", RELEASE, "2026-09-01T10:00:00Z", "sab_1", "", 55),
        HistoryEvent(900, "grabbed", RELEASE, "2026-09-01T09:00:00Z", "sab_1", ""),
        HistoryEvent(800, "grabbed", "Dune.2021.older-GRP", "2026-08-01T09:00:00Z", "sab_0", ""),
    ]  # fmt: skip
    meleys = ctx.services.radarr["meleys"]
    meleys.movie_list = [Movie(8, "Dune", 438631, 2021, "", True, True, 44)]
    meleys.files = [MediaFile(44, DUNE_1080, 14_000_000_000, "Bluray-1080p", "FLUX", 8)]
    meleys.events[8] = [
        HistoryEvent(71, "downloadFolderImported", "Dune.1080p", "2026-09-01", "sab_9", "", 44),
        HistoryEvent(70, "grabbed", "Dune.1080p", "2026-09-01", "sab_9", ""),
    ]  # fmt: skip
    ctx.services.probe.files[DUNE_1080] = Inspection(DUNE_1080, 9331.0, "h264", 0, ())
    return ctx


def with_forks_history(ctx):
    ctx.services.sonarr["meleys"].events[12] = [
        HistoryEvent(31, "downloadFolderImported", FORKS_RELEASE, "2026-09-02", "sab_7", "", 72, 702),
        HistoryEvent(30, "grabbed", FORKS_RELEASE, "2026-09-01", "sab_7", "", None, 702),
    ]  # fmt: skip


def capped(ctx, cap):
    return replace(
        ctx, settings=replace(ctx.settings, guardrails=Guardrails(replace_daily_cap=cap))
    )


async def broken(ctx, copy=DUNE_4K_ITEM, path=DUNE_4K):
    """A report whose file check failed: replaceable on the evidence alone."""
    ctx.services.probe.errors[path] = ("[hevc @ 0x1] Invalid NAL unit size",)
    filed = await report(ctx, copy, ReportKind.WONT_PLAY, "freezes", at=4350.0)
    assert filed.report.decision is Decision.REPLACEABLE
    return filed.report


async def confirmed(ctx, runner, reported):
    """replace_media as the model asks for it, then the friend's Confirm, through the runner."""
    asked = await runner.run(
        ctx, "replace_media", {"report_id": reported.id, "host": reported.host}
    )
    assert asked.content["status"] == "awaiting_confirmation"
    pending = ctx.store.decide_pending(asked.pending_id, "approved", ctx.user_id)
    return await runner.run_decision(ctx, pending, True)


async def use_up_the_cap(ctx, runner):
    """A cap of one, spent on a real confirmed replacement of another file."""
    await confirmed(ctx, runner, await broken(ctx, Copy("movie", 438631, False), DUNE_1080))
    assert ctx.services.radarr["meleys"].deleted == [44]


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
        "A new copy usually lands within a few hours when a release is out there; I'll DM you "
        "once it's on the server. Tell me if that one's broken too."
    )
    (notice,) = out.notices
    assert isinstance(notice, AdminPost)
    assert notice.text.startswith(
        f"Deleted {DUNE_4K} (68.5 GB) on vermithor: the 4K copy of Dune (2021).\n"
        "Reason: won't play; a file check found it corrupt: decode errors at 1:12:15-1:12:45"
    )
    assert "Reported by dany." in notice.text and notice.text.endswith("Seerr issue #1.")
    stored = library.store.get_report(reported.id)
    assert stored.status is ReportStatus.REPLACED and stored.decision is Decision.REPLACEABLE
    assert library.services.seerr.issues[0]["comments"] == [out.content]


async def test_an_episode_file_is_replaced_with_every_episode_it_held(library):
    with_forks_history(library)
    reported = await broken(library, FORKS_ITEM, FORKS)
    out = await replace_media(library, reported.id, "meleys")
    sonarr = library.services.sonarr["meleys"]
    assert (sonarr.failed, sonarr.deleted, sonarr.searched) == ([30], [72], [[702]])
    assert out.content.startswith("Replacing the 1080p copy of The Bear (2022) S02E07 on meleys")


async def test_a_file_with_no_grab_behind_it_is_left_for_the_admin(library):
    reported = await broken(library, FORKS_ITEM, FORKS)  # Sonarr's history has no import of it
    out = await replace_media(library, reported.id, "meleys")
    sonarr = library.services.sonarr["meleys"]
    assert (sonarr.failed, sonarr.deleted, sonarr.searched) == ([], [], [])
    assert out.is_error and not out.retryable
    assert "- blocklist: no grab of this file in the history" in out.content
    assert "- delete: not run" in out.content and "- search: not run" in out.content
    (notice,) = out.notices
    assert notice.text.startswith(
        "Replacing the 1080p copy of The Bear (2022) S02E07 on meleys stopped"
    )


async def test_a_release_already_marked_failed_is_not_marked_twice(library):
    library.services.radarr["vermithor"].events[8].insert(
        0, HistoryEvent(902, "downloadFailed", RELEASE, "2026-09-02T09:00:00Z", "sab_1", "")
    )
    reported = await broken(library)
    out = await replace_media(library, reported.id, "vermithor")
    assert library.services.radarr["vermithor"].failed == []
    assert f"- blocklist: {RELEASE} was already marked failed" in out.content
    assert library.services.radarr["vermithor"].deleted == [55]


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
    assert out.retryable  # Radarr didn't answer and nothing was deleted: try again
    assert "- delete: failed: radarr DELETE" in out.content
    assert "- search: not run, since the step before didn't go through" in out.content
    assert out.content.endswith("Nothing was deleted; the admin has been told.")
    (notice,) = out.notices
    assert notice.text.startswith("Replacing the 4K copy of Dune (2021) on vermithor stopped")
    assert library.store.get_report(reported.id).status is ReportStatus.OPEN


async def test_over_the_daily_cap_the_admin_decides(library):
    ctx, runner = capped(library, 1), ToolRunner(registry)
    await use_up_the_cap(ctx, runner)
    reported = await broken(ctx)
    asked = await confirmed(ctx, runner, reported)
    (post,) = asked.notices  # the approval is the admin's one notice
    assert isinstance(post, ApprovalPost)
    assert post.text.startswith(
        "dany asks to replace the 4K copy of Dune (2021) on vermithor (won't play; a file check"
    )
    assert "The daily cap of 1 replacements is used up" in post.text
    assert ctx.services.radarr["vermithor"].deleted == []
    assert ctx.store.get_report(reported.id).status is ReportStatus.ESCALATED
    # While it waits on the admin, asking again doesn't ask twice.
    again = await confirmed(ctx, runner, reported)
    assert again.is_error and again.content == (
        f"Report {reported.id} can't be acted on: it's already waiting on the admin."
    )

    admin = replace(ctx, user_id="boss", tier=Tier.ADMIN)
    approval = ctx.store.decide_pending(post.pending_id, "approved", "boss")
    approved = await runner.run_decision(admin, approval, True)
    assert ctx.services.radarr["vermithor"].deleted == [55]
    notice, dm = approved.notices
    assert isinstance(notice, AdminPost) and notice.text.startswith("Deleted ")
    assert dm == DirectMessage("d1", approved.text)
    assert ctx.store.get_report(reported.id).status is ReportStatus.REPLACED


async def test_an_admins_no_covers_that_report_only(library):
    ctx, runner = capped(library, 1), ToolRunner(registry)
    await use_up_the_cap(ctx, runner)
    reported = await broken(ctx)
    (post,) = (await confirmed(ctx, runner, reported)).notices
    admin = replace(ctx, user_id="boss", tier=Tier.ADMIN)
    denial = ctx.store.decide_pending(post.pending_id, "denied", "boss")
    denied = await runner.run_decision(admin, denial, False)
    assert denied.notices == (
        DirectMessage("d1", "The admin decided not to replace Dune (2021) in 4K for now; your report stays open in Seerr."),
    )  # fmt: skip
    assert ctx.store.get_report(reported.id).status is ReportStatus.DECLINED
    # Under a bigger cap, that report still can't be replaced...
    roomy = capped(ctx, 10)
    out = await replace_media(roomy, reported.id, "vermithor")
    assert out.content.endswith("the admin decided not to replace it.")
    # ...but it doesn't speak for the file: a new report stands on its own evidence.
    link_pal(ctx)
    pal = await report(roomy, DUNE_4K_ITEM, ReportKind.WONT_PLAY, user="d2")
    assert pal.report.decision is Decision.REPLACEABLE  # its own file check failed
    assert ctx.services.radarr["vermithor"].deleted == []


async def test_an_approval_that_lapsed_leaves_the_report_open_again(library):
    ctx, runner = capped(library, 1), ToolRunner(registry)
    await use_up_the_cap(ctx, runner)
    reported = await broken(ctx)
    (post,) = (await confirmed(ctx, runner, reported)).notices
    ctx.store.decide_pending(post.pending_id, "expired", "luwin")  # no button left
    out = await replace_media(capped(ctx, 10), reported.id, "vermithor")
    assert not out.is_error and ctx.services.radarr["vermithor"].deleted == [55]


async def test_an_approved_replacement_that_stops_for_good_reopens_the_report(library):
    ctx, runner = capped(library, 1), ToolRunner(registry)
    await use_up_the_cap(ctx, runner)
    reported = await broken(ctx, FORKS_ITEM, FORKS)  # no grab in Sonarr's history
    (post,) = (await confirmed(ctx, runner, reported)).notices
    admin = replace(ctx, user_id="boss", tier=Tier.ADMIN)
    approval = ctx.store.decide_pending(post.pending_id, "approved", "boss")
    stopped = await runner.run_decision(admin, approval, True)
    assert stopped.is_error and not stopped.retryable
    assert ctx.store.get_report(reported.id).status is ReportStatus.OPEN


async def test_two_confirmations_at_once_cannot_both_slip_under_the_cap(library):
    ctx, runner = capped(library, 1), ToolRunner(registry)
    first = await broken(ctx)
    second = await broken(ctx, Copy("movie", 438631, False), DUNE_1080)
    for radarr in ctx.services.radarr.values():  # a real arr answers later, letting others run
        radarr.history = pausing(radarr.history)
    both = await asyncio.gather(confirmed(ctx, runner, first), confirmed(ctx, runner, second))
    assert sorted(o.approval_id is not None for o in both) == [False, True]
    deleted = ctx.services.radarr["vermithor"].deleted + ctx.services.radarr["meleys"].deleted
    assert len(deleted) == 1


def pausing(call):
    async def paused(*args):
        await asyncio.sleep(0)
        return await call(*args)

    return paused


async def test_a_confirmed_replacement_is_audited_and_counted_once(library):
    ctx, runner = capped(library, 1), ToolRunner(registry)
    done = await confirmed(ctx, runner, await broken(ctx))
    assert not done.is_error and ctx.services.radarr["vermithor"].deleted == [55]
    # The tool's own account of the delete; no second "confirmed" post.
    (notice,) = done.notices
    assert notice.text.startswith("Deleted ")
    row = ctx.store.audit_recent(1)[0]
    assert (row.tool, row.host, row.ok) == ("replace_media", "vermithor", True)
    assert "- delete: deleted" in row.result
    assert ctx.store.audit_count_since("replace_media", datetime.now(UTC) - timedelta(1)) == 1


async def test_asking_the_admin_and_their_approval_leave_the_friends_count_alone(library):
    ctx, runner = capped(library, 1), ToolRunner(registry)
    await use_up_the_cap(ctx, runner)
    (post,) = (await confirmed(ctx, runner, await broken(ctx))).notices
    admin = replace(ctx, user_id="boss", tier=Tier.ADMIN)
    await runner.run_decision(
        admin, ctx.store.decide_pending(post.pending_id, "approved", "boss"), True
    )
    assert ctx.services.radarr["vermithor"].deleted == [55]
    assert ctx.store.audit_count_since("replace_media", datetime.now(UTC) - timedelta(1)) == 1


async def test_the_kill_switch_stops_replace_media_directly_and_through_an_approval(library):
    kill = KillSwitch()
    ctx, runner = capped(library, 1), ToolRunner(registry, kill_switch=kill)
    await use_up_the_cap(ctx, runner)
    reported = await broken(ctx)
    asked = await runner.run(ctx, "replace_media", {"report_id": reported.id, "host": "vermithor"})
    confirm = ctx.store.decide_pending(asked.pending_id, "approved", "d1")
    kill.on("bad day")
    held = await runner.run_decision(ctx, confirm, True)
    assert held.is_error and held.retryable and "bad day" in held.content
    refused = await runner.run(
        ctx, "replace_media", {"report_id": reported.id, "host": "vermithor"}
    )
    assert refused.is_error and "disabled" in refused.content

    kill.off()
    (post,) = (await confirmed(ctx, runner, reported)).notices  # over the cap: the admin decides
    kill.on("bad day")
    admin = replace(ctx, user_id="boss", tier=Tier.ADMIN)
    approval = ctx.store.decide_pending(post.pending_id, "approved", "boss")
    held = await runner.run_decision(admin, approval, True)
    assert held.is_error and held.retryable and "decide_replacement is disabled" in held.content
    assert ctx.services.radarr["vermithor"].deleted == []


def test_replacement_tools_are_destructive_and_the_decision_is_the_admins():
    replace_spec, decide = registry.get("replace_media"), registry.get("decide_replacement")
    assert replace_spec.destructive and replace_spec.tier == Tier.FRIEND
    assert replace_spec.host_param == "host"
    assert decide.destructive and decide.button_only and decide.tier == Tier.ADMIN
    assert "decide_replacement" not in {s.name for s in registry.for_tier(Tier.ADMIN)}


async def test_the_friend_hears_once_when_the_new_copy_lands(library):
    runner = ToolRunner(registry)
    reported = await broken(library)
    link_pal(library)
    await report(library, DUNE_4K_ITEM, ReportKind.WONT_PLAY, "same here", user="d2")
    await confirmed(library, runner, reported)
    radarr = library.services.radarr["vermithor"]
    assert await tell_landed(library.services, library.store) == []  # nothing yet
    radarr.files = [MediaFile(56, "/Vermithor/Movies/Dune (2021)/new.mkv", 60_000_000_000,
                              "Remux-2160p", "FLUX", 8)]  # fmt: skip
    told = await tell_landed(library.services, library.store)
    assert sorted(dm.to for dm in told) == ["d1", "d2"]
    dm = next(dm for dm in told if dm.to == "d1")
    assert dm.text.startswith("The new 4K copy of Dune (2021) is on the server now.")
    assert dm.about == Titled(Copy("movie", 438631, True), "Dune (2021)")
    assert await tell_landed(library.services, library.store) == []  # once each
