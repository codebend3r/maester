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
from maester.clients.seerr import (
    ArrRef,
    MediaStatus,
    Refusal,
    RequestRefused,
    RequestStatus,
    Routing,
    SearchResult,
)
from maester.clients.sonarr import Episode
from maester.clients.wizarr import Invite, WizarrUser, honored_expiry_days, redeemer

BASE = "http://svc.test"


@respx.mock
async def test_seerr_search_drops_people_and_parses_status(fixture):
    respx.get(f"{BASE}/api/v1/search").respond(json=fixture("seerr_search"))
    results = await SeerrClient(BASE, "k").search("dune")
    assert [r.year for r in results] == [2021, 1984]
    assert results[0].status == MediaStatus.AVAILABLE
    assert results[1].status == MediaStatus.UNKNOWN
    assert (
        results[0].poster_url == "https://image.tmdb.org/t/p/w185/d5NXSklXo0qyIYkgV94XAgMrLYk.jpg"
    )
    assert results[1].poster_url is None


@respx.mock
async def test_seerr_create_request_impersonates_and_sends_seasons(fixture):
    route = respx.post(f"{BASE}/api/v1/request").respond(
        status_code=201, json=fixture("seerr_request")
    )
    req = await SeerrClient(BASE, "k").create_request("tv", 95396, seasons=[2, 3], as_user=4)
    sent = route.calls.last.request
    assert sent.headers["X-API-User"] == "4"
    assert sent.headers["X-Api-Key"] == "k"
    body = json.loads(sent.content)
    assert body["seasons"] == [2, 3] and "serverId" not in body and "tags" not in body
    assert req.id == 77 and req.seasons == (2, 3) and req.requested_by_id == 4
    assert req.status == RequestStatus.PENDING and req.media_status == MediaStatus.PENDING
    assert req.tvdb_id == 371980 and req.rating_key is None


@respx.mock
async def test_seerr_create_request_sends_routing(fixture):
    route = respx.post(f"{BASE}/api/v1/request").respond(
        status_code=201, json=fixture("seerr_request")
    )
    routing = Routing(server_id=0, tags=(1, 4, 7), profile_id=11)
    await SeerrClient(BASE, "k").create_request("tv", 95396, as_user=4, routing=routing)
    body = json.loads(route.calls.last.request.content)
    assert (body["serverId"], body["tags"], body["profileId"]) == (0, [1, 4, 7], 11)
    assert body["seasons"] == "all"


@pytest.mark.parametrize(
    ("status", "message", "reason"),
    [
        (403, "Movie Quota exceeded.", Refusal.QUOTA),
        (403, "You do not have permission to make 4K movie requests.", Refusal.PERMISSION),
        (403, "This media is blocklisted.", Refusal.BLOCKLISTED),
        (409, "Request for this media already exists.", Refusal.DUPLICATE),
        (202, "No seasons available to request", Refusal.NO_SEASONS),
    ],
)
@respx.mock
async def test_seerr_refusals_become_typed(status, message, reason):
    respx.post(f"{BASE}/api/v1/request").respond(status_code=status, json={"message": message})
    with pytest.raises(RequestRefused) as refused:
        await SeerrClient(BASE, "k").create_request("movie", 1, as_user=4)
    assert refused.value.reason == reason and refused.value.message == message


@respx.mock
async def test_seerr_other_failures_stay_client_errors():
    respx.post(f"{BASE}/api/v1/request").respond(status_code=500, json={"message": "boom"})
    with pytest.raises(ClientError, match="500"):
        await SeerrClient(BASE, "k").create_request("movie", 1, as_user=4)


@respx.mock
async def test_seerr_movie_details(fixture):
    respx.get(f"{BASE}/api/v1/movie/438631").respond(json=fixture("seerr_movie"))
    movie = await SeerrClient(BASE, "k").media_details("movie", 438631)
    assert movie.display == "Dune (2021)" and movie.media_type == "movie"
    assert movie.status == MediaStatus.AVAILABLE and movie.status_4k == MediaStatus.UNKNOWN
    assert movie.rating_key == "4348" and movie.rating_key_for(True) is None
    assert movie.collection_id == 726871 and movie.seasons == () and not movie.anime_by_tmdb
    # Seerr sent the standard copy to its server 0, where the movie's id is 8; no 4K copy.
    assert movie.arr_for(False) == ArrRef(0, 8) and movie.arr_for(True) is None


