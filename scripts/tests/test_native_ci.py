import re
import subprocess
import tomllib
from pathlib import Path

import pytest
import yaml

ROOT = Path(__file__).resolve().parents[2]
WORKFLOWS = ROOT / ".github/workflows"
ACTIONS = ROOT / ".github/actions"
PULL_REQUEST = "pull-request-checks.yml"
MAIN = "native-checks.yml"
# Each web app's job in the pull request workflow: its selection output, the root script that runs
# a target on it alone, and its folder.
WEB_APP_JOBS = {
    "raven-web": ("raven", "ci:raven:web", "apps/raven/web"),
    "wren-web": ("wren", "ci:wren:web", "apps/raven/music-web"),
}

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
# Each end to end job and its group.
E2E_JOBS = {
    **{f"e2e-{device}": group for device, (_, group, has_flows) in DEVICES.items() if has_flows},
    "desktop-e2e": "desktop",
}
# The native jobs a pull request lists: the selection, the builds and the tests. Main lists the
# selection alone.
NATIVE_JOBS = ["select", *BUILD_JOBS, *FOLLOW_ON_JOBS, "desktop-test"]
# Each native job that is more than a build of a device, and the action that holds its steps.
JOB_ACTIONS = {
    "select": "raven-native-select",
    "windows-native": "raven-windows-native",
    "windows-app": "raven-windows-app",
    "desktop-native": "raven-mac-native",
    "desktop-app": "raven-mac-app",
    "desktop-test": "raven-mac-playback",
}
# What a device's two jobs must agree on to hand a build over.
HANDOFF_SETTINGS = ("APP_SETUP", "APP_PROJECT", "APP_ARTIFACT", "APP_BUNDLE")
# A build is uploaded under the commit it was built from, and read back under the commit of
# whichever run holds it: the merged pull request's, or the end to end run's own.
HANDOFF = "${{ env.APP_ARTIFACT }}-${{ inputs.sha }}"
FOUND_HANDOFF = "${{ env.APP_ARTIFACT }}-${{ env.BUILD_SHA }}"
NATIVE_SHA = "${{ env.NATIVE_BUILD_SHA }}"
END_TO_END_TARGETS = ("app:e2e", "@raven/music:e2e")
# Each app's folder and its Nx project.
PROJECTS = {"apps/raven/app": "@raven/app", "apps/raven/music": "@raven/music"}
PLAN_SCRIPT = ROOT / "scripts/plan_native_builds.sh"
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


def load_action(name: str) -> dict:
    return yaml.load((ACTIONS / name / "action.yml").read_text(), Loader=yaml.BaseLoader)


def action_step(job: dict, action: str) -> dict:
    return next(step for step in job["steps"] if step.get("uses") == f"./.github/actions/{action}")


def test_pull_requests_list_the_native_jobs_and_wait_for_them():
    workflow = load_workflow(PULL_REQUEST)
    jobs = workflow["jobs"]
    # Every native job is this workflow's own: none is a workflow called, which GitHub would list
    # as a group of jobs under the caller's name.
    assert set(jobs) == {
        "checks",
        "build",
        "web-apps",
        *WEB_APP_JOBS,
        *NATIVE_JOBS,
        "checks-complete",
        "supabase",
        "smoke",
    }
    assert all("uses" not in jobs[job_name] for job_name in NATIVE_JOBS)
    # The selection diffs the head commit against the base, and the builds are named for the head.
    assert workflow["env"]["NATIVE_BUILD_SHA"] == "${{ github.event.pull_request.head.sha }}"
    assert workflow["env"]["NATIVE_SELECT_BASE"] == "${{ github.event.pull_request.base.sha }}"
    # Every build starts at once: the native jobs wait for what the workspace's build waits for.
    assert jobs["select"]["needs"] == jobs["build"]["needs"] == "checks"
    assert all(
        "e2e" not in check["target"] for check in jobs["checks"]["strategy"]["matrix"]["check"]
    )
    complete = jobs["checks-complete"]
    assert complete["name"] == "✅ Checks"
    assert set(complete["needs"]) == {"checks", "build", "web-apps", *WEB_APP_JOBS, *NATIVE_JOBS}
    gate = complete["steps"][-1]
    # The selection runs on every PR, so its skipped result means the checks failed, never a
    # pass; a build it did not select is skipped and passes, and one that failed does not.
    assert 'test "$SELECT_RESULT" = success' in gate["run"]
    assert 'test "$WEB_APPS_RESULT" = success' in gate["run"]
    assert gate["env"]["ALL_RESULTS"] == "${{ join(needs.*.result, ' ') }}"
    assert '*" failure "* | *" cancelled "*) exit 1' in gate["run"]


