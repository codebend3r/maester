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
from collections.abc import Awaitable, Callable, Sequence
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Annotated, Any

import pydantic
from pydantic import BaseModel, ConfigDict, JsonValue, Strict

from sparrow.config import Settings
from sparrow.memo import Memo
from sparrow.notify import Notice
from sparrow.store import LinkedUser, NotLinked, Store

if TYPE_CHECKING:
    from sparrow.clients import Services


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


# The tiers an admin (or the sandbox) can give someone, by their lowercase names.
AssignableTier = enum.StrEnum(
    "AssignableTier", {t.name: t.name.lower() for t in Tier if t > Tier.UNLINKED}
)


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
        link = self.store.active_link(self.user_id)
        if link is None:
            raise NotLinked(f"User {self.user_id} isn't linked to a Plex account")
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
    # A line under the title: availability, a short overview.
    detail: str = ""

    @property
    def display(self) -> str:
        if self.year and str(self.year) not in self.label:
            return f"{self.label} ({self.year})"
        return self.label


@dataclass(frozen=True)
class TitleLink:
    label: str
    url: str


@dataclass(frozen=True)
class Title:
    """A title a tool found, for the chat to show beside the reply, and where it opens.

    `key` names the title across calls, so one found twice is shown once.
    """

    key: str
    title: str
    year: int | None
    links: tuple[TitleLink, ...]


@dataclass(frozen=True)
class Ok:
    """The tool did it: the model sees `content`; `notices` are posted or DMed, `titles` are
    shown with the reply, and `choices` are offered as buttons (`offer` builds those)."""

    content: Any
    notices: tuple[Notice, ...] = ()
    titles: tuple[Title, ...] = ()
    choices: tuple[Choice, ...] = ()


def offer(items: Sequence[Choice], notes: Sequence[str] = ()) -> Ok:
    """Offer the user a pick instead of a plain result.

    At most `MAX_CHOICES` become buttons; the model is told which were left
    off, so it never promises a button that isn't there. `notes` tell the
    model what else it should know (what couldn't be looked up).
    """
    shown = tuple(items[:MAX_CHOICES])
    left_off = items[MAX_CHOICES:]
    content: dict[str, Any] = {
        "choices": [
            {"label": c.label, "value": c.value, "year": c.year, "detail": c.detail} for c in shown
        ],
        "note": "Shown to the user as numbered buttons; wait for their pick.",
        **({"not_shown": [f"{c.display} ({c.value})" for c in left_off]} if left_off else {}),
        **({"notes": list(notes)} if notes else {}),
    }
    return Ok(content, choices=shown)


@dataclass(frozen=True)
class Refused:
    """The tool won't do it, and says why (a quota, the wrong host, nothing left to request).

    Every refusal is one of these, never an exception or a success that says no. The model
    sees an error, the audit row is not ok, and it is final: a press that ended this way
    isn't offered again.
    """

    content: str
    notices: tuple[Notice, ...] = ()


@dataclass(frozen=True)
class Failed:
    """A step the tool took failed, and it says which. Final unless `retryable` (a service
    that didn't answer): only then is a button press that ended this way offered again."""

    content: Any
    notices: tuple[Notice, ...] = ()
    retryable: bool = False


# What a handler returns besides a plain JSON answer: exactly one of these, so a result
# can't both succeed and fail, or be retried without having failed.
Result = Ok | Refused | Failed
# A handler's answer: a `Result`, or plain JSON the model reads as it is.
Answer = Result | JsonValue


Handler = Callable[..., Awaitable[Answer]]


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
    # Built from the handler's signature: the check every call goes through, and the
    # schema the model sees.
    args_model: type[BaseModel] = field(init=False, repr=False, compare=False)
    input_schema: dict[str, Any] = field(init=False, repr=False, compare=False)

    def __post_init__(self) -> None:
        model = model_of(self.name, self.handler)
        object.__setattr__(self, "args_model", model)
        object.__setattr__(self, "input_schema", schema_of(model))

    def _parse(self, data: object) -> BaseModel:
        try:
            return self.args_model.model_validate(data)
        except pydantic.ValidationError as exc:
            raise ValidationError(_explain(exc)) from None

    def validate(self, data: object) -> dict[str, Any]:
        """`data` as stored and audited, once it fits the handler's signature."""
        self._parse(data)
        return dict(data) if isinstance(data, dict) else {}

    async def call(self, ctx: ToolContext, args: dict[str, Any]) -> Answer:
        """Run the handler with `args` as its signature takes them (an enum as its member)."""
        parsed = self._parse(args)
        return await self.handler(ctx, **{k: getattr(parsed, k) for k in parsed.model_fields_set})

    def definition(self) -> dict[str, Any]:
        """The tool as the Messages API wants it, streaming its input eagerly."""
        return {
            "name": self.name,
            "description": self.description,
            "input_schema": self.input_schema,
            "eager_input_streaming": True,
        }


class ToolRegistry:
    def __init__(self) -> None:
        self._specs: dict[str, ToolSpec] = {}

    def register(self, spec: ToolSpec) -> ToolSpec:
        if spec.name in self._specs:
            raise ValueError(f"tool {spec.name!r} is already registered")
        self._specs[spec.name] = spec
        return spec

    def get(self, name: str) -> ToolSpec | None:
        return self._specs.get(name)

    def names(self) -> list[str]:
        return sorted(self._specs)

    def for_tier(self, tier: Tier) -> list[ToolSpec]:
        """Tools the model may call for this tier, in a stable order so the prompt caches."""
        return [spec for spec in (self._specs[n] for n in sorted(self._specs)) if spec.tier <= tier]

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
                )
            )
            return fn

        return decorate


# The process-wide registry that tool modules decorate into. Tests build
# their own `ToolRegistry()` so they never see the app's tools.
registry = ToolRegistry()
tool = registry.tool
