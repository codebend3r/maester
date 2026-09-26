"""One recorded call per real client through respx, plus the fakes' behavior."""

import json

import pytest
import respx

from maester.clients import (
    ClientError,
    FakeSeerrClient,
    FakeSonarrClient,
    FakeWizarrClient,
    PlexClient,
    RadarrClient,
    SabnzbdClient,
    SeerrClient,
    SonarrClient,
    TautulliClient,
    WizarrClient,
)
from maester.clients.seerr import STATUS_AVAILABLE, STATUS_UNKNOWN, SearchResult
from maester.clients.sonarr import Episode
from maester.clients.wizarr import Invite, WizarrUser, honored_expiry_days, redeemer

BASE = "http://svc.test"


@respx.mock
async def test_seerr_search_drops_people_and_parses_status(fixture):
    respx.get(f"{BASE}/api/v1/search").respond(json=fixture("seerr_search"))
    results = await SeerrClient(BASE, "k").search("dune")
    assert [r.year for r in results] == [2021, 1984]
    assert results[0].status == STATUS_AVAILABLE
    assert results[1].status == STATUS_UNKNOWN


@respx.mock
async def test_seerr_create_request_impersonates_and_sends_seasons(fixture):
    route = respx.post(f"{BASE}/api/v1/request").respond(
        status_code=201, json=fixture("seerr_request")
    )
    req = await SeerrClient(BASE, "k").create_request("tv", 95396, seasons=[2, 3], as_user=4)
    sent = route.calls.last.request
    assert sent.headers["X-API-User"] == "4"
    assert sent.headers["X-Api-Key"] == "k"
    assert json.loads(sent.content)["seasons"] == [2, 3]
    assert req.id == 77 and req.seasons == (2, 3) and req.requested_by_id == 4


@respx.mock
async def test_sonarr_queue_percent_and_host(fixture):
    respx.get(f"{BASE}/api/v3/queue").respond(json=fixture("sonarr_queue"))
    client = SonarrClient("meleys", BASE, "k")
    (item,) = await client.queue()
    assert client.host == "meleys"
    assert item.percent == 80.0
    assert item.download_id == "SABnzbd_nzo_abc"


@respx.mock
async def test_radarr_movie_files_and_delete(fixture):
    respx.get(f"{BASE}/api/v3/moviefile").respond(json=fixture("radarr_moviefile"))
    delete = respx.delete(f"{BASE}/api/v3/moviefile/55").respond(status_code=200)
    client = RadarrClient("vermithor", BASE, "k")
    (f,) = await client.movie_files(8)
    assert f.quality == "Bluray-2160p" and f.release_group == "FLUX"
    await client.delete_movie_file(f.id)
    assert delete.called


@respx.mock
async def test_sabnzbd_queue_carries_the_api_key_as_a_param(fixture):
    route = respx.get(f"{BASE}/api").respond(json=fixture("sabnzbd_queue"))
    (d,) = await SabnzbdClient("meleys", BASE, "sab-key").queue()
    assert "apikey=sab-key" in str(route.calls.last.request.url)
    assert d.percent == 80.0 and d.nzo_id == "SABnzbd_nzo_abc"


@respx.mock
async def test_tautulli_activity_parses_the_diagnosis_fields(fixture):
    respx.get(f"{BASE}/api/v2").respond(json=fixture("tautulli_activity"))
    activity = await TautulliClient("vermithor", BASE, "k").activity()
    (s,) = activity.sessions
    assert activity.transcode_count == 1
    assert s.relayed and s.location == "wan"
    assert s.subtitle_decision == "burn" and s.transcode_reasons == ("Subtitle burn-in required",)
    assert s.video_dynamic_range == "Dolby Vision" and s.audio_channels == 8


@respx.mock
async def test_tautulli_error_result_raises():
    respx.get(f"{BASE}/api/v2").respond(
        json={"response": {"result": "error", "message": "Invalid apikey"}}
    )
    with pytest.raises(ClientError, match="Invalid apikey"):
        await TautulliClient("vermithor", BASE, "bad").activity()


@respx.mock
async def test_plex_item_exposes_tmdb_id_and_deep_link(fixture):
    respx.get(f"{BASE}/library/metadata/4348").respond(json=fixture("plex_metadata"))
    client = PlexClient(BASE, "tok")
    item = await client.item("4348")
    assert item.tmdb_id == 438631
    assert item.files[0].endswith("2160p.mkv")
    assert client.deep_link("m1", "4348").endswith("details?key=%2Flibrary%2Fmetadata%2F4348")


@respx.mock
async def test_wizarr_create_invite_snaps_expiry_up(fixture):
    respx.get(f"{BASE}/api/servers").respond(json={"servers": [{"id": 1}]})
    route = respx.post(f"{BASE}/api/invitations").respond(
        json={"invitation": {"id": 9, "code": "X", "url": "u"}}
    )
    inv = await WizarrClient(BASE, "k").create_invite(expires_in_days=10, duration="35")
    assert json.loads(route.calls.last.request.content)["expires_in_days"] == 30
    assert inv.code == "X"


@respx.mock
async def test_wizarr_redeemer_resolves_the_user_repr(fixture):
    respx.get(f"{BASE}/api/invitations").respond(json=fixture("wizarr_invitations"))
    (inv,) = await WizarrClient(BASE, "k").list_invites()
    users = [WizarrUser(281, "dany", "dany@example.com", None, "Meleys")]
    assert redeemer(inv, users).username == "dany"
    assert redeemer(Invite(1, "c", "u", used_by="DANY"), users).id == 281
    assert redeemer(Invite(1, "c", "u"), users) is None


@respx.mock
async def test_http_errors_become_client_errors():
    respx.get(f"{BASE}/api/v3/rootfolder").respond(status_code=401, text="Unauthorized")
    with pytest.raises(ClientError, match=r"sonarr GET /api/v3/rootfolder failed \(401\)"):
        await SonarrClient("meleys", BASE, "k").root_folders()


def test_honored_expiry_days():
    assert [honored_expiry_days(d) for d in (1, 2, 7, 8, 30, 90)] == [1, 7, 7, 30, 30, 30]


async def test_fake_seerr_round_trip():
    seerr = FakeSeerrClient(results=[SearchResult(1, "movie", "Dune", 2021, "", None, 1, 1)])
    assert [r.title for r in await seerr.search("du")] == ["Dune"]
    req = await seerr.create_request("movie", 1, is_4k=True, as_user=4)
    assert (await seerr.list_requests(user_id=4)) == [req]
    assert (await seerr.approve_request(req.id)).status == 2


async def test_fake_sonarr_tracks_destructive_calls():
    sonarr = FakeSonarrClient(
        host="meleys", episode_list=[Episode(1, 12, 2, 7, "Forks", False, None, True)]
    )
    assert (await sonarr.episodes(12))[0].number == 7
    await sonarr.mark_failed(99)
    await sonarr.episode_search([1])
    assert sonarr.failed == [99] and sonarr.searched == [[1]]


async def test_fake_wizarr_invite():
    wizarr = FakeWizarrClient()
    inv = await wizarr.create_invite(expires_in_days=7, duration="35")
    assert inv.code == "FAKE001" and (await wizarr.list_invites()) == [inv]
