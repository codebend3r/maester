from dataclasses import replace

import pytest

from sparrow.agent.tools import Refused, Result, Tier
from sparrow.clients.seerr import IssueType
from sparrow.media import Decision, ReportKind
from sparrow.notify import AdminPost, DirectMessage
from sparrow.playback.diagnosis import FileChecked, TheirWord
from sparrow.seerr_events import SeerrNotification, issue_status
from sparrow.tools.playback import report_problem
from tests.playback_world import (
    DUNE_4K_ITEM,
    FORKS,
    FORKS_ITEM,
    link_pal,
    report,
    stock,
)


@pytest.fixture
def library(ctx):
    return stock(ctx)


async def test_a_failed_file_check_makes_the_copy_replaceable(library):
    library.services.probe.errors[FORKS] = ("[h264 @ 0x1] error while decoding MB 12 40",)
    filed = await report(library, FORKS_ITEM, ReportKind.WONT_PLAY, "freezes", at=1200.0)
    assert library.services.probe.decoded == [(FORKS, 1185.0, 30.0)]
    assert filed.report.health == "corrupt" and filed.report.decision is Decision.REPLACEABLE
    assert isinstance(filed.diagnosis, FileChecked)
    out = filed.as_dict()
    assert out["next"].startswith(
        "The evidence allows a new copy (a file check found it corrupt: decode errors at 19:45"
    )
    assert "replace_media with report_id 1 and host meleys" in out["next"]
    (issue,) = library.services.seerr.issues
    assert (issue["mediaId"], issue["problemSeason"], issue["problemEpisode"]) == (31, 2, 7)
    assert "(release group NTb)" in issue["message"]
    assert "Decision: a replacement was offered to the friend" in issue["message"]


async def test_a_healthy_file_needs_a_second_reporter(library):
    link_pal(library)
    first = await report(library, FORKS_ITEM, ReportKind.WONT_PLAY)
    assert (first.report.health, first.report.decision) == ("ok", Decision.RECORDED)
    assert "(1 report and no failed file check)" in first.as_dict()["next"]
    again = await report(library, FORKS_ITEM, ReportKind.WONT_PLAY)  # the same friend again
    assert again.report.decision is Decision.RECORDED
    second = await report(library, FORKS_ITEM, ReportKind.WONT_PLAY, user="d2")
    assert second.report.decision is Decision.REPLACEABLE
    assert second.evidence.describe() == "2 people reported it"


async def test_an_unreadable_file_is_never_proof(library):
    library.services.probe.files.pop(FORKS)
    filed = await report(library, FORKS_ITEM, ReportKind.WONT_PLAY)
    assert filed.report.health == "unreadable" and filed.report.decision is Decision.RECORDED
    assert filed.diagnosis.health.evidence == (
        f"there's no file at {FORKS} on the read-only media mount",
    )


async def test_wrong_file_reports_take_the_friends_word_and_keep_the_release_group(library):
    link_pal(library)
    cam = await report(library, DUNE_4K_ITEM, ReportKind.CAM, "it's a cam, people's heads")
    assert cam.report.decision is Decision.RECORDED and cam.diagnosis == TheirWord()
    assert cam.report.release_group == "FraMeSToR" and library.services.probe.decoded == []
    assert library.services.seerr.issues[0]["issueType"] == IssueType.VIDEO
    wrong = await report(library, DUNE_4K_ITEM, ReportKind.WRONG_TITLE, "it's Dune 1984", user="d2")
    assert wrong.report.decision is Decision.REPLACEABLE  # two people, one file
    assert library.services.seerr.issues[1]["issueType"] == IssueType.OTHER


async def test_track_problems_list_the_tracks_and_ask_the_admin(library):
    filed = await report(library, DUNE_4K_ITEM, ReportKind.AUDIO, "no English dub")
    assert filed.report.decision is Decision.FOR_ADMIN
    (issue,) = library.services.seerr.issues
    assert issue["issueType"] == IssueType.AUDIO
    assert 'Tracks:\n- audio: eng truehd 8ch "TrueHD Atmos 7.1" (default)' in issue["message"]
    assert "- subtitle: es srt (forced, file)" in issue["message"]
    assert "Decision: recorded for the admin" in issue["message"]
    (notice,) = filed.notices
    assert isinstance(notice, AdminPost) and notice.text.startswith(
        "dany@example.com reports audio out of sync or a missing dub on the 4K copy of Dune (2021) "
        '(vermithor): "no English dub". Nothing fixes this automatically'
    )
    assert (
        filed.as_dict()["next"] == "Tell them it's recorded and the admin has been asked to fix it."
    )


