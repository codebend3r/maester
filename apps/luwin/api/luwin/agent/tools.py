"""Tool declarations: name, handler, minimum tier, destructive flag.

A tool is a plain async function that takes a `ToolContext` plus keyword
arguments. Its signature is its contract: the registry builds a pydantic
model from the parameters' type hints (`Annotated[..., Field(description=...)]`
for what the model should read about one), and that model is both the JSON
schema the model sees and the check every call goes through. The registry is
the only way the model learns about tools, and it filters by tier: a friend
never sees a tool they cannot call, and the runner rejects out-of-tier calls
anyway.

There is deliberately no shell, HTTP passthrough or filesystem tool.
"""

from __future__ import annotations

import enum
import inspect
import typing
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Annotated, Any

import pydantic
from pydantic import BaseModel, ConfigDict, Strict

from luwin.config import Settings
from luwin.memo import Memo
from luwin.notify import Notice
from luwin.store import LinkedUser, NotLinked, Store

if TYPE_CHECKING:
    from luwin.clients import Services


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
    `memo` keeps answers tools share across calls for a while (a health
    check, a speed test), one per app.
    """

    user_id: str
    tier: Tier
    services: Services
    store: Store
    settings: Settings
    memo: Memo

    def linked_user(self) -> LinkedUser:
        """The caller's link: who requests go to Seerr as.

        Requests carry `X-API-User: seerr_user_id`, so the friend's name,
        quotas and permissions apply. Someone whose Plex account matches no
        Seerr user has none, and the tool refuses.
        """
        return self.link_of(self.user_id)

    def link_of(self, user_id: str) -> LinkedUser:
        """Someone's link, for a tool acting on their behalf (an admin's decision)."""
        link = self.store.active_link(user_id)
        if link is None:
            raise NotLinked(f"User {user_id} isn't linked to a Plex account")
        return link

    def name_of(self, user_id: str) -> str:
        """Someone as the admin knows them: their Plex name, or their user id if unlinked."""
        link = self.store.active_link(user_id)
        return link.name if link else user_id


# A reply offers at most ten options, one card each.
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

    `decide` is a button-only admin tool's handler; `args` are its arguments
    except `approved`, which the press supplies. They are checked against that
    tool's signature before anything is stored (`open_approval` in
    `luwin/agent/runner.py`), and on the press the tool runs through the same
    checks and audit as any call. With a `subject` (the Seerr request it
    decides), an approval already open about it is reused rather than posted
    twice, whoever raised it first.
    """

    notice: str
    summary: str
    decide: Handler
    args: dict[str, Any]
    subject: str | None = None

    def decide_spec(self) -> ToolSpec:
        """The admin tool the press runs; `LookupError` when `decide` isn't a button-only tool."""
        spec = spec_of(self.decide)
        if not spec.button_only:
            raise LookupError(f"{spec.name!r} is not a registered admin decision tool")
        return spec


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


class ValidationError(ValueError):
    """Arguments that don't fit a tool's signature."""


# JSON types match exactly: no coercion, and a bool is not an int. Eager input
# streaming turns off server-side validation, so a truncated or mistyped input
# can arrive parsed; nothing reaches a handler that its signature doesn't take.
_ARGS_CONFIG = ConfigDict(extra="forbid", strict=True)


def _field_type(hint: Any) -> Any:
    """A parameter's type for the args model: an enum takes its values, as JSON carries them."""
    if isinstance(hint, type) and issubclass(hint, enum.Enum):
        return Annotated[hint, Strict(False)]
    return hint


def model_of(name: str, handler: Handler) -> type[BaseModel]:
    """The model of a handler's keyword arguments: every parameter after the context."""
    hints = typing.get_type_hints(handler, include_extras=True)
    params = list(inspect.signature(handler).parameters.values())[1:]
    fields: dict[str, Any] = {
        p.name: (
            _field_type(hints.get(p.name, Any)),
            ... if p.default is inspect.Parameter.empty else p.default,
        )
        for p in params
    }
    return pydantic.create_model(f"{name}_args", __config__=_ARGS_CONFIG, **fields)


