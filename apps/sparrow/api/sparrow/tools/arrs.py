"""The admin's questions about Radarr, Sonarr and Lidarr, and the moves they ask of them.

Whatever the arr's own UI shows, the admin can ask sparrow instead, on any host:

- `arr_overview`: how it is set up and doing: version, root folders and what
  each holds, the custom filters saved in its list, tags, quality profiles,
  disks, health warnings and the queue.
- `arr_titles`: its movies, series or artists, picked the way its list
  picks them (a saved custom filter such as "Movies (Requested)", a title, a
  path, what is on disk, whether monitored), sorted and counted.
- `arr_history`: what it grabbed, imported, failed and deleted lately.
- `arr_move`: give the titles a filter picks another root folder, or each
  its letter folder ("Late Quartet, A (2012)" to `/Meleys/Movies/L`), and
  the arr moves their files. Destructive: the admin presses Confirm first.

A saved custom filter is read the way the UI reads it: every rule must hold,
each one checked against the title's record (its `statistics` included, for
Sonarr's and Lidarr's sizes). A rule this can't read (a date window, a field
the record lacks) is refused, never guessed.
"""

from __future__ import annotations

import asyncio
from collections.abc import Callable
from dataclasses import dataclass
from typing import Annotated, Any, Literal

from pydantic import Field

from sparrow.agent.tools import Failed, Ok, Refused, Result, Tier, ToolContext, tool
from sparrow.clients import ClientError
from sparrow.clients.arr_library import ArrLibrary, ArrService, ArrTitle, CustomFilter, HistoryRow
from sparrow.clients.base import Answers, every_host

GIB = 2**30
TITLES_SHOWN = 50
MAX_TITLES = 200
MAX_EVENTS = 100
# A filtered history is read from this many of the newest events.
EVENTS_READ = 250
MAX_MOVES = 200
# A letter folder for a title whose folder starts with anything but a letter: "25th Hour".
NOT_A_LETTER = "#"

Service = Annotated[
    ArrService,
    Field(description="radarr (movies), sonarr (TV series) or lidarr (music artists)."),
]
AnyHost = Annotated[
    str, Field(description="The host it runs on, such as vermithor; empty for every host.")
]
OneHost = Annotated[str, Field(description="The host it runs on, such as vermithor.", min_length=1)]
FilterName = Annotated[
    str,
    Field(description="A custom filter saved in the arr's list, by its label: Movies (Requested)."),
]
TitleText = Annotated[str, Field(description="Part of the title (an artist's name for lidarr).")]
PathText = Annotated[str, Field(description="Part of the path: /Meleys/Movies/Requests/.")]
OnDisk = Literal["any", "complete", "missing", "incomplete"]
Monitored = Literal["any", "monitored", "unmonitored"]
Sort = Literal["title", "added", "release", "year", "size"]
Event = Literal["any", "grabbed", "imported", "failed", "deleted"]

# What each kind of arr's titles have on disk, counted.
UNITS: dict[ArrService, str] = {"radarr": "file", "sonarr": "episodes", "lidarr": "tracks"}

EVENT_NAMES = {
    "grabbed": "grabbed",
    "downloadFailed": "download failed",
    "downloadFolderImported": "imported",
    "downloadImported": "imported",
    "trackFileImported": "imported",
    "movieFolderImported": "imported from its folder",
    "seriesFolderImported": "imported from its folder",
    "albumImportIncomplete": "import incomplete",
    "movieFileDeleted": "file deleted",
    "episodeFileDeleted": "file deleted",
    "trackFileDeleted": "file deleted",
    "movieFileRenamed": "file renamed",
    "episodeFileRenamed": "file renamed",
    "trackFileRenamed": "file renamed",
    "downloadIgnored": "ignored",
}
EVENTS: dict[Event, frozenset[str]] = {
    "any": frozenset(),
    "grabbed": frozenset({"grabbed"}),
    "imported": frozenset(
        {
            "downloadFolderImported",
            "downloadImported",
            "trackFileImported",
            "movieFolderImported",
            "seriesFolderImported",
        }
    ),
    "failed": frozenset({"downloadFailed", "albumImportIncomplete"}),
    "deleted": frozenset({"movieFileDeleted", "episodeFileDeleted", "trackFileDeleted"}),
}


