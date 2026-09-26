from maester import __version__
from maester.__main__ import main


def test_version_flag_prints_version(capsys):
    assert main(["--version"]) == 0
    assert capsys.readouterr().out.strip() == f"maester {__version__}"


def test_default_run_exits_clean(capsys):
    assert main([]) == 0
    assert "maester" in capsys.readouterr().out
