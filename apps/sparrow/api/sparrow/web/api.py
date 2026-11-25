"""sparrow's own API, under `/api`, for its web app.

Every route but the sign-in config needs an account raven approved (`Auth`);
the admin's need the ADMIN tier, enforced here whatever the page shows. Writes
take JSON only.

- `GET /api/auth/config`: where the page signs in, raven's own answer relayed
  as it is (Supabase's URL and publishable key), so the page asks only sparrow
- `GET /api/me`: who is signed in and their tier
- `POST /api/admin/users/{user_id}/tier`: set or clear a user's tier
  override, audited as `/tier` under the admin who set it
"""

# No `from __future__ import annotations`: FastAPI reads each route's
# `Annotated[..., Depends(auth...)]` at definition, where `auth` is in scope.
import logging
from dataclasses import dataclass
from typing import Annotated, Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from sparrow.agent.tools import AssignableTier, Tier
from sparrow.chat.identity import IdentityService
from sparrow.clients import ClientError
from sparrow.clients.raven import RavenServer
from sparrow.store import Store
from sparrow.web.auth import Auth, Reason, Refused, Viewer, require_json

log = logging.getLogger("sparrow.web")

# The audit log's name for a tier change, as the admin's command it replaced was named.
TIER_AUDIT = "/tier"


def me_body(viewer: Viewer) -> dict[str, Any]:
    """`GET /api/me`'s answer, the sandbox's too."""
    return {
        "user": {"id": viewer.user.user_id, "email": viewer.display_name},
        "tier": viewer.tier.name.lower(),
    }


class TierChange(BaseModel):
    tier: AssignableTier | None


@dataclass(frozen=True)
class Api:
    auth: Auth
    identity: IdentityService
    store: Store
    raven: RavenServer

    def router(self) -> APIRouter:
        router = APIRouter(prefix="/api")
        auth, identity, store, raven = self.auth, self.identity, self.store, self.raven

        @router.get("/auth/config")
        async def auth_config() -> dict[str, Any]:
            try:
                return await raven.auth_config()
            except ClientError:
                log.warning("raven couldn't say where to sign in", exc_info=True)
                raise Refused(503, Reason.SIGN_IN_UNAVAILABLE) from None

        @router.get("/me")
        async def me(viewer: Annotated[Viewer, Depends(auth.approved)]) -> dict[str, Any]:
            return me_body(viewer)

        @router.post("/admin/users/{user_id}/tier", dependencies=[Depends(require_json)])
        async def set_tier(
            user_id: str, change: TierChange, admin: Annotated[Viewer, Depends(auth.admin)]
        ) -> dict[str, Any]:
            if store.get_user(user_id) is None:
                raise Refused(404, Reason.UNKNOWN_USER)
            tier = Tier.parse(change.tier) if change.tier is not None else None
            said = identity.set_tier_override(user_id, tier)
            store.audit(
                user_id=admin.user.user_id,
                tool=TIER_AUDIT,
                args={"target": user_id, "tier": change.tier},
                result=said,
                ok=True,
            )
            user = store.get_user(user_id)
            return {
                "user_id": user_id,
                "tier_override": user.tier_override if user else None,
                "tier": identity.tier_for(user_id).name.lower(),
            }

        return router
