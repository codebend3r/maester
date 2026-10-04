"""The admin's daily digest: the state of the server in one message.

Sent to the admin at `DIGEST_TIME`. A section is there only when
it has something to say, in this order:

- switches left on: the kill switch, a maintenance window
- waiting on you: every open approval, oldest first, and how long it's waited
- new requests: the last day's Seerr requests, whose, and where each stands
- open issues: Seerr's open issues, newest first
- replacements: the files replaced in the last day, and why
- downloads, per host: what the sweeper cleared or surfaced in the last day,
  what an arr flags as stuck now, and what SABnzbd failed
- space: every volume's free space, and the forecast for one that fills
  within `SOON`
- release groups to look at: groups whose files keep being reported
- couldn't check: any service that didn't answer, so a missing section is
  never mistaken for good news
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta

from luwin.agent.limits import KillSwitch
from luwin.clients import ClientError, Services
from luwin.clients.seerr import MediaRequest, RequestStatus
from luwin.config import Settings
from luwin.formatting import ago, local_time
from luwin.jobs.sweep import downloads as queued_downloads
from luwin.library import ARR_NAMES
from luwin.media import episode_code, version_label
from luwin.notify import AdminPost, Notice
from luwin.playback.reports import POLICIES
from luwin.releases import new_bad_releases
from luwin.storage import FORECAST_WINDOW, forecasts, read_space
from luwin.store import MAINTENANCE, StallAction, Store

DAY = timedelta(days=1)
# A volume that fills sooner than this gets its forecast in the digest.
SOON = timedelta(days=30)
# How many of Seerr's newest requests and open issues are read.
NEWEST = 50

STALL_WORDS = {
    StallAction.RESEARCHED: "stalled, so its release was blocklisted and searched again",
    StallAction.REMOVED: "stalled; its release was blocklisted and removed, but the search "
    "didn't start, so search for it",
    StallAction.SURFACED: "stalled again after a re-search; it's left for you",
    StallAction.FAILED: "stalled, and couldn't be cleared",
}


@dataclass
class Section:
    title: str
    lines: list[str] = field(default_factory=list)

    def render(self) -> str:
        return "\n".join([f"**{self.title}**", *(f"- {line}" for line in self.lines)])


class Digest:
    def __init__(
        self, services: Services, store: Store, settings: Settings, kill_switch: KillSwitch
    ):
        self.services = services
        self.store = store
        self.settings = settings
        self.kill_switch = kill_switch
        self.zone = settings.jobs.zone

    async def __call__(self) -> list[Notice]:
        return [AdminPost(await self.compose(datetime.now(UTC)))]

    async def compose(self, now: datetime) -> str:
        missed = Section("Couldn't check")
        titles = Titles(self.services)
        sections = [
            self.switches(),
            self.waiting(now),
            await self.new_requests(now, titles, missed),
            await self.open_issues(now, titles, missed),
            self.replacements(now),
            *await self.downloads(now, missed),
            await self.space(now, missed),
            self.bad_releases(),
            missed,
        ]
        head = f"**Daily digest, {now.astimezone(self.zone):%a %b %d}**"
        said = [s.render() for s in sections if s.lines]
        return "\n\n".join([head, *said]) if said else f"{head}\nNothing to report."

    def switches(self) -> Section:
        section = Section("Switched on")
        if flag := self.kill_switch.flag:
            why = f" ({flag.message})" if flag.message else ""
            section.lines.append(f"The kill switch is on{why}: destructive tools refuse.")
        if window := self.store.flag(MAINTENANCE):
            why = f" ({window.message})" if window.message else ""
            since = local_time(datetime.fromisoformat(window.set_at), self.zone)
            section.lines.append(
                f"Maintenance has been on since {since}{why}: requests and replacements are held."
            )
        return section

    def waiting(self, now: datetime) -> Section:
        waiting = self.store.open_pending("approve")
        return Section(
            f"Waiting on you ({len(waiting)})",
            [f"{p.summary} (asked {ago(now - datetime.fromisoformat(p.ts))})" for p in waiting],
        )

    async def new_requests(self, now: datetime, titles: Titles, missed: Section) -> Section:
        section = Section("New requests")
        try:
            requests = await self.services.seerr.list_requests(take=NEWEST, filter="all")
        except ClientError as exc:
            missed.lines.append(f"Seerr's requests: {exc}")
            return section
        new = [r for r in requests if r.created and now - r.created <= DAY]
        for r in sorted(new, key=lambda r: r.id):
            title = await titles.of(r.media_type, r.tmdb_id)
            section.lines.append(
                f"{title} in {version_label(r.is_4k)} for {self._who(r)}: {self._stands(r)}"
            )
        return section

    def _who(self, request: MediaRequest) -> str:
        link = self.store.active_link_by_seerr_id(request.requested_by_id)
        return link.name if link else request.requested_by_name or "someone in Seerr"

    @staticmethod
    def _stands(request: MediaRequest) -> str:
        if request.status == RequestStatus.PENDING:
            return "waiting for approval"
        if request.status == RequestStatus.APPROVED:
            return request.media_status.label
        return request.status.label

    async def open_issues(self, now: datetime, titles: Titles, missed: Section) -> Section:
        section = Section("Open issues")
        try:
            issues = await self.services.seerr.open_issues(take=NEWEST)
        except ClientError as exc:
            missed.lines.append(f"Seerr's issues: {exc}")
            return section
        for issue in issues:
            title = await titles.of(issue.media_type, issue.tmdb_id)
            code = episode_code(issue.season, issue.episode)
            raised = datetime.fromisoformat(issue.created_at) if issue.created_at else None
            when = f", {ago(now - raised)}" if raised else ""
            section.lines.append(
                f"#{issue.id} {title}{f' {code}' if code else ''}: {issue.kind}, raised by "
                f"{issue.reporter or 'someone'}{when}"
            )
        return section

    def replacements(self, now: datetime) -> Section:
        section = Section("Replaced")
        for row in self.store.acted_since(("replace_media", "decide_replacement"), now - DAY):
            if row.args.get("approved") is False:  # the admin's Deny: nothing was replaced
                continue
            report = self.store.get_report(int(row.args.get("report_id", 0)))
            if report is not None:
                section.lines.append(
                    f"{report.title} in {report.copy.version} on {report.host}: "
                    f"{POLICIES[report.kind].label}"
                )
        return section

    async def downloads(self, now: datetime, missed: Section) -> list[Section]:
        by_host: dict[str, Section] = {}

        def of(host: str) -> Section:
            return by_host.setdefault(host, Section(f"Downloads on {host}"))

        latest = {(s.host, s.item): s for s in self.store.stalls_since(now - DAY)}
        for stall in latest.values():
            of(stall.host).lines.append(
                f"{stall.title}: {STALL_WORDS[stall.action]} ({stall.reason})"
            )
        for kind, clients in (("movie", self.services.radarr), ("tv", self.services.sonarr)):
            for host, arr in sorted(clients.items()):
                arr_name = f"{ARR_NAMES[kind]} on {host}"
                try:
                    queue = await arr.queue()
                except ClientError as exc:
                    missed.lines.append(f"{arr_name}'s queue: {exc}")
                    continue
                handled = self.store.watched(host, kind)
                for d in queued_downloads(host, kind, queue):
                    seen = handled.get(d.download_id)
                    if d.flagged and not d.waiting and not (seen and seen.acted_at):
                        why = "; ".join(m for r in d.records for m in r.error_messages)
                        why = why or f"{ARR_NAMES[kind]} marks it {d.first.tracked_status}"
                        of(host).lines.append(f"{d.title}: stuck in {ARR_NAMES[kind]} ({why})")
        for host, sab in sorted(self.services.sabnzbd.items()):
            try:
                history = await sab.history(limit=NEWEST)
            except ClientError as exc:
                missed.lines.append(f"SABnzbd on {host}: {exc}")
                continue
            for d in history:
                finished = datetime.fromtimestamp(d.completed, UTC) if d.completed else None
                if d.status.lower() == "failed" and finished and now - finished <= DAY:
                    why = d.fail_message or "no reason given"
                    of(host).lines.append(f"{d.name}: failed in SABnzbd ({why})")
        return [by_host[h] for h in sorted(by_host)]

    async def space(self, now: datetime, missed: Section) -> Section:
        section = Section("Space")
        space = await read_space(self.services)
        limit = self.settings.guardrails.storage_pause_4k_percent
        for name, why in space.unreachable.items():
            missed.lines.append(f"{name}'s free space: {why}")
        for v in sorted(space.volumes, key=lambda v: -v.used_percent):
            over = " (at or past the 4K limit)" if v.used_percent >= limit else ""
            section.lines.append(v.describe() + over)
        today = now.astimezone(self.zone).date()
        for f in forecasts(self.store.space_since(today - FORECAST_WINDOW)):
            if f.days_left is not None and f.days_left < SOON.days:
                section.lines.append(f"Filling: {f.describe()}")
        return section

    def bad_releases(self) -> Section:
        found = new_bad_releases(self.store, self.settings.bad_release_reports)
        return Section("Release groups to look at", [b.suggestion() for b in found])


class Titles:
    """Titles by TMDB id, each asked of Seerr once per digest."""

    def __init__(self, services: Services):
        self.services = services
        self._known: dict[tuple[str, int], str] = {}

    async def of(self, media_type: str, tmdb_id: int) -> str:
        key = (media_type, tmdb_id)
        if key not in self._known:
            try:
                details = await self.services.seerr.media_details(media_type, tmdb_id)
                self._known[key] = details.display
            except ClientError:
                self._known[key] = f"TMDB {tmdb_id}"
        return self._known[key]
