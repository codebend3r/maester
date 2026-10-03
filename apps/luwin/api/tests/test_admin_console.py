from datetime import UTC, datetime, timedelta

import pytest

from luwin.agent.limits import KillSwitch
from luwin.agent.loop import Agent
from luwin.agent.runner import ToolRunner
from luwin.agent.tools import Tier
from luwin.agent.tools import registry as app_registry
from luwin.chat.admin import AdminConsole
from luwin.chat.identity import IdentityService
from luwin.chat.service import ChatService, ChatUser
from luwin.clients.seerr import MediaDetails, MediaRequest, MediaStatus, RequestStatus
from luwin.config import Settings
from luwin.notify import Announcement, ApprovalPost
from luwin.store import SpaceSample
from luwin.store.base import stamp
from tests.factories import seerr_server
from tests.fake_model import FakeModel, text_message, tool_message

# Importing the tools package registers the real tools into `app_registry`.
import luwin.tools  # noqa: F401  isort: skip

FRIEND = ChatUser("f1", "Friend")
ADMIN = ChatUser("a1", "Boss")
DUNE = MediaDetails(438631, "movie", "Dune", 2021, "", MediaStatus.UNKNOWN, MediaStatus.UNKNOWN)


def make_console(services, store, *script) -> AdminConsole:
    """The console, with a chat service whose model says what `script` says."""
    identity = IdentityService(store, services)
    store.upsert_user(ADMIN.id, tier_override="admin")
    kill = KillSwitch(store)
    agent = Agent(
        model_client=FakeModel.scripted(*script),
        model="fake",
        runner=ToolRunner(app_registry, kill_switch=kill),
        store=store,
        services=services,
        settings=Settings(),
    )
    return AdminConsole(
        identity=identity,
        chat=ChatService(agent=agent, identity=identity, store=store),
        store=store,
        services=services,
        settings=Settings(),
        kill_switch=kill,
    )


@pytest.fixture
def console(services, store):
    store.upsert_user(FRIEND.id, status="active", seerr_user_id=4, plex_username="dany")
    return make_console(services, store)


def test_every_command_is_the_admins_alone_and_a_refusal_is_audited(console, store):
    assert console.kill(FRIEND, True).text == "Only the admin can use /kill."
    assert console.audit(FRIEND).text == "Only the admin can use /audit."
    assert not console.kill_switch.enabled
    rows = store.audit_recent(2)
    assert [(r.tool, r.ok, r.discord_id) for r in rows] == [
        ("/audit", False, FRIEND.id),
        ("/kill", False, FRIEND.id),
    ]


def test_the_kill_switch_goes_on_with_a_reason_and_off_again(console, store):
    on = console.kill(ADMIN, True, "bad grabs tonight")
    assert on.text.startswith("Kill switch on") and "bad grabs tonight" in on.text
    flag = store.flag("kill")
    assert (flag.message, flag.set_by) == ("bad grabs tonight", ADMIN.id)
    assert console.kill(ADMIN, False).text.startswith("Kill switch off")
    assert console.kill(ADMIN, False).text == "The kill switch was already off."
    assert [r.args["on"] for r in store.audit_recent(3, tool="/kill")] == [False, False, True]


def test_admin_sets_and_clears_a_tier_override(console, store):
    identity = console.identity
    assert console.set_tier(FRIEND, ADMIN.id, "admin").text == "Only the admin can use /tier."
    assert console.set_tier(ADMIN, FRIEND.id, "trusted").text.endswith("trusted.")
    assert identity.tier_for(FRIEND.id) == Tier.TRUSTED
    assert console.set_tier(ADMIN, FRIEND.id, None).text.endswith("the default.")
    assert identity.tier_for(FRIEND.id) == Tier.FRIEND
    assert console.set_tier(ADMIN, FRIEND.id, "king").text.startswith("Unknown tier")
    rows = store.audit_recent(tool="/tier")
    assert [(r.args["tier"], r.ok) for r in rows] == [
        ("king", False),
        (None, True),
        ("trusted", True),
        ("admin", False),
    ]


def test_audit_lists_the_latest_rows_newest_first_named_as_the_admin_knows_them(console, store):
    store.audit(
        discord_id=FRIEND.id, tool="request_media", args={"tmdb_id": 438631}, result={}, ok=True
    )
    store.audit(discord_id=None, tool="sweep_stalled", args={}, result="", ok=False, host="meleys")
    reply = console.audit(ADMIN, 2)
    first, second = reply.text.splitlines()
    assert "luwin: `sweep_stalled` on meleys, refused or failed" in first
    assert 'dany: `request_media`, ok {"tmdb_id": 438631}' in second
    # Asking is audited too, after the listing.
    assert store.audit_recent(1)[0].tool == "/audit"
    assert len(console.audit(ADMIN, 500).text.splitlines()) == 3


