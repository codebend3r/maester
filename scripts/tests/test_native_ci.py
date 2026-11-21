import tomllib
from pathlib import Path

import pytest
import yaml

ROOT = Path(__file__).resolve().parents[2]
WORKFLOWS = ROOT / ".github/workflows"
NATIVE_WORKFLOW = "./.github/workflows/native-checks.yml"
SELECT_SCRIPT = "python3 scripts/select_native_checks.py"
DESKTOP_JOBS = {"desktop-native", "desktop-app", "desktop-playback"}
# Each job that opens a group, and the group it runs for; Windows is part of the desktop.
GROUP_JOBS = {
    "windows-native": "desktop",
    "app-build": "app",
    "music-build": "music",
    "desktop-native": "desktop",
}
# Each end to end matrix, the build matrix it waits for, and the devices it runs the flows of.
E2E_JOBS = {
    "app-e2e": ("app-build", ["iPhone", "Apple TV", "Android TV"]),
    "music-e2e": ("music-build", ["Wren iPhone"]),
}
# Every row a build matrix builds, the devices with no flows yet among them.
BUILD_ROWS = {
    "app-build": ["iPhone", "Apple TV", "Android TV", "Android phone"],
    "music-build": ["Wren iPhone", "Wren Android"],
}
HANDOFF = "${{ matrix.app.artifact }}-${{ inputs.sha }}"
END_TO_END_TARGETS = ("app:e2e", "@raven/music:e2e")
# Each job that continues a group's native build, and the job it waits for.
FOLLOW_ON_JOBS = {
    **{job_name: build_job for job_name, (build_job, _) in E2E_JOBS.items()},
    "windows-app": "windows-native",
    "desktop-app": "desktop-native",
    "desktop-playback": "desktop-native",
}
CANCEL_STEP = {
    "name": "🛑 Cancel the run",
    "if": "failure() && github.event_name == 'pull_request'",
    "continue-on-error": "true",
    "shell": "bash",
    "env": {"GH_TOKEN": "${{ github.token }}"},
    "run": "gh run cancel ${{ github.run_id }} --repo ${{ github.repository }}",
}


def load_workflow(name: str) -> dict:
    return yaml.load((WORKFLOWS / name).read_text(), Loader=yaml.BaseLoader)


def test_pull_requests_run_the_native_checks_and_wait_for_them():
    workflow = load_workflow("pull-request-checks.yml")
    jobs = workflow["jobs"]
    assert set(jobs) == {
        "checks",
        "lighthouse",
        "build",
        "native",
        "checks-complete",
        "supabase",
        "smoke",
    }
    # Selection lives in the shared workflow; the caller passes the commits and nothing else.
    assert SELECT_SCRIPT not in str(jobs)
    native = jobs["native"]
    assert native["uses"] == NATIVE_WORKFLOW
    assert native["needs"] == "checks"
    assert "if" not in native
    assert native["permissions"] == {"actions": "write", "contents": "read"}
    assert native["with"] == {
        "sha": "${{ github.event.pull_request.head.sha }}",
        "base": "${{ github.event.pull_request.base.sha }}",
    }
    assert native["secrets"] == "inherit"
    complete = jobs["checks-complete"]
    assert complete["name"] == "✅ Checks"
    assert complete["needs"] == ["checks", "lighthouse", "build", "native"]
    gate = complete["steps"][-1]["run"]
    # Lighthouse runs beside the matrix, so the build and the native apps never wait for it,
    # and the gate does.
    assert "needs" not in jobs["lighthouse"]
    assert all(
        check["target"] != "lighthouse" for check in jobs["checks"]["strategy"]["matrix"]["check"]
    )
    assert 'test "$LIGHTHOUSE_RESULT" = success' in gate
    # Native apps runs on every PR, so a skipped result means the checks failed, never a pass.
    assert 'test "$NATIVE_RESULT" = success' in gate
    assert "skipped" not in gate
    # No macOS runner outside the shared workflow: the native jobs run through it alone.
    assert all(job.get("runs-on") != "macos-26" for job in jobs.values())