class UnreadableRule(ValueError):
    """A custom filter rule this can't apply the way the arr's UI would."""


def _view(record: dict[str, Any]) -> dict[str, Any]:
    return {**(record.get("statistics") or {}), **record}


def _number(value: Any, rule: dict[str, Any]) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        raise UnreadableRule(f"{rule} compares {value!r} as a number") from None


def _text(value: Any) -> str:
    return str(value).lower()


def _same(actual: Any, wanted: Any) -> bool:
    if isinstance(actual, bool):
        return actual == (wanted is True or _text(wanted) == "true")
    if isinstance(actual, int | float) and not isinstance(wanted, bool):
        try:
            return float(actual) == float(wanted)
        except (TypeError, ValueError):
            return False
    return _text(actual) == _text(wanted)


def _test(rule: dict[str, Any], kind: str) -> Callable[[Any, Any], bool]:
    tests: dict[str, Callable[[Any, Any], bool]] = {
        "equal": _same,
        "contains": lambda a, v: _text(v) in _text(a),
        "startsWith": lambda a, v: _text(a).startswith(_text(v)),
        "endsWith": lambda a, v: _text(a).endswith(_text(v)),
        "lessThan": lambda a, v: _number(a, rule) < _number(v, rule),
        "lessThanOrEqual": lambda a, v: _number(a, rule) <= _number(v, rule),
        "greaterThan": lambda a, v: _number(a, rule) > _number(v, rule),
        "greaterThanOrEqual": lambda a, v: _number(a, rule) >= _number(v, rule),
    }
    if kind not in tests:
        raise UnreadableRule(f"{rule} is a {kind!r} rule, which sparrow can't apply")
    return tests[kind]


NEGATED = {
    "notEqual": "equal",
    "notContains": "contains",
    "notStartsWith": "startsWith",
    "notEndsWith": "endsWith",
}


def holds(rule: dict[str, Any], record: dict[str, Any]) -> bool:
    """Whether a title's record passes one rule: any of the rule's values matching any of
    the field's (a list field such as tags has several), or none, for a negated rule."""
    view = _view(record)
    key = rule.get("key") or ""
    if key not in view:
        raise UnreadableRule(f"{rule} reads {key!r}, which these records don't have")
    actual = view[key]
    values = rule.get("value")
    kind = rule.get("type") or ""
    test = _test(rule, NEGATED.get(kind, kind))
    hit = any(
        test(a, v)
        for a in (actual if isinstance(actual, list) else [actual])
        for v in (values if isinstance(values, list) else [values])
    )
    return not hit if kind in NEGATED else hit


def rule_text(rule: dict[str, Any]) -> str:
    """A rule as the admin would say it: "path contains /Meleys/Movies/Requests/"."""
    values = rule.get("value")
    shown = ", ".join(map(str, values)) if isinstance(values, list) else str(values)
    return f"{rule.get('key')} {rule.get('type')} {shown}"


@dataclass(frozen=True)
class Pick:
    """Which titles: every one of these that is set must hold."""

    custom_filter: str = ""
    title: str = ""
    path: str = ""

    def chosen(self, titles: list[ArrTitle], filters: tuple[CustomFilter, ...]) -> list[ArrTitle]:
        """The titles picked; `LookupError` for a filter the arr hasn't, `UnreadableRule` for
        one that can't be applied."""
        rules: tuple[dict[str, Any], ...] = ()
        if self.custom_filter:
            saved = next(
                (f for f in filters if _text(f.label) == _text(self.custom_filter.strip())), None
            )
            if saved is None:
                raise LookupError(
                    f"no custom filter called {self.custom_filter!r}; the saved ones are "
                    + ", ".join(f.label for f in filters)
                )
            rules = saved.rules
        return [
            t
            for t in titles
            if all(holds(rule, t.raw) for rule in rules)
            and _text(self.title.strip()) in _text(t.title)
            and _text(self.path.strip()) in _text(t.path)
        ]