async def test_a_report_is_kept_when_seerr_cannot_take_the_issue(library):
    library.services.seerr.down = True
    filed = await report(library, DUNE_4K_ITEM, ReportKind.CAM)
    assert filed.issue_id is None
    assert filed.issue_note.startswith("not opened: seerr POST /api/v1/issue failed")
    assert filed.as_dict()["seerr_issue"] is None
    assert filed.as_dict()["seerr_issue_note"] == filed.issue_note
    assert library.store.get_report(filed.report.id).seerr_issue_id is None
    library.services.seerr.down = False
    library.services.seerr.details[("movie", 438631)] = replace(
        library.services.seerr.details[("movie", 438631)], media_id=None
    )
    filed = await report(library, DUNE_4K_ITEM, ReportKind.CAM)
    assert filed.issue_note == "not opened: Seerr doesn't track this title yet"


async def test_resolving_the_issue_in_seerr_resolves_the_report_once(library):
    filed = await report(library, DUNE_4K_ITEM, ReportKind.CAM)

    def event(kind):
        return SeerrNotification.from_webhook(
            {"notification_type": kind, "issue": {"issue_id": str(filed.issue_id)}, "media": None}
        )

    (dm,) = await issue_status(library.store, True, event("ISSUE_RESOLVED"))
    assert dm == DirectMessage("d1", "Your report about Dune (2021) in 4K was resolved.")
    assert library.store.get_report(filed.report.id).resolved_at is not None
    assert await issue_status(library.store, True, event("ISSUE_RESOLVED")) == []  # a repeat
    assert await issue_status(library.store, False, event("ISSUE_REOPENED")) == []
    assert library.store.get_report(filed.report.id).resolved_at is None


async def test_report_problem_files_a_confirmed_copy(library):
    out = await report_problem(
        library, 136315, "tv", "1080p", "wont_play", "stops", season=2, episode=7, at="20:00"
    )
    assert isinstance(out, Result) and out.content["decision"] == "recorded"
    assert library.services.probe.decoded[0][1] == 1185.0
    # What can't be filed is refused, one way: a failed result that says why.
    for call, why in (
        (dict(media_type="tv", season=2, episode=8, kind="cam"), "S02E08 has no file on meleys"),
        (dict(media_type="movie", kind="wont_play", at="later"), "'later' isn't a time"),
        (dict(media_type="tv", season=2, kind="cam"), "name both the season and the episode"),
    ):
        tmdb_id = 136315 if call["media_type"] == "tv" else 438631
        out = await report_problem(library, tmdb_id, version="1080p", description="x", **call)
        assert isinstance(out, Refused) and why in out.content


def test_every_report_kind_has_a_policy_and_the_tool_offers_each():
    from sparrow.agent.tools import registry
    from sparrow.playback.reports import POLICIES

    assert set(POLICIES) == set(ReportKind)
    spec = registry.get("report_problem")
    assert spec.input_schema["properties"]["kind"]["enum"] == [k.value for k in ReportKind]
    assert spec.tier == Tier.FRIEND and not spec.destructive


async def test_resolved_reports_no_longer_testify(library):
    link_pal(library)
    first = await report(library, DUNE_4K_ITEM, ReportKind.CAM)
    library.store.set_issue_resolved(first.report.seerr_issue_id, True)
    second = await report(library, DUNE_4K_ITEM, ReportKind.CAM, user="d2")
    assert second.report.decision is Decision.RECORDED  # the resolved report doesn't count
    # Two reports that still stand prove the file.
    third = await report(library, DUNE_4K_ITEM, ReportKind.CAM)
    assert third.report.decision is Decision.REPLACEABLE


async def test_one_friends_claims_never_make_a_healthy_file_replaceable(library):
    # A moment past the end of a full, clean file.
    past_the_end = await report(library, DUNE_4K_ITEM, ReportKind.WONT_PLAY, "freezes", at=12600.0)
    assert past_the_end.report.health == "ok" and past_the_end.report.decision is Decision.RECORDED
    # A decode line the audit doesn't know, or a flaky mount.
    for line in ("[h264 @ 0x55] Could not find ref with POC 12", "Read error: Input/output error"):
        library.services.probe.errors[FORKS] = (line,)
        filed = await report(library, FORKS_ITEM, ReportKind.WONT_PLAY)
        assert filed.report.health == "unreadable" and filed.report.decision is Decision.RECORDED
