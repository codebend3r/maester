import pytest

from maester.config import MissingConfig, Settings, load_settings, require


def test_defaults_when_env_is_empty():
    s = load_settings({})
    assert s == Settings()
    assert s.model == "claude-opus-5"
    assert s.guardrails.replace_daily_cap == 3
    assert s.db_path == "/data/maester.db"


def test_values_are_parsed_and_urls_stripped():
    s = load_settings(
        {
            "MAESTER_MODEL": "claude-opus-5-5",
            "DISCORD_GUILD_ID": "123",
            "SEERR_URL": "http://seerr:5055/ ",
            "REPLACE_DAILY_CAP": "5",
            "USER_TOKENS_PER_DAY": "",
        }
    )
    assert s.model == "claude-opus-5-5"
    assert s.discord_guild_id == 123
    assert s.seerr_url == "http://seerr:5055"
    assert s.guardrails.replace_daily_cap == 5
    assert s.guardrails.user_tokens_per_day == 200_000


def test_require_names_every_missing_variable_at_once():
    with pytest.raises(MissingConfig) as exc:
        require({"A": "1", "B": ""}, "A", "B", "C")
    assert exc.value.names == ["B", "C"]
    assert "B, C" in str(exc.value)


def test_require_passes_when_all_present():
    require({"A": "1"}, "A")
