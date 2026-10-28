"""The features, each of which gets its own GitHub Project, and which pull requests belong to each.

A pull request joins the feature its body names on a `Feature: <name>` line, else the first
feature one of whose branch prefixes its head branch starts with. A pull request matching
neither is a feature of its own, named after its title. Stacked branches don't decide it: the
Windows stack sits on top of the splash page, which sits on top of a review branch.

`stories` are draft items for work that has no pull request yet, such as a spike on a local
branch. A draft is added once, by title, and left alone after that.
"""

FEATURES = [
    {
        "name": "Windows desktop app",
        "summary": "Raven's desktop app on Windows: libmpv, the addon's Windows surface, the window.",
        "branches": ("raven-windows-",),
        "stories": [],
    },
    {
        "name": "Audio library support",
        "summary": "Music libraries in raven and a standalone music player.",
        "branches": ("audio-library-",),
        "stories": [],
    },
    {
        "name": "Credit detection",
        "summary": "Find a title's intro and end credits so the player can skip them.",
        "branches": ("credit-detection-",),
        "stories": [
            {
                "title": "Spike credit detection",
                "body": "Try ways to find intro and credit ranges in a file, on `credit-detection-spike`.",
                "status": "In Progress",
            },
        ],
    },
    {
        "name": "Raven device app",
        "summary": "Raven on iPhone, iPad, Apple TV and Android TV, and the HLS it plays.",
        "branches": ("device-",),
        "stories": [],
    },
    {
        "name": "Whole-repo thermo review",
        "summary": "The second whole-repo review, as stacked `thermo-*` PRs.",
        "branches": ("thermo-",),
        "stories": [],
    },
    {
        "name": "Raven splash page",
        "summary": "Raven's splash page on maester.netlify.app.",
        "branches": ("raven-splash",),
        "stories": [],
    },
    {
        "name": "Raven desktop player",
        "summary": "The player and the desktop app around it: controls, sound, frames, offline downloads.",
        "branches": (
            "player-",
            "desktop-app-",
            "fix-player-",
            "raven-audio-seek-",
        ),
        "stories": [],
    },
    {
        "name": "Raven web library",
        "summary": "Browsing a library on the web: listings, pictures, heroes, ordering, duplicates.",
        "branches": (
            "warm-library-",
            "reorder-libraries-",
            "showcase-web",
            "raven-image-loading",
            "delete-duplicate-",
        ),
        "stories": [],
    },
    {
        "name": "Workspace tooling",
        "summary": "CI, test output, lint rules and developer tools across the workspace.",
        "branches": (
            "ci-",
            "unit-test-",
            "typescript-rules",
            "raven-zustand-devtools",
            "feature-projects",
        ),
        "stories": [],
    },
]