@respx.mock
async def test_seerr_tv_details_merge_tmdb_seasons_with_server_status(fixture):
    respx.get(f"{BASE}/api/v1/tv/136315").respond(json=fixture("seerr_tv"))
    show = await SeerrClient(BASE, "k").media_details("tv", 136315)
    assert show.display == "The Bear (2022)" and show.tvdb_id == 403245
    # No specials, nothing unaired.
    assert [(s.number, s.episodes) for s in show.seasons] == [(1, 8), (2, 10), (3, 10)]
    assert [s.status for s in show.seasons] == [
        MediaStatus.AVAILABLE,
        MediaStatus.PROCESSING,
        MediaStatus.UNKNOWN,
    ]


@respx.mock
async def test_seerr_request_actions_quota_and_services(fixture):
    client = SeerrClient(BASE, "k")
    respx.get(f"{BASE}/api/v1/request/77").respond(json=fixture("seerr_request"))
    approved = {**fixture("seerr_request"), "status": 2}
    approve = respx.post(f"{BASE}/api/v1/request/77/approve").respond(json=approved)
    declined = {**fixture("seerr_request"), "status": 3}
    decline = respx.post(f"{BASE}/api/v1/request/77/decline").respond(json=declined)
    assert (await client.get_request(77)).status == RequestStatus.PENDING
    assert (await client.approve_request(77)).status == RequestStatus.APPROVED and approve.called
    assert (await client.decline_request(77)).status == RequestStatus.DECLINED and decline.called

    respx.get(f"{BASE}/api/v1/user/4/quota").respond(json=fixture("seerr_quota"))
    quotas = await client.quota(4)
    assert (quotas.movie.used, quotas.movie.limit, quotas.movie.remaining) == (10, 10, 0)
    assert quotas.movie.restricted and quotas.of("tv").limit is None

    respx.get(f"{BASE}/api/v1/settings/sonarr").respond(json=fixture("seerr_sonarr_settings"))
    respx.get(f"{BASE}/api/v1/service/sonarr/0").respond(json=fixture("seerr_sonarr_service"))
    hd, uhd = await client.servers("sonarr")
    assert hd.is_default and not hd.is_4k and hd.url == "http://192.168.50.3:27021"
    assert uhd.is_4k and uhd.url == "https://meleys.lan:8989/sonarr4k"
    options = await client.server_options("sonarr", 0)
    assert options.tag("DUB").id == 7 and options.profile("dual audio").id == 11
    assert options.default_tags == (1,) and options.anime_tags == (1, 4)
    assert options.tag("nope") is None


@respx.mock
async def test_sonarr_series_by_tvdb_and_follow(fixture):
    client = SonarrClient("vermithor", BASE, "k")
    lookup = respx.get(f"{BASE}/api/v3/series", params={"tvdbId": 403245}).respond(
        json=fixture("sonarr_series")
    )
    series = await client.series_by_tvdb(403245)
    assert series.id == 12 and not series.monitored and lookup.called
    respx.get(f"{BASE}/api/v3/series", params={"tvdbId": 1}).respond(json=[])
    assert await client.series_by_tvdb(1) is None

    respx.get(f"{BASE}/api/v3/series/12").respond(json=fixture("sonarr_series")[0])
    put = respx.put(f"{BASE}/api/v3/series/12").respond(json={})
    await client.follow(12)
    sent = json.loads(put.calls.last.request.content)
    assert sent["monitored"] is True and sent["monitorNewItems"] == "all"
    assert sent["path"] == "/Vermithor/TV/The Bear"


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
    s, episode = activity.sessions
    assert activity.transcode_count == 1
    assert s.relayed and s.location == "wan"
    assert s.subtitle_decision == "burn" and s.transcode_reasons == ("Subtitle burn-in required",)
    assert s.video_dynamic_range == "Dolby Vision" and s.audio_channels == 8
    assert (s.dovi_profile, s.device, s.season, s.show_key) == (7, "Roku Ultra", None, "")
    assert (episode.show_key, episode.season, episode.episode) == ("5120", 2, 7)
    assert episode.dovi_profile == 0


