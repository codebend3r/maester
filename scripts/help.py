"""Print every root `package.json` script, grouped, with what each one does.

    bun run help                 grouped and coloured
    bun run help -- --plain      no colour, as when piped or with NO_COLOR set
    bun run help -- --markdown   docs/commands.md, which this writes: never edit it by hand

`GROUPS` is the one place a script is described. `tests/test_help.py` fails when the root
`package.json` gains a script this file does not describe, or loses one it still does, and
when `docs/commands.md` is not what `--markdown` writes, so neither drifts from what `bun run`
can actually run.
"""

import argparse
import json
import os
import shutil
import sys
import textwrap
import unicodedata
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


@dataclass(frozen=True)
class Command:
    name: str
    summary: str
    # What the command needs beyond the core tools, shown as a tag: "macOS", "Docker", ...
    needs: str = ""


@dataclass(frozen=True)
class Group:
    title: str
    blurb: str
    colour: str
    commands: tuple[Command, ...]


# ANSI SGR codes: a group's colour paints its heading and its commands' names.
COLOURS = {
    "green": "32",
    "yellow": "33",
    "blue": "34",
    "magenta": "35",
    "cyan": "36",
    "red": "31",
    "bright_blue": "94",
    "bright_magenta": "95",
}

GROUPS: tuple[Group, ...] = (
    Group(
        "Everyday checks",
        "What to run before a push; the pre-push hook runs the same checks.",
        "green",
        (
            Command(
                "verify",
                "Every check at once: spelling, TypeScript only, one command per script, dead "
                "code and CSS, lint, format, typecheck, unit and screen tests, and every build.",
            ),
            Command("verify:uncached", "verify, ignoring Nx's cache, after a toolchain change."),
            Command(
                "affected",
                "The repo-wide checks, then lint, format, typecheck, tests and builds only for "
                "the projects your branch changed.",
            ),
            Command(
                "affected:tasks", "The per-project half of affected, without the repo-wide checks."
            ),
            Command("build", "Builds every project."),
            Command("test", "Every project's unit tests."),
            Command("test:screens", "The device app's render tests under jest-expo."),
            Command("typecheck", "Typechecks every TypeScript project."),
        ),
    ),
    Group(
        "Lint and format",
        "Style and static checks across Python, TypeScript and SCSS.",
        "cyan",
        (
            Command("lint", "Lints Python (ruff), TypeScript (oxlint) and SCSS (gale)."),
            Command("lint:py", "Lints the Python with sparrow's pinned ruff."),
            Command("lint:ts", "Lints the TypeScript with oxlint."),
            Command("lint:css", "Lints the SCSS with gale."),
            Command("lint:fix", "Fixes what the three linters can fix on their own."),
            Command("format", "Formats every project (oxfmt, ruff format)."),
            Command("format:check", "Fails on any file the formatters would change."),
            Command(
                "lint-staged",
                "Lints and formats only the staged files, as the pre-commit hook does.",
            ),
        ),
    ),
    Group(
        "Repo rules",
        "Workspace-wide checks for rules no linter covers.",
        "yellow",
        (
            Command("spellcheck", "Spellchecks the repo with typos."),
            Command("typescript-only", "Fails on any .js, .jsx, .mjs or .cjs file."),
            Command(
                "one-command-per-script", "Fails on a package.json script chained with &&, || or ;."
            ),
            Command("comment-style", "Fails on stacked // comment lines in TypeScript or SCSS."),
            Command("dead-code", "Finds unused exports, files and dependencies with knip."),
            Command("dead-css", "Finds SCSS module classes no component reads."),
            Command(
                "claude-audit",
                "Has Claude Code read your unpushed commits against the CLAUDE.md files for the "
                "rules no linter checks.",
                "Claude Code",
            ),
            Command("graph", "Opens Nx's interactive project graph in the browser."),
        ),
    ),
    Group(
        "Dev servers",
        "Run a product locally; each reads the .env beside its compose file.",
        "magenta",
        (
            Command("dev:raven", "raven's server, shared UI and web app, with hot reload."),
            Command(
                "dev:raven:prod",
                "raven's web app and UI against the live server on Vhagar, with no local server.",
            ),
            Command(
                "dev:raven:vhagar",
                "raven's web app and UI against Vhagar over the home network, playing straight "
                "from it. The fastest way to load and play at home.",
                "Vhagar",
            ),
            Command(
                "dev:raven:db",
                "Replaces the local raven database with a copy of Vhagar's, paths rewritten to "
                "this Mac's mounts. Stop the dev server first.",
                "Vhagar",
            ),
            Command(
                "dev:raven:splash", "raven's splash page (maester.netlify.app) with hot reload."
            ),
            Command("web:build", "Builds raven's web app, as Netlify and the desktop app ship it."),
            Command("build:raven:splash", "Builds raven's splash page."),
            Command("preview:raven:splash", "Serves the built splash page, as Netlify would."),
            Command("dev:sparrow", "sparrow's API and chat page."),
            Command("sandbox:sparrow", "sparrow's sandbox for testing its answers."),
            Command("dev:rookery", "rookery's sign-in server and its login pages."),
        ),
    ),
    Group(
        "raven device app",
        "Expo on react-native-tvos: iPhone, iPad, Apple TV and Android TV.",
        "blue",
        (
            Command("app:start", "Starts Metro for a dev client.", "watchman"),
            Command("app:server", "raven's dev server, for the app to talk to."),
            Command(
                "app:dev:ios", "A Debug build on the iPhone simulator, against Metro.", "Xcode"
            ),
            Command("app:dev:ipad", "A Debug build on the iPad simulator, against Metro.", "Xcode"),
            Command(
                "app:dev:tvos", "A Debug build on the Apple TV simulator, against Metro.", "Xcode"
            ),
            Command(
                "app:prebuild:ios",
                "Generates the iPhone and iPad native project and its pods.",
                "Xcode",
            ),
            Command(
                "app:prebuild:tvos", "Generates the Apple TV native project and its pods.", "Xcode"
            ),
            Command(
                "app:prebuild:android-tv", "Generates the Android TV native project.", "Android SDK"
            ),
            Command("app:build:ios", "A Release build for the iPhone simulator.", "Xcode"),
            Command("app:build:tvos", "A Release build for the Apple TV simulator.", "Xcode"),
            Command(
                "app:build:android-tv",
                "A Release APK for Android TV, to install on the emulator or a TV.",
                "Android SDK",
            ),
            Command(
                "app:deploy:tvos",
                "Builds the signed Release and puts it on the paired Apple TV.",
                "Xcode",
            ),
            Command(
                "app:deploy:android-tv",
                "Builds the Release APK and puts it on the Android TV over adb, found over mDNS.",
                "Android SDK",
            ),
            Command(
                "app:deploy:tvs",
                "Puts the checked-out app on the Android TV, then on the Apple TV.",
                "Xcode",
            ),
            Command(
                "app:e2e",
                "The Maestro flows on the iPhone simulator, against the fixture server.",
                "Maestro",
            ),
            Command(
                "app:e2e:tvos",
                "The Siri Remote XCUITest on the Apple TV simulator.",
                "Xcode",
            ),
            Command(
                "app:e2e:android-tv",
                "The Maestro flows on the Android TV emulator, driven by the remote.",
                "emulator",
            ),
        ),
    ),
    Group(
        "Raven desktop",
        "The Electron app on macOS and Windows, with libmpv.",
        "bright_magenta",
        (
            Command("desktop:dev", "Raven in Electron with the web app's dev build.", "macOS"),
            Command("desktop:build", "Builds Raven's main process, preload and web app."),
            Command("desktop:test:native", "The libmpv player's native tests.", "macOS"),
            Command(
                "desktop:e2e", "Playwright drives the real pages against a fixture server.", "macOS"
            ),
            Command(
                "desktop:make",
                "Packages Raven: the dmg and zip, or Squirrel's installer on Windows.",
            ),
            Command(
                "desktop:audit:bundle", "Checks the packaged engine's binaries and their imports."
            ),
            Command(
                "desktop:smoke:packaged",
                "Launches the packaged app and checks it starts and quits. Uses your own "
                "~/Library/Application Support/raven.",
                "macOS",
            ),
            Command("desktop:release:assets", "Names and gathers the release's files for upload."),
            Command(
                "mpv:native",
                "Builds the pinned libmpv and the addon, then runs its audit and native tests.",
                "macOS + Xcode",
            ),
            Command(
                "mpv:native:windows",
                "The Windows addon's audit and native tests against the pinned libmpv DLL.",
                "Windows",
            ),
        ),
    ),
    Group(
        "Pull request checks, locally",
        "Each runs one CI job from pull-request-checks.yml on this machine.",
        "red",
        (
            Command("ci:docker", "The ✅ Checks job inside an Ubuntu 24.04 container.", "Docker"),
            Command(
                "ci:app:ios",
                "The 📱 App on iPhone and iPad job: every ci:app:ios step below, in order.",
                "macOS + Xcode",
            ),
            Command(
                "ci:app:ios:tools",
                "Its tools: Homebrew's, Maestro and the iOS simulator runtime.",
                "macOS + Xcode",
            ),
            Command(
                "ci:app:ios:simulator",
                "Boots the raven-phone iPhone simulator, making it when there is none.",
                "macOS + Xcode",
            ),
            Command(
                "ci:app:ios:build",
                "The fixture's Release build for the iPhone simulator.",
                "macOS + Xcode",
            ),
            Command("ci:app:ios:pods", "Checks the build's pod install finished.", "macOS + Xcode"),
            Command(
                "ci:app:ios:install", "Installs the build on the iPhone simulator.", "macOS + Xcode"
            ),
            Command(
                "ci:app:ios:e2e",
                "The touch Maestro flows on the iPhone simulator.",
                "macOS + Xcode",
            ),
            Command("ci:app:tvos", "The 📺 App on Apple TV job.", "macOS + Xcode"),
            Command(
                "ci:app:tvos:build",
                "The Apple TV job's Release build for the simulator, with a brief log.",
                "macOS + Xcode",
            ),
            Command(
                "ci:app:android-tv",
                "The 📺 App on Android TV job: every ci:app:android-tv step below, in order.",
                "Android SDK",
            ),
            Command(
                "ci:app:android-tv:tools",
                "Its tools: Android Studio, the SDK, the TV system image and Maestro.",
                "Android SDK",
            ),
            Command(
                "ci:app:android-tv:emulator",
                "Starts the raven_tv emulator, making it when there is none.",
                "Android SDK",
            ),
            Command(
                "ci:app:android-tv:build",
                "The fixture's Release APK for the emulator.",
                "Android SDK",
            ),
            Command(
                "ci:app:android-tv:emulator:wait",
                "Waits for the emulator to boot and turns its animations off.",
                "Android SDK",
            ),
            Command(
                "ci:app:android-tv:install", "Installs the APK on the emulator.", "Android SDK"
            ),
            Command(
                "ci:app:android-tv:e2e",
                "The remote's Maestro flows on the emulator.",
                "Android SDK",
            ),
            Command("ci:app:install", "The device app jobs' bun install."),
            Command(
                "ci:app:libraries",
                "Builds the libraries the fixture server and the device app read.",
            ),
            Command(
                "ci:app:fixture",
                "The device app jobs' fixture server on :8490, in the foreground.",
                "ffmpeg",
            ),
            Command(
                "ci:app:fixture:wait", "Waits up to three minutes for the fixture server to answer."
            ),
            Command("ci:wren", "The 🎵 Wren on iPhone job.", "macOS + Xcode"),
            Command("ci:desktop:e2e", "The 🎬 Desktop end to end job.", "macOS"),
            Command(
                "web:e2e",
                "The 🌐 Web end to end job: Playwright drives the web app against a fixture server.",
                "Chrome + ffmpeg",
            ),
        ),
    ),
    Group(
        "Help",
        "This list.",
        "bright_blue",
        (Command("help", "Lists every command, grouped, with what it does."),),
    ),
)


