import re

from help import COLOURS, GROUPS, described, render, root_scripts

ANSI = re.compile(r"\x1b\[[0-9;]*m")


def test_describes_every_root_script_and_nothing_else():
    assert sorted(described()) == sorted(root_scripts())


def test_describes_each_script_once():
    names = described()
    assert len(names) == len(set(names))


def test_every_command_has_a_summary_and_every_group_a_known_colour():
    assert all(command.summary.strip() for group in GROUPS for command in group.commands)
    assert all(group.colour in COLOURS for group in GROUPS)


def test_plain_output_has_no_colour_and_names_every_command():
    plain = render(colour=False, width=100)
    assert ANSI.search(plain) is None
    assert all(f"bun run {name}" in plain for name in described())
    assert all(group.title in plain for group in GROUPS)


def test_coloured_output_reads_the_same_once_its_codes_are_gone():
    assert ANSI.sub("", render(colour=True, width=100)) == render(colour=False, width=100)


def test_keeps_within_the_width_and_never_splits_a_tag():
    plain = render(colour=False, width=80)
    assert all(len(line) <= 80 for line in plain.splitlines())
    assert "[macOS + Xcode]" in plain