def _hosts(ctx: ToolContext, service: ArrService, host: str) -> dict[str, ArrLibrary] | Refused:
    configured = ctx.services.arr_libraries.get(service) or {}
    if not configured:
        name = service.upper()
        return Refused(f"No {service} is set up here ({name}_<HOST>_URL and _API_KEY).")
    if not host.strip():
        return dict(configured)
    found = configured.get(host.strip().lower())
    if found is None:
        return Refused(
            f"There's no {service} on {host}; it runs on {', '.join(sorted(configured))}."
        )
    return {found.host: found}


def _unreachable(service: ArrService, answers: Answers[str, Any]) -> dict[str, str]:
    return {f"{service} {host}": why for host, why in answers.unreachable.items()}


def gib(size: int) -> float:
    return round(size / GIB, 1)


def title_row(t: ArrTitle, service: ArrService, host: str | None) -> dict[str, Any]:
    row: dict[str, Any] = {"title": t.title, "year": t.year, "path": t.path}
    if host:
        row["host"] = host
    if service == "radarr":
        row["downloaded"] = t.have > 0
    else:
        row[UNITS[service]] = f"{t.have}/{t.want}"
    extras = {
        "size_gib": gib(t.size_bytes) if t.size_bytes else None,
        "quality": t.quality,
        "monitored": t.monitored,
        "status": t.status,
        "release": t.release,
        "added": t.added,
        "profile": t.profile,
        "tags": list(t.tags),
    }
    return {**row, **{k: v for k, v in extras.items() if v not in (None, [], "")}}


ON_DISK: dict[OnDisk, Callable[[ArrTitle], bool]] = {
    "any": lambda t: True,
    "complete": lambda t: t.want > 0 and t.have >= t.want,
    "missing": lambda t: t.have == 0,
    "incomplete": lambda t: t.have < t.want,
}
MONITORED: dict[Monitored, Callable[[ArrTitle], bool]] = {
    "any": lambda t: True,
    "monitored": lambda t: t.monitored,
    "unmonitored": lambda t: not t.monitored,
}
# Each sort's key, and whether it runs newest or biggest first.
SORTS: dict[Sort, tuple[Callable[[ArrTitle], Any], bool]] = {
    "title": (lambda t: _text(t.title), False),
    "added": (lambda t: t.added or "", True),
    "release": (lambda t: t.release or "", True),
    "year": (lambda t: t.year or 0, True),
    "size": (lambda t: t.size_bytes, True),
}


@tool(
    "arr_titles",
    "The admin's view of a Radarr's movies, a Sonarr's series or a Lidarr's artists, as the "
    "arr's own list shows them: pick them by a custom filter saved there (\"Movies "
    '(Requested)"), part of the title, part of the path, what is on disk (complete, missing: '
    "nothing yet, incomplete: some episodes or tracks missing) and whether monitored; sort by "
    "title, added, release, year or size. Answers with how many matched, their total size, "
    "and each one's path, what is on disk, quality, status and release. Use arr_overview for "
    "the filters, root folders and tags it has.",
    tier=Tier.ADMIN,
)
async def arr_titles(
    ctx: ToolContext,
    service: Service,
    host: AnyHost = "",
    custom_filter: FilterName = "",
    title: TitleText = "",
    path: PathText = "",
    on_disk: OnDisk = "any",
    monitored: Monitored = "any",
    sort: Sort = "title",
    limit: Annotated[int, Field(description="How many to list.", ge=1, le=MAX_TITLES)] = (
        TITLES_SHOWN
    ),
) -> Result:
    hosts = _hosts(ctx, service, host)
    if isinstance(hosts, Refused):
        return hosts
    by_text = Pick(title=title, path=path)

    async def read(lib: ArrLibrary) -> list[ArrTitle]:
        if not custom_filter:
            return await lib.titles()
        titles, setup = await asyncio.gather(lib.titles(), lib.setup())
        return Pick(custom_filter=custom_filter).chosen(titles, setup.filters)

    try:
        answers = await every_host(hosts, read)
    except (LookupError, UnreadableRule) as exc:
        return Refused(f"That filter can't be applied: {exc}.")
    found = [
        (h, t)
        for h, titles in answers.answered.items()
        for t in by_text.chosen(titles, ())
        if ON_DISK[on_disk](t) and MONITORED[monitored](t)
    ]
    if not answers.answered:
        return Failed(f"No {service} answered: {_unreachable(service, answers)}", retryable=True)
    key, newest_first = SORTS[sort]
    found.sort(key=lambda pair: key(pair[1]), reverse=newest_first)
    many = len(hosts) > 1
    content: dict[str, Any] = {
        "service": service,
        "hosts": sorted(answers.answered),
        "matched": len(found),
        "size_gib": gib(sum(t.size_bytes for _, t in found)),
        "titles": [title_row(t, service, h if many else None) for h, t in found[:limit]],
    }
    if len(found) > limit:
        content["note"] = f"{len(found) - limit} more left out; ask for more or narrow it."
    if answers.unreachable:
        content["unreachable"] = _unreachable(service, answers)
    return Ok(content)


