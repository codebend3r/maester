import pytest

from features import FEATURES
from sync_features import MERGED, OPEN, feature_for, status_for


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
        assert (
            feature_for(pr(title="MAE: auto-approve sign-ups"))["name"] == "Auto-approve sign-ups"
        )


class TestStatusFor:
    def test_open_is_in_progress(self):
        assert status_for(pr()) == OPEN

    def test_merged_is_done(self):
        assert status_for(pr(state="MERGED", mergedAt="2026-10-27T00:00:00Z")) == MERGED

    def test_closed_unmerged_is_left_out(self):
        assert status_for(pr(state="CLOSED")) is None