def gate_of(results: str) -> int:
    gate = load_workflow(PULL_REQUEST)["jobs"]["checks-complete"]["steps"][-1]["run"]
    passed = {"CHECKS_RESULT", "BUILD_RESULT", "SELECT_RESULT", "WEB_APPS_RESULT"}
    return subprocess.run(
        ["bash", "-e", "-c", gate],
        env={"PATH": "/usr/bin:/bin", **dict.fromkeys(passed, "success"), "ALL_RESULTS": results},
        capture_output=True,
        check=False,
    ).returncode


def test_the_gate_passes_a_skipped_native_job_and_fails_a_failed_or_cancelled_one():
    assert gate_of("success success skipped skipped") == 0
    assert gate_of("success failure skipped") != 0
    assert gate_of("success skipped cancelled") != 0


def test_a_pull_request_holds_no_end_to_end_job_not_even_a_skipped_one():
    # A job a pull request skips is still listed on it, so its workflow holds none, and no word
    # of one: the flows are main's alone.
    assert "e2e" not in (WORKFLOWS / PULL_REQUEST).read_text().lower()
    jobs = load_workflow(PULL_REQUEST)["jobs"]
    assert not any("E2E" in job.get("name", "") for job in jobs.values())
    assert "env.APP_FLOWS" not in (ACTIONS / "raven-app-build/action.yml").read_text()


def test_main_lists_the_pull_request_s_selection_unchanged():
    pull_request = load_workflow(PULL_REQUEST)["jobs"]["select"]
    main = load_workflow(MAIN)["jobs"]["select"]
    # A pull request's selection waits for its checks; main has none to wait for.
    assert pull_request == {**main, "needs": "checks"}


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


def test_every_main_push_runs_the_end_to_end_jobs_without_cancellation():
    workflow = load_workflow(MAIN)
    assert workflow["on"] == {"push": {"branches": ["main"]}}
    assert "concurrency" not in workflow
    assert workflow["permissions"]["actions"] == "write"
    assert set(workflow["jobs"]) == {"select", *E2E_JOBS, "web-e2e", "screen-tests"}
    assert all("uses" not in job for job in workflow["jobs"].values())
    # No base: the selection finds main's last green run.
    assert workflow["env"]["NATIVE_BUILD_SHA"] == "${{ github.sha }}"
    assert workflow["env"]["NATIVE_SELECT_BASE"] == ""
    assert "needs" not in workflow["jobs"]["select"]
    # The web's browser suite runs here too, on every push, and Nx restores an unchanged pass.
    web = workflow["jobs"]["web-e2e"]
    assert "needs" not in web
    assert "if" not in web
    assert any("-t e2e:browser" in step.get("run", "") for step in web["steps"])
    # The device apps' screen tests run here alone, on every push, never on a pull request.
    screens = workflow["jobs"]["screen-tests"]
    assert "needs" not in screens
    assert "if" not in screens
    assert any("-t test:screens" in step.get("run", "") for step in screens["steps"])
    pull_request = load_workflow(PULL_REQUEST)["jobs"]["checks"]["strategy"]["matrix"]["check"]
    assert all(check["target"] != "test:screens" for check in pull_request)
    # The selection looks its last green run up under this workflow's file name.
    assert f"workflows/{MAIN}/runs" in (ROOT / "scripts/select_native_checks.py").read_text()


