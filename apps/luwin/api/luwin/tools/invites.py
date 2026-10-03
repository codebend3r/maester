"""Invites for someone new, asked for by a trusted friend and issued through Wizarr.

`request_invite` doesn't invite anyone: it puts the ask in the admin's
approval queue, one per friend and person. The admin's Approve runs
`decide_invite`, a button-only admin tool, which creates a Wizarr invite
scoped to the libraries an invite shares (`luwin/access.py`) on the servers
holding them, with the link's expiry (`INVITE_EXPIRES_DAYS`, snapped up to
one Wizarr honors) and the access it grants (`INVITE_ACCESS_DAYS`). The link,
on Wizarr's public address (`WIZARR_PUBLIC_URL`), goes to the friend who
asked, to forward, with both dates, and to the admin too in case the DM
doesn't land. Issuing an invite is destructive: it runs one at a time under
the kill switch. A create Wizarr didn't confirm isn't retried (it may exist
already); the admin checks Wizarr, and the friend hears it's in hand.
"""

from __future__ import annotations

from datetime import datetime, timedelta

from luwin.access import invite_libraries
from luwin.agent.tools import Approval, Result, Tier, ToolContext, tool
from luwin.clients import ClientError
from luwin.clients.wizarr import Invite, honored_expiry_days
from luwin.notify import DirectMessage

# What the admin reads in the approval post; the rest is cut.
NAME_MAX, NOTE_MAX = 100, 500


def invite_link(ctx: ToolContext, invite: Invite) -> str:
    """Where the new person opens the invite: Wizarr's public address, `/j/<code>`.

    Wizarr's own `url` is a path on its host (`/j/<code>`), which is no use to
    someone outside the LAN.
    """
    public = ctx.settings.access.public_url
    if public:
        return f"{public}/j/{invite.code}"
    if invite.url.startswith(("http://", "https://")):
        return invite.url
    return f"{ctx.settings.wizarr_url}/j/{invite.code}"


@tool(
    "request_invite",
    "Ask the admin for a Plex invite for someone new (a friend of the user). Nothing is sent "
    "until the admin approves; then the user gets the invite link in a DM to forward. "
    "for_whom is who it's for, as the user names them; note is anything the admin should "
    "know (how they know them).",
    {
        "type": "object",
        "properties": {
            "for_whom": {"type": "string", "description": "Who the invite is for."},
            "note": {"type": "string", "description": "Anything the admin should know."},
        },
        "required": ["for_whom"],
        "additionalProperties": False,
    },
    tier=Tier.TRUSTED,
)
async def request_invite(ctx: ToolContext, for_whom: str, note: str = "") -> Result:
    for_whom = " ".join(for_whom.split())[:NAME_MAX]
    note = note.strip()[:NOTE_MAX]
    if not for_whom:
        return Result.refusal("Say who the invite is for.")
    who = ctx.linked_user().name
    notice = f"{who} asks for a Plex invite for {for_whom}" + (f": {note}" if note else ".")
    return Result(
        {"asked": True, "for": for_whom},
        approval=Approval(
            notice=notice,
            summary=f"Invite for {for_whom}, from {who}",
            decide="decide_invite",
            args={"for_whom": for_whom, "requester": ctx.user_id},
            subject=f"invite:{ctx.user_id}:{for_whom.lower()}",
        ),
    )


@tool(
    "decide_invite",
    "The admin's decision on an invite a friend asked for.",
    {
        "type": "object",
        "properties": {
            "for_whom": {"type": "string"},
            "requester": {"type": "string", "description": "The friend's user id."},
            "approved": {"type": "boolean"},
        },
        "required": ["for_whom", "requester", "approved"],
        "additionalProperties": False,
    },
    tier=Tier.ADMIN,
    destructive=True,
    button_only=True,
)
async def decide_invite(ctx: ToolContext, for_whom: str, requester: str, approved: bool) -> Result:
    """Create the invite and send its link to the friend who asked, or tell them no."""
    if not approved:
        dm = f"The admin didn't approve an invite for {for_whom}. Ask them if you think it's a mistake."
        return Result(f"No invite for {for_whom}.", (DirectMessage(requester, dm),))
    access = ctx.settings.access
    wizarr = ctx.services.wizarr
    snag = DirectMessage(
        requester,
        f"The admin said yes to an invite for {for_whom}, but it couldn't be made just now; "
        "the admin will sort it out.",
    )
    libraries = invite_libraries(await wizarr.libraries(), access)
    if not libraries:
        return Result.refusal(
            "No library an invite may share was found in Wizarr (check INVITE_SERVERS and "
            "INVITE_LIBRARIES), so no invite was created.",
            snag,
        )
    duration = str(access.access_days) if access.access_days else "unlimited"
    try:
        invite = await wizarr.create_invite(
            expires_in_days=access.invite_expires_days,
            duration=duration,
            library_ids=[lib.id for lib in libraries],
            server_ids=sorted({lib.server_id for lib in libraries}),
        )
    except ClientError as exc:
        # Wizarr may have made it before failing to answer, so pressing again could make a
        # second live invite: the admin checks Wizarr instead.
        return Result.refusal(
            f"Wizarr didn't confirm the invite ({exc}). Check its invitations for one it made "
            f"anyway before making another for {for_whom}.",
            snag,
        )
    link = invite_link(ctx, invite)
    days = honored_expiry_days(access.invite_expires_days)
    until = (datetime.now(ctx.settings.jobs.zone) + timedelta(days=days)).strftime("%b %d")
    lasts = (
        f"their access lasts {access.access_days} days"
        if access.access_days
        else "their access doesn't end"
    )
    dm = (
        f"The admin approved an invite for {for_whom}. Send them this link: {link}\n"
        f"It works until {until} ({days} days). Once they join with their Plex account, "
        f"{lasts}. Then they can talk to me here after linking with `/link`."
    )
    shared = ", ".join(sorted(f"{lib.name} on {lib.server_name}" for lib in libraries))
    return Result(
        {
            "invited": for_whom,
            "link": link,
            "link_until": until,
            "access": duration,
            "libraries": shared,
        },
        (DirectMessage(requester, dm),),
    )
