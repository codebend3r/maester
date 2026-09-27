"""A playback report: one model and one flow, from what a friend said to what was decided.

A report is about one copy's file (`items.py`) and has a kind. The kind's
policy (`POLICIES`, data rather than branches) says how it is diagnosed and
whether a new copy fixes it:

- `wont_play` checks the player first (`client_limits.py`): a known limit
  gets its fix and nothing else happens. Only when the player explains
  nothing is the file's health checked (`health.py`).
- `subtitles` and `audio` read the file's tracks. Nothing fixes tracks
  automatically, so the admin is asked.
- the wrong-file kinds (`wrong_title`, `wrong_episode`, `cam`,
  `hardcoded_subs`) and `other` have nothing to measure: the friend's word
  is the evidence.

A player fix must not shield a broken file for good: a friend who already
got one for this file and reports it again has the file checked instead.

The report is then stored and decided (`Action`), from stored evidence
only (`Evidence`): a replaceable kind whose file failed a health check, or
that two or more people reported, may be replaced (`replace.py`); a
replaceable kind short of that is recorded, and anything else goes to the
admin. A report the player explains doesn't count as a reporter, a report
whose issue was resolved no longer speaks for the file, and an admin's "no"
to replacing the file stands for it. What each decision means downstream
(its Seerr issue line, the model's next step, whether it shows evidence or
asks the admin) is data (`WORDING`).
Every report opens a Seerr issue as the friend, with the diagnosis and the
decision, so the admin's trail is in a tool they already use; resolving it
there marks the report resolved (`seerr_events.py`).
"""

from __future__ import annotations

import enum
from collections.abc import Awaitable, Callable, Iterable
from dataclasses import dataclass, replace
from typing import Any

from maester.clients import ClientError, Services
from maester.clients.media import Track, Unreadable
from maester.clients.seerr import ISSUE_AUDIO, ISSUE_OTHER, ISSUE_SUBTITLE, ISSUE_VIDEO
from maester.notify import AdminPost, Notice
from maester.playback import tracks
from maester.playback.client_limits import ClientLimit, Playback, client_causes
from maester.playback.health import Health, check_health
from maester.playback.items import LocatedFile
from maester.playback.plays import playback_of, recent_plays
from maester.store import LinkedUser, ReportRow, Store

# How many people reporting one file prove it needs a new copy.
REPORTERS_TO_REPLACE = 2


class ReportKind(enum.StrEnum):
    WONT_PLAY = "wont_play"
    WRONG_TITLE = "wrong_title"
    WRONG_EPISODE = "wrong_episode"
    CAM = "cam"
    HARDCODED_SUBS = "hardcoded_subs"
    SUBTITLES = "subtitles"
    AUDIO = "audio"
    OTHER = "other"


class Action(enum.StrEnum):
    """What became of a report."""

    ADVISED = "advised"  # a player limit explains it; the friend got the fix
    REPLACEABLE = "replaceable"  # the evidence allows a new copy; offered to the friend
    RECORDED = "recorded"  # a new copy would fix it, once the evidence allows one
    FOR_ADMIN = "for_admin"  # nothing fixes it automatically; the admin was asked
    ESCALATED = "escalated"  # a replacement waits on the admin (over the daily cap)
    REPLACED = "replaced"
    DECLINED = "declined"  # the admin turned the replacement down


@dataclass(frozen=True)
class Diagnosis:
    """What the checks found; a field left empty wasn't checked."""

    player: str = ""  # which play the player check read, or why there was none
    playback: Playback | None = None
    causes: tuple[ClientLimit, ...] = ()
    health: Health | None = None
    tracks: tuple[Track, ...] = ()

    def summary(self) -> str:
        if self.causes:
            return " ".join(f"Player limit: {c.cause} Fix: {c.fix}" for c in self.causes)
        if self.health:
            return f"File check: {self.health.summary}."
        if self.tracks:
            return f"The file has {len(self.tracks)} audio and subtitle tracks (listed below)."
        return "Nothing to measure; the report itself is the evidence."

    def as_dict(self) -> dict[str, Any]:
        checked: dict[str, Any] = {}
        if self.player:
            checked["player_check"] = self.player
        if self.playback:
            checked["playback"] = self.playback.as_dict()
        if self.causes:
            checked["player_causes"] = [c.as_dict() for c in self.causes]
        if self.health:
            checked["file_check"] = self.health.as_dict()
        if self.tracks:
            checked["tracks"] = tracks.listing(self.tracks)
        return checked


