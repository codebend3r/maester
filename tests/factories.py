"""Small builders for records tests need often, with defaults worth overriding."""

from maester.store import PendingAction


def pending_action(**overrides) -> PendingAction:
    fields = dict(
        id=1,
        kind="confirm",
        action="replace_media",
        requester="5",
        payload={},
        summary="replace it",
        decision=None,
        expires_at="2099-01-01T00:00:00.000Z",
        decided_by=None,
    )
    return PendingAction(**{**fields, **overrides})
