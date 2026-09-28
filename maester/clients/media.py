"""The media files themselves, read with ffprobe and ffmpeg on the read-only mount.

Only a file an arr owns is ever read. Callers name a title; its path comes
from the owning Radarr or Sonarr, and `MediaPaths` maps that path onto the
container's mounts (`MEDIA_PATH_MAP`, for arrs that see the shares under
other names) and refuses anything that resolves outside `MEDIA_ROOTS`,
symlinks and `..` included. Nothing here takes a path from the model.

`inspect` is ffprobe: duration, the video codec and Dolby Vision profile,
every audio and subtitle track, and subtitle files lying next to the video.
`decode` runs ffmpeg over one stretch of the file and reports the frames
it got out and the errors it printed; judging those is the health check's
job (`maester/playback/health.py`). Both run as async subprocesses under a
timeout (`process.py`), a few at a time, so the bot stays responsive and the
NAS isn't swamped. The process runner is injected, so tests never need ffmpeg.
"""

from __future__ import annotations

import asyncio
import json
import os
from collections.abc import Iterable, Sequence
from dataclasses import dataclass, field, replace
from typing import Any, Protocol

from maester.clients.process import Completed, Runner, lines, run_process
from maester.config import media_root_problem

# ffprobe and ffmpeg processes running at once, across every check.
MAX_PROCESSES = 2
SIDECAR_EXTENSIONS = frozenset({".srt", ".ass", ".ssa", ".vtt", ".sub", ".sup"})
# Words in a subtitle file's name that describe it rather than name its language.
SIDECAR_FLAGS = frozenset({"forced", "sdh", "hi", "cc", "default"})


class Unreadable(Exception):
    """The file can't be read, so it can't be judged; the message says why."""


@dataclass(frozen=True)
class Track:
    kind: str  # "audio" | "subtitle"
    codec: str
    language: str  # as tagged ("eng", "spa"); empty when untagged
    title: str
    default: bool = False
    forced: bool = False
    channels: int = 0  # audio only
    external: bool = False  # a subtitle file next to the video

    @classmethod
    def from_stream(cls, raw: dict[str, Any]) -> Track:
        tags = raw.get("tags") or {}
        disposition = raw.get("disposition") or {}
        return cls(
            kind=raw["codec_type"],
            codec=raw.get("codec_name") or "",
            language=tags.get("language") or "",
            title=tags.get("title") or "",
            default=bool(disposition.get("default")),
            forced=bool(disposition.get("forced")),
            channels=int(raw.get("channels") or 0),
        )


@dataclass(frozen=True)
class Inspection:
    """What ffprobe reads from a file without decoding it."""

    path: str  # where this container reads it
    duration: float  # seconds, as the container claims
    video_codec: str
    dovi_profile: int  # 0 without Dolby Vision
    tracks: tuple[Track, ...]  # audio and subtitles, embedded then external
    warnings: tuple[str, ...] = ()  # what ffprobe printed besides its answer

    @classmethod
    def from_ffprobe(cls, path: str, raw: dict[str, Any], warnings: Sequence[str]) -> Inspection:
        streams = raw.get("streams") or []
        try:
            duration = float((raw.get("format") or {})["duration"])
        except (KeyError, TypeError, ValueError):
            raise Unreadable("ffprobe found no duration in it") from None
        video = next(
            (
                s
                for s in streams
                if s.get("codec_type") == "video"
                and not (s.get("disposition") or {}).get("attached_pic")
            ),
            {},
        )
        dovi = next(
            (int(d["dv_profile"]) for d in video.get("side_data_list") or [] if "dv_profile" in d),
            0,
        )
        return cls(
            path=path,
            duration=duration,
            video_codec=video.get("codec_name") or "",
            dovi_profile=dovi,
            tracks=tuple(
                Track.from_stream(s)
                for s in streams
                if s.get("codec_type") in ("audio", "subtitle")
            ),
            warnings=tuple(warnings),
        )


@dataclass(frozen=True)
class Decoded:
    """What decoding one stretch gave: frames out, and ffmpeg's error lines."""

    frames: int
    errors: tuple[str, ...]
    exit_code: int | None  # None when it ran out of time and was stopped


class MediaPaths:
    """Where this container may read media, and how an arr's paths map onto it."""

    def __init__(self, roots: Iterable[str], path_map: Iterable[tuple[str, str]] = ()):
        roots = list(roots)
        if problems := [p for p in map(media_root_problem, roots) if p]:
            raise ValueError(f"not a media root: {'; '.join(problems)}")
        self.roots = tuple(os.path.realpath(r) for r in roots)
        # Longest prefix first, so a nested share wins over its parent.
        self.path_map = tuple(
            sorted(
                ((os.path.normpath(a), os.path.normpath(m)) for a, m in path_map),
                key=lambda pair: -len(pair[0]),
            )
        )

    def container_path(self, arr_path: str) -> str:
        """The real path to read for a path an arr reports; `Unreadable` outside the roots."""
        if not self.roots:
            raise Unreadable("no media roots are configured (MEDIA_ROOTS), so no file can be read")
        path = os.path.normpath(arr_path)
        if not os.path.isabs(path):
            raise Unreadable(f"the arr reported a relative path, {arr_path!r}")
        for arr_root, mount in self.path_map:
            if _within(path, arr_root):
                path = mount + path[len(arr_root) :]
                break
        return self.contain(path, arr_path)

    def contain(self, path: str, named: str | None = None) -> str:
        """`path` with its links resolved, when that is inside a media root."""
        real = os.path.realpath(path)
        if not any(_within(real, root) for root in self.roots):
            raise Unreadable(f"{named or path} isn't under a media root this container mounts")
        return real