@dataclass(frozen=True)
class Case:
    """What a diagnosis works from."""

    services: Services
    link: LinkedUser
    located: LocatedFile
    at: float | None  # the moment the friend named, in seconds
    advised: bool  # they already had a player fix for this file, so it's the file's turn


Diagnose = Callable[[Case], Awaitable[Diagnosis]]


async def _last_play(case: Case, dovi_profile: int | None) -> tuple[str, Playback | None]:
    """The friend's latest play of this copy, as the player check reads it, or why there's none."""
    services, link, located = case.services, case.link, case.located
    if link.tautulli_user_id is None:
        return "not checked: their Plex account isn't matched to a Tautulli user", None
    found = await recent_plays(services, link.tautulli_user_id)
    play = next((p for p in found.plays if p.is_of(located.details, located.item)), None)
    if play is None:
        return "not checked: no recent play of this copy in Tautulli", None
    try:
        playback = await playback_of(services, play, dovi_profile)
    except ClientError as exc:
        return f"not checked: Tautulli on {play.host} couldn't say how it played ({exc})", None
    when = "playing now" if play.live else "their last play"
    return f"{when}, {play.player} (Tautulli on {play.host})", playback


async def player_then_file(case: Case) -> Diagnosis:
    """The player first; the file's health only when no player limit explains it."""
    probe = case.services.probe
    try:
        inspection = await probe.inspect(case.located.file.path)
    except Unreadable as exc:
        inspection, unreadable = None, Health.unreadable(exc)
    else:
        unreadable = None
    player, playback = await _last_play(case, inspection.dovi_profile if inspection else None)
    if case.advised:
        player += "; they already had a player fix for this file, so the file is checked"
    causes = client_causes(playback) if playback and not case.advised else ()
    if causes:
        return Diagnosis(player, playback, causes)
    health = (
        unreadable
        if inspection is None
        else await check_health(probe, inspection, at=case.at, expected=case.located.runtime)
    )
    return Diagnosis(player, playback, health=health)


async def track_listing(case: Case) -> Diagnosis:
    """The file's audio and subtitle tracks."""
    try:
        inspection = await case.services.probe.inspect(case.located.file.path)
    except Unreadable as exc:
        return Diagnosis(health=Health.unreadable(exc))
    return Diagnosis(tracks=inspection.tracks)


async def by_their_word(case: Case) -> Diagnosis:
    """Nothing to measure: a cam or the wrong movie plays fine."""
    return Diagnosis()


@dataclass(frozen=True)
class KindPolicy:
    label: str  # how the problem reads to people
    issue_type: int  # Seerr's issue type
    diagnose: Diagnose
    # A new copy fixes it, so it goes through the replace flow; otherwise the
    # admin is asked, since nothing fixes it automatically.
    replaceable: bool


POLICIES: dict[ReportKind, KindPolicy] = {
    ReportKind.WONT_PLAY: KindPolicy("won't play", ISSUE_VIDEO, player_then_file, True),
    ReportKind.WRONG_TITLE: KindPolicy("the wrong movie or show", ISSUE_OTHER, by_their_word, True),
    ReportKind.WRONG_EPISODE: KindPolicy("the wrong episode", ISSUE_OTHER, by_their_word, True),
    ReportKind.CAM: KindPolicy("a cam or screener copy", ISSUE_VIDEO, by_their_word, True),
    ReportKind.HARDCODED_SUBS: KindPolicy(
        "hardcoded foreign subtitles", ISSUE_SUBTITLE, by_their_word, True
    ),
    ReportKind.SUBTITLES: KindPolicy(
        "subtitles missing or out of sync", ISSUE_SUBTITLE, track_listing, False
    ),
    ReportKind.AUDIO: KindPolicy(
        "audio out of sync or a missing dub", ISSUE_AUDIO, track_listing, False
    ),
    ReportKind.OTHER: KindPolicy("another problem", ISSUE_OTHER, by_their_word, True),
}


def policy_of(report: ReportRow) -> KindPolicy:
    return POLICIES[ReportKind(report.kind)]


