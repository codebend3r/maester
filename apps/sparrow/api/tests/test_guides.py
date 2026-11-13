import pytest

from sparrow.agent.tools import Tier, registry
from sparrow.chat.service import UNLINKED_HELP
from sparrow.guides import DEVICES, GUIDES_DIR, guide
from sparrow.tools.guides import setup_guide


@pytest.mark.parametrize("device", sorted(DEVICES))
def test_every_device_has_a_guide_ending_with_what_every_device_shares(device):
    text = guide(device)
    assert text.startswith("# ") and "sign in" in text.lower()
    assert text.endswith("I'll look at the stream.")
    assert "**Relay.**" in text and "**Quality.**" in text


def test_every_guide_file_is_offered():
    files = {p.stem for p in GUIDES_DIR.glob("*.md")} - {"streaming"}
    assert files == set(DEVICES.values())


async def test_the_model_gets_the_guide_to_answer_from(ctx):
    out = await setup_guide(ctx, "roku")
    assert out["device"] == "roku" and out["guide"] == guide("roku")
    assert "not from memory" in registry.get("setup_guide").description
    assert registry.get("setup_guide").tier == Tier.FRIEND


def test_newcomers_are_pointed_at_the_guides():
    assert "setup guide" in UNLINKED_HELP