def described() -> list[str]:
    """Every script name the groups describe, in the order they are listed."""
    return [command.name for group in GROUPS for command in group.commands]


def root_scripts() -> list[str]:
    """The root package.json's script names."""
    return list(json.loads((ROOT / "package.json").read_text())["scripts"])


@dataclass(frozen=True)
class Style:
    """Wraps text in ANSI codes, or leaves it alone when colour is off."""

    on: bool

    def __call__(self, text: str, *codes: str) -> str:
        return f"\x1b[{';'.join(codes)}m{text}\x1b[0m" if self.on and codes else text


BOLD = "1"
DIM = "2"
# A requirement tag's colour, the same in every group.
TAG = COLOURS["yellow"]
NBSP = chr(0xA0)  # a no-break space, written out so it cannot pass for a space


def render(*, colour: bool, width: int) -> str:
    style = Style(colour)
    name_width = max(len(name) for name in described())
    # The summary column starts after "  bun run <name>  ".
    indent = 2 + len("bun run ") + name_width + 2
    summary_width = max(width - indent, 30)
    intro = (
        "Run any of them from the repo root with bun run <command>. "
        "A tag in brackets names what a command needs beyond the core tools."
    )
    lines = [
        style("maester commands", BOLD),
        *(style(line, DIM) for line in textwrap.wrap(intro, width)),
        "",
    ]
    for group in GROUPS:
        tint = COLOURS[group.colour]
        lines.append(style(f"▌ {group.title}", BOLD, tint))
        lines.extend(style(f"  {line}", DIM) for line in textwrap.wrap(group.blurb, width - 2))
        for command in group.commands:
            # The tag's spaces are held together while wrapping, so it never splits over two lines.
            tag = f"[{command.needs.replace(' ', NBSP)}]" if command.needs else ""
            text = f"{command.summary} {tag}" if tag else command.summary
            first, *rest = [
                line.replace(tag, style(tag, TAG)).replace(NBSP, " ") if tag else line
                for line in textwrap.wrap(text, summary_width)
            ]
            name = style("bun run ", DIM) + style(command.name.ljust(name_width), BOLD, tint)
            lines.append(f"  {name}  {first}")
            lines.extend(" " * indent + line for line in rest)
        lines.append("")
    return "\n".join(lines)


