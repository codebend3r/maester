import pytest

from maester.agent.tools import Tier, registry
from maester.chat.identity import IdentityService, RoleMap
from maester.chat.service import UNLINKED_HELP, ChatService
from maester.guides import DEVICES, GUIDES_DIR, guide
from maester.tools.guides import setup_guide


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


def test_anyone_can_read_a_guide_and_newcomers_are_pointed_at_it(services, store):
    chat = ChatService(
        agent=None, identity=IdentityService(store, services, RoleMap()), store=store
    )
    chunks = chat.setup_guide("apple_tv")
    assert "".join(chunks).startswith("# Apple TV") and all(len(c) <= 2000 for c in chunks)
    assert "`/setup`" in UNLINKED_HELP
