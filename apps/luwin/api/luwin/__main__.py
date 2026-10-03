"""Process entrypoint. `uv run luwin` lands here."""

import sys

from luwin import __version__


def main(argv: list[str] | None = None) -> int:
    args = sys.argv[1:] if argv is None else argv
    if "--version" in args:
        print(f"luwin {__version__}")
        return 0
    from luwin.app import run

    return run()


if __name__ == "__main__":
    raise SystemExit(main())
