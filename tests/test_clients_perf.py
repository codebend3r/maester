"""The performance epic's clients: every client's ping and the fleet monitor (respx), and
the speed test (a scripted run)."""

import json

import pytest
import respx

from maester.clients import (
    ClientError,
    PlexClient,
    RadarrClient,
    SabnzbdClient,
    SeerrClient,
    SonarrClient,
    TautulliClient,
    WizarrClient,
)
from maester.clients.fleet import (
    FakeFleetMonitor,
    FleetMonitorClient,
    SupabaseLogin,
    SupabaseSession,
    Vitals,
)
from maester.clients.process import Completed
from maester.clients.speedtest import FakeSpeedTest, OoklaSpeedTest, SpeedResult, SpeedTestFailed

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


class Scripted:
    """A process runner that answers once and records what it was asked to run."""

    def __init__(self, answer):
        self.answer, self.calls = answer, []

    async def __call__(self, argv, timeout):
        self.calls.append((list(argv), timeout))
        if isinstance(self.answer, Exception):
            raise self.answer
        return self.answer


async def test_ookla_result_is_read_in_kbps(fixture):
    run = Scripted(Completed(0, json.dumps(fixture("ookla_result")) + "\n", ""))
    result = await OoklaSpeedTest("meleys", run, timeout=60).measure()
    # Ookla gives bytes per second: 4,318,211 B/s is 34,546 kbps.
    assert (result.upload_kbps, result.download_kbps, result.ping_ms) == (34546, 942970, 8.1)
    assert (result.server, result.isp) == ("Rogers, Toronto, ON", "Rogers Communications")
    assert result.url.startswith("https://www.speedtest.net/result/c/")
    ((argv, timeout),) = run.calls
    assert argv == ["speedtest", "--accept-license", "--accept-gdpr", "--format=json"]
    assert timeout == 60


@pytest.mark.parametrize(
    ("answer", "why"),
    [
        (Completed(None, "", ""), "longer than 90 s"),
        (
            Completed(2, "", '{"type":"log","timestamp":"2026-09-27T10:00:00Z","message":'
                      '"Configuration - Couldn\'t resolve host name (HostNotFoundException)",'
                      '"level":"error"}\n'),
            "Couldn't resolve host name",
        ),
        (Completed(1, "", "Segmentation fault\n"), "Segmentation fault"),
        (Completed(0, '{"type":"result","upload":{}}', ""), "missing 'bandwidth'"),
        (FileNotFoundError(2, "No such file or directory: 'speedtest'"), "couldn't start"),
    ],
)  # fmt: skip
async def test_ookla_failures_say_why(answer, why):
    with pytest.raises(SpeedTestFailed, match=why):
        await OoklaSpeedTest("meleys", Scripted(answer)).measure()


async def test_fake_speed_test_answers_or_fails():
    result = SpeedResult(40_000, 900_000, 8.0, "Rogers, Toronto, ON", "Rogers", "u")
    fake = FakeSpeedTest(result=result)
    assert await fake.measure() == result and fake.runs == 1
    with pytest.raises(SpeedTestFailed, match="no test server"):
        await FakeSpeedTest().measure()


BASE = "http://svc.test"


@respx.mock
async def test_each_client_pings_its_cheapest_live_route():
    routes = [
        respx.get(f"{BASE}/identity").respond(json={"MediaContainer": {"machineIdentifier": "m"}}),
        respx.get(f"{BASE}/api/v1/status").respond(json={"version": "2.7.3", "commitTag": "x"}),
        respx.get(f"{BASE}/api/status").respond(json={"users": 12, "invites": 3, "pending": 1, "expired": 0}),
        respx.get(f"{BASE}/api/v3/system/status").respond(json={"appName": "Sonarr", "version": "4.0.9"}),
        respx.get(f"{BASE}/api", params={"mode": "version"}).respond(json={"version": "4.3.3"}),
        respx.get(f"{BASE}/api/v2", params={"cmd": "status"}).respond(
            json={"response": {"result": "success", "message": "Ok", "data": {}}}
        ),
    ]  # fmt: skip
    await PlexClient(BASE, "tok").ping()
    await SeerrClient(BASE, "k").ping()
    await WizarrClient(BASE, "k").ping()
    await SonarrClient("meleys", BASE, "arr-key").ping()
    await RadarrClient("meleys", BASE, "arr-key").ping()
    await SabnzbdClient("meleys", BASE, "k").ping()
    await TautulliClient("meleys", BASE, "k").ping()
    assert all(route.called for route in routes)
    assert routes[3].calls.last.request.headers["X-Api-Key"] == "arr-key"
    assert routes[3].call_count == 2  # Sonarr and Radarr share the route


@respx.mock
async def test_a_ping_that_isnt_answered_is_a_client_error():
    respx.get(f"{BASE}/api/v2").respond(
        json={"response": {"result": "error", "message": "Invalid apikey", "data": {}}}
    )
    respx.get(f"{BASE}/api/v3/system/status").respond(status_code=401, text="Unauthorized")
    with pytest.raises(ClientError, match="Invalid apikey"):
        await TautulliClient("meleys", BASE, "bad").ping()
    with pytest.raises(ClientError, match="401"):
        await RadarrClient("meleys", BASE, "bad").ping()
