import pytest

from luwin import __version__
from luwin.__main__ import main
from luwin.config import RENAMED, MissingConfig


def test_version_flag_prints_version(capsys):
    assert main(["--version"]) == 0
    assert capsys.readouterr().out.strip() == f"luwin {__version__}"


def test_default_run_fails_fast_naming_missing_config(monkeypatch, tmp_path):
    monkeypatch.chdir(tmp_path)  # away from any developer `.env` the entrypoint would load
    for name in (
        "ANTHROPIC_API_KEY",
        "SEERR_URL",
        "SEERR_API_KEY",
        *RENAMED,  # an old name in a developer's env would be refused before these
    ):
        monkeypatch.delenv(name, raising=False)
    with pytest.raises(MissingConfig) as exc:
        main([])
    assert exc.value.names == ["ANTHROPIC_API_KEY", "SEERR_URL", "SEERR_API_KEY"]
