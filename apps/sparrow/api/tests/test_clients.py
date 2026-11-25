"""One recorded call per real client through respx, plus the fakes' behavior."""

import json

import pytest
import respx

from sparrow.clients import (
    ClientError,
    FakeSeerrClient,
    FakeSonarrClient,
    FleetMonitorClient,
    RadarrClient,
    SabnzbdClient,
    SeerrClient,
    SonarrClient,
)
from sparrow.clients.base import gather_each
from sparrow.clients.seerr import (
    ArrRef,
    MediaDetails,
    MediaStatus,
    Refusal,
    RequestRefused,
    RequestStatus,
    Routing,
    SearchResult,
)
from sparrow.clients.sonarr import Episode

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
    assert req.tvdb_id == 371980


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
    assert movie.collection_id == 726871 and movie.seasons == () and not movie.anime_by_tmdb
    # Seerr sent the standard copy to its server 0, where the movie's id is 8; no 4K copy.
    assert movie.arr_for(False) == ArrRef(0, 8) and movie.arr_for(True) is None
    # Seerr's own id for it (what issues are filed against), and its runtime.
    assert (movie.media_id, movie.runtime_minutes) == (12, 155)


@respx.mock
async def test_seerr_tv_details_merge_tmdb_seasons_with_server_status(fixture):
    respx.get(f"{BASE}/api/v1/tv/136315").respond(json=fixture("seerr_tv"))
    show = await SeerrClient(BASE, "k").media_details("tv", 136315)
    assert show.display == "The Bear (2022)" and show.tvdb_id == 403245
    assert (show.media_id, show.runtime_minutes) == (31, 30)
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
    assert (await client.get_request(77)).status == RequestStatus.PENDING

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
async def test_seerr_issues_are_filed_as_the_user_against_seerrs_media_id():
    route = respx.post(f"{BASE}/api/v1/issue").respond(status_code=201, json={"id": 34})
    comment = respx.post(f"{BASE}/api/v1/issue/34/comment").respond(json={"id": 34})
    client = SeerrClient(BASE, "k")
    issue = await client.create_issue(31, 1, "S02E07 freezes", as_user=4, season=2, episode=7)
    assert issue == 34
    sent = route.calls.last.request
    assert "X-API-User" not in sent.headers  # the admin key files it, naming the friend
    assert json.loads(sent.content) == {
        "issueType": 1, "message": "S02E07 freezes", "mediaId": 31, "userId": 4,
        "problemSeason": 2, "problemEpisode": 7,
    }  # fmt: skip
    await client.create_issue(12, 4, "wrong movie", as_user=4)
    assert "problemSeason" not in json.loads(route.calls.last.request.content)
    await client.comment_issue(34, "Replaced.")
    assert json.loads(comment.calls.last.request.content) == {"message": "Replaced."}


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
async def test_sonarr_queue_percent_host_and_the_episode_it_is_for(fixture):
    route = respx.get(f"{BASE}/api/v3/queue").respond(json=fixture("sonarr_queue"))
    client = SonarrClient("meleys", BASE, "k")
    (item,) = await client.queue()
    assert client.host == "meleys"
    assert item.percent == 80.0
    assert item.download_id == "SABnzbd_nzo_abc"
    assert (item.episode_id, item.label) == (107, "The Bear (2022) S02E07")
    sent = route.calls.last.request.url.params
    assert sent["includeSeries"] == "true" and sent["includeEpisode"] == "true"


@respx.mock
async def test_removing_a_download_blocklists_it_and_leaves_the_search_to_the_caller():
    route = respx.delete(f"{BASE}/api/v3/queue/402").respond(status_code=200)
    await RadarrClient("meleys", BASE, "k").remove_from_queue(402)
    params = route.calls.last.request.url.params
    assert (params["removeFromClient"], params["blocklist"], params["skipRedownload"]) == (
        "true",
        "true",
        "true",
    )


