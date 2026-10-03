from dataclasses import replace

import pytest

from maester.agent.tools import Result, Tier
from maester.clients.seerr import ISSUE_AUDIO, ISSUE_OTHER, ISSUE_VIDEO
from maester.clients.tautulli import StreamData
from maester.media import Decision, ReportKind, ReportStatus
from maester.notify import AdminPost, DirectMessage
from maester.playback.diagnosis import FileChecked, PlayerLimit, TheirWord
from maester.playback.reports import Evidence
from maester.seerr_events import SeerrNotification, issue_status
from maester.tools.playback import report_problem
from tests.factories import history_row, session
from tests.playback_world import (
    DANY,
    DUNE_4K,
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


async def test_a_player_limit_is_the_answer_and_the_file_is_left_alone(library):
    # Played on vermithor's own Plex server: known there by its TMDB id, not Seerr's keys.
    library.services.tautulli["vermithor"].sessions = [
        session(user_id=DANY, rating_key="9001", product="Plex for Roku", player="Living Room",
                dovi_profile=7, video_decision="direct play", tmdb_id=438631)
    ]  # fmt: skip
    filed = await report(library, DUNE_4K_ITEM, ReportKind.WONT_PLAY, "purple picture")
    assert filed.report.decision is Decision.ADVISED and filed.notices == ()
    assert library.services.probe.decoded == []  # the file was never decoded
    out = filed.as_dict()
    (cause,) = out["diagnosis"]["player_causes"]
    assert cause["limit"] == "dolby_vision_profile_7" and "1080p version" in cause["fix"]
    assert out["diagnosis"]["player_check"] == (
        "playing now, Plex for Roku on Living Room (Tautulli on vermithor)"
    )
    playback = out["diagnosis"]["playback"]
    assert (playback["platform"], playback["container"], playback["video_decision"]) == (
        "Roku", "mkv", "direct play",
    )  # fmt: skip
    assert out["next"].startswith("Give them the player fix")
    (issue,) = library.services.seerr.issues
    assert (issue["mediaId"], issue["issueType"], issue["as_user"]) == (12, ISSUE_VIDEO, 4)
    assert issue["message"].startswith("purple picture\n\nReported through maester by dany")
    assert "Decision: a player limit explains it" in issue["message"]
    assert filed.report.seerr_issue_id == 1 and out["seerr_issue"] == 1
    # The player explained it, so it doesn't count toward replacing the file.
    assert not filed.evidence.proven
    assert Evidence.for_file(library.store, "vermithor", "movie", 55).reporters == set()


async def test_a_finished_play_is_read_from_the_history_with_the_files_profile(library):
    vermithor = library.services.tautulli["vermithor"]
    vermithor.history_rows = [
        history_row(user_id=DANY, rating_key="9001", row_id=77, product="Plex Web", player="Chrome")
    ]
    vermithor.titles["9001"] = 438631  # what vermithor's Plex server says the item is
    vermithor.streams[77] = StreamData("mkv", "hevc", "direct play", "eac3", "direct play", "", "")
    filed = await report(library, DUNE_4K_ITEM, ReportKind.WONT_PLAY)
    # Tautulli's history has no Dolby Vision profile; the file says 7.
    assert isinstance(filed.diagnosis, PlayerLimit)
    assert filed.diagnosis.check.playback.dovi_profile == 7
    assert filed.report.decision is Decision.ADVISED


async def test_a_failed_file_check_makes_the_copy_replaceable(library):
    library.services.probe.errors[FORKS] = ("[h264 @ 0x1] error while decoding MB 12 40",)
    filed = await report(library, FORKS_ITEM, ReportKind.WONT_PLAY, "freezes", at=1200.0)
    assert library.services.probe.decoded == [(FORKS, 1185.0, 30.0)]
    assert filed.report.health == "corrupt" and filed.report.decision is Decision.REPLACEABLE
    assert isinstance(filed.diagnosis, FileChecked)
    assert (
        filed.diagnosis.check.describe() == "not checked: no recent play of this copy in Tautulli"
    )
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
    assert library.services.seerr.issues[0]["issueType"] == ISSUE_VIDEO
    wrong = await report(library, DUNE_4K_ITEM, ReportKind.WRONG_TITLE, "it's Dune 1984", user="d2")
    assert wrong.report.decision is Decision.REPLACEABLE  # two people, one file
    assert library.services.seerr.issues[1]["issueType"] == ISSUE_OTHER


async def test_track_problems_list_the_tracks_and_ask_the_admin(library):
    filed = await report(library, DUNE_4K_ITEM, ReportKind.AUDIO, "no English dub")
    assert filed.report.decision is Decision.FOR_ADMIN
    (issue,) = library.services.seerr.issues
    assert issue["issueType"] == ISSUE_AUDIO
    assert 'Tracks:\n- audio: eng truehd 8ch "TrueHD Atmos 7.1" (default)' in issue["message"]
    assert "- subtitle: es srt (forced, file)" in issue["message"]
    assert "Decision: recorded for the admin" in issue["message"]
    (notice,) = filed.notices
    assert isinstance(notice, AdminPost) and notice.text.startswith(
        "dany reports audio out of sync or a missing dub on the 4K copy of Dune (2021) "
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
        assert out.is_error and why in out.content


def test_every_report_kind_has_a_policy_and_the_tool_offers_each():
    from maester.agent.tools import registry
    from maester.playback.reports import POLICIES

    assert set(POLICIES) == set(ReportKind)
    spec = registry.get("report_problem")
    assert spec.input_schema["properties"]["kind"]["enum"] == [k.value for k in ReportKind]
    assert spec.tier == Tier.FRIEND and not spec.destructive


async def test_after_a_player_fix_a_second_report_checks_the_file(library):
    library.services.tautulli["vermithor"].sessions = [
        session(user_id=DANY, rating_key="9001", dovi_profile=7, player="Living Room",
                tmdb_id=438631)
    ]  # fmt: skip
    library.services.probe.errors[DUNE_4K] = ("[hevc @ 0x1] Invalid NAL unit size",)
    first = await report(library, DUNE_4K_ITEM, ReportKind.WONT_PLAY, "purple")
    assert first.report.decision is Decision.ADVISED and library.services.probe.decoded == []
    again = await report(library, DUNE_4K_ITEM, ReportKind.WONT_PLAY, "the 1080p is fine, 4K isn't")
    assert isinstance(again.diagnosis, FileChecked) and again.report.health == "corrupt"
    assert again.report.decision is Decision.REPLACEABLE
    assert again.diagnosis.check.describe().endswith(
        "already had a player fix for this file, so the file is checked"
    )


async def test_resolved_and_declined_reports_no_longer_testify(library):
    link_pal(library)
    first = await report(library, DUNE_4K_ITEM, ReportKind.CAM)
    library.store.set_issue_resolved(first.report.seerr_issue_id, True)
    second = await report(library, DUNE_4K_ITEM, ReportKind.CAM, user="d2")
    assert second.report.decision is Decision.RECORDED  # the resolved report doesn't count
    # The admin declined replacing it for the second report: that one is spent...
    library.store.move_report(second.report.id, {ReportStatus.OPEN}, ReportStatus.DECLINED)
    third = await report(library, DUNE_4K_ITEM, ReportKind.CAM)
    assert third.report.decision is Decision.RECORDED
    assert third.evidence.describe() == "1 report and no failed file check"
    # ...but it covers only that report: two new ones stand on their own evidence.
    fourth = await report(library, DUNE_4K_ITEM, ReportKind.CAM, user="d2")
    assert fourth.report.decision is Decision.REPLACEABLE


async def test_one_friends_claims_never_make_a_healthy_file_replaceable(library):
    # A moment past the end of a full, clean file.
    past_the_end = await report(library, DUNE_4K_ITEM, ReportKind.WONT_PLAY, "freezes", at=12600.0)
    assert past_the_end.report.health == "ok" and past_the_end.report.decision is Decision.RECORDED
    # A decode line the audit doesn't know, or a flaky mount.
    for line in ("[h264 @ 0x55] Could not find ref with POC 12", "Read error: Input/output error"):
        library.services.probe.errors[FORKS] = (line,)
        filed = await report(library, FORKS_ITEM, ReportKind.WONT_PLAY)
        assert filed.report.health == "unreadable" and filed.report.decision is Decision.RECORDED


# HEVC converted below the file's bitrate: Tautulli says so, not why.
SHIELD_HEVC = dict(user_id=DANY, rating_key="9001", tmdb_id=438631, player="SHIELD Android TV",
                   video_decision="transcode", stream_bitrate_kbps=8000, source_bitrate_kbps=62103)  # fmt: skip


async def test_hevc_converted_below_the_file_at_home_is_the_players(library):
    # Meleys' Tautulli watches the Plex server Seerr's keys are of.
    library.services.tautulli["meleys"].sessions = [session(**SHIELD_HEVC, location="lan")]
    filed = await report(library, DUNE_4K_ITEM, ReportKind.WONT_PLAY, "it stutters")
    assert isinstance(filed.diagnosis, PlayerLimit) and filed.report.decision is Decision.ADVISED
    (cause,) = filed.diagnosis.causes
    assert cause.name == "hevc_unsupported" and "can't play this HEVC file as it is" in cause.cause


async def test_hevc_converted_below_the_file_away_from_home_checks_the_file(library):
    """Away from home it may be the app's remote quality or the connection, not the player."""
    library.services.tautulli["meleys"].sessions = [session(**SHIELD_HEVC, location="wan")]
    filed = await report(library, DUNE_4K_ITEM, ReportKind.WONT_PLAY, "it stutters")
    assert isinstance(filed.diagnosis, FileChecked) and filed.diagnosis.check.causes == ()
    assert filed.diagnosis.check.play is not None  # the play was found, and read
