"""Split long replies into messages of at most 2000 characters, cleanly."""

from __future__ import annotations

MESSAGE_LIMIT = 2000


def split_reply(text: str, limit: int = MESSAGE_LIMIT) -> list[str]:
    """Split on paragraph, then line, then word boundaries, never mid-word if avoidable."""
    text = text.strip()
    if not text:
        return []
    if len(text) <= limit:
        return [text]
    chunks: list[str] = []
    rest = text
    while len(rest) > limit:
        cut = _best_cut(rest, limit)
        chunks.append(rest[:cut].rstrip())
        rest = rest[cut:].lstrip()
    if rest:
        chunks.append(rest)
    return chunks


def _best_cut(text: str, limit: int) -> int:
    for sep in ("\n\n", "\n", " "):
        idx = text.rfind(sep, 0, limit)
        if idx > limit // 4:
            return idx + len(sep)
    return limit