@respx.mock
async def test_radarr_movie_files_delete_and_search(fixture):
    files = respx.get(f"{BASE}/api/v3/moviefile").respond(json=fixture("radarr_moviefile"))
    delete = respx.delete(f"{BASE}/api/v3/moviefile/55").respond(status_code=200)
    search = respx.post(f"{BASE}/api/v3/command").respond(json={"id": 3})
    client = RadarrClient("vermithor", BASE, "k")
    (f,) = await client.files(8)
    assert files.calls.last.request.url.params["movieId"] == "8"
    assert f.quality == "Bluray-2160p" and f.release_group == "FLUX"
    await client.delete_file(f.id)
    assert delete.called
    assert await client.search([8]) == 3
    assert json.loads(search.calls.last.request.content) == {
        "name": "MoviesSearch",
        "movieIds": [8],
    }


@respx.mock
async def test_sabnzbd_queue_carries_the_api_key_as_a_param(fixture):
    route = respx.get(f"{BASE}/api").respond(json=fixture("sabnzbd_queue"))
    (d,) = await SabnzbdClient("meleys", BASE, "sab-key").queue()
    assert "apikey=sab-key" in str(route.calls.last.request.url)
    assert d.percent == 80.0 and d.nzo_id == "SABnzbd_nzo_abc"


@respx.mock
async def test_http_errors_become_client_errors():
    respx.get(f"{BASE}/api/v3/rootfolder").respond(status_code=401, text="Unauthorized")
    with pytest.raises(ClientError, match=r"sonarr GET /api/v3/rootfolder failed \(401\)"):
        await SonarrClient("meleys", BASE, "k").root_folders()


async def test_fake_seerr_round_trip():
    unknown = MediaStatus.UNKNOWN
    seerr = FakeSeerrClient(
        results=[SearchResult(1, "movie", "Dune", 2021, "", None, unknown, unknown)]
    )
    assert [r.title for r in await seerr.search("du")] == ["Dune"]
    req = await seerr.create_request("movie", 1, is_4k=True, as_user=4)
    assert (await seerr.list_requests(user_id=4)) == [req]
    with pytest.raises(ClientError, match="404"):
        await seerr.media_details("movie", 2)


async def test_fake_sonarr_tracks_destructive_calls():
    sonarr = FakeSonarrClient(
        host="meleys", episode_list=[Episode(1, 12, 2, 7, "Forks", False, None, True)]
    )
    assert (await sonarr.episodes(12))[0].number == 7
    await sonarr.mark_failed(99)
    await sonarr.search([1])
    assert sonarr.failed == [99] and sonarr.searched == [[1]]


@respx.mock
async def test_arr_queue_reads_stall_messages_and_history_is_typed(fixture):
    respx.get(f"{BASE}/api/v3/queue").respond(json=fixture("radarr_queue_stalled"))
    history = respx.get(f"{BASE}/api/v3/history/movie", params={"movieId": 8}).respond(
        json=fixture("radarr_history")
    )
    client = RadarrClient("meleys", BASE, "k")
    (item,) = await client.queue()
    assert item.tracked_status == "warning" and item.media_id == 8
    assert item.label == "Dune (2021)" and item.episode_id is None
    assert item.error_messages == ("The download is stalled with no connections",)
    failed, grabbed = await client.history(8)
    assert history.called and (failed.id, failed.event_type) == (1002, "downloadFailed")
    assert failed.message == "Unpacking failed, write error or disk is full?"
    assert grabbed.event_type == "grabbed" and grabbed.message == ""


@respx.mock
async def test_an_import_in_the_history_names_the_file_it_made(fixture):
    respx.get(f"{BASE}/api/v3/history/movie", params={"movieId": 8}).respond(
        json=fixture("radarr_history_imported")
    )
    imported, grabbed = await RadarrClient("vermithor", BASE, "k").history(8)
    assert (imported.event_type, imported.file_id, imported.download_id) == (
        "downloadFolderImported", 55, "SABnzbd_nzo_x1",
    )  # fmt: skip
    assert (grabbed.event_type, grabbed.file_id, grabbed.episode_id) == ("grabbed", None, None)


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
async def test_sonarr_episodes_know_their_file_and_when_they_aired(fixture):
    respx.get(f"{BASE}/api/v3/episode", params={"seriesId": 12}).respond(
        json=fixture("sonarr_episode")
    )
    sundae, forks, unaired = await SonarrClient("meleys", BASE, "k").episodes(12)
    assert (sundae.file_id, sundae.has_file, sundae.aired.year) == (71, True, 2023)
    assert (forks.file_id, forks.has_file, forks.number) == (None, False, 7)
    assert unaired.aired is None


