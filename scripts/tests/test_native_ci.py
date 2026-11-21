import subprocess
import tomllib
from pathlib import Path

import pytest
import yaml

ROOT = Path(__file__).resolve().parents[2]
WORKFLOWS = ROOT / ".github/workflows"
NATIVE_WORKFLOW = "./.github/workflows/native-checks.yml"
SELECT_SCRIPT = "python3 scripts/select_native_checks.py"
GROUPS = ("app", "music", "desktop")
# Each device's job id suffix, the name its jobs carry, its group, and whether it has flows.
DEVICES = {
    "iphone": ("iPhone", "app", True),
    "apple-tv": ("Apple TV", "app", True),
    "android-tv": ("Android TV", "app", True),
    "android-phone": ("Android phone", "app", False),
    "wren-iphone": ("Wren iPhone", "music", True),
    "wren-android": ("Wren Android", "music", False),
}
# Each job that builds for a group when the plan says to, and the group.
BUILD_JOBS = {
    **{f"build-{device}": group for device, (_, group, _) in DEVICES.items()},
    "windows-native": "desktop",
    "desktop-native": "desktop",
}
# Each job that continues a native build in the same run, and the job it waits for.
FOLLOW_ON_JOBS = {"windows-app": "windows-native", "desktop-app": "desktop-native"}
# Each end to end job, the build job it reads from or falls back on, and its group.
E2E_JOBS = {
    **{
        f"e2e-{device}": (f"build-{device}", group)
        for device, (_, group, has_flows) in DEVICES.items()
        if has_flows
    },
    "desktop-e2e": ("desktop-native", "desktop"),
}
DESKTOP_JOBS = {"desktop-native", "desktop-app", "desktop-test", "desktop-e2e"}
ALL_JOBS = ["select", *BUILD_JOBS, *FOLLOW_ON_JOBS, "desktop-test", *E2E_JOBS]
# A build is uploaded under the commit it was built from, and read back under the commit of
# whichever run holds it: the merged pull request's, or the end to end run's own.
HANDOFF = "${{ env.APP_ARTIFACT }}-${{ inputs.sha }}"
FOUND_HANDOFF = "${{ env.APP_ARTIFACT }}-${{ env.BUILD_SHA }}"
END_TO_END_TARGETS = ("app:e2e", "@raven/music:e2e")
PLAN_SCRIPT = ROOT / "scripts/plan_native_stage.sh"
FIND_SCRIPT = ROOT / "scripts/find_pr_builds.sh"
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
    # The build stage: a pull request builds and uploads, and runs no end to end suite.
    assert native["with"] == {
        "sha": "${{ github.event.pull_request.head.sha }}",
        "stage": "build",
        "base": "${{ github.event.pull_request.base.sha }}",
    }
    assert all(
        "e2e" not in check["target"] for check in jobs["checks"]["strategy"]["matrix"]["check"]
    )
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
    assert set(workflow["jobs"]) == {"native", "web-e2e"}
    assert SELECT_SCRIPT not in str(workflow)
    native = workflow["jobs"]["native"]
    assert native["uses"] == NATIVE_WORKFLOW
    assert "needs" not in native
    assert "if" not in native
    # No base: the shared workflow finds main's last green run, or runs every group by hand.
    assert native["with"] == {"sha": "${{ github.sha }}", "stage": "e2e"}
    assert native["secrets"] == "inherit"
    # The web's browser suite runs here too, on every push, and Nx restores an unchanged pass.
    web = workflow["jobs"]["web-e2e"]
    assert "needs" not in web
    assert "if" not in web
    assert any("-t e2e:browser" in step.get("run", "") for step in web["steps"])


