"""Tool declarations: name, schema, handler, minimum tier, destructive flag.

A tool is a plain async function that takes a `ToolContext` plus keyword
arguments matching its JSON schema. The registry is the only way the model
learns about tools, and it filters by tier: a friend never sees a tool they
cannot call, and the runner rejects out-of-tier calls anyway.

There is deliberately no shell, HTTP passthrough or filesystem tool.
"""

from __future__ import annotations

import enum
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

from maester.config import Settings
from maester.notify import Notice
from maester.store import LinkedUser, NotLinked, Store

if TYPE_CHECKING:
    from maester.clients import Services


class Tier(enum.IntEnum):
    UNLINKED = 0
    FRIEND = 1
    TRUSTED = 2
    ADMIN = 3

    @classmethod
    def parse(cls, name: str | None, default: Tier | None = None) -> Tier:
        if not name:
            if default is None:
                raise ValueError("tier name is empty")
            return default
        try:
            return cls[name.upper()]
        except KeyError:
            raise ValueError(f"unknown tier {name!r}") from None


@dataclass(frozen=True)
class ToolContext:
    """What a tool handler gets besides its arguments.

    `services` holds the clients the app wires up, real or fake. `user_id`
    is the chat identity the call runs as and is audited under. `settings`
    is the deployment's configuration, for the few tools that need a knob.
    """

    user_id: str
    tier: Tier
    services: Services
    store: Store
    settings: Settings

    def linked_user(self) -> LinkedUser:
        """The caller's active link: who requests go to Seerr as.

        Requests carry `X-API-User: seerr_user_id`, so the friend's name,
        quotas and permissions apply. An admin who never linked, or a link
        still waiting on approval, has none, and the tool refuses.
        """
        return self.link_of(self.user_id)

    def link_of(self, discord_id: str) -> LinkedUser:
        """Someone's active link, for a tool acting on their behalf (an admin's decision)."""
        link = self.store.active_link(discord_id)
        if link is None:
            raise NotLinked(f"Discord user {discord_id} isn't linked to a Plex account")
        return link

    def name_of(self, discord_id: str) -> str:
        """Someone as the admin knows them: their Plex name, or their Discord id if unlinked."""
        link = self.store.active_link(discord_id)
        return link.name if link else discord_id


# Discord shows at most ten embeds on one message, one card per option.
MAX_CHOICES = 10


@dataclass(frozen=True)
class Choice:
    """One option a tool offers the user; the chat layer shows it as a button."""

    label: str
    value: str
    year: int | None = None
    poster_url: str | None = None
    # A line under the title: availability, a short overview.
    detail: str = ""

    @property
    def display(self) -> str:
        if self.year and str(self.year) not in self.label:
            return f"{self.label} ({self.year})"
        return self.label


@dataclass(frozen=True)
class Choices:
    """Return this from a handler to offer the user a pick instead of a plain result.

    At most `MAX_CHOICES` become buttons; the model is told which were left
    off, so it never promises a button that isn't there. `notes` tell the
    model what else it should know (what couldn't be looked up).
    """

    items: list[Choice]
    notes: tuple[str, ...] = ()

    @property
    def shown(self) -> list[Choice]:
        return self.items[:MAX_CHOICES]

    def as_content(self) -> dict[str, Any]:
        content: dict[str, Any] = {
            "choices": [
                {
                    "label": c.label,
                    "value": c.value,
                    "year": c.year,
                    "poster_url": c.poster_url,
                    "detail": c.detail,
                }
                for c in self.shown
            ],
            "note": "Shown to the user as numbered buttons; wait for their pick.",
        }
        if left_off := self.items[MAX_CHOICES:]:
            content["not_shown"] = [f"{c.display} ({c.value})" for c in left_off]
        if self.notes:
            content["notes"] = list(self.notes)
        return content


@dataclass(frozen=True)
class Approval:
    """Ask the admin: `notice` goes up with Approve/Deny buttons, and the press runs `decide`.

    `decide` names a button-only admin tool; `args` are its arguments except
    `approved`, which the press supplies. The runner checks them against that
    tool's schema before anything is stored, and on the press runs the tool
    through the same checks and audit as any call.
    """

    notice: str
    summary: str
    decide: str
    args: dict[str, Any]


@dataclass(frozen=True)
class Result:
    """A handler's result plus what goes out besides it.

    The model sees `content`. `notices` are posted or DMed. With `approval`,
    the admin is asked and the model is told the action now waits on them.
    `is_error` marks a failure the tool explains itself (a refusal, a step
    that failed): the model sees an error and the audit row is not ok. It is
    final unless `retryable` (a service that didn't answer): only then is a
    button press that ended this way offered again. Every refusal is one of
    these (`refusal`), never an exception or a success that says no.
    """

    content: Any
    notices: tuple[Notice, ...] = ()
    approval: Approval | None = None
    is_error: bool = False
    retryable: bool = False

    def __post_init__(self) -> None:
        if self.approval is not None and self.is_error:
            raise ValueError("a result that asks the admin isn't a failure")
        if self.retryable and not self.is_error:
            raise ValueError("only a failure can be retried")

    @classmethod
    def refusal(cls, reason: str, *notices: Notice) -> Result:
        """The tool won't do it, and says why."""
        return cls(reason, notices, is_error=True)