def schema_of(model: type[BaseModel]) -> dict[str, Any]:
    """The JSON schema the model sees: pydantic's, without its titles, defaults and `$defs`,
    and with an optional parameter written as its type (leaving it out is how to skip it)."""
    schema = model.model_json_schema()
    defs = schema.pop("$defs", {})

    def clean(node: dict[str, Any]) -> dict[str, Any]:
        if ref := node.get("$ref"):
            node = {
                **defs[ref.rsplit("/", 1)[-1]],
                **{k: v for k, v in node.items() if k != "$ref"},
            }
        if options := node.get("anyOf"):
            present = [o for o in options if o != {"type": "null"}]
            if len(present) == 1:
                node = {**{k: v for k, v in node.items() if k != "anyOf"}, **present[0]}
        node = {k: v for k, v in node.items() if k not in ("title", "default")}
        if "items" in node:
            node["items"] = clean(node["items"])
        if "properties" in node:
            node["properties"] = {k: clean(v) for k, v in node["properties"].items()}
        return node

    return clean(schema)


def _explain(error: pydantic.ValidationError) -> str:
    """The first problem with some arguments, in the words the model and the admin read."""
    first = error.errors()[0]
    where = ".".join(str(part) for part in first["loc"])
    match first["type"]:
        case "missing":
            return f"missing required argument {where!r}"
        case "extra_forbidden":
            return f"unexpected argument {where!r}"
        case "model_type" | "dict_type" if not first["loc"]:
            return "input is not an object"
        case _:
            return f"argument {where!r}: {first['msg']}"


@dataclass(frozen=True)
class ToolSpec:
    name: str
    description: str
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
    # Changes something the stack must be up for (a request, a replacement): during a
    # maintenance window the call is saved and runs when it ends.
    held_in_maintenance: bool = False
    # Built from the handler's signature: the check every call goes through, and the
    # schema the model sees.
    args_model: type[BaseModel] = field(init=False, repr=False, compare=False)
    input_schema: dict[str, Any] = field(init=False, repr=False, compare=False)

    def __post_init__(self) -> None:
        model = model_of(self.name, self.handler)
        object.__setattr__(self, "args_model", model)
        object.__setattr__(self, "input_schema", schema_of(model))

    def validate(self, data: Any) -> dict[str, Any]:
        """`data` as stored and audited, once it fits the handler's signature."""
        try:
            self.args_model.model_validate(data)
        except pydantic.ValidationError as exc:
            raise ValidationError(_explain(exc)) from None
        return dict(data)

    def parse(self, data: dict[str, Any]) -> BaseModel:
        """Validated arguments, typed, for code that reads a stored call (an approval's payload)."""
        try:
            return self.args_model.model_validate(data)
        except pydantic.ValidationError as exc:
            raise ValidationError(_explain(exc)) from None

    async def call(self, ctx: ToolContext, args: dict[str, Any]) -> Any:
        """Run the handler with `args` as its signature takes them (an enum as its member)."""
        parsed = self.parse(args)
        return await self.handler(ctx, **{k: getattr(parsed, k) for k in parsed.model_fields_set})

    def definition(self) -> dict[str, Any]:
        """The tool as the Messages API wants it, streaming its input eagerly."""
        return {
            "name": self.name,
            "description": self.description,
            "input_schema": self.input_schema,
            "eager_input_streaming": True,
        }


# Every registered tool by its handler, so an `Approval` can name its decide tool by the
# function itself rather than by a string that a rename would silently break.
_SPECS: dict[Handler, ToolSpec] = {}


def spec_of(handler: Handler) -> ToolSpec:
    """The tool a handler was registered as; `LookupError` when it never was."""
    spec = _SPECS.get(handler)
    if spec is None:
        name = getattr(handler, "__name__", repr(handler))
        raise LookupError(f"{name!r} is not a registered tool")
    return spec


class ToolRegistry:
    def __init__(self) -> None:
        self._specs: dict[str, ToolSpec] = {}

    def register(self, spec: ToolSpec) -> ToolSpec:
        if spec.name in self._specs:
            raise ValueError(f"tool {spec.name!r} is already registered")
        if spec.button_only and spec.tier != Tier.ADMIN:
            raise ValueError(f"button-only tool {spec.name!r} must be admin tier")
        self._specs[spec.name] = spec
        _SPECS[spec.handler] = spec
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
        *,
        tier: Tier = Tier.FRIEND,
        destructive: bool = False,
        host_param: str | None = None,
        button_only: bool = False,
        held_in_maintenance: bool = False,
    ) -> Callable[[Handler], Handler]:
        def decorate(fn: Handler) -> Handler:
            self.register(
                ToolSpec(
                    name=name,
                    description=description,
                    handler=fn,
                    tier=tier,
                    destructive=destructive,
                    host_param=host_param,
                    button_only=button_only,
                    held_in_maintenance=held_in_maintenance,
                )
            )
            return fn

        return decorate


# The process-wide registry that tool modules decorate into. Tests build
# their own `ToolRegistry()` so they never see the app's tools.
registry = ToolRegistry()
tool = registry.tool
