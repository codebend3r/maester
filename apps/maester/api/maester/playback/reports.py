"""A playback report: one model and one flow, from what a friend said to what was decided.

A report is about one copy's file (`items.py`) and has a kind. The kind's
policy (`POLICIES`, data rather than branches) names how it is diagnosed
(`diagnosis.py`) and whether a new copy fixes it. A friend who already got
a player fix for this file is diagnosed with the policy's `after_advice`
strategy instead, so a fix can't shield a broken file for good.

The report is filed with its `Decision`, written once and made from stored
evidence only (`Evidence`): a replaceable kind whose file failed a health
check, or that two or more people reported, may be replaced (`replace.py`);
a replaceable kind short of that is recorded; anything else goes to the
admin. A report the player explains doesn't testify, nor does one whose
Seerr issue was resolved or whose replacement the admin declined. How each
decision reads, to the Seerr issue and to the model, is data (`WORDING`).

A report's replacement then moves through statuses (`ReportStatus`) by the
moves defined here (`ESCALATE`, `DECLINE`, `REOPEN`, `REPLACE`), each a
compare-and-set in the store, and who may start a replacement from which
status is `MAY_REPLACE`. The admin's no covers that
one report: a later report of the same file stands on its own evidence.

Every report opens a Seerr issue as the friend, with the diagnosis and the
decision, so the admin's trail is in a tool they already use. Resolving the
issue in Seerr marks the report resolved (`seerr_events.py`).
"""

from __future__ import annotations

import enum
from collections.abc import Iterable
from dataclasses import dataclass, replace
from typing import Any

from maester.clients import ClientError, Services
from maester.clients.seerr import ISSUE_AUDIO, ISSUE_OTHER, ISSUE_SUBTITLE, ISSUE_VIDEO
from maester.media import Decision, ReportKind, ReportStatus
from maester.notify import AdminPost, Notice
from maester.playback.diagnosis import (
    Case,
    Diagnose,
    Diagnosis,
    PlayerLimit,
    by_their_word,
    file_only,
    player_then_file,
    track_listing,
)
from maester.playback.health import Health
from maester.playback.items import LocatedFile
from maester.releases import release_group
from maester.store import LinkedUser, ReportRow, Store

# How many people reporting one file prove it needs a new copy.
REPORTERS_TO_REPLACE = 2


@dataclass(frozen=True)
class KindPolicy:
    label: str  # how the problem reads to people
    issue_type: int  # Seerr's issue type
    diagnose: Diagnose
    # A new copy fixes it, so it goes through the replace flow; otherwise the
    # admin is asked, since nothing fixes it automatically.
    replaceable: bool
    after_advice: Diagnose  # for a friend who already had a player fix for this file


def _kind(
    label: str,
    issue_type: int,
    diagnose: Diagnose,
    replaceable: bool,
    after_advice: Diagnose | None = None,
) -> KindPolicy:
    return KindPolicy(label, issue_type, diagnose, replaceable, after_advice or diagnose)


POLICIES: dict[ReportKind, KindPolicy] = {
    ReportKind.WONT_PLAY: _kind("won't play", ISSUE_VIDEO, player_then_file, True, file_only),
    ReportKind.WRONG_TITLE: _kind("the wrong movie or show", ISSUE_OTHER, by_their_word, True),
    ReportKind.WRONG_EPISODE: _kind("the wrong episode", ISSUE_OTHER, by_their_word, True),
    ReportKind.CAM: _kind("a cam or screener copy", ISSUE_VIDEO, by_their_word, True),
    ReportKind.HARDCODED_SUBS: _kind(
        "hardcoded foreign subtitles", ISSUE_SUBTITLE, by_their_word, True
    ),
    ReportKind.SUBTITLES: _kind(
        "subtitles missing or out of sync", ISSUE_SUBTITLE, track_listing, False
    ),
    ReportKind.AUDIO: _kind(
        "audio out of sync or a missing dub", ISSUE_AUDIO, track_listing, False
    ),
    ReportKind.OTHER: _kind("another problem", ISSUE_OTHER, by_their_word, True),
}


@dataclass(frozen=True)
class Testimony:
    """What one report says about its file."""

    reporter: str | None  # who it counts as reporting the file as broken, if anyone
    failed_check: Health | None  # its health check, when that found the file broken

    @classmethod
    def of(cls, report: ReportRow) -> Testimony:
        """A stored report's testimony. A resolved issue or a declined replacement is spent."""
        if report.resolved_at is not None or report.status is ReportStatus.DECLINED:
            return cls(None, None)
        counts = POLICIES[report.kind].replaceable and report.decision is not Decision.ADVISED
        check = Health.from_dict(report.diagnosis["file_check"]) if report.health else None
        return cls(
            report.discord_id if counts else None,
            check if check and check.verdict.failed else None,
        )

    @classmethod
    def new(cls, reporter: str, policy: KindPolicy, diagnosis: Diagnosis) -> Testimony:
        """A report being filed. One the player explains says nothing about the file."""
        match diagnosis:
            case PlayerLimit():
                return cls(None, None)
        failed = diagnosis.health if diagnosis.health and diagnosis.health.verdict.failed else None
        return cls(reporter if policy.replaceable else None, failed)