Handler = Callable[..., Awaitable[Any]]


@dataclass(frozen=True)
class ToolSpec:
    name: str
    description: str
    input_schema: dict[str, Any]
    handler: Handler
    tier: Tier = Tier.FRIEND
    destructive: bool = False
    # Name of the argument that carries the arr host, so the audit row and
    # the confirmation summary can say which stack is being touched.
    host_param: str | None = None
    # Runs only from an admin's decision button, never from the model: it
    # applies an `Approval` another tool raised, and must be safe to run
    # again, since a failed run reopens the buttons.
    button_only: bool = False

    def definition(self) -> dict[str, Any]:
        """The tool as the Messages API wants it, streaming its input eagerly."""
        return {
            "name": self.name,
            "description": self.description,
            "input_schema": self.input_schema,
            "eager_input_streaming": True,
        }


class ValidationError(ValueError):
    pass


_JSON_TYPES: dict[str, type | tuple[type, ...]] = {
    "string": str,
    "integer": int,
    "number": (int, float),
    "boolean": bool,
    "array": list,
    "object": dict,
}


def validate_input(schema: dict[str, Any], data: Any) -> dict[str, Any]:
    """A small JSON-schema check: object shape, required keys, property types.

    Eager input streaming turns off server-side validation, so a truncated
    or mistyped input can arrive parsed. This catches the shapes that
    matter for calling a handler with keyword arguments; anything deeper
    is the handler's job.
    """
    if not isinstance(data, dict):
        raise ValidationError("input is not an object")
    props = schema.get("properties", {})
    for key in schema.get("required", []):
        if key not in data:
            raise ValidationError(f"missing required argument {key!r}")
    for key, value in data.items():
        if key not in props:
            raise ValidationError(f"unexpected argument {key!r}")
        expected = props[key].get("type")
        if expected in _JSON_TYPES and value is not None:
            py = _JSON_TYPES[expected]
            # bool is an int subclass; an integer field must not accept True.
            if not isinstance(value, py) or (
                expected in ("integer", "number") and isinstance(value, bool)
            ):
                raise ValidationError(f"argument {key!r} should be {expected}")
        enum_values = props[key].get("enum")
        if enum_values is not None and value not in enum_values:
            raise ValidationError(f"argument {key!r} must be one of {enum_values}")
    return data


class ToolRegistry:
    def __init__(self) -> None:
        self._specs: dict[str, ToolSpec] = {}

    def register(self, spec: ToolSpec) -> ToolSpec:
        if spec.name in self._specs:
            raise ValueError(f"tool {spec.name!r} is already registered")
        if spec.button_only and spec.tier != Tier.ADMIN:
            raise ValueError(f"button-only tool {spec.name!r} must be admin tier")
        self._specs[spec.name] = spec
        return spec

    def get(self, name: str) -> ToolSpec | None:
        return self._specs.get(name)

    def names(self) -> list[str]:
        return sorted(self._specs)

    def for_tier(self, tier: Tier) -> list[ToolSpec]:
        """Tools the model may call for this tier, in a stable order so the prompt caches."""
        return [
            spec
            for spec in (self._specs[n] for n in sorted(self._specs))
            if spec.tier <= tier and not spec.button_only
        ]

    def definitions(self, tier: Tier) -> list[dict[str, Any]]:
        defs = [s.definition() for s in self.for_tier(tier)]
        if defs:
            # One breakpoint after the tool list: tools render before the
            # system prompt, so this caches the whole stable prefix.
            defs[-1] = {**defs[-1], "cache_control": {"type": "ephemeral"}}
        return defs

    def tool(
        self,
        name: str,
        description: str,
        input_schema: dict[str, Any],
        *,
        tier: Tier = Tier.FRIEND,
        destructive: bool = False,
        host_param: str | None = None,
        button_only: bool = False,
    ) -> Callable[[Handler], Handler]:
        def decorate(fn: Handler) -> Handler:
            self.register(
                ToolSpec(
                    name=name,
                    description=description,
                    input_schema=input_schema,
                    handler=fn,
                    tier=tier,
                    destructive=destructive,
                    host_param=host_param,
                    button_only=button_only,
                )
            )
            return fn

        return decorate


# The process-wide registry that tool modules decorate into. Tests build
# their own `ToolRegistry()` so they never see the app's tools.
registry = ToolRegistry()
tool = registry.tool
