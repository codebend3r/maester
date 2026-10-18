import os
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]


def git(repo: Path, *args: str) -> str:
    return subprocess.check_output(
        ["git", "-C", str(repo), *args], text=True, stderr=subprocess.PIPE
    ).strip()


@pytest.fixture
def repo(tmp_path: Path) -> Path:
    source = tmp_path / "source"
    source.mkdir()
    git(source, "init", "-b", "main")
    git(source, "config", "user.email", "test@example.com")
    git(source, "config", "user.name", "Test")
    (source / "scripts").mkdir()
    shutil.copy(ROOT / "scripts/bump_version.sh", source / "scripts/bump_version.sh")
    git(source, "add", ".")
    git(source, "commit", "-m", "Release v0.6.2")
    git(source, "tag", "v0.6.2")
    git(source, "commit", "--allow-empty", "-m", "First build")
    git(source, "tag", "v0.6.2.1")
    git(source, "commit", "--allow-empty", "-m", "Second build")

    checkout = tmp_path / "checkout"
    subprocess.run(
        ["git", "clone", "--depth", "1", source.as_uri(), str(checkout)],
        check=True,
        capture_output=True,
    )
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    bunx = bin_dir / "bunx"
    bunx.write_text('#!/bin/sh\nprintf "BUILT=%s\\n" "${VITE_RAVEN_VERSION:-unset}"\n')
    bunx.chmod(0o755)
    return checkout


def build(repo: Path, *, context: str = "production") -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["bash", str(ROOT / "apps/raven/netlify-build.sh")],
        cwd=repo,
        env={
            **os.environ,
            "PATH": f"{repo.parent / 'bin'}:{os.environ['PATH']}",
            "CONTEXT": context,
            "BRANCH": "main",
            "VITE_RAVEN_VERSION": "0.6.2.999",
        },
        text=True,
        capture_output=True,
    )


def test_production_before_and_after_ci_tag(repo: Path):
    before = build(repo)
    assert before.returncode == 0, before.stderr
    assert "BUILT=0.6.2.2" in before.stdout
    assert git(repo, "rev-parse", "--is-shallow-repository") == "false"

    git(repo.parent / "source", "tag", "v0.6.2.2")
    after = build(repo)
    assert after.returncode == 0, after.stderr
    assert "BUILT=0.6.2.2" in after.stdout


def test_release_commit_uses_base_version(repo: Path):
    git(repo, "fetch", "--unshallow", "--tags", "origin")
    git(repo, "checkout", "v0.6.2")
    result = build(repo)
    assert result.returncode == 0, result.stderr
    assert "BUILT=0.6.2\n" in result.stdout


@pytest.mark.parametrize("context", ["deploy-preview", "branch-deploy"])
def test_preview_does_not_claim_production_version(repo: Path, context: str):
    result = build(repo, context=context)
    assert result.returncode == 0, result.stderr
    assert "BUILT=unset" in result.stdout


def test_failed_fetch_does_not_build(repo: Path):
    git(repo, "remote", "set-url", "origin", str(repo.parent / "missing"))
    result = build(repo)
    assert result.returncode != 0
    assert "BUILT=" not in result.stdout


def test_failed_version_lookup_does_not_build(repo: Path):
    git(repo.parent / "source", "tag", "-d", "v0.6.2", "v0.6.2.1")
    result = build(repo)
    assert result.returncode != 0
    assert "BUILT=" not in result.stdout
