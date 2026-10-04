import asyncio
from dataclasses import replace
from datetime import UTC, datetime, timedelta

from luwin.agent.tools import Tier, registry
from luwin.memo import Memo
from luwin.tools import service_health as health
from luwin.tools.service_health import service_health


class Hangs:
    async def ping(self):
        await asyncio.sleep(10)


async def test_everything_up(ctx):
    ctx.services.fleet = None
    out = await service_health(ctx)
    assert out["all_up"] and out["down"] == [] and out["checked"] == "just now"
    assert out["up"] == [
        "Plex", "Seerr", "Wizarr", "Sonarr on meleys", "Sonarr on vermithor", "Radarr on meleys",
        "Radarr on vermithor", "SABnzbd on meleys", "SABnzbd on vermithor", "Tautulli on meleys",
        "Tautulli on vermithor",
    ]  # fmt: skip


async def test_what_is_down_is_named_with_why_and_a_hung_one_times_out(ctx, monkeypatch):
    monkeypatch.setattr(health, "PING_TIMEOUT", 0.05)
    ctx.services.plex.down = True
    ctx.services.radarr["vermithor"].down = True
    ctx.services.tautulli["meleys"] = Hangs()
    ctx.services.fleet.down = True
    out = await service_health(ctx)
    assert not out["all_up"]
    down = {d["service"]: d["why"] for d in out["down"]}
    assert set(down) == {"Plex", "Radarr on vermithor", "Tautulli on meleys", "the fleet monitor"}
    assert (
        "connection refused" in down["Plex"]
        and down["Tautulli on meleys"] == "no answer within 0.05 s"
    )
    assert "Seerr" in out["up"] and "Tautulli on vermithor" in out["up"]


async def test_the_answer_is_kept_for_a_minute(ctx):
    now = [datetime(2026, 9, 27, 23, 59, tzinfo=UTC)]
    ctx = replace(ctx, memo=Memo(lambda: now[0]))
    await service_health(ctx)
    ctx.services.plex.down = True
    now[0] += timedelta(seconds=59)
    kept = await service_health(ctx)
    assert kept["all_up"] and kept["checked"] == "just now"
    now[0] += timedelta(seconds=1)
    assert [d["service"] for d in (await service_health(ctx))["down"]] == ["Plex"]


def test_tool_is_registered_for_friends():
    assert "service_health" in {s.name for s in registry.for_tier(Tier.FRIEND)}


async def test_a_maintenance_window_is_named_with_the_admins_reason(ctx):
    assert "maintenance" not in await service_health(ctx)
    ctx.store.raise_flag("maintenance", "swapping a drive", "a1")
    out = await service_health(ctx)
    assert out["maintenance"]["message"] == "swapping a drive"
    assert out["maintenance"]["since"] == ctx.store.flag("maintenance").set_at
