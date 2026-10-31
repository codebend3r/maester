import pytest

from sparrow import __version__
from sparrow.__main__ import main
from sparrow.config import RENAMED, REQUIRED, MissingConfig


def test_version_flag_prints_version(capsys):
    assert main(["--version"]) == 0
    assert capsys.readouterr().out.strip() == f"sparrow {__version__}"


def test_default_run_fails_fast_naming_missing_config(monkeypatch, tmp_path):
    monkeypatch.chdir(tmp_path)  # away from any developer `.env` the entrypoint would load
    # An old name in a developer's env would be refused before these.
    for name in (*REQUIRED, *RENAMED):
        monkeypatch.delenv(name, raising=False)
    with pytest.raises(MissingConfig) as exc:
        main([])
    assert exc.value.names == [
        "ANTHROPIC_API_KEY",
        "SEERR_URL",
        "SEERR_API_KEY",
        "ROOKERY_URL",
        "ROOKERY_PUBLIC_URL",
        "ROOKERY_SERVICE_TOKEN",
    ]