@tool(
    "arr_overview",
    "How a Radarr, Sonarr or Lidarr is set up and doing, on one host or every one: its "
    "version, root folders (free space, how many titles each holds), the custom filters saved "
    "in its list and their rules, tags, quality profiles, disks, health warnings, the queue, "
    "and how many titles it has, monitored, complete and missing. The admin's.",
    tier=Tier.ADMIN,
)
async def arr_overview(ctx: ToolContext, service: Service, host: AnyHost = "") -> Result:
    hosts = _hosts(ctx, service, host)
    if isinstance(hosts, Refused):
        return hosts

    async def read(lib: ArrLibrary) -> dict[str, Any]:
        setup, titles = await asyncio.gather(lib.setup(), lib.titles())
        return {
            "version": setup.version,
            "titles": {
                "total": len(titles),
                "monitored": sum(t.monitored for t in titles),
                "complete": sum(ON_DISK["complete"](t) for t in titles),
                "missing": sum(ON_DISK["missing"](t) for t in titles),
                "size_gib": gib(sum(t.size_bytes for t in titles)),
            },
            "root_folders": [
                {
                    "path": r.path,
                    "titles": sum(t.path.startswith(r.path.rstrip("/") + "/") for t in titles),
                    **({"free_gib": gib(r.free_bytes)} if r.free_bytes is not None else {}),
                }
                for r in setup.root_folders
            ],
            "custom_filters": [
                {"label": f.label, "list": f.kind, "rules": [rule_text(r) for r in f.rules]}
                for f in setup.filters
            ],
            "tags": list(setup.tags),
            "quality_profiles": list(setup.profiles),
            "disks": [
                {"path": d.path, "free_gib": gib(d.free_bytes), "used_percent": d.used_percent}
                for d in setup.disks
            ],
            "health": list(setup.health),
            "queued": setup.queued,
        }

    answers = await every_host(hosts, read)
    if not answers.answered:
        return Failed(f"No {service} answered: {_unreachable(service, answers)}", retryable=True)
    content: dict[str, Any] = {"service": service, "hosts": answers.answered}
    if answers.unreachable:
        content["unreachable"] = _unreachable(service, answers)
    return Ok(content)


def event_row(e: HistoryRow, host: str | None) -> dict[str, Any]:
    row = {
        "when": e.when,
        "event": EVENT_NAMES.get(e.event, e.event),
        "title": e.title,
        "release": e.release,
        "quality": e.quality,
        "why": e.why,
        "host": host,
    }
    return {k: v for k, v in row.items() if v}


@tool(
    "arr_history",
    "What a Radarr, Sonarr or Lidarr did lately, newest first: grabs, imports, failed "
    "downloads and deleted files, each with its title, release, quality and why. Narrow it "
    "to one kind of event. The admin's.",
    tier=Tier.ADMIN,
)
async def arr_history(
    ctx: ToolContext,
    service: Service,
    host: AnyHost = "",
    event: Event = "any",
    count: Annotated[int, Field(description="How many events.", ge=1, le=MAX_EVENTS)] = 25,
) -> Result:
    hosts = _hosts(ctx, service, host)
    if isinstance(hosts, Refused):
        return hosts
    wanted = EVENTS[event]
    answers = await every_host(hosts, lambda lib: lib.history(EVENTS_READ if wanted else count))
    if not answers.answered:
        return Failed(f"No {service} answered: {_unreachable(service, answers)}", retryable=True)
    many = len(hosts) > 1
    events = sorted(
        (
            (h, e)
            for h, rows in answers.answered.items()
            for e in rows
            if not wanted or e.event in wanted
        ),
        key=lambda pair: pair[1].when,
        reverse=True,
    )
    content: dict[str, Any] = {
        "service": service,
        "events": [event_row(e, h if many else None) for h, e in events[:count]],
    }
    if answers.unreachable:
        content["unreachable"] = _unreachable(service, answers)
    return Ok(content)