async def test_pending_lists_open_approvals_and_raises_ones_seerr_holds_without_one(
    console, services, store
):
    store.create_pending(
        kind="approve", action="link_account", requester="n1", payload={},
        summary="Link Newbie to Plex account new@example.com", ttl=timedelta(days=7),
    )  # fmt: skip
    services.seerr.details[("movie", 438631)] = DUNE
    services.seerr.requests = [
        MediaRequest(9, RequestStatus.PENDING, "movie", 438631, True, 4),
        MediaRequest(10, RequestStatus.APPROVED, "movie", 438631, False, 4),
    ]
    reply = await console.pending(ADMIN)
    lines = reply.text.splitlines()
    assert lines[0] == "2 waiting on you:"
    assert lines[1].startswith("- Link Newbie") and "expires in about 7 d" in lines[1]
    assert lines[2].startswith("- 4K Dune (2021) for dany (asked just now")
    assert [p.summary for p in reply.offers] == [line[2:].split(" (asked")[0] for line in lines[1:]]
    assert store.pending_about("seerr-request:9") == reply.offers[1]
    # Asked again: nothing is raised twice.
    assert len((await console.pending(ADMIN)).offers) == 2


async def test_pending_says_when_seerr_couldnt_be_read(console, services):
    services.seerr.down = True

    async def down(**kw):
        services.seerr.refuse_if_down("/api/v1/request")

    services.seerr.list_requests = down
    reply = await console.pending(ADMIN)
    assert reply.text.startswith("Nothing is waiting on you.")
    assert "Couldn't read Seerr's pending requests" in reply.text


def test_forecast_says_when_each_volume_fills_or_that_there_are_no_samples(console, store):
    assert console.forecast(FRIEND).text == "Only the admin can use /forecast."
    assert console.forecast(ADMIN).text.startswith("No free-space samples yet")
    today = datetime.now(UTC).date()
    store.record_space(
        today,
        [SpaceSample("v|40|vermithor", today, "/Vermithor (vermithor)", 4 * 10**12, 40 * 10**12)],
    )
    assert console.forecast(ADMIN).text == (
        "- /Vermithor (vermithor): 4.0 TB free; 1 day of samples so far, a forecast needs 7."
    )
    assert store.audit_recent(1)[0].tool == "/forecast"


async def test_maintenance_holds_a_request_and_runs_it_when_it_ends(services, store):
    store.upsert_user(FRIEND.id, status="active", seerr_user_id=4, plex_username="dany")
    services.seerr.details[("movie", 438631)] = DUNE
    console = make_console(
        services,
        store,
        tool_message([("request_media", {"tmdb_id": 438631, "media_type": "movie"})]),
        text_message("The server's down for maintenance; I've saved it."),
        text_message("Dune went through; it's waiting on the admin."),
    )
    assert console.start_maintenance(FRIEND, "x").text == "Only the admin can use /maintenance."
    started = console.start_maintenance(ADMIN, "swapping a drive")
    assert started.text.startswith("Maintenance on") and store.flag("maintenance")
    (announced,) = started.notices
    assert isinstance(announced, Announcement) and "(swapping a drive)" in announced.text
    assert console.start_maintenance(ADMIN, "two drives").text.startswith("Maintenance was")

    asked = await console.chat.handle_message(FRIEND, "get Dune 2021")
    assert asked.text == "The server's down for maintenance; I've saved it."
    assert services.seerr.requests == []  # held, not sent
    (held,) = store.held_calls()
    assert (held.discord_id, held.tool) == (FRIEND.id, "request_media")
    audited = store.audit_recent(tool="request_media")[0]
    assert audited.held_id == held.id and audited.ok
    assert f"held for maintenance (#{held.id})" in console.audit(ADMIN, 5).text

    ended = await console.end_maintenance(ADMIN)
    assert store.flag("maintenance") is None and store.held_calls() == []
    (request,) = services.seerr.requests
    assert request.requested_by_id == 4 and not request.is_4k
    assert ended.text == (
        "Maintenance off. Ran 1 held:\n"
        '- dany: request_media: {"tmdb_id": 438631, "media_type": "movie"}: now waiting on your '
        "approval"
    )
    off, approval = ended.notices
    assert isinstance(off, Announcement) and isinstance(approval, ApprovalPost)
    ((to, dm),) = ended.dms
    assert to == FRIEND.id and dm.text == "Dune went through; it's waiting on the admin."
    # The friend's next turn sees what ran, like a confirmation.
    remembered = store.recent_messages(FRIEND.id, max_tokens=10_000)
    assert any(
        block.get("id") == f"toolu_held_{held.id}"
        for m in remembered
        if isinstance(m["content"], list)
        for block in m["content"]
    )
    assert (await console.end_maintenance(ADMIN)).text == (
        "Maintenance wasn't on, and nothing is held."
    )


