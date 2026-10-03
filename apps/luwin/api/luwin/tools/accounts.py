"""The admin's decision on a /link request, run from the Approve/Deny buttons.

`link_account` is button-only: the model never sees it, and it runs only
when the admin presses a button on a link request `IdentityService` raised,
through the same runner checks and audit as any tool.
"""

from __future__ import annotations

from datetime import UTC, datetime

from luwin.agent.tools import Result, Tier, ToolContext, tool
from luwin.notify import DirectMessage
from luwin.store import LinkStatus


@tool(
    "link_account",
    "The admin's decision on a request to link a Discord account to a Plex account.",
    {
        "type": "object",
        "properties": {
            "user_id": {"type": "string"},
            "display_name": {"type": "string"},
            "account": {"type": "string", "description": "The Plex email or username."},
            "approved": {"type": "boolean"},
        },
        "required": ["user_id", "display_name", "account", "approved"],
        "additionalProperties": False,
    },
    tier=Tier.ADMIN,
    button_only=True,
)
async def link_account(
    ctx: ToolContext, user_id: str, display_name: str, account: str, approved: bool
) -> Result:
    if approved:
        linked_at = datetime.now(UTC).isoformat()
        ctx.store.upsert_user(user_id, status=LinkStatus.ACTIVE, linked_at=linked_at)
        dm = "You're linked! Ask me for movies and shows any time."
        return Result(f"Linked {display_name} to {account}.", (DirectMessage(user_id, dm),))
    ctx.store.upsert_user(user_id, status=LinkStatus.REVOKED)
    dm = "The admin didn't approve that link. Ask them if you think it's a mistake."
    return Result(f"Denied linking {display_name} to {account}.", (DirectMessage(user_id, dm),))
