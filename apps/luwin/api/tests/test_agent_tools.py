import pytest

from luwin.agent.tools import Tier, ToolRegistry, ValidationError, validate_input

SCHEMA = {
    "type": "object",
    "properties": {
        "query": {"type": "string"},
        "limit": {"type": "integer"},
        "kind": {"type": "string", "enum": ["movie", "tv"]},
    },
    "required": ["query"],
}


def test_tier_parse():
    assert Tier.parse("admin") == Tier.ADMIN
    assert Tier.parse(None, Tier.FRIEND) == Tier.FRIEND
    with pytest.raises(ValueError):
        Tier.parse("king")


def test_validate_input_accepts_and_rejects():
    assert validate_input(SCHEMA, {"query": "dune", "limit": 3}) == {"query": "dune", "limit": 3}
    for bad, msg in [
        ({}, "missing required"),
        ({"query": 1}, "should be string"),
        ({"query": "x", "limit": True}, "should be integer"),
        ({"query": "x", "kind": "book"}, "one of"),
        ({"query": "x", "extra": 1}, "unexpected"),
        ("nope", "not an object"),
    ]:
        with pytest.raises(ValidationError, match=msg):
            validate_input(SCHEMA, bad)


def test_registry_filters_by_tier_and_marks_cache_breakpoint():
    reg = ToolRegistry()

    @reg.tool("search", "find things", SCHEMA)
    async def search(ctx, **kw):
        return kw

    @reg.tool("replace", "destroy things", SCHEMA, tier=Tier.TRUSTED, destructive=True)
    async def replace(ctx, **kw):
        return kw

    @reg.tool("kill", "admin only", SCHEMA, tier=Tier.ADMIN)
    async def kill(ctx, **kw):
        return kw

    assert [s.name for s in reg.for_tier(Tier.FRIEND)] == ["search"]
    assert [s.name for s in reg.for_tier(Tier.TRUSTED)] == ["replace", "search"]
    assert [s.name for s in reg.for_tier(Tier.ADMIN)] == ["kill", "replace", "search"]
    assert reg.definitions(Tier.UNLINKED) == []
    defs = reg.definitions(Tier.TRUSTED)
    assert all(d["eager_input_streaming"] for d in defs)
    assert "cache_control" in defs[-1] and "cache_control" not in defs[0]
    with pytest.raises(ValueError, match="already registered"):
        reg.tool("search", "dup", SCHEMA)(search)
