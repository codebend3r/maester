"""The performance epic's clients: every client's ping and the fleet monitor (respx), and
the speed test (a scripted run)."""

import json

import pytest
import respx

from maester.clients import (
    ClientError,
    FakeTautulliClient,
    PlexClient,
    RadarrClient,
    SabnzbdClient,
    SeerrClient,
    SonarrClient,
    TautulliClient,
    WizarrClient,
)
from maester.clients.base import every_host
from maester.clients.fleet import FakeFleetMonitor, FleetMonitorClient, Vitals
from maester.clients.process import Completed
from maester.clients.speedtest import FakeSpeedTest, OoklaSpeedTest, SpeedResult, SpeedTestFailed

MONITOR = "http://meleys.lan:8010"


def monitor() -> FleetMonitorClient:
    return FleetMonitorClient(MONITOR, "fleet-token")


@respx.mock
async def test_fleet_vitals_read_each_hosts_last_reading_with_the_token(fixture):
    cpu = respx.get(f"{MONITOR}/fleet/cpu", params={"minutes": 5}).respond(
        json=fixture("fleet_cpu")
    )
    respx.get(f"{MONITOR}/fleet/memory").respond(json=fixture("fleet_memory"))
    vitals = await monitor().vitals()
    assert vitals["meleys"] == Vitals(96.4, 61.0)  # the last point of the window
    assert vitals["vermithor"] == Vitals(22.0, None) and "caraxes" not in vitals
    assert cpu.calls.last.request.headers["Authorization"] == "Bearer fleet-token"


@respx.mock
async def test_fleet_errors_and_odd_answers_are_client_errors(fixture):
    respx.get(f"{MONITOR}/fleet/cpu").respond(status_code=401, json={"detail": "unauthorized"})
    respx.get(f"{MONITOR}/fleet/memory").respond(json=fixture("fleet_memory"))
    with pytest.raises(ClientError, match="401"):
        await monitor().vitals()
    respx.get(f"{MONITOR}/fleet/cpu").respond(json={"hosts": [{"name": "meleys", "points": [{}]}]})
    with pytest.raises(ClientError, match="unexpected shape"):
        await monitor().vitals()


@respx.mock
async def test_fleet_ping_reads_a_route_the_token_opens(fixture):
    memory = respx.get(f"{MONITOR}/fleet/memory").respond(json=fixture("fleet_memory"))
    await monitor().ping()
    assert memory.calls.last.request.headers["Authorization"] == "Bearer fleet-token"


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
        respx.get(f"{BASE}/api", params={"mode": "queue", "limit": "1"}).respond(
            json={"queue": {"status": "Idle", "slots": []}}
        ),
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
async def test_sabnzbd_refuses_a_wrong_key_in_its_answer_and_the_ping_says_so():
    respx.get(f"{BASE}/api").respond(json={"status": False, "error": "API Key Incorrect"})
    with pytest.raises(ClientError, match="API Key Incorrect"):
        await SabnzbdClient("meleys", BASE, "bad").ping()


@respx.mock
async def test_plex_pings_by_naming_itself():
    identity = respx.get(f"{BASE}/identity").respond(
        json={"MediaContainer": {"machineIdentifier": "abc123", "version": "1.43.4"}}
    )
    await PlexClient(BASE, "tok").ping()
    assert identity.call_count == 1


async def test_every_host_names_the_hosts_that_cant_answer_and_raises_on_a_bug():
    class Host:
        def __init__(self, answer):
            self.answer = answer

        async def ask(self):
            if isinstance(self.answer, Exception):
                raise self.answer
            return self.answer

    refused = ClientError("tautulli", "GET", "/api/v2", None, "connection refused")
    found = await every_host({"b": Host(2), "a": Host(1), "c": Host(refused)}, lambda h: h.ask())
    assert found.answered == {"a": 1, "b": 2} and "connection refused" in found.unreachable["c"]
    with pytest.raises(KeyError):
        await every_host({"a": Host(KeyError("oops"))}, lambda h: h.ask())


async def test_a_downable_fake_answers_like_an_unreachable_service():
    tautulli = FakeTautulliClient(host="meleys")
    await tautulli.ping()
    tautulli.down = True
    with pytest.raises(ClientError, match="tautulli GET ping failed"):
        await tautulli.ping()
    assert FakeTautulliClient().down is False  # one fake's outage is its own


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
