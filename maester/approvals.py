"""The admin's Approve/Deny on a Seerr request: one per request Seerr leaves pending.

A friend's request tool raises it when Seerr leaves their request pending,
and Seerr's MEDIA_PENDING webhook raises it for a request made anywhere else
(Seerr's own page, a collection, a friend not linked here). Both build it
here about the same subject, so the admin gets one post with buttons however
it came in, and the press runs `decide_request` either way.
"""

from __future__ import annotations

from maester.agent.runner import APPROVAL_TTL
from maester.agent.tools import Approval
from maester.clients.seerr import MediaRequest
from maester.media import version_label
from maester.notify import ApprovalPost
from maester.store import PendingAction, Store

DECIDE = "decide_request"


def request_subject(request_id: int) -> str:
    """What an approval of a Seerr request is about."""
    return f"seerr-request:{request_id}"


def request_approval(
    request: MediaRequest, title: str, *, requester: str, who: str, note: str = ""
) -> Approval:
    """Ask the admin about a pending Seerr request.

    `requester` is the friend's Discord id, empty when the Seerr user isn't
    linked here (nobody to DM); `who` is how the admin knows them.
    """
    version = version_label(request.is_4k)
    notice = f"{who} asks for {title} in {version} (Seerr request #{request.id})."
    return Approval(
        notice=f"{notice} {note}" if note else notice,
        summary=f"{version} {title} for {who}",
        decide=DECIDE,
        args={"request_id": request.id, "title": title, "version": version, "requester": requester},
        subject=request_subject(request.id),
    )


def decision_dm(title: str, version: str, approved: bool) -> str:
    """What the requester is told once the admin decides, wherever they decided."""
    if approved:
        return (
            f"The admin approved {title} in {version}. It's on its way; I'll message you when "
            "it's ready."
        )
    if version == "4K":
        return f"The admin declined {title} in 4K. You can still ask for the regular version."
    return f"The admin declined {title} in {version}."


def raise_approval(
    store: Store, approval: Approval, requester: str
) -> tuple[PendingAction, ApprovalPost | None]:
    """Raise an approval outside a tool call (a webhook): its post, unless one is open already."""
    pending, new = store.create_pending_once(
        subject=approval.subject or "",
        kind="approve",
        action=approval.decide,
        requester=requester,
        payload=approval.args,
        summary=approval.summary,
        ttl=APPROVAL_TTL,
    )
    return pending, ApprovalPost(approval.notice, pending.id) if new else None
