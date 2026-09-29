from datetime import UTC, datetime, timedelta

import pytest

from maester.clients.wizarr import WizarrUser
from maester.config import Access, Settings, load_settings
from maester.jobs.expiry import remind_expiring


def user(n, email, days, name=""):
    """A Wizarr record whose access ends `days` from now (None: never)."""
    end = None if days is None else (datetime.now(UTC) + timedelta(days=days, hours=2)).isoformat()
    return WizarrUser(n, name or email.split("@")[0], email, end, "Meleys")


@pytest.fixture
def friends(services, store):
    store.upsert_user("d1", status="active", seerr_user_id=4, plex_email="dany@example.com")
    store.upsert_user("d2", status="active", seerr_user_id=5, plex_email="pal@example.com")
    store.upsert_user("d3", status="pending", seerr_user_id=6, plex_email="soon@example.com")
    return services


async def test_a_friend_hears_a_week_out_and_a_day_out_once_each(friends, store):
    end = datetime(2026, 10, 10, 18, 0, tzinfo=UTC)
    # Two servers, two records: access ends at the earlier one.
    friends.wizarr.user_list = [
        WizarrUser(1, "dany", "dany@example.com", (end + timedelta(days=20)).isoformat(), "A"),
        WizarrUser(2, "dany", "dany@example.com", end.isoformat(), "B"),
    ]

    async def on(day):
        clock = datetime(2026, 10, day, 12, 0, tzinfo=UTC)
        return await remind_expiring(friends, store, Settings(), lambda: clock)

    assert await on(1) == []  # nine days out
    (week,) = await on(4)
    assert week.to == "d1" and week.text == (
        "Heads up: your Plex access ends in 6 days (Sat Oct 10). Ask the admin if you'd like "
        "to keep it going."
    )
    assert await on(5) == []  # once
    (day,) = await on(9)
    assert "ends tomorrow (Sat Oct 10)" in day.text
    assert await on(10) == []


async def test_a_missed_week_sends_only_the_nearest_reminder_and_a_renewal_starts_afresh(
    friends, store
):
    friends.wizarr.user_list = [user(1, "pal@example.com", 1)]
    (dm,) = await remind_expiring(friends, store, Settings())
    assert dm.to == "d2" and "ends tomorrow" in dm.text
    assert await remind_expiring(friends, store, Settings()) == []
    friends.wizarr.user_list = [user(1, "pal@example.com", 7)]  # renewed
    (renewed,) = await remind_expiring(friends, store, Settings())
    assert "in 7 days" in renewed.text


async def test_nobody_far_off_unlimited_expired_or_unlinked_hears_anything(friends, store):
    friends.wizarr.user_list = [
        user(1, "dany@example.com", 20),
        user(2, "pal@example.com", None, name="pal"),
        user(3, "soon@example.com", 2),  # their link isn't approved
    ]
    assert await remind_expiring(friends, store, Settings()) == []
    friends.wizarr.user_list = [user(1, "dany@example.com", -3)]
    assert await remind_expiring(friends, store, Settings()) == []


async def test_the_text_is_the_admins_and_points_at_the_contribution_link(friends, store):
    settings = Settings(
        access=Access(
            contribution_url="https://pay.example/westeroz",
            reminder="Your access ends {when}, on {date}. {renew}",
        )
    )
    friends.wizarr.user_list = [user(1, "dany@example.com", 3)]
    (dm,) = await remind_expiring(friends, store, settings)
    assert dm.text.startswith("Your access ends in 3 days, on ")
    assert dm.text.endswith("To keep it going, chip in here: https://pay.example/westeroz")


async def test_wizarr_down_skips_a_day_and_a_bad_template_fails_on_boot(friends, store):
    friends.wizarr.down = True
    assert await remind_expiring(friends, store, Settings()) == []
    with pytest.raises(ValueError, match="EXPIRY_REMINDER"):
        load_settings({"EXPIRY_REMINDER": "ends in {days}"})


async def test_reminders_go_out_on_the_days_configured_and_only_by_email(friends, store):
    settings = Settings(access=Access(remind_days=(4, 1)))
    friends.wizarr.user_list = [user(1, "dany@example.com", 6)]
    assert await remind_expiring(friends, store, settings) == []  # renewing monthly: not yet
    friends.wizarr.user_list = [user(1, "someone@else.com", 1, name="dany")]
    assert await remind_expiring(friends, store, Settings()) == []  # a username isn't enough
    assert load_settings({"EXPIRY_REMIND_DAYS": "1, 4"}).access.remind_days == (4, 1)
    with pytest.raises(ValueError, match="EXPIRY_REMIND_DAYS"):
        load_settings({"EXPIRY_REMIND_DAYS": "a week"})
