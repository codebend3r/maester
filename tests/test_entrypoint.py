import pytest

from maester import __version__
from maester.__main__ import main
from maester.config import MissingConfig


def test_version_flag_prints_version(capsys):
    assert main(["--version"]) == 0
    assert capsys.readouterr().out.strip() == f"maester {__version__}"


def test_default_run_fails_fast_naming_missing_config(monkeypatch):
    for name in (
        "ANTHROPIC_API_KEY",
        "DISCORD_BOT_TOKEN",
        "DISCORD_GUILD_ID",
        "SEERR_URL",
        "SEERR_API_KEY",
    ):
        monkeypatch.delenv(name, raising=False)
    with pytest.raises(MissingConfig) as exc:
        main([])
    assert "ANTHROPIC_API_KEY" in exc.value.names and "SEERR_API_KEY" in exc.value.names
