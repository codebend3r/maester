from datetime import UTC, datetime, timedelta

import pytest

from maester.agent.limits import KillSwitch
from maester.agent.tools import Tier
from maester.chat.admin import AdminConsole
from maester.chat.identity import IdentityService, RoleMap
from maester.chat.service import ChatUser
from maester.clients.seerr import MediaDetails, MediaRequest, MediaStatus, RequestStatus
from maester.config import Settings
from maester.store import SpaceSample

ADMIN_ROLE = 1
FRIEND = ChatUser("f1", "Friend")
ADMIN = ChatUser("a1", "Boss", frozenset({ADMIN_ROLE}))
DUNE = MediaDetails(438631, "movie", "Dune", 2021, "", MediaStatus.UNKNOWN, MediaStatus.UNKNOWN)


@pytest.fixture
def console(services, store):
    store.upsert_user(FRIEND.id, status="active", seerr_user_id=4, plex_username="dany")
    return AdminConsole(
        identity=IdentityService(store, services, RoleMap(ADMIN_ROLE, 0)),
        store=store,
        services=services,
        settings=Settings(),
        kill_switch=KillSwitch(store),
    )


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
    assert identity.tier_for(FRIEND.id, set()) == Tier.TRUSTED
    assert console.set_tier(ADMIN, FRIEND.id, None).text.endswith("from roles.")
    assert identity.tier_for(FRIEND.id, set()) == Tier.FRIEND
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
    assert "maester: `sweep_stalled` on meleys, refused or failed" in first
    assert 'dany: `request_media`, ok {"tmdb_id": 438631}' in second
    # Asking is audited too, after the listing.
    assert store.audit_recent(1)[0].tool == "/audit"
    assert len(console.audit(ADMIN, 500).text.splitlines()) == 3


async def test_pending_lists_open_approvals_and_raises_ones_seerr_holds_without_one(
    console, services, store
):
    store.create_pending(
        kind="approve", action="link_account", requester="n1", payload={},
        summary="Link Discord user Newbie to Plex account new@example.com", ttl=timedelta(days=7),
    )  # fmt: skip
    services.seerr.details[("movie", 438631)] = DUNE
    services.seerr.requests = [
        MediaRequest(9, RequestStatus.PENDING, "movie", 438631, True, 4),
        MediaRequest(10, RequestStatus.APPROVED, "movie", 438631, False, 4),
    ]
    reply = await console.pending(ADMIN)
    lines = reply.text.splitlines()
    assert lines[0] == "2 waiting on you:"
    assert lines[1].startswith("- Link Discord user Newbie") and "expires in about 7 d" in lines[1]
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
