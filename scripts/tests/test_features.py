import pytest

from features import FEATURES
from sync_features import MERGED, OPEN, Projects, feature_for, status_for


def pr(branch: str = "some-branch", body: str = "", title: str = "MAE: do a thing", **rest):
    """A pull request as `gh pr list --json` returns it."""
    return {
        "number": 1,
        "title": title,
        "url": "https://github.com/codebend3r/maester/pull/1",
        "body": body,
        "state": "OPEN",
        "headRefName": branch,
        "mergedAt": None,
        "projectItems": [],
    } | rest


class TestFeatureFor:
    def test_names_are_unique(self):
        names = [f["name"] for f in FEATURES]
        assert len(names) == len(set(names))

    @pytest.mark.parametrize(
        ("branch", "name"),
        [
            ("raven-windows-window", "Windows desktop app"),
            ("audio-library-support", "Audio library support"),
            ("credit-detection-spike", "Credit detection"),
            ("thermo-core", "Whole-repo thermo review"),
            ("device-android-tv", "Raven device app"),
        ],
    )
    def test_branch_prefix_picks_the_feature(self, branch, name):
        assert feature_for(pr(branch))["name"] == name

    def test_body_line_beats_the_branch(self):
        body = "## What\n\nFeature: credit detection\n"
        assert feature_for(pr("raven-windows-x", body))["name"] == "Credit detection"

    def test_body_line_can_start_a_new_feature(self):
        assert feature_for(pr(body="Feature: Subtitles"))["name"] == "Subtitles"

    def test_unmatched_pr_is_its_own_feature(self):
        feature = feature_for(pr(title="MAE: auto-approve sign-ups"))
        assert feature["name"] == "Auto-approve sign-ups"
        assert feature["own"] is True

    def test_listed_feature_is_not_a_prs_own(self):
        assert not feature_for(pr("raven-windows-window")).get("own")


def projects(*titles: str) -> Projects:
    """A dry-run `Projects` holding a project under each title."""
    made = Projects.__new__(Projects)
    made.dry_run = True
    made.by_title = {
        title: {"number": number, "id": f"id{number}", "title": title}
        for number, title in enumerate(titles, start=1)
    }
    made.details = {}
    return made


def on(*titles: str) -> list[dict]:
    """A PR's `projectItems`, one on each titled project."""
    return [{"title": title} for title in titles]


class TestEnsure:
    def test_a_retitled_pr_renames_its_project(self):
        held = projects("Old title", "Other feature")
        retitled = pr(title="MAE: new title", projectItems=on("Old title"))
        project = held.ensure(feature_for(retitled), retitled)
        assert project is not None
        assert project["number"] == 1
        assert set(held.by_title) == {"New title", "Other feature"}

    def test_a_pr_held_nowhere_gets_a_new_project(self):
        held = projects("Other feature")
        new = pr(title="MAE: new title")
        assert held.ensure(feature_for(new), new) is None
        assert held.by_title["New title"] == {"planned": True}

    def test_a_pr_on_a_deleted_project_gets_a_new_project(self):
        held = projects("Other feature")
        orphan = pr(title="MAE: new title", projectItems=on("Deleted"))
        assert held.ensure(feature_for(orphan), orphan) is None
        assert held.by_title["New title"] == {"planned": True}

    def test_a_listed_feature_never_renames(self):
        held = projects("Old title")
        listed = pr("raven-windows-window", projectItems=on("Old title"))
        assert held.ensure(feature_for(listed), listed) is None
        assert "Old title" in held.by_title


class TestStatusFor:
    def test_open_is_in_progress(self):
        assert status_for(pr()) == OPEN

    def test_merged_is_done(self):
        assert status_for(pr(state="MERGED", mergedAt="2026-10-27T00:00:00Z")) == MERGED

    def test_closed_unmerged_is_left_out(self):
        assert status_for(pr(state="CLOSED")) is None
