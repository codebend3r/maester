from luwin.chat.split import split_reply


def test_short_text_is_one_chunk():
    assert split_reply("  hi  ") == ["hi"]
    assert split_reply("") == []


def test_splits_on_paragraphs_first():
    a, b = "A" * 1500, "B" * 1500
    assert split_reply(f"{a}\n\n{b}") == [a, b]


def test_falls_back_to_lines_then_words():
    lines = "\n".join(["x" * 900] * 3)
    chunks = split_reply(lines)
    assert all(len(c) <= 2000 for c in chunks) and "".join(chunks).count("x") == 2700
    words = " ".join(["word"] * 800)
    chunks = split_reply(words)
    assert all(len(c) <= 2000 and not c.startswith(" ") for c in chunks)
    assert " ".join(chunks) == words


def test_hard_cut_when_no_boundary():
    blob = "z" * 4500
    assert [len(c) for c in split_reply(blob)] == [2000, 2000, 500]