@dataclass(frozen=True)
class Evidence:
    """What the reports of one file prove, whatever the model says."""

    failed_check: Health | None  # a health check of this very file that found it broken
    reporters: frozenset[str]  # who reported the file as needing a new copy

    @classmethod
    def of(cls, testimonies: Iterable[Testimony]) -> Evidence:
        said = list(testimonies)
        return cls(
            failed_check=next((t.failed_check for t in said if t.failed_check), None),
            reporters=frozenset(t.reporter for t in said if t.reporter),
        )

    @classmethod
    def for_file(cls, store: Store, host: str, media_type: str, file_id: int) -> Evidence:
        return cls.of(map(Testimony.of, store.reports_for_file(host, media_type, file_id)))

    @property
    def proven(self) -> bool:
        return self.failed_check is not None or len(self.reporters) >= REPORTERS_TO_REPLACE

    def describe(self) -> str:
        if self.failed_check is not None:
            return f"a file check found it {self.failed_check.summary}"
        people = len(self.reporters)
        if people >= REPORTERS_TO_REPLACE:
            return f"{people} people reported it"
        return f"{people} report{'' if people == 1 else 's'} and no failed file check"


def decide(policy: KindPolicy, diagnosis: Diagnosis, evidence: Evidence) -> Decision:
    match diagnosis:
        case PlayerLimit():
            return Decision.ADVISED
        case _ if not policy.replaceable:
            return Decision.FOR_ADMIN
        case _ if evidence.proven:
            return Decision.REPLACEABLE
        case _:
            return Decision.RECORDED


@dataclass(frozen=True)
class Wording:
    """How a decision reads: its line in the Seerr issue, and the model's next step.

    `{evidence}`, `{report_id}` and `{host}` are filled in from the report.
    """

    issue: str
    next: str


WORDING: dict[Decision, Wording] = {
    Decision.ADVISED: Wording(
        "a player limit explains it; the friend was given the fix",
        "Give them the player fix. If it still fails after, report it again: the file is "
        "checked then.",
    ),
    Decision.REPLACEABLE: Wording(
        "a replacement was offered to the friend ({evidence})",
        "The evidence allows a new copy ({evidence}). Offer it: replace_media with report_id "
        "{report_id} and host {host} deletes this copy and searches for another once they "
        "confirm.",
    ),
    Decision.RECORDED: Wording(
        "recorded ({evidence}); it can be replaced once a file check fails or a second "
        "person reports it",
        "Tell them it's recorded ({evidence}); the copy is replaced once a file check fails "
        "or someone else reports it.",
    ),
    Decision.FOR_ADMIN: Wording(
        "recorded for the admin: nothing fixes this automatically yet",
        "Tell them it's recorded and the admin has been asked to fix it.",
    ),
}


class Actor(enum.StrEnum):
    FRIEND = "friend"  # confirms a replacement of their own report
    ADMIN = "admin"  # approves one over the daily cap


@dataclass(frozen=True)
class Move:
    """One step a report's status may take, from the statuses it may start in."""

    from_: frozenset[ReportStatus]
    to: ReportStatus


S = ReportStatus
# Every move a report makes. Nothing else changes a report's status.
ESCALATE = Move(frozenset({S.OPEN}), S.ESCALATED)  # over the cap: the admin decides
DECLINE = Move(frozenset({S.ESCALATED}), S.DECLINED)  # the admin's no, for this report
REOPEN = Move(frozenset({S.ESCALATED}), S.OPEN)  # its approval can't lead anywhere now
REPLACE = Move(frozenset({S.OPEN, S.ESCALATED}), S.REPLACED)  # the file was deleted
# Who may start a replacement from which status, and why no one else may.
MAY_REPLACE: dict[Actor, frozenset[ReportStatus]] = {
    Actor.FRIEND: frozenset({S.OPEN}),
    Actor.ADMIN: frozenset({S.ESCALATED}),
}
NOT_NOW: dict[ReportStatus, str] = {
    S.OPEN: "it isn't waiting on the admin",
    S.ESCALATED: "it's already waiting on the admin",
    S.REPLACED: "it was already replaced",
    S.DECLINED: "the admin decided not to replace it",
}


