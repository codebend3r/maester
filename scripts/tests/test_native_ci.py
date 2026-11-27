import json
import re
import shlex
import subprocess
import tomllib
from pathlib import Path

import pytest
import yaml

ROOT = Path(__file__).resolve().parents[2]
WORKFLOWS = ROOT / ".github/workflows"
ACTIONS = ROOT / ".github/actions"
PULL_REQUEST = "pull-request-checks.yml"
MAIN = "e2e-tests.yml"
# Every job main's run starts with, so a "Release vX.Y.Z" commit runs none of them.
NOT_A_RELEASE = "${{ !startsWith(github.event.head_commit.message, 'Release v') }}"
# Each runner OS's one install in the pull request workflow, and its runner.
INSTALL_JOBS = {
    "install": "ubuntu-24.04",
    "install-macos": "macos-26",
    "install-windows": "windows-2025",
}
INSTALL_ACTION = "./.github/actions/bun-install"

SELECT_SCRIPT = "python3 scripts/select_native_checks.py"
GROUPS = ("app", "music", "desktop")
# Each device's job id suffix, the name its jobs carry, its group, and whether it has flows.
DEVICES = {
    "iphone": ("iPhone", "app", True),
    "apple-tv": ("Apple TV", "app", True),
    "android-tv": ("Android TV", "app", True),
    "android-phone": ("Android phone", "app", True),
    "wren-iphone": ("Wren iPhone", "music", True),
    "wren-android": ("Wren Android", "music", True),
    "wren-apple-tv": ("Wren Apple TV", "music", True),
    "wren-android-tv": ("Wren Android TV", "music", True),
}
# Each device whose flows run on another device's build, and that device: an iPad runs the
# iPhone's simulator build.
SHARED_BUILDS = {"ipad": "iphone", "wren-ipad": "wren-iphone"}
# Each device with flows and its end to end job's name, which names the app it tests.
E2E_NAMES = {
    "iphone": "🎬 E2E Raven iPhone",
    "ipad": "🎬 E2E Raven iPad",
    "apple-tv": "🎬 E2E Raven Apple TV",
    "android-tv": "🎬 E2E Raven Android TV",
    "android-phone": "🎬 E2E Raven Android phone",
    "wren-iphone": "🎵 E2E Wren iPhone",
    "wren-ipad": "🎵 E2E Wren iPad",
    "wren-android": "🎵 E2E Wren Android",
    "wren-apple-tv": "🎵 E2E Wren Apple TV",
    "wren-android-tv": "🎵 E2E Wren Android TV",
}
# Each group's build job emoji: raven's jobs wear the clapperboard, Wren's its musical note.
BUILD_EMOJI = {"app": "🎬", "music": "🎵"}
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
    **{f"e2e-{device}": DEVICES[build][1] for device, build in SHARED_BUILDS.items()},
    "desktop-e2e": "desktop",
    "windows-e2e": "desktop",
}
# The native jobs a pull request lists: the builds and the tests. It selects nothing; main lists
# the selection alone.
NATIVE_JOBS = [*BUILD_JOBS, *FOLLOW_ON_JOBS, "desktop-test"]
# Each pull request native job that is more than a build of a device, and the action that holds
# its steps.
JOB_ACTIONS = {
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
END_TO_END_TARGETS = ("app:e2e", "wren:e2e", "wren:tv:e2e")
# Each app's folder and its Nx project.
PROJECTS = {
    "apps/raven/app": "@raven/app",
    "apps/wren/wren-app": "@wren/app",
    "apps/wren/wren-tv": "@wren/tv",
}
PLAN_SCRIPT = ROOT / "scripts/plan_native_builds.sh"
FIND_SCRIPT = ROOT / "scripts/find_pr_builds.sh"
# Every row of the pull request's one matrix, by the name its job carries.
STANDARD_CHECK_NAMES = {
    "🏗️ Build every project",
    "🖌️ Gale",
    "🧹 Dead code",
    "🧼 Dead CSS",
    "🎨 Oxfmt",
    "🔦 Lighthouse Raven web",
    "🔦 Lighthouse Wren web",
    "♿ axe-core",
    "🌐 E2E Raven web",
    "🎵 E2E Wren web",
    "🏠 E2E maester.tv",
    "🧩 One command per script",
    "🟦 Oxlint",
    "🐍 Python lint",
    "🔤 Spellcheck",
    "🧪 Unit tests",
    "🧩 Type-check",
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


def load_action(name: str) -> dict:
    return yaml.load((ACTIONS / name / "action.yml").read_text(), Loader=yaml.BaseLoader)


def standard_checks() -> list[dict]:
    """The rows of the pull request's `standard-checks` matrix."""
    return load_workflow(PULL_REQUEST)["jobs"]["standard-checks"]["strategy"]["matrix"]["check"]


def action_step(job: dict, action: str) -> dict:
    return next(step for step in job["steps"] if step.get("uses") == f"./.github/actions/{action}")


def test_pull_requests_list_the_native_jobs_and_wait_for_them():
    workflow = load_workflow(PULL_REQUEST)
    jobs = workflow["jobs"]
    # Every native job is this workflow's own: none is a workflow called, which GitHub would list
    # as a group of jobs under the caller's name.
    assert set(jobs) == {
        *INSTALL_JOBS,
        "standard-checks",
        *NATIVE_JOBS,
        "checks-complete",
        "supabase",
        "smoke",
    }
    assert all("uses" not in jobs[job_name] for job_name in NATIVE_JOBS)
    # The builds are named for the head commit, and nothing diffs against the base.
    assert workflow["env"]["NATIVE_BUILD_SHA"] == "${{ github.event.pull_request.head.sha }}"
    assert "NATIVE_SELECT_BASE" not in workflow["env"]
    complete = jobs["checks-complete"]
    assert complete["name"] == "✅ Checks"
    assert set(complete["needs"]) == {*INSTALL_JOBS, "standard-checks", *NATIVE_JOBS}
    gate = complete["steps"][-1]
    assert gate["env"] == {"ALL_RESULTS": "${{ join(needs.*.result, ' ') }}"}


def gate_of(results: str) -> int:
    gate = load_workflow(PULL_REQUEST)["jobs"]["checks-complete"]["steps"][-1]["run"]
    return subprocess.run(
        ["bash", "-e", "-c", gate],
        env={"PATH": "/usr/bin:/bin", "ALL_RESULTS": results},
        capture_output=True,
        check=False,
    ).returncode


def test_the_gate_passes_only_when_every_job_passed():
    # Every job runs on every pull request, so a skipped one means a job it waits for failed.
    assert gate_of("success success success") == 0
    assert gate_of("success skipped") != 0
    assert gate_of("success failure") != 0
    assert gate_of("success cancelled") != 0


def test_a_pull_request_selects_nothing_and_runs_every_check_on_every_project():
    text = (WORKFLOWS / PULL_REQUEST).read_text()
    assert "affected" not in text
    assert "--exclude=" not in text
    assert "raven-native-select" not in text
    jobs = load_workflow(PULL_REQUEST)["jobs"]
    assert all("if" not in jobs[job_name] for job_name in NATIVE_JOBS)


def test_each_runner_os_installs_once_and_every_job_restores_that_install():
    jobs = load_workflow(PULL_REQUEST)["jobs"]
    for job_name, runner in INSTALL_JOBS.items():
        assert jobs[job_name]["runs-on"] == runner
        assert any(step.get("uses") == INSTALL_ACTION for step in jobs[job_name]["steps"])
    # Nothing but the shared action installs, and off Windows it installs only on a cache miss.
    paths = [WORKFLOWS / PULL_REQUEST, *ACTIONS.glob("*/action.yml")]
    installing = [
        path.relative_to(ROOT)
        for path in paths
        if "bun install --frozen-lockfile" in path.read_text()
    ]
    assert installing == [Path(".github/actions/bun-install/action.yml")]
    restore, downloads, install = load_action("bun-install")["runs"]["steps"]
    assert "runner.os" in restore["with"]["key"]
    assert "node_modules" in restore["with"]["path"]
    # The cache's tar breaks the junctions Bun links a Windows install with, so a Windows job
    # restores Bun's downloads, which hold no links, and always installs from them.
    assert restore["if"] == "runner.os != 'Windows'"
    assert downloads["if"] == "runner.os == 'Windows'"
    assert "runner.os" in downloads["with"]["key"]
    assert "node_modules" not in downloads["with"]["path"]
    assert install["if"] == "runner.os == 'Windows' || steps.restore.outputs.cache-hit != 'true'"
    # Each job waits for the install of the OS it runs on, itself or through the standard checks.
    assert jobs["standard-checks"]["needs"] == "install"
    assert jobs["supabase"]["needs"] == "install"
    for job_name in BUILD_JOBS:
        job = jobs[job_name]
        needs = job["needs"] if isinstance(job["needs"], list) else [job["needs"]]
        assert "standard-checks" in needs
        expected = {"macos-26": "install-macos", "windows-2025": "install-windows"}.get(
            job["runs-on"]
        )
        assert expected is None or expected in needs, job_name


def test_a_pull_request_holds_no_device_end_to_end_job_not_even_a_skipped_one():
    # A job a pull request skips is still listed on it, so its workflow holds none: the device
    # flows are main's alone. The browser suites are rows of the standard checks, not jobs.
    jobs = load_workflow(PULL_REQUEST)["jobs"]
    assert not any("e2e" in job_name for job_name in jobs)
    assert not any("E2E" in job.get("name", "") for job in jobs.values())
    text = (WORKFLOWS / PULL_REQUEST).read_text()
    assert "env.APP_FLOWS" not in text
    assert "maestro" not in text.lower()
    assert "env.APP_FLOWS" not in (ACTIONS / "raven-app-build/action.yml").read_text()


def test_a_pull_request_runs_every_browser_suite_as_a_check_it_must_pass():
    # Main's run alone let a stale browser test merge and fail every push after it, so each web
    # app's suite, and the static site's, is a standard check, which ✅ Checks waits for.
    suites = {check["name"]: check for check in standard_checks() if "e2e" in check["target"]}
    assert set(suites) == {"🌐 E2E Raven web", "🎵 E2E Wren web", "🏠 E2E maester.tv"}
    scripts = json.loads((ROOT / "package.json").read_text())["scripts"]
    assert {scripts[suite["script"]] for suite in suites.values()} == {
        "nx run @raven/web:e2e:browser",
        "nx run @wren/web:e2e:browser",
        "nx run @raven/splash:e2e:browser",
    }
    # The fixture server encodes its clips with ffmpeg, which the static site, with no server,
    # does not need; a failure keeps the app's traces.
    assert {name for name, suite in suites.items() if suite.get("ffmpeg") == "true"} == {
        "🌐 E2E Raven web",
        "🎵 E2E Wren web",
    }
    assert {suite["dir"]: suite["traces"] for suite in suites.values()} == {
        "apps/raven/web": "e2e-traces",
        "apps/wren/wren-web": "wren-e2e-traces",
        "apps/raven/splash": "splash-e2e-traces",
    }
    upload = next(
        step
        for step in load_workflow(PULL_REQUEST)["jobs"]["standard-checks"]["steps"]
        if step.get("name") == "📤 Upload the browser suite's traces"
    )
    assert upload["if"] == "failure() && matrix.check.target == 'e2e:browser'"
    assert upload["with"]["path"] == "${{ matrix.check.dir }}/test-results"
    for project in suites.values():
        targets = json.loads((ROOT / project["dir"] / "package.json").read_text())["nx"]["targets"]
        assert targets["e2e:browser"]["cache"] is True


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
    assert set(workflow["jobs"]) == {
        "select",
        *E2E_JOBS,
        "web-e2e",
        "wren-web-e2e",
        "splash-e2e",
        "wren-desktop-e2e",
        "screen-tests",
    }
    assert all("uses" not in job for job in workflow["jobs"].values())
    # No base: the selection finds main's last green run.
    assert workflow["env"]["NATIVE_BUILD_SHA"] == "${{ github.sha }}"
    assert workflow["env"]["NATIVE_SELECT_BASE"] == ""
    assert "needs" not in workflow["jobs"]["select"]
    # The browser suites run here too, on every push, and Nx restores an unchanged pass. Each
    # job runs its own app's suite alone, through the one list of steps they share.
    browser_projects = {
        "web-e2e": "@raven/web",
        "wren-web-e2e": "@wren/web",
        "splash-e2e": "@raven/splash",
    }
    for name, project in browser_projects.items():
        web = workflow["jobs"][name]
        assert "needs" not in web
        assert web["if"] == NOT_A_RELEASE
        assert web["env"]["WEB_PROJECT"] == project
        assert web["steps"] == workflow["jobs"]["web-e2e"]["steps"]
        assert any(
            '-t e2e:browser -p "$WEB_PROJECT"' in step.get("run", "") for step in web["steps"]
        )
    # The device apps' screen tests run here alone, on every push, never on a pull request.
    screens = workflow["jobs"]["screen-tests"]
    assert "needs" not in screens
    assert screens["if"] == NOT_A_RELEASE
    assert any("-t test:screens" in step.get("run", "") for step in screens["steps"])
    assert all(check["target"] != "test:screens" for check in standard_checks())
    # The selection looks its last green run up under this workflow's file name.
    assert f"workflows/{MAIN}/runs" in (ROOT / "scripts/select_native_checks.py").read_text()


def test_native_jobs_select_and_plan_their_groups_once():
    select = load_workflow(MAIN)["jobs"]["select"]
    # The end to end jobs need it, so a release commit skips them with it.
    assert select["if"] == NOT_A_RELEASE
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


def test_a_selected_group_with_no_build_found_is_planned_as_one_to_build():
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
    # Not a push: nothing is found, with no call made.
    result = subprocess.run(
        ["bash", str(FIND_SCRIPT)],
        env={"PATH": "/usr/bin:/bin", "EVENT": event, "REPO": "o/r", "SHA": "main"},
        capture_output=True,
        text=True,
        check=True,
    )
    assert result.stdout == ""


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
    name, group, has_flows = facts
    jobs = load_workflow(PULL_REQUEST)["jobs"]
    build = jobs[f"build-{device}"]
    # Each build names its app: raven's device app or Wren.
    app_name = name if group == "music" else f"Raven {name}"
    assert build["name"] == f"{BUILD_EMOJI[group]} Build {app_name}"
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


@pytest.mark.parametrize(("device", "name"), sorted(E2E_NAMES.items()))
def test_each_device_s_flows_run_on_its_own_build_in_a_job_named_for_it(device: str, name: str):
    jobs = load_workflow(MAIN)["jobs"]
    built = SHARED_BUILDS.get(device, device)
    job, build = (
        jobs[f"e2e-{device}"],
        load_workflow(PULL_REQUEST)["jobs"][f"build-{built}"],
    )
    assert job["name"] == name
    # A device's two jobs agree on the build that passes between them.
    assert all(job["env"][setting] == build["env"][setting] for setting in HANDOFF_SETTINGS)
    # The Siri Remote's flow reads the test project its build packed beside the app.
    assert (job["env"]["APP_DRIVER"] == "xcuitest") == ("APP_TEST_PROJECT" in build["env"])
    group = DEVICES[built][1]
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
    assert (test["name"], e2e["name"]) == (
        "🧪 Test Raven Mac player",
        "🎬 E2E Raven Mac desktop",
    )
    # The tests run on the native pieces this run built.
    assert test["needs"] == "desktop-native"
    assert "if" not in test
    assert action_step(test, "raven-mac-playback")["with"] == {
        "target": "test:native",
        "build-run-id": "${{ github.run_id }}",
        "build-sha": NATIVE_SHA,
    }
    # Main's suite reads the handoff from whichever run holds it.
    assert action_step(e2e, "raven-mac-playback")["with"] == {
        "target": "e2e",
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
    assert "e2e-tests.yml pull-request-checks.yml" in script
    assert 'gh run list --workflow "$workflow"' in script


def test_main_warms_the_compile_caches_of_every_app_a_pull_request_builds():
    jobs = load_workflow(PULL_REQUEST)["jobs"]
    built = {
        (
            jobs[f"build-{device}"]["env"]["APP_SETUP"],
            jobs[f"build-{device}"]["env"]["APP_PROJECT"],
        )
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


def test_every_remote_test_build_caches_what_its_pack_step_reads():
    # A build Nx restores from its cache leaves only its outputs on disk, so a folder the pack step
    # tars that the target does not save fails the job on every run with nothing to build.
    step = next(
        step
        for step in load_action("raven-app-build")["runs"]["steps"]
        if step.get("name") == "📦 Pack the remote test project"
    )
    jobs = load_workflow(PULL_REQUEST)["jobs"]
    builds = [job["env"] for job in jobs.values() if job.get("env", {}).get("APP_TEST_PROJECT")]
    assert builds
    for env in builds:
        xcode = env.get("APP_XCODE_PROJECT", "Raven")
        pods = env.get("APP_PODS_TARGET", "raven")
        packed = (
            step["run"]
            .replace("${APP_PODS_TARGET:-raven}", pods)
            .replace("${APP_XCODE_PROJECT:-Raven}", xcode)
        )
        # `tar -czf <archive> <path>...`: everything after the archive is packed.
        tarred = set(shlex.split(packed)[3:])
        package = json.loads((ROOT / env["APP_PROJECT"] / "package.json").read_text())
        outputs = {
            output.removeprefix("{projectRoot}/")
            for output in package["nx"]["targets"]["build:tvos"]["outputs"]
        }
        assert tarred <= outputs, (env["APP_PROJECT"], sorted(tarred - outputs))


def test_each_device_s_flows_are_a_target_of_their_own():
    # Nx Cloud restores a target's pass by its inputs, which a device shares with every other
    # device of its app, so two jobs running one target would test one device and restore the
    # other. A simulator and an emulator each get their own name too, and their own logs.
    jobs = load_workflow(MAIN)["jobs"]
    envs = [jobs[f"e2e-{device}"]["env"] for device in E2E_NAMES]
    for setting in ("APP_FLOWS", "APP_LOGS"):
        assert len({env[setting] for env in envs}) == len(envs), setting
    simulators = [env["APP_SIMULATOR"] for env in envs if "APP_SIMULATOR" in env]
    assert len(set(simulators)) == len(simulators)
    scripts = json.loads((ROOT / "package.json").read_text())["scripts"]
    for env in envs:
        script = env["APP_FLOWS"].removeprefix("bun run ")
        project, target = scripts[script].removeprefix("nx run ").split(":", 1)
        folder = next(folder for folder, name in PROJECTS.items() if name == project)
        package = json.loads((ROOT / folder / "package.json").read_text())
        assert target in package["scripts"]
        assert target in package["nx"]["includedScripts"]
        assert package["nx"]["targets"][target]["cache"] is True


def test_each_android_job_boots_the_emulator_its_flows_need():
    jobs = load_workflow(MAIN)["jobs"]
    emulators = {
        device: (job["env"]["APP_AVD_TARGET"], job["env"]["APP_AVD_PROFILE"])
        for device in E2E_NAMES
        if (job := jobs[f"e2e-{device}"])["env"]["APP_BUNDLE"] == ""
    }
    tv, phone = ("android-tv", "tv_1080p"), ("google_apis", "pixel_7")
    assert emulators == {
        "android-tv": tv,
        "android-phone": phone,
        "wren-android": phone,
        "wren-android-tv": tv,
    }
    avd = action_step(jobs["e2e-iphone"], "raven-android-avd")
    assert avd["with"] == {
        "target": "${{ env.APP_AVD_TARGET }}",
        "profile": "${{ env.APP_AVD_PROFILE }}",
    }
    # Main saves a snapshot of each, and a snapshot supersedes only its own target's.
    legs = load_workflow("app-caches.yml")["jobs"]["android-avd"]["strategy"]["matrix"]["emulator"]
    assert {(leg["target"], leg["profile"]) for leg in legs} == set(emulators.values())
    key = next(
        step
        for step in load_action("raven-android-avd")["runs"]["steps"]
        if step.get("id") == "avd"
    )
    assert 'family="avd-v1-$TARGET-"' in key["run"]
    assert 'echo "supersedes=$family $key"' in key["run"]


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
    # The Mac's suite reads the native handoff, and the Windows one the libmpv and the addon.
    expected["desktop"] |= {"raven-native-handoff", "raven-native-win32-x64"}
    windows = action_step(
        load_workflow(PULL_REQUEST)["jobs"]["windows-native"], "raven-windows-native"
    )
    assert windows["with"] == {"sha": NATIVE_SHA}
    download = next(
        step
        for step in jobs["windows-e2e"]["steps"]
        if step.get("uses") == "actions/download-artifact@v8"
    )
    assert download["with"] == {
        "name": "raven-native-win32-x64-${{ needs.select.outputs.desktop_sha }}",
        "run-id": "${{ needs.select.outputs.desktop_run }}",
        "github-token": "${{ github.token }}",
        "path": "libs/raven/mpv/resources/win32-x64",
    }
    found = {
        group: set(names.split())
        for names, group in re.findall(
            r"if has ([^;]+); then\n\s+echo (\w+)=true", FIND_SCRIPT.read_text()
        )
    }
    assert found == expected


def test_the_standard_checks_run_every_check_at_once_and_cancel_on_a_failure():
    job = load_workflow(PULL_REQUEST)["jobs"]["standard-checks"]
    checks = standard_checks()
    assert {check["name"] for check in checks} == STANDARD_CHECK_NAMES
    assert "max-parallel" not in job["strategy"]
    assert job["strategy"]["fail-fast"] == "true"
    assert job["steps"][-1] == CANCEL_STEP
    # Lighthouse and the browser suites run on one web app a runner, through the root script that
    # names its cached Nx target; every other check runs on every project.
    scripts = json.loads((ROOT / "package.json").read_text())["scripts"]
    assert {scripts[check["script"]] for check in checks if check["target"] == "lighthouse"} == {
        "nx run @raven/web:lighthouse",
        "nx run @wren/web:lighthouse",
    }
    assert {check["target"] for check in checks if "script" in check} == {
        "lighthouse",
        "e2e:browser",
    }
    for project in ("apps/raven/web", "apps/wren/wren-web"):
        targets = json.loads((ROOT / project / "package.json").read_text())["nx"]["targets"]
        assert targets["lighthouse"]["cache"] is True