@respx.mock
async def test_tautulli_history_and_stream_data_of_a_finished_play(fixture):
    route = respx.get(f"{BASE}/api/v2", params={"cmd": "get_history"}).respond(
        json=fixture("tautulli_history")
    )
    respx.get(f"{BASE}/api/v2", params={"cmd": "get_stream_data"}).respond(
        json=fixture("tautulli_stream_data")
    )
    client = TautulliClient("meleys", BASE, "k")
    episode, movie = await client.history(user_id=8008135, length=5)
    assert route.calls.last.request.url.params["user_id"] == "8008135"
    assert (episode.row_id, episode.show_key, episode.season, episode.episode) == (
        1124,
        "5120",
        2,
        7,
    )
    assert (movie.rating_key, movie.show_key, movie.season, movie.product) == (
        "4348",
        "",
        None,
        "Plex for Roku",
    )
    stream = await client.stream_data(1124)
    assert (stream.video_codec, stream.video_decision) == ("hevc", "transcode")
    assert (stream.audio_codec, stream.audio_decision, stream.subtitle_decision) == (
        "eac3",
        "direct play",
        "",
    )


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
    assert [(v.resolution, v.video_codec, v.bitrate_kbps) for v in item.versions] == [
        ("4k", "hevc", 62103),
        ("4k", "hevc", 18412),
        ("1080", "h264", 10240),
    ]
    assert item.versions[2].size_bytes == 11_980_000_000
    assert client.deep_link("m1", "4348") == (
        "https://app.plex.tv/desktop/#!/server/m1/details?key=%2Flibrary%2Fmetadata%2F4348"
    )


@respx.mock
async def test_plex_seasons_count_episodes_in_the_library(fixture):
    respx.get(f"{BASE}/library/metadata/5120/children").respond(json=fixture("plex_children"))
    seasons = await PlexClient(BASE, "tok").seasons("5120")
    assert [(s.number, s.episodes) for s in seasons] == [(1, 8), (2, 6)]


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
    unknown = MediaStatus.UNKNOWN
    seerr = FakeSeerrClient(
        results=[SearchResult(1, "movie", "Dune", 2021, "", None, unknown, unknown)]
    )
    assert [r.title for r in await seerr.search("du")] == ["Dune"]
    req = await seerr.create_request("movie", 1, is_4k=True, as_user=4)
    assert (await seerr.list_requests(user_id=4)) == [req]
    assert (await seerr.approve_request(req.id)).status == RequestStatus.APPROVED
    with pytest.raises(ClientError, match="404"):
        await seerr.media_details("movie", 2)


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


@respx.mock
async def test_arr_queue_reads_stall_messages_and_history_is_typed(fixture):
    respx.get(f"{BASE}/api/v3/queue").respond(json=fixture("radarr_queue_stalled"))
    history = respx.get(f"{BASE}/api/v3/history/movie", params={"movieId": 8}).respond(
        json=fixture("radarr_history")
    )
    client = RadarrClient("meleys", BASE, "k")
    (item,) = await client.queue()
    assert item.tracked_status == "warning" and item.media_id == 8
    assert item.error_messages == ("The download is stalled with no connections",)
    failed, grabbed = await client.history(8)
    assert history.called and (failed.id, failed.event_type) == (1002, "downloadFailed")
    assert failed.message == "Unpacking failed, write error or disk is full?"
    assert grabbed.event_type == "grabbed" and grabbed.message == ""


@respx.mock
async def test_seerr_collection_parts_in_release_order(fixture):
    respx.get(f"{BASE}/api/v1/collection/87359").respond(json=fixture("seerr_collection"))
    collection = await SeerrClient(BASE, "k").collection(87359)
    assert collection.name == "Mission: Impossible Collection"
    assert [(p.year, p.status) for p in collection.parts] == [
        (1996, MediaStatus.AVAILABLE),
        (2000, MediaStatus.UNKNOWN),
        (2006, MediaStatus.AVAILABLE),
        (2011, MediaStatus.PENDING),
        (2015, MediaStatus.UNKNOWN),
    ]
    assert all(p.media_type == "movie" for p in collection.parts)


@respx.mock
async def test_sonarr_episode_files_carry_season_and_audio_languages(fixture):
    respx.get(f"{BASE}/api/v3/episodefile", params={"seriesId": 40}).respond(
        json=fixture("sonarr_episodefile")
    )
    dual, japanese, unscanned = await SonarrClient("meleys", BASE, "k").episode_files(40)
    assert (dual.season, dual.audio_languages) == (1, ("jpn", "eng"))
    assert (japanese.season, japanese.audio_languages) == (2, ("jpn",))
    assert unscanned.audio_languages is None and unscanned.media_id == 40


@respx.mock
async def test_plex_answers_none_for_a_key_it_no_longer_has():
    respx.get(f"{BASE}/library/metadata/999").respond(status_code=404)
    respx.get(f"{BASE}/library/metadata/999/children").respond(status_code=404)
    respx.get(f"{BASE}/library/metadata/500").respond(status_code=500)
    client = PlexClient(BASE, "tok")
    assert await client.item("999") is None and await client.seasons("999") == []
    with pytest.raises(ClientError, match="500"):
        await client.item("500")
