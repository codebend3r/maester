"""The admin's Approve/Deny on a Seerr request: one per request Seerr leaves pending.

A friend's request tool raises it when Seerr leaves their request pending,
and Seerr's MEDIA_PENDING webhook raises it for a request made anywhere else
(Seerr's own page, a collection, a friend not linked here). Both build it
here about the same subject, so the admin gets one post with buttons however
it came in, and the press runs `decide_request`, the button-only admin tool
here, either way.
"""

from __future__ import annotations

from typing import Annotated

from pydantic import Field

from luwin.agent.runner import open_approval
from luwin.agent.tools import Approval, Ok, Refused, Result, Tier, ToolContext, tool
from luwin.clients import ClientError, Services
from luwin.clients.seerr import MediaRequest, RequestStatus
from luwin.media import Version, version_label
from luwin.notify import ApprovalPost, DirectMessage
from luwin.store import PendingAction, Store


def request_subject(request_id: int) -> str:
    """What an approval of a Seerr request is about."""
    return f"seerr-request:{request_id}"


def request_approval(
    request: MediaRequest, title: str, *, requester: str, who: str, note: str = ""
) -> Approval:
    """Ask the admin about a pending Seerr request.

    `requester` is the friend's user id, empty when the Seerr user isn't
    linked here (nobody to DM); `who` is how the admin knows them.
    """
    version = version_label(request.is_4k)
    notice = f"{who} asks for {title} in {version} (Seerr request #{request.id})."
    return Approval(
        notice=f"{notice} {note}" if note else notice,
        summary=f"{version} {title} for {who}",
        decide=decide_request,
        args={"request_id": request.id, "title": title, "version": version, "requester": requester},
        subject=request_subject(request.id),
    )


@tool(
    "decide_request",
    "The admin's decision on a request Seerr left pending: approve or decline it in Seerr.",
    tier=Tier.ADMIN,
    button_only=True,
)
async def decide_request(
    ctx: ToolContext,
    request_id: Annotated[int, Field(description="The Seerr request id.")],
    title: str,
    version: Version,
    requester: Annotated[
        str, Field(description="The requester's user id; empty when they aren't linked here.")
    ],
    approved: bool,
) -> Result:
    """Approve or decline the request in Seerr, then tell the requester.

    Safe to run again: when Seerr already shows this decision (an earlier
    press went through before failing), the requester is still told.
    """
    seerr = ctx.services.seerr
    wanted = RequestStatus.APPROVED if approved else RequestStatus.DECLINED
    try:
        current = (await seerr.get_request(request_id)).status
    except ClientError as exc:
        if exc.status != 404:
            raise
        return Refused(
            f"Seerr request #{request_id} ({title} in {version}) no longer exists in Seerr; "
            "nothing to decide."
        )
    if current == RequestStatus.PENDING:
        await (seerr.approve_request if approved else seerr.decline_request)(request_id)
    elif current != wanted:
        return Refused(
            f"Seerr request #{request_id} ({title} in {version}) was already {current.label} in "
            "Seerr; nothing changed."
        )
    verb = "Approved" if approved else "Declined"
    dm = decision_dm(title, version, approved)
    told = (DirectMessage(requester, dm),) if requester else ()
    return Ok(f"{verb} {title} in {version} in Seerr (request #{request_id}).", told)


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


async def ask_about_request(
    services: Services, store: Store, request: MediaRequest
) -> tuple[PendingAction, ApprovalPost | None]:
    """The open approval of a pending Seerr request, raised when there's none yet.

    For requests no friend's tool asked about: Seerr's webhook, or the admin's
    `/pending` finding one the webhook never delivered.
    """
    if open_ := store.pending_about(request_subject(request.id)):
        return open_, None
    details = await services.seerr.media_details(request.media_type, request.tmdb_id)
    link = store.active_link_by_seerr_id(request.requested_by_id)
    requester = link.user_id if link else ""
    who = (
        link.name if link else request.requested_by_name or f"Seerr user {request.requested_by_id}"
    )
    approval = request_approval(request, details.display, requester=requester, who=who)
    pending, new = open_approval(store, approval, requester)
    return pending, ApprovalPost(approval.notice, pending.id) if new else None
