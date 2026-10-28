import os
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]

# A git hook exports GIT_DIR, GIT_INDEX_FILE and the like, which would point
# every git call below at the repo being pushed instead of the throwaway one.
ENV = {key: value for key, value in os.environ.items() if not key.startswith("GIT_")}


def git(repo: Path, *args: str) -> str:
    return subprocess.check_output(
        ["git", "-C", str(repo), *args], text=True, stderr=subprocess.PIPE, env=ENV
    ).strip()


def next_build(repo: Path) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["bash", "scripts/bump_version.sh", "--print", "build"],
        cwd=repo,
        env=ENV,
        text=True,
        capture_output=True,
    )


@pytest.fixture
def repo(tmp_path: Path) -> Path:
    git(tmp_path, "init", "-b", "main")
    git(tmp_path, "config", "user.email", "test@example.com")
    git(tmp_path, "config", "user.name", "Test")
    (tmp_path / "scripts").mkdir()
    shutil.copy(ROOT / "scripts/bump_version.sh", tmp_path / "scripts/bump_version.sh")
    git(tmp_path, "add", ".")
    git(tmp_path, "commit", "-m", "Release v0.7.6")
    git(tmp_path, "tag", "v0.7.6")
    git(tmp_path, "commit", "--allow-empty", "-m", "First merge")
    git(tmp_path, "tag", "v0.7.6.1")
    return tmp_path


def test_counts_merges_since_the_release(repo: Path):
    git(repo, "commit", "--allow-empty", "-m", "Second merge")
    result = next_build(repo)
    assert result.returncode == 0, result.stderr
    assert result.stdout.strip() == "0.7.6.2"


def test_skips_a_tag_main_lost_to_a_force_push(repo: Path):
    git(repo, "commit", "--allow-empty", "-m", "Second merge")
    git(repo, "tag", "v0.7.6.2")
    git(repo, "commit", "--amend", "--allow-empty", "-m", "Second merge, amended")
    result = next_build(repo)
    assert result.returncode == 0, result.stderr
    assert result.stdout.strip() == "0.7.6.3"
    assert "v0.7.6.2" in result.stderr


def test_refuses_a_commit_that_already_has_its_build(repo: Path):
    result = next_build(repo)
    assert result.returncode == 1
    assert "HEAD is already tagged v0.7.6.1" in result.stderr