@dataclass(frozen=True)
class Evidence:
    """What the stored reports of one file prove, whatever the model says."""

    failed_check: Health | None  # a health check of this very file that found it broken
    reporters: frozenset[str]  # who reported the file as needing a new copy
    declined: bool = False  # the admin said no to replacing this file

    @classmethod
    def of(cls, reports: Iterable[ReportRow]) -> Evidence:
        reports = list(reports)
        # A report whose Seerr issue was resolved no longer speaks for the file.
        open_ = [r for r in reports if r.resolved_at is None]
        checks = (Health.from_dict(r.diagnosis["file_check"]) for r in open_ if r.health)
        return cls(
            failed_check=next((h for h in checks if h.verdict.failed), None),
            reporters=frozenset(
                r.discord_id
                for r in open_
                if policy_of(r).replaceable and r.action != Action.ADVISED
            ),
            declined=any(r.action == Action.DECLINED for r in reports),
        )

    @property
    def proven(self) -> bool:
        if self.declined:
            return False
        return self.failed_check is not None or len(self.reporters) >= REPORTERS_TO_REPLACE

    def describe(self) -> str:
        if self.declined:
            return "the admin decided not to replace this file"
        if self.failed_check is not None:
            return f"a file check found it {self.failed_check.summary}"
        people = len(self.reporters)
        if people >= REPORTERS_TO_REPLACE:
            return f"{people} people reported it"
        return f"{people} report{'' if people == 1 else 's'} and no failed file check"


def decide(policy: KindPolicy, diagnosis: Diagnosis, evidence: Evidence) -> Action:
    if diagnosis.causes:
        return Action.ADVISED
    if not policy.replaceable:
        return Action.FOR_ADMIN
    return Action.REPLACEABLE if evidence.proven else Action.RECORDED


@dataclass(frozen=True)
class Wording:
    """What a decision means downstream.

    `issue` is its line in the Seerr issue and `next` the model's next step;
    `{evidence}`, `{report_id}` and `{host}` are filled in from the report.
    """

    issue: str
    next: str
    shows_evidence: bool = False  # the model sees what the evidence proves
    asks_admin: bool = False  # the admin gets a notice to fix it by hand


WORDING: dict[Action, Wording] = {
    Action.ADVISED: Wording(
        "a player limit explains it; the friend was given the fix",
        "Give them the player fix. If it still fails after, report it again: the file is "
        "checked then.",
    ),
    Action.REPLACEABLE: Wording(
        "a replacement was offered to the friend ({evidence})",
        "Offer a new copy: replace_media with report_id {report_id} and host {host} deletes "
        "this copy and searches for another once they confirm.",
        shows_evidence=True,
    ),
    Action.RECORDED: Wording(
        "recorded ({evidence}); it can be replaced once a file check fails or a second "
        "person reports it",
        "Tell them it's recorded; the copy is replaced once a file check fails or someone "
        "else reports it.",
        shows_evidence=True,
    ),
    Action.FOR_ADMIN: Wording(
        "recorded for the admin: nothing fixes this automatically yet",
        "Tell them it's recorded and the admin has been asked to fix it.",
        asks_admin=True,
    ),
}


@dataclass(frozen=True)
class Filed:
    """A stored report, what was found and decided, and what goes out besides the reply."""

    report: ReportRow
    located: LocatedFile
    diagnosis: Diagnosis
    evidence: Evidence
    issue_id: int | None = None  # the Seerr issue it opened
    issue_note: str = ""  # why none was opened
    notices: tuple[Notice, ...] = ()

    @property
    def action(self) -> Action:
        return Action(self.report.action)

    @property
    def wording(self) -> Wording:
        return WORDING[self.action]

    def _fill(self, template: str) -> str:
        return template.format(
            evidence=self.evidence.describe(),
            report_id=self.report.id,
            host=self.located.owner.host,
        )

    @property
    def decision(self) -> str:
        """The decision as the Seerr issue reads it."""
        return self._fill(self.wording.issue)

    @property
    def next_step(self) -> str:
        """What the model should do with the report."""
        return self._fill(self.wording.next)

    def as_dict(self) -> dict[str, Any]:
        reply = {
            "report_id": self.report.id,
            "title": self.located.title,
            "version": self.located.item.version,
            "host": self.located.owner.host,
            "problem": policy_of(self.report).label,
            "diagnosis": self.diagnosis.as_dict(),
            "decision": self.action,
            "seerr_issue": self.issue_id or self.issue_note,
            "next": self.next_step,
        }
        if self.wording.shows_evidence:
            reply["evidence"] = self.evidence.describe()
        return reply