def test_native_jobs_select_and_plan_their_groups_once():
    select = load_workflow(MAIN)["jobs"]["select"]
    assert "if" not in select
    # The run's commit (GITHUB_SHA), which the script diffs, with the history to do so.
    checkout = select["steps"][0]
    assert checkout["uses"] == "actions/checkout@v7"
    assert checkout["with"] == {"fetch-depth": "0"}
    plan = action_step(select, "raven-native-select")
    assert plan["id"] == "plan"
    assert plan["with"] == {"sha": NATIVE_SHA, "base": "${{ env.NATIVE_SELECT_BASE }}"}
    facts = [f"{group}_{fact}" for group in GROUPS for fact in ("selected", "build", "run", "sha")]
    # Every job reads the plan, never the selection or the lookup themselves.
    assert select["outputs"] == {fact: f"${{{{ steps.plan.outputs.{fact} }}}}" for fact in facts}
    action = load_action("raven-native-select")
    assert {name: output["value"] for name, output in action["outputs"].items()} == select[
        "outputs"
    ]
    steps = {step["id"]: step for step in action["runs"]["steps"] if "id" in step}
    assert steps["select"]["run"] == SELECT_SCRIPT
    assert steps["select"]["env"]["NATIVE_BASE"] == "${{ inputs.base }}"
    assert steps["select"]["env"]["GH_TOKEN"] == "${{ github.token }}"
    # The lookup decides by the event whether there is a merged pull request to look for.
    assert "if" not in steps["find"]
    assert steps["find"]["env"]["EVENT"] == "${{ github.event_name }}"
    assert steps["find"]["run"] == 'bash scripts/find_pr_builds.sh >> "$GITHUB_OUTPUT"'
    assert steps["plan"]["run"] == 'bash scripts/plan_native_builds.sh >> "$GITHUB_OUTPUT"'
    assert "if" not in steps["plan"]
    for group in GROUPS:
        assert (
            steps["plan"]["env"][f"SELECTED_{group}"] == f"${{{{ steps.select.outputs.{group} }}}}"
        )
        assert steps["plan"]["env"][f"FOUND_{group}"] == f"${{{{ steps.find.outputs.{group} }}}}"


@pytest.mark.parametrize("name", [PULL_REQUEST, MAIN])
def test_every_job_reads_and_fills_nx_cloud_s_cache(name: str):
    workflow = load_workflow(name)
    # Set once for the whole workflow, so no job, a new one included, builds without it.
    assert workflow["env"]["NX_CLOUD_ACCESS_TOKEN"] == "${{ secrets.NX_CLOUD_ACCESS_TOKEN }}"
    assert all(
        "NX_CLOUD_ACCESS_TOKEN" not in job.get("env", {}) for job in workflow["jobs"].values()
    )


@pytest.mark.parametrize("name", [PULL_REQUEST, MAIN])
def test_no_workflow_sets_what_the_selection_script_reads(name: str):
    # A workflow's env reaches every job, the tests' too, where it would stand in for a base.
    assert "NATIVE_BASE" not in load_workflow(name).get("env", {})


def test_native_jobs_have_no_matrix():
    jobs = load_workflow(PULL_REQUEST)["jobs"]
    assert all("strategy" not in jobs[job_name] for job_name in NATIVE_JOBS)


def test_main_has_no_matrix_at_all():
    assert all("strategy" not in job for job in load_workflow(MAIN)["jobs"].values())


def plan_of(env: dict[str, str]) -> dict[str, str]:
    result = subprocess.run(
        ["bash", str(PLAN_SCRIPT)],
        env={"PATH": "/usr/bin:/bin", "THIS_RUN": "20", "THIS_SHA": "main", **env},
        capture_output=True,
        text=True,
        check=True,
    )
    return dict(line.split("=", 1) for line in result.stdout.splitlines())


def test_a_pull_request_builds_what_it_selected():
    plan = plan_of({"SELECTED_app": "true", "SELECTED_desktop": "false"})
    assert (plan["app_selected"], plan["app_build"]) == ("true", "true")
    assert (plan["app_run"], plan["app_sha"]) == ("20", "main")
    assert (plan["desktop_selected"], plan["desktop_build"]) == ("false", "false")
    # A group the selection said nothing of is neither selected nor built.
    assert (plan["music_selected"], plan["music_build"]) == ("false", "false")