def test_native_checks_select_and_plan_their_groups_once():
    workflow = load_workflow("native-checks.yml")
    inputs = workflow["on"]["workflow_call"]["inputs"]
    assert set(inputs) == {"sha", "stage", "base"}
    assert inputs["sha"]["type"] == "string"
    assert inputs["sha"]["required"] == "true"
    assert inputs["stage"]["type"] == "string"
    assert inputs["stage"]["required"] == "true"
    assert inputs["base"]["type"] == "string"
    assert inputs["base"]["required"] == "false"
    assert set(workflow["jobs"]) == set(ALL_JOBS)
    select = workflow["jobs"]["select"]
    assert select["runs-on"] == "ubuntu-24.04"
    assert "needs" not in select
    assert "if" not in select
    # The caller's commit (GITHUB_SHA), which the script diffs, with the history to do so.
    checkout = select["steps"][0]
    assert checkout["uses"] == "actions/checkout@v7"
    assert checkout["with"] == {"fetch-depth": "0"}
    steps = {step["id"]: step for step in select["steps"] if "id" in step}
    assert steps["select"]["run"] == SELECT_SCRIPT
    assert steps["select"]["env"]["NATIVE_BASE"] == "${{ inputs.base }}"
    assert steps["select"]["env"]["GH_TOKEN"] == "${{ github.token }}"
    # The merged pull request's builds are looked for in the e2e stage alone.
    assert steps["find"]["if"] == "inputs.stage == 'e2e'"
    assert steps["find"]["run"] == 'bash scripts/find_pr_builds.sh >> "$GITHUB_OUTPUT"'
    assert steps["plan"]["run"] == 'bash scripts/plan_native_stage.sh >> "$GITHUB_OUTPUT"'
    assert "if" not in steps["plan"]
    for group in GROUPS:
        assert (
            steps["plan"]["env"][f"SELECTED_{group}"] == f"${{{{ steps.select.outputs.{group} }}}}"
        )
        assert steps["plan"]["env"][f"FOUND_{group}"] == f"${{{{ steps.find.outputs.{group} }}}}"
    # Every job reads the plan, never the selection or the lookup themselves.
    assert select["outputs"] == {
        f"{group}_{fact}": f"${{{{ steps.plan.outputs.{group}_{fact} }}}}"
        for group in GROUPS
        for fact in ("build", "e2e", "run", "sha")
    }


def test_native_checks_have_no_matrix_and_no_job_skipped_for_every_caller():
    workflow = load_workflow("native-checks.yml")
    assert all("strategy" not in job for job in workflow["jobs"].values())
    assert "matrix." not in (WORKFLOWS / "native-checks.yml").read_text()
    # A job skipped in one stage skips everything downstream of it there, so none exists: the
    # selection always runs, and a build's follow-ons are skipped only with their build.
    assert all("inputs.stage" not in job.get("if", "") for job in workflow["jobs"].values())


def plan_of(env: dict[str, str]) -> dict[str, str]:
    result = subprocess.run(
        ["bash", str(PLAN_SCRIPT)],
        env={"PATH": "/usr/bin:/bin", "THIS_RUN": "20", "THIS_SHA": "main", **env},
        capture_output=True,
        text=True,
        check=True,
    )
    return dict(line.split("=", 1) for line in result.stdout.splitlines())


def test_a_pull_request_builds_what_it_selected_and_tests_nothing_end_to_end():
    plan = plan_of({"STAGE": "build", "SELECTED_app": "true", "SELECTED_desktop": "false"})
    assert plan["app_build"] == "true"
    assert plan["app_e2e"] == "false"
    assert (plan["app_run"], plan["app_sha"]) == ("20", "main")
    assert (plan["desktop_build"], plan["desktop_e2e"]) == ("false", "false")
    # A group the selection said nothing of is neither built nor tested.
    assert (plan["music_build"], plan["music_e2e"]) == ("false", "false")


def test_main_tests_a_found_group_on_the_pull_request_s_builds_and_builds_the_rest():
    plan = plan_of(
        {
            "STAGE": "e2e",
            "FOUND_RUN": "7",
            "FOUND_SHA": "head",
            "SELECTED_app": "true",
            "FOUND_app": "true",
            "SELECTED_music": "true",
            "SELECTED_desktop": "false",
            "FOUND_desktop": "true",
        }
    )
    assert (plan["app_build"], plan["app_e2e"]) == ("false", "true")
    assert (plan["app_run"], plan["app_sha"]) == ("7", "head")
    # Selected but not found: built here, and read from this run.
    assert (plan["music_build"], plan["music_e2e"]) == ("true", "true")
    assert (plan["music_run"], plan["music_sha"]) == ("20", "main")
    # Found but not selected: nothing runs for it.
    assert (plan["desktop_build"], plan["desktop_e2e"]) == ("false", "false")


