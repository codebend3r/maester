"""Release groups: which one made a file, and which ones keep making files friends report.

A file's release group is what its arr recorded, or else the "-GROUP" at the
end of its file name: the scene convention, which Radarr's and Sonarr's own
renames keep at the end. Words that only look like a group there ("WEB-DL",
a codec, a resolution) aren't taken for one.

A group whose files were reported `BAD_RELEASE_REPORTS` times or more in
`WINDOW` is suggested for a block in the digest, once per window. Files are
counted, not reports: two friends reporting one file is one bad file. A
report the player explains doesn't count, since the file was fine.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import PurePosixPath

from luwin.store import ReportRow, Store

WINDOW = timedelta(days=30)
# Claimed per group when suggested, so the digest says it once a window.
SOURCE = "bad_release"

_TRAILING_TAGS = re.compile(r"(\s*\[[^\]]*\])+$")
_GROUP = re.compile(r"-([A-Za-z0-9][A-Za-z0-9._@]*)$")
# Words that end a file name after a hyphen without being a release group.
_NOT_GROUPS = {
    "dl", "rip", "web", "hd", "sd", "uhd", "hdr", "x264", "x265", "h264", "h265", "hevc", "avc",
    "480p", "576p", "720p", "1080p", "2160p", "4k", "sample", "proper", "repack",
}  # fmt: skip


def group_from_name(path: str) -> str | None:
    """The release group at the end of a file name, if it has one."""
    stem = _TRAILING_TAGS.sub("", PurePosixPath(path).stem)
    match = _GROUP.search(stem)
    if match is None:
        return None
    group = match[1]
    if group.lower() in _NOT_GROUPS or group.isdigit():
        return None
    return group


def release_group(recorded: str | None, path: str) -> str | None:
    """The arr's word for a file's group, or else its file name's."""
    return recorded or group_from_name(path)


@dataclass(frozen=True)
class BadRelease:
    group: str
    files: tuple[str, ...]  # "Dune (2021) in 4K on vermithor", one per file

    def suggestion(self) -> str:
        pattern = f"^{re.escape(self.group)}$"
        return (
            f"{self.group}: {len(self.files)} reported files in {WINDOW.days} days "
            f"({'; '.join(self.files)}). To stop grabbing it, add a custom format with a Release "
            f"Group condition `{pattern}` scored -10000 in your Radarr and Sonarr profiles, or "
            f"put `{self.group}` in a release profile's Must Not Contain."
        )


def bad_releases(reports: list[ReportRow], threshold: int) -> list[BadRelease]:
    """Groups with `threshold` or more distinct reported files, most first."""
    files: dict[str, dict[tuple[str, str, int], str]] = {}
    for r in reports:
        if not r.release_group:
            continue
        key = (r.host, r.copy.media_type, r.file_id)
        files.setdefault(r.release_group, {})[key] = f"{r.title} in {r.copy.version} on {r.host}"
    found = [
        BadRelease(group, tuple(sorted(named.values())))
        for group, named in files.items()
        if len(named) >= threshold
    ]
    return sorted(found, key=lambda b: (-len(b.files), b.group.lower()))


def new_bad_releases(store: Store, threshold: int) -> list[BadRelease]:
    """Groups past the threshold now that haven't been suggested this window."""
    since = datetime.now(UTC) - WINDOW
    return [
        bad
        for bad in bad_releases(store.file_reports_since(since), threshold)
        if store.claim(SOURCE, bad.group.lower(), window=WINDOW)
    ]