def cell_width(text: str) -> int:
    """How many columns text takes in a monospaced table: an emoji or other wide character takes two."""
    return sum(2 if unicodedata.east_asian_width(char) in "WF" else 1 for char in text)


def markdown_table(rows: list[tuple[str, ...]]) -> list[str]:
    """A table padded as oxfmt pads one, so the written file passes the format check."""
    widths = [max(cell_width(row[i]) for row in rows) for i in range(len(rows[0]))]

    def line(cells: tuple[str, ...]) -> str:
        padded = (
            cell + " " * (width - cell_width(cell))
            for cell, width in zip(cells, widths, strict=True)
        )
        return f"| {' | '.join(padded)} |"

    rule = tuple("-" * width for width in widths)
    return [line(rows[0]), line(rule), *(line(row) for row in rows[1:])]


def render_markdown() -> str:
    """docs/commands.md: every group as a table of its commands."""
    lines = [
        "<!-- Written by scripts/help.py --markdown from its GROUPS; edit them, never this file. -->",
        "",
        "# Commands",
        "",
        "Every script in the root `package.json`, grouped. Run any of them from the repo root with "
        "`bun run <command>`; `bun run help` prints the same list in the terminal, and "
        "[Pull request checks, locally](ci-commands.md) explains the `ci:*` commands. The Needs "
        "column names what a command needs beyond Bun, uv and ffmpeg.",
    ]
    for group in GROUPS:
        rows = [("Command", "What it does", "Needs")]
        rows.extend(
            (f"`{command.name}`", command.summary.replace("|", "\\|"), command.needs)
            for command in group.commands
        )
        lines.extend(["", f"## {group.title}", "", group.blurb, "", *markdown_table(rows)])
    return "\n".join(lines) + "\n"


def wants_colour(*, plain: bool) -> bool:
    """Colour only on a terminal, and never with --plain or NO_COLOR (no-color.org)."""
    if plain or "NO_COLOR" in os.environ:
        return False
    return "FORCE_COLOR" in os.environ or sys.stdout.isatty()


def main() -> None:
    parser = argparse.ArgumentParser(description="List every root command with what it does.")
    parser.add_argument("--plain", action="store_true", help="print without colour")
    parser.add_argument("--markdown", action="store_true", help="print docs/commands.md")
    args = parser.parse_args()
    if args.markdown:
        sys.stdout.write(render_markdown())
        return
    width = shutil.get_terminal_size(fallback=(100, 24)).columns
    print(render(colour=wants_colour(plain=args.plain), width=min(width, 120)))


if __name__ == "__main__":
    main()