def letter_folder(folder: str) -> str:
    """The letter folder a title's folder files under: its first letter, or `#`."""
    first = folder[:1].upper()
    return first if first.isalpha() else NOT_A_LETTER


@tool(
    "arr_move",
    "Move titles in a Radarr, Sonarr or Lidarr to another root folder, files and all: the "
    "arr changes each one's path and moves its folder there. Pick them as arr_titles does (a "
    "saved custom filter, part of the title, part of the path), then send them all to "
    "to_root_folder, or each to its letter folder under to_letter_buckets_under "
    '(/Meleys/Movies sends "Late Quartet, A (2012)" to /Meleys/Movies/L and "25th Hour" to '
    "/Meleys/Movies/#). Every destination must be one of the arr's root folders. List the "
    "titles with arr_titles first and tell the admin what moves where; the admin must press "
    "Confirm. The admin's.",
    tier=Tier.ADMIN,
    destructive=True,
    host_param="host",
)
async def arr_move(
    ctx: ToolContext,
    service: Service,
    host: OneHost,
    custom_filter: FilterName = "",
    title: TitleText = "",
    path: PathText = "",
    to_root_folder: Annotated[
        str, Field(description="One root folder for them all: /Meleys/Movies/Requests.")
    ] = "",
    to_letter_buckets_under: Annotated[
        str, Field(description="The folder whose letter folders they go to: /Meleys/Movies.")
    ] = "",
) -> Result:
    if not (custom_filter or title or path):
        return Refused("Say which titles: a custom_filter, part of a title or part of a path.")
    if bool(to_root_folder) == bool(to_letter_buckets_under):
        return Refused("Say where: either to_root_folder or to_letter_buckets_under, not both.")
    hosts = _hosts(ctx, service, host)
    if isinstance(hosts, Refused):
        return hosts
    (lib,) = hosts.values()
    try:
        titles, setup = await asyncio.gather(lib.titles(), lib.setup())
        chosen = Pick(custom_filter, title, path).chosen(titles, setup.filters)
    except ClientError as exc:
        return Failed(f"{service} on {lib.host} didn't answer: {exc.detail}", retryable=True)
    except (LookupError, UnreadableRule) as exc:
        return Refused(f"That filter can't be applied: {exc}.")
    if not chosen:
        return Refused("Nothing matches that, so nothing was moved.")
    if len(chosen) > MAX_MOVES:
        return Refused(f"That picks {len(chosen)} titles; move at most {MAX_MOVES} at a time.")
    roots = {r.path.rstrip("/") for r in setup.root_folders}
    moved: list[dict[str, str]] = []
    skipped: list[dict[str, str]] = []
    failed: list[dict[str, str]] = []
    for t in chosen:
        root = to_root_folder.rstrip("/") or (
            f"{to_letter_buckets_under.rstrip('/')}/{letter_folder(t.folder)}"
        )
        new = f"{root}/{t.folder}"
        if root not in roots:
            skipped.append({"title": t.title, "why": f"{root} isn't one of its root folders"})
            continue
        if new == t.path.rstrip("/"):
            skipped.append({"title": t.title, "why": "already there"})
            continue
        try:
            await lib.move(t.id, new)
        except ClientError as exc:
            failed.append({"title": t.title, "why": exc.detail})
            continue
        moved.append({"title": t.title, "from": t.path, "to": new})
    content: dict[str, Any] = {"service": service, "host": lib.host, "moved": moved}
    if skipped:
        content["skipped"] = skipped
    if failed:
        content["failed"] = failed
    if moved:
        content["note"] = (
            f"{service} moves the files in the background; big ones take a while to land."
        )
    return Ok(content)
