"""Which of an arr's titles a pick names: a saved custom filter read the way the UI reads it,
and a title or path to match.

Every rule of a filter must hold, each checked against the title's record
(its `statistics` included, for Sonarr's and Lidarr's sizes). A rule this
can't read (a date window, a field the record lacks) is refused
(`UnreadableRule`), never guessed.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from sparrow.clients.arr_library import ArrTitle, CustomFilter

# A saved filter's rule, `{key, value, type}`, and a title's record, as the arr's API gives them.
Rule = dict[str, Any]
Record = dict[str, Any]


class UnreadableRule(ValueError):
    """A custom filter rule this can't apply the way the arr's UI would."""


def _view(record: Record) -> Record:
    return {**(record.get("statistics") or {}), **record}


def _number(value: Any, rule: Rule) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        raise UnreadableRule(f"{rule} compares {value!r} as a number") from None


def text_of(value: Any) -> str:
    return str(value).lower()


def _same(actual: Any, wanted: Any) -> bool:
    if isinstance(actual, bool):
        return actual == (wanted is True or text_of(wanted) == "true")
    if isinstance(actual, int | float) and not isinstance(wanted, bool):
        try:
            return float(actual) == float(wanted)
        except (TypeError, ValueError):
            return False
    return text_of(actual) == text_of(wanted)


# How each kind of rule compares a record's value (`a`) with the rule's (`v`).
Test = Callable[[Any, Any, Rule], bool]
TESTS: dict[str, Test] = {
    "equal": lambda a, v, rule: _same(a, v),
    "contains": lambda a, v, rule: text_of(v) in text_of(a),
    "startsWith": lambda a, v, rule: text_of(a).startswith(text_of(v)),
    "endsWith": lambda a, v, rule: text_of(a).endswith(text_of(v)),
    "lessThan": lambda a, v, rule: _number(a, rule) < _number(v, rule),
    "lessThanOrEqual": lambda a, v, rule: _number(a, rule) <= _number(v, rule),
    "greaterThan": lambda a, v, rule: _number(a, rule) > _number(v, rule),
    "greaterThanOrEqual": lambda a, v, rule: _number(a, rule) >= _number(v, rule),
}


NEGATED = {
    "notEqual": "equal",
    "notContains": "contains",
    "notStartsWith": "startsWith",
    "notEndsWith": "endsWith",
}


def holds(rule: Rule, record: Record) -> bool:
    """Whether a title's record passes one rule: any of the rule's values matching any of
    the field's (a list field such as tags has several), or none, for a negated rule."""
    view = _view(record)
    key = rule.get("key") or ""
    if key not in view:
        raise UnreadableRule(f"{rule} reads {key!r}, which these records don't have")
    actual = view[key]
    values = rule.get("value")
    kind = rule.get("type") or ""
    test = TESTS.get(NEGATED.get(kind, kind))
    if test is None:
        raise UnreadableRule(f"{rule} is a {kind!r} rule, which sparrow can't apply")
    hit = any(
        test(a, v, rule)
        for a in (actual if isinstance(actual, list) else [actual])
        for v in (values if isinstance(values, list) else [values])
    )
    return not hit if kind in NEGATED else hit


def rule_text(rule: Rule) -> str:
    """A rule as the admin would say it: "path contains /Meleys/Movies/Requests/"."""
    values = rule.get("value")
    shown = ", ".join(map(str, values)) if isinstance(values, list) else str(values)
    return f"{rule.get('key')} {rule.get('type')} {shown}"


@dataclass(frozen=True)
class Pick:
    """Which titles: every one of these that is set must hold."""

    custom_filter: str = ""
    title: str = ""
    path: str = ""

    def chosen(self, titles: list[ArrTitle], filters: tuple[CustomFilter, ...]) -> list[ArrTitle]:
        """The titles picked; `LookupError` for a filter the arr hasn't, `UnreadableRule` for
        one that can't be applied."""
        rules: tuple[Rule, ...] = ()
        if self.custom_filter:
            saved = next(
                (f for f in filters if text_of(f.label) == text_of(self.custom_filter.strip())),
                None,
            )
            if saved is None:
                raise LookupError(
                    f"no custom filter called {self.custom_filter!r}; the saved ones are "
                    + ", ".join(f.label for f in filters)
                )
            rules = saved.rules
        return [
            t
            for t in titles
            if all(holds(rule, t.raw) for rule in rules)
            and text_of(self.title.strip()) in text_of(t.title)
            and text_of(self.path.strip()) in text_of(t.path)
        ]
