import sys
from pathlib import Path

# The scripts import each other as top-level modules, as they do when run from `scripts/`.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