def test_supabase_reserves_its_ports_before_any_network_activity():
    workflow = load_workflow("pull-request-checks.yml")
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


def test_every_main_push_runs_the_native_checks_without_cancellation():
    workflow = load_workflow("main-native-checks.yml")
    assert workflow["on"] == {
        "push": {"branches": ["main"]},
        "workflow_dispatch": "",
    }
    assert "concurrency" not in workflow
    assert workflow["permissions"]["actions"] == "write"
    assert set(workflow["jobs"]) == {"native"}
    assert SELECT_SCRIPT not in str(workflow)
    native = workflow["jobs"]["native"]
    assert native["uses"] == NATIVE_WORKFLOW
    assert "needs" not in native
    assert "if" not in native
    # No base: the shared workflow finds main's last green run, or runs every group by hand.
    assert native["with"] == {"sha": "${{ github.sha }}"}
    assert native["secrets"] == "inherit"


def test_native_checks_select_their_groups_once():
    workflow = load_workflow("native-checks.yml")
    inputs = workflow["on"]["workflow_call"]["inputs"]
    assert set(inputs) == {"sha", "base"}
    assert inputs["sha"]["type"] == "string"
    assert inputs["sha"]["required"] == "true"
    assert inputs["base"]["type"] == "string"
    assert inputs["base"]["required"] == "false"
    assert set(workflow["jobs"]) == {"select", *GROUP_JOBS, *FOLLOW_ON_JOBS}
    select = workflow["jobs"]["select"]
    assert select["runs-on"] == "ubuntu-24.04"
    assert "needs" not in select
    assert "if" not in select
    # The caller's commit (GITHUB_SHA), which the script diffs, with the history to do so.
    checkout = select["steps"][0]
    assert checkout["uses"] == "actions/checkout@v7"
    assert checkout["with"] == {"fetch-depth": "0"}
    script = select["steps"][-2]
    assert script["id"] == "select"
    assert script["run"] == SELECT_SCRIPT
    assert script["env"]["NATIVE_BASE"] == "${{ inputs.base }}"
    assert script["env"]["GH_TOKEN"] == "${{ github.token }}"
    assert select["outputs"] == {
        group: f"${{{{ steps.select.outputs.{group} }}}}" for group in ("app", "music", "desktop")
    }


@pytest.mark.parametrize(("job_name", "group"), sorted(GROUP_JOBS.items()))
def test_group_jobs_run_only_when_their_group_was_selected(job_name: str, group: str):
    job = load_workflow("native-checks.yml")["jobs"][job_name]
    assert job["needs"] == "select"
    assert job["if"] == f"needs.select.outputs.{group} == 'true'"


@pytest.mark.parametrize(("job_name", "native_job"), sorted(FOLLOW_ON_JOBS.items()))
def test_follow_on_jobs_wait_for_their_native_build(job_name: str, native_job: str):
    job = load_workflow("native-checks.yml")["jobs"][job_name]
    assert job["needs"] == native_job
    # A skipped native build skips its follow-ons; a gate of their own would be a second truth.
    assert "if" not in job


@pytest.mark.parametrize("job_name", sorted(["select", *GROUP_JOBS, *FOLLOW_ON_JOBS]))
def test_every_native_job_cancels_a_failing_pull_request_run(job_name: str):
    job = load_workflow("native-checks.yml")["jobs"][job_name]
    assert job["steps"][-1] == CANCEL_STEP
    assert sum(step.get("name") == CANCEL_STEP["name"] for step in job["steps"]) == 1


def runs_of(job: dict) -> str:
    return "\n".join(
        step.get("run", "") + step.get("with", {}).get("script", "") for step in job["steps"]
    )


def rows_of(job: dict) -> list[dict]:
    return job["strategy"]["matrix"]["app"]


