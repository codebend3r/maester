from types import SimpleNamespace

from maester.agent.tools import Tier, ToolContext, registry
from maester.clients import FakeTautulliClient
from maester.config import Settings
from maester.tools.basics import server_status
from tests.factories import session


class Broken:
    async def activity(self):
        raise ConnectionError("down")


async def test_server_status_reports_each_host_and_survives_a_dead_one(store):
    services = SimpleNamespace(
        tautulli={
            "vermithor": FakeTautulliClient(
                host="vermithor",
                sessions=[
                    session(),
                    session(relayed=True, transcode_decision="transcode", bandwidth_kbps=2000),
                ],
            ),
            "meleys": Broken(),
        }
    )
    ctx = ToolContext("u", Tier.FRIEND, services, store, Settings())
    out = await server_status(ctx)
    assert out["hosts"]["vermithor"] == {
        "reachable": True,
        "streams": 2,
        "transcodes": 1,
        "total_bandwidth_mbps": 10.0,
        "wan_bandwidth_mbps": 10.0,
        "relayed_streams": 1,
    }
    assert (
        out["hosts"]["meleys"]["reachable"] is False and "down" in out["hosts"]["meleys"]["error"]
    )


async def test_server_status_without_tautulli(store):
    out = await server_status(
        ToolContext("u", Tier.FRIEND, SimpleNamespace(tautulli={}), store, Settings())
    )
    assert out.is_error and "No Tautulli instance is configured" in out.content


def test_tool_is_registered_for_friends():
    assert "server_status" in {s.name for s in registry.for_tier(Tier.FRIEND)}