def test_main_reads_a_found_group_from_the_pull_request_s_run_and_builds_the_rest():
    plan = plan_of(
        {
            "FOUND_RUN": "7",
            "FOUND_SHA": "head",
            "SELECTED_app": "true",
            "FOUND_app": "true",
            "SELECTED_music": "true",
            "SELECTED_desktop": "false",
            "FOUND_desktop": "true",
        }
    )
    assert (plan["app_selected"], plan["app_build"]) == ("true", "false")
    assert (plan["app_run"], plan["app_sha"]) == ("7", "head")
    # Selected but not found: built here, and read from this run.
    assert (plan["music_selected"], plan["music_build"]) == ("true", "true")
    assert (plan["music_run"], plan["music_sha"]) == ("20", "main")
    # Found but not selected: nothing runs for it.
    assert (plan["desktop_selected"], plan["desktop_build"]) == ("false", "false")


@pytest.mark.parametrize("event", ["workflow_dispatch", "pull_request"])
def test_the_lookup_never_fails_the_run_and_reads_the_pull_request_s_checks(event: str):
    script = FIND_SCRIPT.read_text()
    assert "set -e" not in script
    assert "pull-request-checks.yml/runs" in script
    # Not a push: nothing is found, with no call made, so a pull request builds what it selected.
    result = subprocess.run(
        ["bash", str(FIND_SCRIPT)],
        env={"PATH": "/usr/bin:/bin", "EVENT": event, "REPO": "o/r", "SHA": "main"},
        capture_output=True,
        text=True,
        check=True,
    )
    assert result.stdout == ""


@pytest.mark.parametrize(("job_name", "group"), sorted(BUILD_JOBS.items()))
def test_build_jobs_run_when_the_plan_says_to_build_their_group(job_name: str, group: str):
    job = load_workflow(PULL_REQUEST)["jobs"][job_name]
    assert job["needs"] == "select"
    assert job["if"] == f"needs.select.outputs.{group}_build == 'true'"


@pytest.mark.parametrize(("job_name", "group"), sorted(E2E_JOBS.items()))
def test_end_to_end_jobs_wait_only_for_the_selection(job_name: str, group: str):
    job = load_workflow(MAIN)["jobs"][job_name]
    assert job["needs"] == "select"
    assert job["if"] == f"needs.select.outputs.{group}_selected == 'true'"
    # Main builds nothing, so a group the plan says to build has no build to test.
    assert job["env"]["BUILD_MISSING"] == f"${{{{ needs.select.outputs.{group}_build }}}}"
    guard = job["steps"][0]
    assert guard["if"] == "env.BUILD_MISSING == 'true'"
    assert "exit 1" in guard["run"]
    # The flows are the pushed commit's, whichever commit the build is of.
    assert job["steps"][1]["with"]["ref"] == "${{ github.sha }}"
    # Main cancels nothing: every push is tested to the end.
    assert all(step.get("name") != CANCEL_STEP["name"] for step in job["steps"])


@pytest.mark.parametrize(("job_name", "native_job"), sorted(FOLLOW_ON_JOBS.items()))
def test_follow_on_jobs_wait_for_their_native_build(job_name: str, native_job: str):
    job = load_workflow(PULL_REQUEST)["jobs"][job_name]
    assert job["needs"] == native_job
    # A skipped native build skips its follow-ons; a gate of their own would be a second truth.
    assert "if" not in job


@pytest.mark.parametrize("job_name", sorted(NATIVE_JOBS))
def test_every_native_job_cancels_a_failing_pull_request_run(job_name: str):
    job = load_workflow(PULL_REQUEST)["jobs"][job_name]
    assert job["steps"][-1] == CANCEL_STEP
    assert sum(step.get("name") == CANCEL_STEP["name"] for step in job["steps"]) == 1
    # The token a pull request's workflow hands out reads only, so each job asks to cancel.
    assert job["permissions"] == {"actions": "write", "contents": "read"}


@pytest.mark.parametrize(("job_name", "action"), sorted(JOB_ACTIONS.items()))
def test_each_native_job_s_steps_live_in_an_action(job_name: str, action: str):
    job = load_workflow(PULL_REQUEST)["jobs"][job_name]
    # A checkout, the action, and the cancel.
    assert [step.get("uses") for step in job["steps"]] == [
        "actions/checkout@v7",
        f"./.github/actions/{action}",
        None,
    ]
    assert load_action(action)["runs"]["using"] == "composite"


