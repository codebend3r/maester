import tomllib
from pathlib import Path

import pytest
import yaml

ROOT = Path(__file__).resolve().parents[2]
WORKFLOWS = ROOT / ".github/workflows"
NATIVE_WORKFLOW = "./.github/workflows/native-checks.yml"
DESKTOP_JOBS = {"desktop-native", "desktop-app", "desktop-playback"}


def test_pull_requests_do_not_run_or_wait_for_native_or_desktop_jobs():
    workflow = yaml.load(
        (WORKFLOWS / "pull-request-checks.yml").read_text(), Loader=yaml.BaseLoader
    )
    jobs = workflow["jobs"]
    assert set(jobs) == {"checks", "build", "checks-complete", "supabase", "smoke"}
    assert all(job.get("uses") != NATIVE_WORKFLOW for job in jobs.values())
    assert all(job.get("runs-on") != "macos-26" for job in jobs.values())


def test_supabase_reserves_its_ports_before_any_network_activity():
    workflow = yaml.load(
        (WORKFLOWS / "pull-request-checks.yml").read_text(), Loader=yaml.BaseLoader
    )
    first_step = workflow["jobs"]["supabase"]["steps"][0]
    command, port_range = first_step["run"].split("=", 1)
    assert command == "sudo sysctl -w net.ipv4.ip_local_reserved_ports"
    first, last = map(int, port_range.split("-"))
    config = tomllib.loads((ROOT / "apps/raven/supabase/config.toml").read_text())
    ports = {
        config["api"]["port"],
        config["db"]["port"],
        config["db"]["shadow_port"],
        config["local_smtp"]["port"],
    }
    assert ports <= set(range(first, last + 1))


def test_every_main_push_selects_native_apps_without_cancellation():
    workflow = yaml.load((WORKFLOWS / "main-native-checks.yml").read_text(), Loader=yaml.BaseLoader)
    assert workflow["on"] == {
        "push": {"branches": ["main"]},
        "workflow_dispatch": "",
    }
    assert "concurrency" not in workflow
    assert workflow["permissions"]["actions"] == "write"
    assert set(workflow["jobs"]) == {"affected", "native"} | DESKTOP_JOBS
    affected = workflow["jobs"]["affected"]
    assert affected["runs-on"] == "ubuntu-24.04"
    assert affected["steps"][0]["with"]["fetch-depth"] == "0"
    assert affected["steps"][-1]["run"] == "python3 scripts/select_native_checks.py"
    native = workflow["jobs"]["native"]
    assert native["uses"] == NATIVE_WORKFLOW
    assert native["needs"] == "affected"
    assert all(
        f"needs.affected.outputs.{group}" in native["if"] for group in ("app", "music", "desktop")
    )
    assert native["with"] == {
        "sha": "${{ github.sha }}",
        "app": "${{ needs.affected.outputs.app == 'true' }}",
        "music": "${{ needs.affected.outputs.music == 'true' }}",
        "windows": "${{ needs.affected.outputs.desktop == 'true' }}",
    }
    assert native["secrets"] == "inherit"


@pytest.mark.parametrize("job_name", sorted(DESKTOP_JOBS))
def test_main_desktop_jobs_build_the_pushed_commit_and_keep_the_handoff(job_name: str):
    workflow = yaml.load((WORKFLOWS / "main-native-checks.yml").read_text(), Loader=yaml.BaseLoader)
    job = workflow["jobs"][job_name]
    assert job["runs-on"] == "macos-26"
    assert "pull_request" not in str(job)
    checkout = job["steps"][0]
    assert checkout["uses"] == "actions/checkout@v7"
    assert checkout["with"]["ref"] == "${{ github.sha }}"
    if job_name == "desktop-native":
        assert job["needs"] == "affected"
        assert job["if"] == "needs.affected.outputs.desktop == 'true'"
        handoff_action = "actions/upload-artifact@v7"
    else:
        assert "if" not in job
        assert job["needs"] == "desktop-native"
        handoff_action = "actions/download-artifact@v8"
    assert any(
        step.get("uses") == handoff_action
        and step["with"]["name"] == "raven-native-handoff-${{ github.sha }}"
        for step in job["steps"]
    )
    assert all("gh run cancel" not in step.get("run", "") for step in job["steps"])


def test_release_dry_runs_do_not_trigger_on_pull_requests():
    workflow = yaml.load((WORKFLOWS / "desktop-release.yml").read_text(), Loader=yaml.BaseLoader)
    assert set(workflow["on"]) == {"push", "workflow_dispatch"}
    assert "tags" in workflow["on"]["push"]


def test_local_desktop_e2e_downloads_main_native_handoffs():
    script = (ROOT / "scripts/ci_desktop_e2e.sh").read_text()
    assert "gh run list --workflow main-native-checks.yml" in script