@pytest.mark.parametrize(("job_name", "names"), sorted(BUILD_ROWS.items()))
def test_build_matrices_name_every_row_for_its_device(job_name: str, names: list[str]):
    job = load_workflow("native-checks.yml")["jobs"][job_name]
    assert job["name"] == "🏗️ Build ${{ matrix.app.name }}"
    assert [row["name"] for row in rows_of(job)] == names
    # On main nothing cancels the run, so one failing row must not end the others.
    assert job["strategy"]["fail-fast"] == "false"


@pytest.mark.parametrize(("job_name", "handoff"), sorted(E2E_JOBS.items()))
def test_end_to_end_jobs_run_the_flows_on_the_build_job_s_artifact(
    job_name: str, handoff: tuple[str, list[str]]
):
    jobs = load_workflow("native-checks.yml")["jobs"]
    build_job, names = handoff
    assert any(
        step.get("uses") == "actions/upload-artifact@v7" and step["with"]["name"] == HANDOFF
        for step in jobs[build_job]["steps"]
    )
    job = jobs[job_name]
    assert job["name"] == "🎬 E2E ${{ matrix.app.name }}"
    assert job["strategy"]["fail-fast"] == "false"
    assert any(
        step.get("uses") == "actions/download-artifact@v8" and step["with"]["name"] == HANDOFF
        for step in job["steps"]
    )
    assert job["steps"][0]["with"]["ref"] == "${{ inputs.sha }}"
    # Each end to end row is the build row itself, so the two jobs agree on the artifact.
    rows = rows_of(job)
    assert [row["name"] for row in rows] == names
    assert all(row in rows_of(jobs[build_job]) for row in rows)
    # The flows run here and nowhere in the build job, and nothing compiles here.
    assert all(any(target in row["flows"] for target in END_TO_END_TARGETS) for row in rows)
    assert "matrix.app.flows" in runs_of(job)
    assert "matrix.app.flows" not in runs_of(jobs[build_job])
    assert all(":e2e" not in row["build"] for row in rows_of(jobs[build_job]))
    assert "matrix.app.build" not in runs_of(job)
    setup = next(
        step for step in job["steps"] if step.get("uses") == "./.github/actions/raven-app-setup"
    )
    assert setup["with"]["compiles"] == "false"


def test_wren_builds_and_runs_its_flows_by_the_app_s_steps():
    jobs = load_workflow("native-checks.yml")["jobs"]
    assert jobs["music-build"]["steps"] == jobs["app-build"]["steps"]
    assert jobs["music-e2e"]["steps"] == jobs["app-e2e"]["steps"]


@pytest.mark.parametrize("job_name", sorted(DESKTOP_JOBS))
def test_desktop_jobs_build_the_given_commit_and_keep_the_handoff(job_name: str):
    workflow = load_workflow("native-checks.yml")
    job = workflow["jobs"][job_name]
    assert job["runs-on"] == "macos-26"
    assert "github.sha" not in str(job)
    checkout = job["steps"][0]
    assert checkout["uses"] == "actions/checkout@v7"
    assert checkout["with"]["ref"] == "${{ inputs.sha }}"
    if job_name == "desktop-native":
        handoff_action = "actions/upload-artifact@v7"
    else:
        handoff_action = "actions/download-artifact@v8"
    assert any(
        step.get("uses") == handoff_action
        and step["with"]["name"] == "raven-native-handoff-${{ inputs.sha }}"
        for step in job["steps"]
    )


def test_release_dry_runs_do_not_trigger_on_pull_requests():
    workflow = load_workflow("desktop-release.yml")
    assert set(workflow["on"]) == {"push", "workflow_dispatch"}
    assert "tags" in workflow["on"]["push"]


def test_local_desktop_e2e_downloads_main_native_handoffs():
    script = (ROOT / "scripts/ci_desktop_e2e.sh").read_text()
    assert "gh run list --workflow main-native-checks.yml" in script
