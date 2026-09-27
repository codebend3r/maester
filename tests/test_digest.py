from datetime import UTC, datetime, timedelta

import pytest

from maester.agent.limits import KillSwitch
from maester.clients.arr import DiskSpace, QueueItem
from maester.clients.sabnzbd import Download
from maester.clients.seerr import Issue, MediaDetails, MediaRequest, MediaStatus, RequestStatus
from maester.config import Guardrails, Settings
from maester.jobs.digest import Digest
from maester.media import Copy, Decision, ReportKind
from maester.notify import AdminPost
from maester.store import SpaceSample, StallAction

NOW = datetime(2026, 9, 27, 12, 0, tzinfo=UTC)
TB = 10**12
DUNE = MediaDetails(438631, "movie", "Dune", 2021, "", MediaStatus.UNKNOWN, MediaStatus.UNKNOWN)
BEAR = MediaDetails(136315, "tv", "The Bear", 2022, "", MediaStatus.AVAILABLE, MediaStatus.UNKNOWN)


@pytest.fixture
def digest(services, store):
    store.upsert_user("d1", status="active", seerr_user_id=4, plex_username="dany")
    services.seerr.details.update({("movie", 438631): DUNE, ("tv", 136315): BEAR})
    settings = Settings(guardrails=Guardrails(storage_pause_4k_percent=90))
    return Digest(services, store, settings, KillSwitch(store))


def sections(text: str) -> dict[str, list[str]]:
    found: dict[str, list[str]] = {}
    for block in text.split("\n\n")[1:]:
        head, *lines = block.splitlines()
        found[head.strip("*")] = [line.removeprefix("- ") for line in lines]
    return found


async def test_a_quiet_day_says_so_and_leaves_empty_sections_out(digest, services):
    for arr in (*services.radarr.values(), *services.sonarr.values()):
        arr.roots = []
    text = await digest.compose(NOW)
    assert text == "**Daily digest, Sun Sep 27**\nNothing to report."


async def test_every_section_says_what_happened_in_the_last_day(digest, services, store):
    store.raise_flag("maintenance", "new drives")
    store.create_pending(
        kind="approve", action="decide_request", requester="d1", payload={},
        summary="4K Dune (2021) for dany", ttl=timedelta(days=7),
    )  # fmt: skip
    services.seerr.requests = [
        MediaRequest(1, RequestStatus.PENDING, "movie", 438631, True, 4,
                     created_at=(NOW - timedelta(hours=2)).isoformat()),
        MediaRequest(2, RequestStatus.APPROVED, "tv", 136315, False, 9,
                     media_status=MediaStatus.PROCESSING, requested_by_name="Grandpa",
                     created_at=(NOW - timedelta(hours=5)).isoformat()),
        MediaRequest(3, RequestStatus.APPROVED, "movie", 438631, False, 4,
                     created_at=(NOW - timedelta(days=3)).isoformat()),  # old news
    ]  # fmt: skip
    services.seerr.open_issue_list = [
        Issue(12, "video", "tv", 136315, "dany", (NOW - timedelta(days=3)).isoformat(), 2, 7)
    ]
    report = store.add_report(
        discord_id="d1", kind=ReportKind.WONT_PLAY, copy=Copy("movie", 438631, True),
        title="Dune (2021)", rating_key=None, host="vermithor", file_id=55,
        file_path="/m/Dune.mkv", release_group="FLUX", health="corrupt", diagnosis={},
        description="", decision=Decision.REPLACEABLE,
    )  # fmt: skip
    store.audit(
        discord_id="d1", tool="replace_media", args={"report_id": report.id}, result="", ok=True
    )
    store.record_stall(
        host="meleys", kind="movie", item="movie:8", title="Oppenheimer (2023)",
        reason="no connections", action=StallAction.RESEARCHED,
    )  # fmt: skip
    services.radarr["vermithor"].queue_items = [
        QueueItem(4, "Rel", "warning", 10, 5, None, ("No files found are eligible for import",),
                  "nzo_x", 31, "warning", media_title="Barbie (2023)"),
    ]  # fmt: skip
    services.sabnzbd["meleys"].history_items = [
        Download("nzo_f", "Foundation.S02E03", "Failed", 0, 1, None, "Repair failed",
                 completed=int((NOW - timedelta(hours=3)).timestamp())),
        Download("nzo_old", "Old.Failure", "Failed", 0, 1, None, "x",
                 completed=int((NOW - timedelta(days=2)).timestamp())),
    ]  # fmt: skip
    services.radarr["meleys"].disks = [DiskSpace("/Movies", int(0.5 * TB), 16 * TB)]
    services.sonarr["vermithor"].down = True

    text = await digest.compose(NOW)
    assert text.startswith("**Daily digest, Sun Sep 27**")
    found = sections(text)
    (window,) = found["Switched on"]
    assert window.startswith("Maintenance has been on since ")
    assert window.endswith(" (new drives): requests and replacements are held.")
    assert found["Waiting on you (1)"][0].startswith("4K Dune (2021) for dany (asked")
    assert found["New requests"] == [
        "Dune (2021) in 4K for dany: waiting for approval",
        "The Bear (2022) in 1080p for Grandpa: requested, downloading",
    ]
    assert found["Open issues"] == [
        "#12 The Bear (2022) S02E07: video, raised by dany, about 3 d ago"
    ]
    assert found["Replaced"] == ["Dune (2021) in 4K on vermithor: won't play"]
    assert found["Downloads on meleys"] == [
        "Oppenheimer (2023): stalled, so its release was blocklisted and searched again "
        "(no connections)",
        "Foundation.S02E03: failed in SABnzbd (Repair failed)",
    ]
    assert found["Downloads on vermithor"] == [
        "Barbie (2023): stuck in Radarr (No files found are eligible for import)"
    ]
    assert found["Space"][0] == (
        "/Movies (meleys): 500.0 GB free of 16.0 TB, 96.9% used (at or past the 4K limit)"
    )
    assert [line.split(":")[0] for line in found["Couldn't check"]] == [
        "Sonarr on vermithor's queue",
        "Sonarr on vermithor's free space",
    ]


async def test_the_forecast_and_a_bad_release_group_come_along_when_they_matter(
    digest, services, store
):
    start = NOW.date() - timedelta(days=20)
    store.record_space(
        NOW.date(),
        [
            SpaceSample("v", start + timedelta(days=n), "/Vermithor (vermithor)",
                        int(4 * TB - n * 150 * 10**9), 40 * TB)
            for n in range(21)
        ],
    )  # fmt: skip
    for n in (1, 2, 3):
        store.add_report(
            discord_id="d1", kind=ReportKind.CAM, copy=Copy("movie", n, False),
            title=f"Movie {n}", rating_key=None, host="meleys", file_id=n, file_path="",
            release_group="CAMz", health=None, diagnosis={}, description="",
            decision=Decision.REPLACEABLE,
        )  # fmt: skip
    found = sections(await digest.compose(NOW))
    (filling,) = [line for line in found["Space"] if line.startswith("Filling")]
    assert "/Vermithor (vermithor): 1.0 TB free" in filling and "full in about 7 days" in filling
    (suggestion,) = found["Release groups to look at"]
    assert suggestion.startswith("CAMz: 3 reported files in 30 days")
    # Suggested once: the next digest leaves it out.
    assert "Release groups to look at" not in sections(await digest.compose(NOW))


async def test_the_digest_is_one_admin_post(digest):
    (post,) = await digest()
    assert isinstance(post, AdminPost) and post.text.startswith("**Daily digest")