def runs_of(steps: list[dict]) -> str:
    return "\n".join(step.get("run", "") + step.get("with", {}).get("script", "") for step in steps)


@pytest.mark.parametrize(("device", "facts"), sorted(DEVICES.items()))
def test_each_device_is_built_by_a_job_named_for_it(device: str, facts: tuple[str, str, bool]):
    name, _, has_flows = facts
    jobs = load_workflow(PULL_REQUEST)["jobs"]
    build = jobs[f"build-{device}"]
    assert build["name"] == f"🏗️ Build {name}"
    # Every device builds by the same steps; only its job's `APP_*` variables differ.
    assert build["steps"] == jobs["build-iphone"]["steps"]
    assert build["steps"][0]["with"] == {"ref": NATIVE_SHA}
    assert action_step(build, "raven-app-build")["with"] == {
        "sha": NATIVE_SHA,
        "node-version": "${{ env.APP_NODE_VERSION }}",
    }
    steps = load_action("raven-app-build")["runs"]["steps"]
    assert any(
        step.get("uses") == "actions/upload-artifact@v7" and step["with"]["name"] == HANDOFF
        for step in steps
    )
    assert ":e2e" not in build["env"]["APP_BUILD"]
    assert "APP_FLOWS" not in build["env"]
    assert (f"e2e-{device}" in load_workflow(MAIN)["jobs"]) == has_flows


@pytest.mark.parametrize(
    ("device", "name"),
    sorted((device, name) for device, (name, _, has_flows) in DEVICES.items() if has_flows),
)
def test_each_device_s_flows_run_on_its_own_build_in_a_job_named_for_it(device: str, name: str):
    jobs = load_workflow(MAIN)["jobs"]
    job, build = jobs[f"e2e-{device}"], load_workflow(PULL_REQUEST)["jobs"][f"build-{device}"]
    assert job["name"] == f"🎬 E2E {name}"
    # A device's two jobs agree on the build that passes between them.
    assert all(job["env"][setting] == build["env"][setting] for setting in HANDOFF_SETTINGS)
    # The Siri Remote's flow reads the test project its build packed beside the app.
    assert (job["env"]["APP_DRIVER"] == "xcuitest") == ("APP_TEST_PROJECT" in build["env"])
    group = DEVICES[device][1]
    assert job["env"]["BUILD_RUN_ID"] == f"${{{{ needs.select.outputs.{group}_run }}}}"
    assert job["env"]["BUILD_SHA"] == f"${{{{ needs.select.outputs.{group}_sha }}}}"
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
    # The flows run here and nothing compiles here.
    assert any(target in job["env"]["APP_FLOWS"] for target in END_TO_END_TARGETS)
    assert "env.APP_FLOWS" in runs_of(job["steps"])
    assert "APP_BUILD" not in job["env"]
    setup = action_step(job, "raven-app-setup")["with"]
    assert setup["compiles"] == "false"
    assert setup["project"] == "${{ env.APP_PROJECT }}"


@pytest.mark.parametrize(
    ("job_name", "action"),
    [("desktop-native", "raven-mac-native"), ("desktop-app", "raven-mac-app")],
)
def test_the_mac_s_build_jobs_build_the_named_commit_and_pass_the_handoff(
    job_name: str, action: str
):
    job = load_workflow(PULL_REQUEST)["jobs"][job_name]
    assert job["runs-on"] == "macos-26"
    assert job["steps"][0]["with"] == {"ref": NATIVE_SHA}
    assert action_step(job, action)["with"] == {"sha": NATIVE_SHA}
    # The native job uploads the handoff and the app job reads this run's.
    handoff_action = {
        "desktop-native": "actions/upload-artifact@v7",
        "desktop-app": "actions/download-artifact@v8",
    }[job_name]
    assert any(
        step.get("uses") == handoff_action
        and step["with"]["name"] == "raven-native-handoff-${{ inputs.sha }}"
        for step in load_action(action)["runs"]["steps"]
    )