def test_the_lookup_never_fails_the_run_and_reads_the_pull_request_s_checks():
    script = FIND_SCRIPT.read_text()
    assert "set -e" not in script
    assert "pull-request-checks.yml/runs" in script
    # Not a push: nothing is found, with no call made.
    result = subprocess.run(
        ["bash", str(FIND_SCRIPT)],
        env={"PATH": "/usr/bin:/bin", "EVENT": "workflow_dispatch", "REPO": "o/r", "SHA": "main"},
        capture_output=True,
        text=True,
        check=True,
    )
    assert result.stdout == ""


@pytest.mark.parametrize(("job_name", "group"), sorted(BUILD_JOBS.items()))
def test_build_jobs_run_when_the_plan_says_to_build_their_group(job_name: str, group: str):
    job = load_workflow("native-checks.yml")["jobs"][job_name]
    assert job["needs"] == "select"
    assert job["if"] == f"needs.select.outputs.{group}_build == 'true'"


@pytest.mark.parametrize(("job_name", "handoff"), sorted(E2E_JOBS.items()))
def test_end_to_end_jobs_wait_only_for_their_own_build(job_name: str, handoff: tuple[str, str]):
    build_job, group = handoff
    job = load_workflow("native-checks.yml")["jobs"][job_name]
    assert job["needs"] == ["select", build_job]
    # A build skipped because the pull request already made it must not skip its flows.
    assert job["if"] == (
        f"${{{{ !cancelled() && needs.select.outputs.{group}_e2e == 'true'"
        f' && contains(fromJSON(\'["success", "skipped"]\'), needs.{build_job}.result) }}}}'
    )
    assert job["env"]["BUILD_RUN_ID"] == f"${{{{ needs.select.outputs.{group}_run }}}}"
    assert job["env"]["BUILD_SHA"] == f"${{{{ needs.select.outputs.{group}_sha }}}}"


@pytest.mark.parametrize(("job_name", "native_job"), sorted(FOLLOW_ON_JOBS.items()))
def test_follow_on_jobs_wait_for_their_native_build(job_name: str, native_job: str):
    job = load_workflow("native-checks.yml")["jobs"][job_name]
    assert job["needs"] == native_job
    # A skipped native build skips its follow-ons; a gate of their own would be a second truth.
    assert "if" not in job


@pytest.mark.parametrize("job_name", sorted(ALL_JOBS))
def test_every_native_job_cancels_a_failing_pull_request_run(job_name: str):
    job = load_workflow("native-checks.yml")["jobs"][job_name]
    assert job["steps"][-1] == CANCEL_STEP
    assert sum(step.get("name") == CANCEL_STEP["name"] for step in job["steps"]) == 1


def runs_of(job: dict) -> str:
    return "\n".join(
        step.get("run", "") + step.get("with", {}).get("script", "") for step in job["steps"]
    )


@pytest.mark.parametrize(("device", "facts"), sorted(DEVICES.items()))
def test_each_device_is_built_by_a_job_named_for_it(device: str, facts: tuple[str, str, bool]):
    name, _, has_flows = facts
    jobs = load_workflow("native-checks.yml")["jobs"]
    build = jobs[f"build-{device}"]
    assert build["name"] == f"🏗️ Build {name}"
    # Every device builds by the same steps; only its job's `APP_*` variables differ.
    assert build["steps"] == jobs["build-iphone"]["steps"]
    assert any(
        step.get("uses") == "actions/upload-artifact@v7" and step["with"]["name"] == HANDOFF
        for step in build["steps"]
    )
    assert ":e2e" not in build["env"]["APP_BUILD"]
    assert "env.APP_FLOWS" not in runs_of(build)
    assert (f"e2e-{device}" in jobs) == has_flows
    assert ("APP_FLOWS" in build["env"]) == has_flows


