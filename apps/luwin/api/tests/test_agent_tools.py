import json
from pathlib import Path
from typing import Annotated, Literal

import pytest
from pydantic import Field

import luwin.tools  # noqa: F401  (registers every tool)
from luwin.agent.tools import Tier, ToolRegistry, ToolSpec, ValidationError, registry
from luwin.media import ReportKind

SCHEMAS = Path(__file__).parent / "fixtures" / "tool_schemas.json"


async def search(
    ctx,
    query: Annotated[str, Field(description="What to find.")],
    limit: int | None = None,
    kind: Literal["movie", "tv"] | None = None,
    years: list[int] | None = None,
):
    return {"query": query}


async def report(ctx, kind: ReportKind):
    return kind


def test_tier_parse():
    assert Tier.parse("admin") == Tier.ADMIN
    assert Tier.parse(None, Tier.FRIEND) == Tier.FRIEND
    with pytest.raises(ValueError):
        Tier.parse("king")


def test_the_schema_is_the_handlers_signature():
    assert ToolSpec("search", "find things", search).input_schema == {
        "type": "object",
        "properties": {
            "query": {"type": "string", "description": "What to find."},
            "limit": {"type": "integer"},
            "kind": {"type": "string", "enum": ["movie", "tv"]},
            "years": {"type": "array", "items": {"type": "integer"}},
        },
        "required": ["query"],
        "additionalProperties": False,
    }


def test_arguments_must_fit_the_signature_exactly():
    spec = ToolSpec("search", "find things", search)
    assert spec.validate({"query": "dune", "limit": 3}) == {"query": "dune", "limit": 3}
    # Leaving out an optional argument and passing null for it are the same.
    assert spec.validate({"query": "dune", "limit": None}) == {"query": "dune", "limit": None}
    for bad, msg in [
        ({}, "missing required argument 'query'"),
        ({"query": None}, "argument 'query'"),
        ({"query": 1}, "argument 'query'"),
        ({"query": "x", "limit": True}, "argument 'limit'"),
        ({"query": "x", "limit": "3"}, "argument 'limit'"),
        ({"query": "x", "kind": "book"}, "argument 'kind'"),
        ({"query": "x", "years": [2021, "2022"]}, "argument 'years.1'"),
        ({"query": "x", "extra": 1}, "unexpected argument 'extra'"),
        ("nope", "not an object"),
    ]:
        with pytest.raises(ValidationError, match=msg):
            spec.validate(bad)


async def test_a_handler_gets_an_enum_as_its_member():
    spec = ToolSpec("report", "report it", report)
    assert spec.input_schema["properties"]["kind"]["enum"] == [k.value for k in ReportKind]
    assert await spec.call(None, spec.validate({"kind": "cam"})) is ReportKind.CAM


def test_every_tools_schema_is_pinned():
    pinned = json.loads(SCHEMAS.read_text())
    assert registry.names() == sorted(pinned)
    for name in registry.names():
        assert registry.get(name).input_schema == pinned[name], name


def test_registry_filters_by_tier_and_marks_cache_breakpoint():
    reg = ToolRegistry()
    reg.tool("search", "find things")(search)

    @reg.tool("replace", "destroy things", tier=Tier.TRUSTED, destructive=True)
    async def replace(ctx, n: int):
        return n

    @reg.tool("kill", "admin only", tier=Tier.ADMIN)
    async def kill(ctx):
        return None

    assert [s.name for s in reg.for_tier(Tier.FRIEND)] == ["search"]
    assert [s.name for s in reg.for_tier(Tier.TRUSTED)] == ["replace", "search"]
    assert [s.name for s in reg.for_tier(Tier.ADMIN)] == ["kill", "replace", "search"]
    assert reg.definitions(Tier.UNLINKED) == []
    defs = reg.definitions(Tier.TRUSTED)
    assert all(d["eager_input_streaming"] for d in defs)
    assert "cache_control" in defs[-1] and "cache_control" not in defs[0]
    with pytest.raises(ValueError, match="already registered"):
        reg.tool("search", "dup")(search)
