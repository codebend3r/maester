"""luwin's own API, under `/api`, for its web app.

Every route needs a session rookery signed in (`Auth`); the admin's need the
ADMIN tier, enforced here whatever the page shows. Writes take JSON only.

- `GET /api/me`: who is signed in and their tier
- `POST /api/admin/users/{user_id}/tier`: set or clear a user's tier
  override, through the admin console's `/tier` so it is audited the same
"""

# No `from __future__ import annotations`: FastAPI reads each route's
# `Annotated[..., Depends(auth...)]` at definition, where `auth` is in scope.
from dataclasses import dataclass
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from luwin.chat.admin import AdminConsole
from luwin.web.auth import Auth, Refused, Viewer, require_json


class TierChange(BaseModel):
    tier: Literal["friend", "trusted", "admin"] | None


@dataclass(frozen=True)
class Api:
    auth: Auth
    console: AdminConsole

    def router(self) -> APIRouter:
        router = APIRouter(prefix="/api")
        auth, console = self.auth, self.console
        identity, store = console.identity, console.store

        @router.get("/me")
        async def me(viewer: Annotated[Viewer, Depends(auth.signed_in)]) -> dict[str, Any]:
            return {
                "user": {
                    "id": viewer.user.user_id,
                    "display_name": viewer.display_name,
                    "thumb": viewer.user.thumb,
                },
                "tier": viewer.tier.name.lower(),
            }

        @router.post("/admin/users/{user_id}/tier", dependencies=[Depends(require_json)])
        async def set_tier(
            user_id: str, change: TierChange, admin: Annotated[Viewer, Depends(auth.admin)]
        ) -> dict[str, Any]:
            if store.get_user(user_id) is None:
                raise Refused(404, {"reason": "unknown_user"})
            console.set_tier(admin.chat_user, user_id, change.tier)
            user = store.get_user(user_id)
            return {
                "user_id": user_id,
                "tier_override": user.tier_override if user else None,
                "tier": identity.tier_for(user_id).name.lower(),
            }

        return router