def issue_message(filed: Filed, reporter: str) -> str:
    """The Seerr issue: the friend's words, then what maester found and decided."""
    report, located = filed.report, filed.located
    policy = policy_of(report)
    group = f" (release group {report.release_group})" if report.release_group else ""
    lines = [
        report.description,
        "",
        f"Reported through maester by {reporter}: {policy.label}, {located.copy} "
        f"on {located.owner.host}.",
        f"File: {located.file.path}{group}",
    ]
    if filed.diagnosis.player:
        lines.append(f"Player: {filed.diagnosis.player}")
    lines += [
        f"Diagnosis: {filed.diagnosis.summary()}",
        f"Decision: {filed.decision}",
    ]
    if filed.diagnosis.tracks:
        lines += ["Tracks:", *(f"- {line}" for line in tracks.lines(filed.diagnosis.tracks))]
    return "\n".join(lines)


class IssueNotOpened(Exception):
    """The report couldn't be filed in Seerr; the message says why."""


async def open_issue(services: Services, link: LinkedUser, filed: Filed) -> int:
    """File the report in Seerr as the friend."""
    located = filed.located
    if located.details.media_id is None:
        raise IssueNotOpened("not opened: Seerr doesn't track this title yet")
    try:
        return await services.seerr.create_issue(
            located.details.media_id,
            policy_of(filed.report).issue_type,
            issue_message(filed, link.name),
            link.seerr_user_id,
            season=located.item.season,
            episode=located.item.episode,
        )
    except ClientError as exc:
        raise IssueNotOpened(f"not opened: {exc}") from exc


def admin_notice(filed: Filed, reporter: str) -> AdminPost:
    """For a problem nothing fixes automatically: the admin is asked."""
    report, located = filed.report, filed.located
    issue = f"Seerr issue #{filed.issue_id}" if filed.issue_id else "The report"
    return AdminPost(
        f"{reporter} reports {policy_of(report).label} on {located.copy} "
        f'({located.owner.host}): "{report.description}". Nothing fixes this automatically '
        f"(Bazarr isn't set up). {issue} has what maester found: "
        f"{filed.diagnosis.summary()}"
    )


async def file_report(
    services: Services,
    store: Store,
    link: LinkedUser,
    located: LocatedFile,
    kind: ReportKind,
    description: str,
    at: float | None = None,
) -> Filed:
    """Diagnose, store and decide a report, then open its Seerr issue."""
    policy, file = POLICIES[kind], located.file
    host, media_type = located.owner.host, located.item.media_type
    advised = any(
        r.discord_id == link.discord_id and r.action == Action.ADVISED
        for r in store.reports_for_file(host, media_type, file.id)
    )
    diagnosis = await policy.diagnose(Case(services, link, located, at, advised))
    with store.transaction():
        # Stored first, so the evidence counts it; the decision replaces the action.
        report = store.add_report(
            discord_id=link.discord_id,
            kind=kind,
            title=located.title,
            media_type=media_type,
            tmdb_id=located.item.tmdb_id,
            is_4k=located.item.is_4k,
            season=located.item.season,
            episode=located.item.episode,
            rating_key=located.details.rating_key_for(located.item.is_4k),
            host=host,
            file_id=file.id,
            file_path=file.path,
            release_group=file.release_group,
            health=diagnosis.health.verdict if diagnosis.health else None,
            diagnosis=diagnosis.as_dict(),
            description=description,
            action=Action.RECORDED,
        )
        evidence = Evidence.of(store.reports_for_file(host, media_type, file.id))
        report = store.update_report(report.id, action=decide(policy, diagnosis, evidence))
    filed = Filed(report, located, diagnosis, evidence)
    try:
        issue_id = await open_issue(services, link, filed)
    except IssueNotOpened as why:
        filed = replace(filed, issue_note=str(why))
    else:
        filed = replace(
            filed,
            report=store.update_report(report.id, seerr_issue_id=issue_id),
            issue_id=issue_id,
        )
    if filed.wording.asks_admin:
        filed = replace(filed, notices=(admin_notice(filed, link.name),))
    return filed
