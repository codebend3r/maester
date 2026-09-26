"""Process entrypoint. `uv run maester` lands here."""

import sys

from maester import __version__


def main(argv: list[str] | None = None) -> int:
    args = sys.argv[1:] if argv is None else argv
    if "--version" in args:
        print(f"maester {__version__}")
        return 0
    from maester.app import run

    return run()


if __name__ == "__main__":
    raise SystemExit(main())