def test_the_mac_s_tests_run_with_its_build_and_its_suite_waits_for_main():
    test = load_workflow(PULL_REQUEST)["jobs"]["desktop-test"]
    e2e = load_workflow(MAIN)["jobs"]["desktop-e2e"]
    assert (test["name"], e2e["name"]) == ("🧪 Test Mac player", "🎬 E2E Mac")
    # The tests run wherever this run built the native pieces, and only there.
    assert test["needs"] == ["select", "desktop-native"]
    assert "if" not in test
    # Both read the handoff from whichever run holds it.
    for job, target in ((test, "test:native"), (e2e, "e2e")):
        assert action_step(job, "raven-mac-playback")["with"] == {
            "target": target,
            "build-run-id": "${{ needs.select.outputs.desktop_run }}",
            "build-sha": "${{ needs.select.outputs.desktop_sha }}",
        }
    steps = load_action("raven-mac-playback")["runs"]["steps"]
    download = next(step for step in steps if step.get("uses") == "actions/download-artifact@v8")
    assert download["with"] == {
        "name": "raven-native-handoff-${{ inputs.build-sha }}",
        "run-id": "${{ inputs.build-run-id }}",
        "github-token": "${{ github.token }}",
        "path": "${{ runner.temp }}",
    }
    assert "bun run desktop:${{ inputs.target }}" in runs_of(steps)
    # A pull request merges long after it was built, so the handoff outlives a day.
    upload = next(
        step
        for step in load_action("raven-mac-native")["runs"]["steps"]
        if step.get("with", {}).get("name") == "raven-native-handoff-${{ inputs.sha }}"
    )
    assert int(upload["with"]["retention-days"]) >= 14


def test_release_dry_runs_do_not_trigger_on_pull_requests():
    workflow = load_workflow("desktop-release.yml")
    assert set(workflow["on"]) == {"push", "workflow_dispatch"}
    assert "tags" in workflow["on"]["push"]


def test_local_desktop_e2e_downloads_main_native_handoffs():
    script = (ROOT / "scripts/ci_desktop_e2e.sh").read_text()
    assert "native-checks.yml pull-request-checks.yml" in script
    assert 'gh run list --workflow "$workflow"' in script


def test_main_warms_the_compile_caches_of_every_app_a_pull_request_builds():
    jobs = load_workflow(PULL_REQUEST)["jobs"]
    built = {
        (jobs[f"build-{device}"]["env"]["APP_SETUP"], jobs[f"build-{device}"]["env"]["APP_PROJECT"])
        for device in DEVICES
    }
    caches = load_workflow("app-caches.yml")["jobs"]
    legs = [
        leg
        for job in ("build-apple", "build-android")
        for leg in caches[job]["strategy"]["matrix"]["platform"]
    ]
    assert {(leg["id"], leg["project"]) for leg in legs} == built
    # Each leg builds its own app, past Nx's cache, so the compile fills the caches it saves.
    assert all(leg["target"].startswith(PROJECTS[leg["project"]] + ":build:") for leg in legs)


def test_every_app_build_keys_its_caches_by_the_app():
    action = (ACTIONS / "raven-app-setup/action.yml").read_text()
    assert "format('{0}/package.json', inputs.project)" in action
    callers = [
        ACTIONS / "raven-app-build/action.yml",
        *(WORKFLOWS / name for name in ("app-caches.yml", "device-release.yml", MAIN)),
    ]
    for path in callers:
        steps = yaml.load(path.read_text(), Loader=yaml.BaseLoader)
        text = str(steps)
        assert "./.github/actions/raven-app-setup" in text
        assert "'project':" in text, path


def test_every_apple_job_builds_and_tests_on_the_one_xcode():
    # A cached result is keyed on the Xcode that made it, so one action names it for every job.
    pinned = [
        path.relative_to(ROOT)
        for path in [*ACTIONS.glob("*/action.yml"), *WORKFLOWS.glob("*.yml")]
        if "Xcode_" in path.read_text()
    ]
    assert pinned == [Path(".github/actions/raven-xcode/action.yml")]
    for action in (
        "raven-app-setup",
        "raven-desktop-native",
        "raven-mac-app",
        "raven-mac-playback",
    ):
        assert "./.github/actions/raven-xcode" in (ACTIONS / action / "action.yml").read_text()