@respx.mock
async def test_sonarr_episode_files_carry_season_and_audio_languages(fixture):
    respx.get(f"{BASE}/api/v3/episodefile", params={"seriesId": 40}).respond(
        json=fixture("sonarr_episodefile")
    )
    dual, japanese, unscanned = await SonarrClient("meleys", BASE, "k").files(40)
    assert (dual.season, dual.audio_languages) == (1, ("jpn", "eng"))
    assert (japanese.season, japanese.audio_languages) == (2, ("jpn",))
    assert unscanned.audio_languages is None and unscanned.media_id == 40


@respx.mock
async def test_sabnzbd_history_keeps_the_failure_and_the_steps_that_went_wrong(fixture):
    respx.get(f"{BASE}/api").respond(json=fixture("sabnzbd_history"))
    failed, done = await SabnzbdClient("meleys", BASE, "k").history()
    assert failed.fail_message == "Unpacking failed, write error or disk is full?"
    assert failed.trouble == (
        "Repair: [Dune] Repaired in 41 seconds",
        "Unpack: [Dune] Unpacking failed, write error or disk is full?",
    )
    assert failed.completed == 1790000000 and done.trouble == ()


@respx.mock
async def test_seerr_open_issues_name_the_title_the_episode_and_who_raised_it(fixture):
    route = respx.get(f"{BASE}/api/v1/issue").respond(json=fixture("seerr_issues"))
    (issue,) = await SeerrClient(BASE, "k").open_issues()
    assert route.calls.last.request.url.params["filter"] == "open"
    assert (issue.id, issue.kind, issue.media_type, issue.tmdb_id) == (12, "video", "tv", 136315)
    assert (issue.season, issue.episode, issue.reporter) == (2, 7, "dany")


@respx.mock
async def test_the_fleet_view_names_each_hosts_state_temperatures_and_containers(fixture):
    respx.get(f"{BASE}/fleet").respond(json=fixture("fleet_view"))
    vermithor, caraxes = await FleetMonitorClient(BASE, "t").hosts()
    assert (vermithor.status, vermithor.disk_percent, vermithor.disk_free_bytes) == (
        "warn",
        93.5,
        6175000000000,
    )
    assert vermithor.temperatures == {"coretemp.temp1": 71.0, "coretemp.temp2": 64.5}
    assert vermithor.containers_down == ("bazarr",)
    assert vermithor.containers_unhealthy == ("seerr",) and vermithor.stale is None
    assert not caraxes.collected and caraxes.status == "unknown" and caraxes.stale is None


@respx.mock
async def test_sonarr_searches_episodes_and_finds_a_series_only_by_its_tvdb_id():
    search = respx.post(f"{BASE}/api/v3/command").respond(json={"id": 4})
    sonarr = SonarrClient("meleys", BASE, "k")
    assert await sonarr.search([1, 2]) == 4
    assert json.loads(search.calls.last.request.content) == {
        "name": "EpisodeSearch",
        "episodeIds": [1, 2],
    }
    no_tvdb = MediaDetails(
        136315, "tv", "The Bear", 2022, "", MediaStatus.UNKNOWN, MediaStatus.UNKNOWN
    )
    assert await sonarr.find_id(no_tvdb) is None  # nothing to ask by, so nothing asked


async def test_gather_each_names_who_couldnt_answer_and_raises_a_bug():
    async def ask(key):
        if key == "down":
            raise ClientError("sonarr", "GET", "/api/v3/queue", None, "timeout")
        if key == "bug":
            raise KeyError(key)
        return key.upper()

    found = await gather_each(["a", "down", "a"], ask)
    assert found.answered == {"a": "A"}
    assert found.unreachable == {"down": "sonarr GET /api/v3/queue failed (None): timeout"}
    with pytest.raises(KeyError):
        await gather_each(["a", "bug"], ask)


@respx.mock
async def test_a_body_that_is_not_json_names_the_method_that_got_it():
    respx.post(f"{BASE}/api/v1/thing").respond(text="<html>")
    with pytest.raises(ClientError) as raised:
        await SeerrClient(BASE, "k").post_json("/api/v1/thing", {})
    assert (raised.value.method, raised.value.detail) == ("POST", "not JSON")
