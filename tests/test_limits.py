import pytest

from maester.agent.limits import KillSwitch, LimitExceeded, RateLimiter


def test_message_window_slides():
    clock = [0.0]
    lim = RateLimiter(messages_per_hour=2, tokens_per_day=10, clock=lambda: clock[0])
    lim.check_message("u")
    lim.check_message("u")
    with pytest.raises(LimitExceeded):
        lim.check_message("u")
    lim.check_message("other")  # per user
    clock[0] = 3601
    lim.check_message("u")


def test_token_budget_resets_each_day():
    clock = [86400.0 * 10 + 100]
    lim = RateLimiter(messages_per_hour=99, tokens_per_day=10, clock=lambda: clock[0])
    assert lim.add_tokens("u", 10) == 10
    with pytest.raises(LimitExceeded):
        lim.check_tokens("u")
    clock[0] += 86400
    lim.check_tokens("u")
    assert lim.add_tokens("u", 1) == 1


def test_kill_switch():
    k = KillSwitch()
    assert not k.enabled
    k.on("disk swap")
    assert k.enabled and k.reason == "disk swap"
    k.off()
    assert not k.enabled and k.reason == ""