def move(store: Store, report: ReportRow, step: Move) -> ReportRow | None:
    """Make one move; None when the report wasn't in a status it starts from."""
    return store.move_report(report.id, step.from_, step.to)


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

    def _fill(self, template: str) -> str:
        return template.format(
            evidence=self.evidence.describe(),
            report_id=self.report.id,
            host=self.located.owner.host,
        )

    @property
    def decision(self) -> str:
        """The decision as the Seerr issue reads it."""
        return self._fill(WORDING[self.report.decision].issue)

    @property
    def next_step(self) -> str:
        """What the model should do with the report."""
        return self._fill(WORDING[self.report.decision].next)

    def as_dict(self) -> dict[str, Any]:
        reply: dict[str, Any] = {
            "report_id": self.report.id,
            "title": self.located.title,
            "version": self.located.copy.version,
            "host": self.located.owner.host,
            "problem": POLICIES[self.report.kind].label,
            "diagnosis": self.diagnosis.as_dict(),
            "decision": self.report.decision,
            "seerr_issue": self.issue_id,
            "next": self.next_step,
        }
        if self.issue_note:
            reply["seerr_issue_note"] = self.issue_note
        return reply


def issue_message(filed: Filed, reporter: str) -> str:
    """The Seerr issue: the friend's words, then what maester found and decided."""
    report, located = filed.report, filed.located
    group = f" (release group {report.release_group})" if report.release_group else ""
    return "\n".join(
        [
            report.description,
            "",
            f"Reported through maester by {reporter}: {POLICIES[report.kind].label}, "
            f"{located.label} on {located.owner.host}.",
            f"File: {located.file.path}{group}",
            f"Diagnosis: {filed.diagnosis.summary()}",
            f"Decision: {filed.decision}",
            *filed.diagnosis.details(),
        ]
    )


class IssueNotOpened(Exception):
    """The report couldn't be filed in Seerr; the message says why."""


async def open_issue(services: Services, link: LinkedUser, filed: Filed) -> int:
    """File the report in Seerr as the friend."""
    located, media_id = filed.located, filed.located.details.media_id
    if media_id is None:
        raise IssueNotOpened("not opened: Seerr doesn't track this title yet")
    try:
        return await services.seerr.create_issue(
            media_id,
            POLICIES[filed.report.kind].issue_type,
            issue_message(filed, link.name),
            # As the friend through `userId`, which Seerr's issue route honors for
            # maester's MANAGE_ISSUES key (requests use `X-API-User` instead).
            as_user=link.seerr_user_id,
            season=located.copy.season,
            episode=located.copy.episode,
        )
    except ClientError as exc:
        raise IssueNotOpened(f"not opened: {exc}") from exc


def admin_notice(filed: Filed, reporter: str) -> AdminPost:
    """For a problem nothing fixes automatically: the admin is asked."""
    report, located = filed.report, filed.located
    issue = f"Seerr issue #{filed.issue_id}" if filed.issue_id else "The report"
    return AdminPost(
        f"{reporter} reports {POLICIES[report.kind].label} on {located.label} "
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
    """Diagnose, decide and store a report, then open its Seerr issue."""
    policy, file = POLICIES[kind], located.file
    host, media_type = located.owner.host, located.copy.media_type
    before = store.reports_for_file(host, media_type, file.id)
    advised = any(
        r.discord_id == link.discord_id and r.decision is Decision.ADVISED and not r.resolved_at
        for r in before
    )
    strategy = policy.after_advice if advised else policy.diagnose
    diagnosis = await strategy(Case(services, link, located, at))
    said = [*map(Testimony.of, before), Testimony.new(link.discord_id, policy, diagnosis)]
    evidence = Evidence.of(said)
    report = store.add_report(
        discord_id=link.discord_id,
        kind=kind,
        copy=located.copy,
        title=located.title,
        rating_key=located.details.rating_key_for(located.copy.is_4k),
        host=host,
        file_id=file.id,
        file_path=file.path,
        release_group=release_group(file.release_group, file.path),
        health=diagnosis.health.verdict if diagnosis.health else None,
        diagnosis=diagnosis.as_dict(),
        description=description,
        decision=decide(policy, diagnosis, evidence),
    )
    filed = Filed(report, located, diagnosis, evidence)
    try:
        issue_id = await open_issue(services, link, filed)
    except IssueNotOpened as why:
        filed = replace(filed, issue_note=str(why))
    else:
        filed = replace(
            filed, report=store.set_report_issue(report.id, issue_id), issue_id=issue_id
        )
    if policy.replaceable:
        return filed
    return replace(filed, notices=(admin_notice(filed, link.name),))