async def test_a_held_call_runs_at_the_tier_its_caller_has_when_maintenance_ends(services, store):
    trusted = ChatUser("t1", "Trusty")
    store.upsert_user(
        trusted.id,
        status="active",
        seerr_user_id=7,
        plex_username="trusty",
        tier_override="trusted",
    )
    services.seerr.details[("movie", 438631)] = DUNE
    services.seerr.arr_servers["radarr"] = [seerr_server(1, "movie", "vermithor", is_4k=True)]
    console = make_console(
        services,
        store,
        tool_message([("request_media_4k", {"tmdb_id": 438631, "media_type": "movie"})]),
        text_message("Saved for after maintenance."),
        text_message("4K isn't open to you any more, so that one didn't go through."),
    )
    console.start_maintenance(ADMIN)
    await console.chat.handle_message(trusted, "Dune in 4K")
    # Their trusted tier was taken away during the window: 4K is no longer theirs.
    store.upsert_user(trusted.id, tier_override=None)
    ended = await console.end_maintenance(ADMIN)
    assert services.seerr.requests == []
    assert "request_media_4k" in ended.text and "didn't go through" in ended.text
    ((to, dm),) = ended.dms  # they still hear how it went
    assert to == trusted.id and "didn't go through" in dm.text


async def test_a_held_call_whose_service_is_still_down_stays_held_for_the_next_end(services, store):
    store.upsert_user(FRIEND.id, status="active", seerr_user_id=4, plex_username="dany")
    services.seerr.details[("movie", 438631)] = DUNE
    console = make_console(
        services,
        store,
        tool_message([("request_media", {"tmdb_id": 438631, "media_type": "movie"})]),
        text_message("Saved."),
        text_message("It went through."),
    )
    console.start_maintenance(ADMIN)
    await console.chat.handle_message(FRIEND, "get Dune")
    services.seerr.down = True
    real_details, services.seerr.media_details = services.seerr.media_details, None

    async def down(media_type, tmdb_id):
        services.seerr.refuse_if_down("/api/v1/movie")

    services.seerr.media_details = down
    first = await console.end_maintenance(ADMIN)
    assert "Still held" in first.text and first.dms == () and len(store.held_calls()) == 1
    services.seerr.down, services.seerr.media_details = False, real_details
    second = await console.end_maintenance(ADMIN)
    assert second.text.startswith("Running what's still held. Ran 1 held:")
    assert store.held_calls() == [] and len(services.seerr.requests) == 1
    assert [to for to, _ in second.dms] == [FRIEND.id]


async def test_a_long_window_still_leaves_the_held_call_in_view_for_the_follow_up(services, store):
    store.upsert_user(FRIEND.id, status="active", seerr_user_id=4, plex_username="dany")
    services.seerr.details[("movie", 438631)] = DUNE
    console = make_console(
        services,
        store,
        tool_message([("request_media", {"tmdb_id": 438631, "media_type": "movie"})]),
        text_message("Saved."),
        text_message("It went through."),
    )
    console.start_maintenance(ADMIN)
    await console.chat.handle_message(FRIEND, "get Dune")
    # An overnight window: everything said before it is past the idle reset.
    store._conn.execute(
        "UPDATE conversations SET created_at = ?", (stamp(datetime.now(UTC) - timedelta(hours=9)),)
    )
    await console.end_maintenance(ADMIN)
    history = store.recent_messages(
        FRIEND.id, max_tokens=10_000, since=datetime.now(UTC) - timedelta(hours=6)
    )
    blocks = [b for m in history if isinstance(m["content"], list) for b in m["content"]]
    assert any(b.get("type") == "tool_use" and b["name"] == "request_media" for b in blocks)
    assert history[0]["content"].startswith("(What I asked for while the server was down")


async def test_pending_posts_what_it_raises_and_one_bad_title_doesnt_stop_the_rest(
    console, services, store
):
    services.seerr.details[("movie", 438631)] = DUNE
    services.seerr.requests = [
        MediaRequest(9, RequestStatus.PENDING, "movie", 438631, True, 4),
        MediaRequest(10, RequestStatus.PENDING, "movie", 11, False, 4),  # Seerr can't find it
    ]
    reply = await console.pending(ADMIN)
    (post,) = reply.notices
    assert isinstance(post, ApprovalPost) and post.text.startswith("dany asks for Dune (2021)")
    assert [p.summary for p in reply.offers] == ["4K Dune (2021) for dany"]
    assert "Couldn't raise an approval for Seerr request #10" in reply.text
