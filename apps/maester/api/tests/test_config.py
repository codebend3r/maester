import os
from datetime import time, timedelta
from zoneinfo import ZoneInfo

import pytest

from maester.config import (
    FleetMonitorAccess,
    Jobs,
    MissingConfig,
    Settings,
    load_settings,
    require,
)


def test_defaults_when_env_is_empty():
    s = load_settings({})
    assert s == Settings()
    assert s.model == "claude-opus-5-5"
    assert s.guardrails.replace_daily_cap == 3
    assert s.db_path == "/data/maester.db"


def test_values_are_parsed_and_urls_stripped():
    s = load_settings(
        {
            "MAESTER_MODEL": "claude-sonnet-5",
            "DISCORD_GUILD_ID": "123",
            "SEERR_URL": "http://seerr:5055/ ",
            "REPLACE_DAILY_CAP": "5",
            "USER_TOKENS_PER_DAY": "",
            "DUB_PROFILE": " Dual Audio ",
        }
    )
    assert (s.dub_tag, s.dub_profile) == ("dub", "Dual Audio")
    assert s.model == "claude-sonnet-5"
    assert s.discord_guild_id == 123
    assert s.seerr_url == "http://seerr:5055"
    assert s.guardrails.replace_daily_cap == 5
    assert s.guardrails.user_tokens_per_day == 200_000


def test_media_roots_and_path_map_are_lists():
    s = load_settings(
        {
            "MEDIA_ROOTS": " /Vermithor, /Meleys ,,",
            "MEDIA_PATH_MAP": "/data/media=/Meleys, broken, =/x, /tv = /Syrax/TV",
            "PROBE_TIMEOUT_SECONDS": "45",
        }
    )
    assert s.media_roots == ("/Vermithor", "/Meleys")
    assert s.media_path_map == (("/data/media", "/Meleys"), ("/tv", "/Syrax/TV"))
    assert s.probe_timeout_seconds == 45 and Settings().media_roots == ()


@pytest.mark.parametrize("roots", ["/", "/Meleys, Movies"])
def test_media_roots_must_be_absolute_and_not_the_whole_filesystem(roots):
    with pytest.raises(ValueError, match="MEDIA_ROOTS"):
        load_settings({"MEDIA_ROOTS": roots})


def test_require_names_every_missing_variable_at_once():
    with pytest.raises(MissingConfig) as exc:
        require({"A": "1", "B": ""}, "A", "B", "C")
    assert exc.value.names == ["B", "C"]
    assert "B, C" in str(exc.value)


def test_require_passes_when_all_present():
    require({"A": "1"}, "A")


def test_the_fleet_monitor_is_optional_but_needs_its_token_once_named():
    assert load_settings({}).fleet_monitor is None
    named = {"FLEET_MONITOR_URL": "http://192.168.50.2:8010/", "FLEET_MONITOR_TOKEN": " tok "}
    assert load_settings(named).fleet_monitor == FleetMonitorAccess(
        "http://192.168.50.2:8010", "tok"
    )
    with pytest.raises(MissingConfig) as exc:
        load_settings({**named, "FLEET_MONITOR_TOKEN": ""})
    assert exc.value.names == ["FLEET_MONITOR_TOKEN"]
    assert load_settings({"FLEET_MONITOR_TOKEN": "tok"}).fleet_monitor is None


def test_the_speed_test_runs_on_the_host_named():
    assert load_settings({}).speedtest_host == ""
    assert load_settings({"SPEEDTEST_HOST": " Meleys "}).speedtest_host == "meleys"


def test_jobs_run_in_the_named_time_zone_at_the_named_times():
    cfg = load_settings(
        {
            "TZ": "America/Toronto",
            "DIGEST_TIME": "07:30",
            "NAS_REPORT_DAY": "Sunday",
            "SWEEP_MINUTES": "10",
            "STALLED_HOURS": "3",
        }
    )
    jobs = cfg.jobs
    assert jobs.zone == ZoneInfo("America/Toronto") and jobs.digest_at == time(7, 30)
    assert jobs.nas_report_day == 6
    assert (jobs.sweep_every, jobs.stalled_after) == (timedelta(minutes=10), timedelta(hours=3))
    assert load_settings({}).jobs == Jobs()


@pytest.mark.parametrize(
    ("name", "value"),
    [("TZ", "Mars/Olympus"), ("DIGEST_TIME", "8am"), ("NAS_REPORT_DAY", "someday")],
)
def test_a_bad_schedule_fails_on_boot_naming_the_variable(name, value):
    with pytest.raises(ValueError, match=name):
        load_settings({name: value})


def test_load_env_file_reads_dotenv_from_the_working_directory(tmp_path, monkeypatch):
    from maester.config import load_env_file

    (tmp_path / ".env").write_text("SEERR_API_KEY=from-file\nDISCORD_GUILD_ID=42\n")
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("DISCORD_GUILD_ID", "7")
    monkeypatch.delenv("SEERR_API_KEY", raising=False)
    assert load_env_file() is True
    assert os.environ["SEERR_API_KEY"] == "from-file"
    assert os.environ["DISCORD_GUILD_ID"] == "7"  # what the process already had wins


def test_load_env_file_is_a_no_op_without_a_file(tmp_path, monkeypatch):
    from maester.config import load_env_file

    monkeypatch.chdir(tmp_path)
    assert load_env_file() is False