def _within(path: str, root: str) -> bool:
    return path == root or path.startswith(root.rstrip("/") + "/")


def sidecar_subtitles(path: str) -> tuple[Track, ...]:
    """Subtitle files next to the video named after it: "Dune (2021).es.forced.srt"."""
    folder, name = os.path.split(path)
    stem = os.path.splitext(name)[0]
    tracks = []
    for entry in sorted(os.listdir(folder)):
        base, ext = os.path.splitext(entry)
        if ext.lower() not in SIDECAR_EXTENSIONS:
            continue
        if base != stem and not base.startswith(f"{stem}."):
            continue  # another video's subtitles
        words = [w for w in base[len(stem) :].split(".") if w]
        flags = {w.lower() for w in words} & SIDECAR_FLAGS
        language = next((w for w in words if w.lower() not in SIDECAR_FLAGS), "")
        tracks.append(
            Track(
                kind="subtitle",
                codec=ext[1:].lower(),
                language=language,
                title=entry,
                forced="forced" in flags,
                external=True,
            )
        )
    return tuple(tracks)


def _frames(progress: str) -> int:
    """The last frame count in ffmpeg's `-progress` output."""
    counts = [line.split("=", 1)[1] for line in lines(progress) if line.startswith("frame=")]
    return int(counts[-1]) if counts else 0


class MediaProbe(Protocol):
    async def inspect(self, arr_path: str) -> Inspection: ...
    async def decode(self, inspection: Inspection, start: float, length: float) -> Decoded: ...


class FileProbe:
    """ffprobe and ffmpeg over the read-only media mounts."""

    def __init__(self, paths: MediaPaths, run: Runner = run_process, *, timeout: float = 120.0):
        self.paths = paths
        self.timeout = timeout
        self._run_process = run
        self._slots = asyncio.Semaphore(MAX_PROCESSES)

    async def _run(self, argv: list[str]) -> Completed:
        async with self._slots:
            return await self._run_process(argv, self.timeout)

    def _locate(self, arr_path: str) -> str:
        path = self.paths.container_path(arr_path)
        if not os.path.isfile(path):
            raise Unreadable(f"there's no file at {path} on the read-only media mount")
        return path

    async def inspect(self, arr_path: str) -> Inspection:
        path = await asyncio.to_thread(self._locate, arr_path)
        argv = ["ffprobe", "-v", "error", "-print_format", "json", "-show_format", "-show_streams"]
        done = await self._run([*argv, f"file:{path}"])
        if done.exit_code is None:
            raise Unreadable(f"ffprobe took longer than {self.timeout:.0f} s")
        if done.exit_code != 0:
            why = next(iter(lines(done.stderr)), f"exit code {done.exit_code}")
            raise Unreadable(f"ffprobe couldn't read it: {why}")
        try:
            raw = json.loads(done.stdout)
        except ValueError:
            raise Unreadable("ffprobe's answer wasn't JSON") from None
        inspection = Inspection.from_ffprobe(path, raw, lines(done.stderr))
        sidecars = await asyncio.to_thread(sidecar_subtitles, path)
        return replace(inspection, tracks=inspection.tracks + sidecars)

    async def decode(self, inspection: Inspection, start: float, length: float) -> Decoded:
        """Decode the first video and audio stream from `start` for `length` seconds.

        Only an inspected file is decoded, and its path is checked against the media
        roots again here, since an `Inspection` is only a record.
        """
        path = await asyncio.to_thread(self.paths.contain, inspection.path)
        done = await self._run(
            [
                "ffmpeg", "-nostdin", "-hide_banner", "-v", "error",
                "-ss", f"{start:.3f}", "-i", f"file:{path}", "-t", f"{length:.3f}",
                "-map", "0:v:0", "-map", "0:a:0?", "-f", "null", "-progress", "pipe:1", "-",
            ]
        )  # fmt: skip
        return Decoded(_frames(done.stdout), lines(done.stderr), done.exit_code)


@dataclass
class FakeFileProbe:
    """Files by the path their arr reports, and what decoding each gives."""

    files: dict[str, Inspection] = field(default_factory=dict)
    # ffmpeg's error lines per file; a file listed in `empty` decodes no frames.
    errors: dict[str, tuple[str, ...]] = field(default_factory=dict)
    empty: set[str] = field(default_factory=set)
    decoded: list[tuple[str, float, float]] = field(default_factory=list)

    async def inspect(self, arr_path: str) -> Inspection:
        if arr_path not in self.files:
            raise Unreadable(f"there's no file at {arr_path} on the read-only media mount")
        return self.files[arr_path]

    async def decode(self, inspection: Inspection, start: float, length: float) -> Decoded:
        path = inspection.path
        self.decoded.append((path, start, length))
        frames = 0 if path in self.empty else int(length * 24)
        return Decoded(frames, self.errors.get(path, ()), 0)
