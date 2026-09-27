"""The admin console's commands: the kill switch, tiers, the audit log, what waits on the
admin, and when each volume fills.

Every command is the admin's alone and is audited under its own name
("/kill"), refusals included, so the log shows who tried what. Replies are
private to the admin; `offers` are approvals to show again with their
buttons, so a week-old request can be decided from a phone. Like the chat
service, the console talks to no chat platform: `bot.py` turns each command
into a slash command and delivers the reply.
"""

from __future__ import annotations

import asyncio
import json
import logging
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from maester.agent.limits import KillSwitch
from maester.agent.tools import Tier
from maester.approvals import ask_about_request
from maester.chat.identity import IdentityService
from maester.chat.service import ChatUser
from maester.clients import ClientError, Services
from maester.config import Settings
from maester.formatting import ago, humanized, local_time
from maester.notify import Notice
from maester.storage import FORECAST_WINDOW, forecasts
from maester.store import AuditRow, PendingAction, Store

log = logging.getLogger("maester.admin")

NOT_ADMIN = "Only the admin can use /{command}."
AUDIT_DEFAULT, AUDIT_MAX = 10, 50
# Seerr requests read by /pending, newest first.
SEERR_PENDING = 50


@dataclass(frozen=True)
class AdminReply:
    text: str
    # Approvals to show again with their Approve/Deny buttons.
    offers: tuple[PendingAction, ...] = ()
    notices: tuple[Notice, ...] = ()


class AdminConsole:
    def __init__(
        self,
        *,
        identity: IdentityService,
        store: Store,
        services: Services,
        settings: Settings,
        kill_switch: KillSwitch,
    ):
        self.identity = identity
        self.store = store
        self.services = services
        self.settings = settings
        self.kill_switch = kill_switch

    def is_admin(self, user: ChatUser) -> bool:
        return self.identity.tier_for(user.id, set(user.role_ids)) == Tier.ADMIN

    def _audit(self, user: ChatUser, command: str, args: dict[str, Any], reply: str, ok: bool):
        self.store.audit(discord_id=user.id, tool=f"/{command}", args=args, result=reply, ok=ok)

    def _refused(self, user: ChatUser, command: str, args: dict[str, Any]) -> AdminReply | None:
        """The refusal a non-admin gets, audited; None for the admin."""
        if self.is_admin(user):
            return None
        text = NOT_ADMIN.format(command=command)
        self._audit(user, command, args, text, ok=False)
        return AdminReply(text)

    def _name(self, discord_id: str | None) -> str:
        if discord_id is None:
            return "maester"
        link = self.store.active_link(discord_id)
        return link.name if link else discord_id

    # -- /kill --------------------------------------------------------------

    def kill(self, admin: ChatUser, on: bool, reason: str = "") -> AdminReply:
        args = {"on": on, "reason": reason}
        if refused := self._refused(admin, "kill", args):
            return refused
        if on:
            self.kill_switch.on(reason, by=admin.id)
            text = "Kill switch on: every destructive tool refuses until `/kill off`."
            if reason:
                text += f" Friends are told: {reason}"
        elif self.kill_switch.enabled:
            self.kill_switch.off()
            text = "Kill switch off: destructive tools run again."
        else:
            text = "The kill switch was already off."
        self._audit(admin, "kill", args, text, ok=True)
        return AdminReply(text)

    # -- /tier --------------------------------------------------------------

    def set_tier(self, admin: ChatUser, target_id: str, tier: str | None) -> AdminReply:
        args = {"target": target_id, "tier": tier}
        if refused := self._refused(admin, "tier", args):
            return refused
        try:
            text = self.identity.set_tier_override(target_id, tier)
        except ValueError:
            text = f"Unknown tier `{tier}`; use friend, trusted, or admin."
            self._audit(admin, "tier", args, text, ok=False)
            return AdminReply(text)
        self._audit(admin, "tier", args, text, ok=True)
        return AdminReply(text)

    # -- /audit -------------------------------------------------------------

    def audit(self, admin: ChatUser, n: int = AUDIT_DEFAULT) -> AdminReply:
        n = max(1, min(n, AUDIT_MAX))
        if refused := self._refused(admin, "audit", {"n": n}):
            return refused
        rows = self.store.audit_recent(n)
        text = "\n".join(self._audit_line(r) for r in rows) or "The audit log is empty."
        # Audited after reading, so the listing shows what came before it.
        self._audit(admin, "audit", {"n": n}, f"{len(rows)} rows", ok=True)
        return AdminReply(text)

    def _audit_line(self, row: AuditRow) -> str:
        when = local_time(datetime.fromisoformat(row.ts), self.settings.jobs.zone)
        verdict = "ok" if row.ok else "refused or failed"
        if row.pending_id is not None:
            verdict = f"asked the admin (#{row.pending_id})"
        host = f" on {row.host}" if row.host else ""
        args = json.dumps(row.args, default=str)
        args = args if len(args) <= 120 else args[:117] + "..."
        return (
            f"`#{row.id}` {when} {self._name(row.discord_id)}: `{row.tool}`{host}, {verdict} {args}"
        )

    # -- /pending -----------------------------------------------------------

    async def pending(self, admin: ChatUser) -> AdminReply:
        """Everything waiting on the admin, with its buttons again.

        Seerr's pending requests are read too: one the webhook never delivered
        (maester was down, or it isn't set up) gets its approval raised here.
        """
        if refused := self._refused(admin, "pending", {}):
            return refused
        note = ""
        try:
            requests = await self.services.seerr.list_requests(take=SEERR_PENDING, filter="pending")
            await asyncio.gather(
                *(ask_about_request(self.services, self.store, r) for r in requests)
            )
        except ClientError as exc:
            log.warning("/pending couldn't read Seerr: %s", exc)
            note = (
                f"\nCouldn't read Seerr's pending requests, so any made there may be missing: {exc}"
            )
        waiting = self.store.open_pending("approve")
        if waiting:
            lines = [f"{len(waiting)} waiting on you:"]
            lines += [f"- {self._waiting_line(p)}" for p in waiting]
            text = "\n".join(lines)
        else:
            text = "Nothing is waiting on you."
        self._audit(admin, "pending", {}, f"{len(waiting)} waiting", ok=True)
        return AdminReply(text + note, offers=tuple(waiting))

    def _waiting_line(self, pending: PendingAction) -> str:
        now = datetime.now(UTC)
        raised = ago(now - datetime.fromisoformat(pending.ts))
        left = datetime.fromisoformat(pending.expires_at) - now
        expires = humanized(int(left.total_seconds()))
        return f"{pending.summary} (asked {raised}, expires in {expires})"

    # -- /forecast ----------------------------------------------------------

    def forecast(self, admin: ChatUser) -> AdminReply:
        """Days until each volume is full, from a straight line through a month of samples."""
        if refused := self._refused(admin, "forecast", {}):
            return refused
        today = datetime.now(self.settings.jobs.zone).date()
        found = forecasts(self.store.space_since(today - FORECAST_WINDOW))
        if found:
            text = "\n".join(f"- {f.describe()}" for f in found)
        else:
            text = "No free-space samples yet: the first is taken tonight at 03:00."
        self._audit(admin, "forecast", {}, f"{len(found)} volumes", ok=True)
        return AdminReply(text)