def test_every_workflow_installs_the_same_node():
    versions = {
        path.name: yaml.load(path.read_text(), Loader=yaml.BaseLoader)
        .get("env", {})
        .get("APP_NODE_VERSION")
        for path in WORKFLOWS.glob("*.yml")
    }
    named = {name: version for name, version in versions.items() if version is not None}
    assert set(named) >= {PULL_REQUEST, MAIN, "app-caches.yml", "device-release.yml"}
    assert len(set(named.values())) == 1, named


def test_a_release_builds_the_native_pieces_as_the_checks_do():
    release = (WORKFLOWS / "desktop-release.yml").read_text()
    assert "./.github/actions/raven-desktop-native" in release
    assert "./.github/actions/raven-windows-mpv" in release
    windows = load_action("raven-windows-native")["runs"]["steps"]
    assert windows[0]["uses"] == "./.github/actions/raven-windows-mpv"


def test_main_finds_a_group_only_with_every_build_its_flows_read():
    jobs = load_workflow(MAIN)["jobs"]
    expected: dict[str, set[str]] = {group: set() for group in GROUPS}
    for job_name, group in E2E_JOBS.items():
        env = jobs[job_name].get("env", {})
        if "APP_ARTIFACT" not in env:
            continue
        expected[group].add(env["APP_ARTIFACT"])
        if env["APP_DRIVER"] == "xcuitest":
            expected[group].add(f"{env['APP_ARTIFACT']}-test-project")
    expected["desktop"].add("raven-native-handoff")
    found = {
        group: set(names.split())
        for names, group in re.findall(
            r"if has ([^;]+); then\n\s+echo (\w+)=true", FIND_SCRIPT.read_text()
        )
    }
    assert found == expected


WEB_APP_CHECK_NAMES = {
    "💬 Comment style",
    "🖌️ CSS lint",
    "🧹 Dead code",
    "🧼 Dead CSS",
    "🎨 Format",
    "🧩 One command per script",
    "🐍 Python lint",
    "🔤 Spellcheck",
    "🧪 Tests",
    "🧩 Type-check",
    "🟦 TypeScript lint",
    "🟦 TypeScript only",
    "🏗️ Build",
    "🔦 Lighthouse",
}


@pytest.mark.parametrize("job_name", WEB_APP_JOBS)
def test_each_web_app_runs_every_check_on_itself_alone(job_name: str):
    output, script, folder = WEB_APP_JOBS[job_name]
    job = load_workflow(PULL_REQUEST)["jobs"][job_name]
    assert {check["name"] for check in job["strategy"]["matrix"]["check"]} == WEB_APP_CHECK_NAMES
    assert job["env"]["WEB_APP_SCRIPT"] == script
    assert job["env"]["WEB_APP_DIR"] == folder
    assert any(step.get("run") == 'bun run "$WEB_APP_SCRIPT" "$TARGET"' for step in job["steps"])
    assert job["if"] == f"needs.web-apps.outputs.{output} == 'true'"


@pytest.mark.parametrize("job_name", WEB_APP_JOBS)
def test_each_web_app_s_job_stands_apart(job_name: str):
    job = load_workflow(PULL_REQUEST)["jobs"][job_name]
    # It waits for its selection alone, never for the workspace's checks or the other app.
    assert job["needs"] == "web-apps"
    assert job["strategy"]["fail-fast"] == "false"
    assert all("gh run cancel" not in step.get("run", "") for step in job["steps"])


def test_the_web_apps_selection_runs_both_when_the_workflow_changes():
    select = next(
        step
        for step in load_workflow(PULL_REQUEST)["jobs"]["web-apps"]["steps"]
        if step.get("id") == "select"
    )
    assert f".github/workflows/{PULL_REQUEST}" in select["run"]
    assert """affected='["@raven/web","@raven/music-web"]'""" in select["run"]


def test_the_workspace_s_checks_leave_the_web_apps_to_their_jobs():
    jobs = load_workflow(PULL_REQUEST)["jobs"]
    check = next(
        step for step in jobs["checks"]["steps"] if step.get("name") == "${{ matrix.check.name }}"
    )
    assert check["env"]["WEB_APPS"] == "@raven/web,@raven/music-web"
    assert check["run"].count('--exclude="$WEB_APPS"') == 2
    build = next(step for step in jobs["build"]["steps"] if step.get("name") == "🏗️ Build")
    assert build["run"] == "bun run build --exclude=@raven/web,@raven/music-web"
