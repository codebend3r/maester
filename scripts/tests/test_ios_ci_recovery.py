import os
import subprocess
import textwrap
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
SCREENSHOT_TIMEOUT = "Failed to get screenshot: Timed out while requesting screenshot."


@pytest.mark.parametrize(
    ("first_exit", "second_exit", "driver_log", "expected_exit", "attempts"),
    [
        (0, 1, "", 0, 1),
        (1, 0, "Assertion failed", 1, 1),
        (1, 0, SCREENSHOT_TIMEOUT, 0, 2),
        (1, 1, SCREENSHOT_TIMEOUT, 1, 2),
    ],
)
def test_ios_retry_only_recovers_screenshot_driver_crash(
    tmp_path: Path,
    first_exit: int,
    second_exit: int,
    driver_log: str,
    expected_exit: int,
    attempts: int,
):
    workflow = (ROOT / ".github/workflows/pull-request-checks.yml").read_text()
    step = workflow.split("      - name: 🎬 App end to end\n", 1)[1]
    block = step.split("        run: |\n", 1)[1].split("\n      #", 1)[0]
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    logs = tmp_path / ".maestro/tests"
    logs.mkdir(parents=True)
    (logs / "xctest_runner.log").write_text(driver_log)
    commands = {
        "bun": (
            'echo run >> "$HOME/attempts"\n'
            'if [ "$(wc -l < "$HOME/attempts")" -eq 1 ]; then\n'
            f"  exit {first_exit}\nfi\nexit {second_exit}\n"
        ),
        "xcrun": 'echo "$*" >> "$HOME/reboots"\n',
    }
    for name, body in commands.items():
        command = bin_dir / name
        command.write_text("#!/bin/sh\n" + body)
        command.chmod(0o755)
    result = subprocess.run(
        ["bash", "-e", "-c", textwrap.dedent(block)],
        env={**os.environ, "HOME": str(tmp_path), "PATH": f"{bin_dir}:/usr/bin:/bin"},
        capture_output=True,
        text=True,
    )
    assert result.returncode == expected_exit, result.stderr
    assert len((tmp_path / "attempts").read_text().splitlines()) == attempts
    assert (tmp_path / "reboots").exists() == (attempts == 2)
    if attempts == 2:
        assert (tmp_path / "reboots").read_text().splitlines() == [
            "simctl shutdown raven-phone",
            "simctl boot raven-phone",
            "simctl bootstatus raven-phone -b",
        ]
