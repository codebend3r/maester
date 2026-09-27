"""The performance epic's clients: the fleet monitor (respx) and the speed test (a scripted run)."""

import json

import pytest
import respx

from maester.clients import ClientError
from maester.clients.fleet import (
    FakeFleetMonitor,
    FleetMonitorClient,
    SupabaseLogin,
    SupabaseSession,
    Vitals,
)

MONITOR, SUPABASE = "http://meleys.lan:8010", "https://proj.supabase.co"
LOGIN = SupabaseLogin(SUPABASE, "anon-key", "maester@example.com", "s3cret")


def monitor(clock=lambda: 1_790_000_000.0) -> FleetMonitorClient:
    return FleetMonitorClient(MONITOR, SupabaseSession(LOGIN, clock=clock))


@respx.mock
async def test_fleet_vitals_sign_in_once_and_read_each_hosts_last_reading(fixture):
    sign_in = respx.post(f"{SUPABASE}/auth/v1/token", params={"grant_type": "password"}).respond(
        json=fixture("supabase_token")
    )
    cpu = respx.get(f"{MONITOR}/fleet/cpu", params={"minutes": 5}).respond(
        json=fixture("fleet_cpu")
    )
    respx.get(f"{MONITOR}/fleet/memory").respond(json=fixture("fleet_memory"))
    client = monitor()
    vitals = await client.vitals()
    assert vitals["meleys"] == Vitals(96.4, 61.0)  # the last point of the window
    assert vitals["vermithor"] == Vitals(22.0, None) and "caraxes" not in vitals
    login = sign_in.calls.last.request
    assert login.headers["apikey"] == "anon-key"
    assert json.loads(login.content) == {"email": "maester@example.com", "password": "s3cret"}
    token = fixture("supabase_token")["access_token"]
    assert cpu.calls.last.request.headers["Authorization"] == f"Bearer {token}"
    await client.vitals()
    assert sign_in.call_count == 1  # the token is kept while it's good


@respx.mock
async def test_fleet_signs_in_again_near_expiry_and_after_a_401(fixture):
    now = [1_790_000_000.0]
    token = fixture("supabase_token")
    sign_in = respx.post(f"{SUPABASE}/auth/v1/token")
    # Each sign-in is good for an hour from when it's made.
    sign_in.side_effect = lambda request: respx.MockResponse(
        200, json={**token, "expires_at": now[0] + 3600}
    )
    respx.get(f"{MONITOR}/fleet/memory").respond(json=fixture("fleet_memory"))
    cpu = respx.get(f"{MONITOR}/fleet/cpu")
    cpu.side_effect = [
        respx.MockResponse(401, json={"detail": "unauthorized"}),
        respx.MockResponse(200, json=fixture("fleet_cpu")),
        respx.MockResponse(200, json=fixture("fleet_cpu")),
    ]
    client = monitor(clock=lambda: now[0])
    assert (await client.vitals())["meleys"].cpu_percent == 96.4
    assert sign_in.call_count == 2  # the monitor refused the first token: signed in again
    now[0] += 3600 - 30  # inside the margin before that token expires
    await client.vitals()
    assert sign_in.call_count == 3  # the CPU and memory reads shared one sign-in


@respx.mock
async def test_fleet_errors_other_than_401_are_not_retried(fixture):
    sign_in = respx.post(f"{SUPABASE}/auth/v1/token").respond(json=fixture("supabase_token"))
    respx.get(f"{MONITOR}/fleet/cpu").respond(status_code=500, text="boom")
    respx.get(f"{MONITOR}/fleet/memory").respond(json=fixture("fleet_memory"))
    with pytest.raises(ClientError, match="500"):
        await monitor().vitals()
    assert sign_in.call_count == 1


@respx.mock
async def test_fleet_ping_reads_the_open_health_route():
    health = respx.get(f"{MONITOR}/health").respond(
        json={"ok": True, "heartbeat_age_seconds": 12.0, "stale": False}
    )
    await monitor().ping()
    assert "Authorization" not in health.calls.last.request.headers


async def test_fake_fleet_monitor_answers_or_is_down():
    fake = FakeFleetMonitor({"meleys": Vitals(10.0, 20.0)})
    assert await fake.vitals() == {"meleys": Vitals(10.0, 20.0)}
    fake.down = True
    with pytest.raises(ClientError, match="connection refused"):
        await fake.vitals()