@pytest.mark.parametrize(
    ("device", "name"),
    sorted((device, name) for device, (name, _, has_flows) in DEVICES.items() if has_flows),
)
def test_each_device_s_flows_run_on_its_own_build_in_a_job_named_for_it(device: str, name: str):
    jobs = load_workflow("native-checks.yml")["jobs"]
    job = jobs[f"e2e-{device}"]
    assert job["name"] == f"🎬 E2E {name}"
    # One settings block a device, so its two jobs agree on the artifact.
    assert job["env"] == jobs[f"build-{device}"]["env"]
    assert job["steps"] == jobs["e2e-iphone"]["steps"]
    # Read from the run that holds it, which the token lets another run's be.
    download = next(
        step
        for step in job["steps"]
        if step.get("uses") == "actions/download-artifact@v8"
        and step["with"]["name"] == FOUND_HANDOFF
    )
    assert download["with"]["run-id"] == "${{ env.BUILD_RUN_ID }}"
    assert download["with"]["github-token"] == "${{ github.token }}"
    # The flows are the pushed commit's, whichever commit the build is of.
    assert job["steps"][0]["with"]["ref"] == "${{ inputs.sha }}"
    # The flows run here and nothing compiles here.
    assert any(target in job["env"]["APP_FLOWS"] for target in END_TO_END_TARGETS)
    assert "env.APP_FLOWS" in runs_of(job)
    assert "env.APP_BUILD" not in runs_of(job)
    setup = next(
        step for step in job["steps"] if step.get("uses") == "./.github/actions/raven-app-setup"
    )
    assert setup["with"]["compiles"] == "false"


@pytest.mark.parametrize("job_name", sorted(DESKTOP_JOBS))
def test_desktop_jobs_build_the_given_commit_and_keep_the_handoff(job_name: str):
    workflow = load_workflow("native-checks.yml")
    job = workflow["jobs"][job_name]
    assert job["runs-on"] == "macos-26"
    assert "github.sha" not in str(job)
    checkout = job["steps"][0]
    assert checkout["uses"] == "actions/checkout@v7"
    assert checkout["with"]["ref"] == "${{ inputs.sha }}"
    # The native job uploads the handoff and the app job reads this run's; the playback jobs
    # read it from whichever run holds it.
    handoffs = {
        "desktop-native": ("actions/upload-artifact@v7", "inputs.sha"),
        "desktop-app": ("actions/download-artifact@v8", "inputs.sha"),
        "desktop-test": ("actions/download-artifact@v8", "env.BUILD_SHA"),
        "desktop-e2e": ("actions/download-artifact@v8", "env.BUILD_SHA"),
    }
    handoff_action, commit = handoffs[job_name]
    assert any(
        step.get("uses") == handoff_action
        and step["with"]["name"] == f"raven-native-handoff-${{{{ {commit} }}}}"
        for step in job["steps"]
    )


def test_the_desktop_playback_jobs_share_their_steps_and_only_e2e_waits_for_main():
    jobs = load_workflow("native-checks.yml")["jobs"]
    test, e2e = jobs["desktop-test"], jobs["desktop-e2e"]
    assert test["steps"] == e2e["steps"]
    assert (test["name"], test["env"]["CHECK_TARGET"]) == ("🧪 Test Mac player", "test:native")
    assert (e2e["name"], e2e["env"]["CHECK_TARGET"]) == ("🎬 E2E Mac", "e2e")
    # The tests run wherever this run built the native pieces, and only there.
    assert test["needs"] == ["select", "desktop-native"]
    assert "if" not in test
    # A pull request merges long after it was built, so the handoff outlives a day.
    upload = next(
        step
        for step in jobs["desktop-native"]["steps"]
        if step.get("with", {}).get("name") == "raven-native-handoff-${{ inputs.sha }}"
    )
    assert int(upload["with"]["retention-days"]) >= 14


def test_release_dry_runs_do_not_trigger_on_pull_requests():
    workflow = load_workflow("desktop-release.yml")
    assert set(workflow["on"]) == {"push", "workflow_dispatch"}
    assert "tags" in workflow["on"]["push"]


def test_local_desktop_e2e_downloads_main_native_handoffs():
    script = (ROOT / "scripts/ci_desktop_e2e.sh").read_text()
    assert "main-native-checks.yml pull-request-checks.yml" in script
    assert 'gh run list --workflow "$workflow"' in script
