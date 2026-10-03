from luwin.agent.prompts import SYSTEM_PROMPT


def test_the_prompt_reads_reports_from_what_friends_say_not_from_reactions():
    # Nothing reads reactions to a message any more, so the model mustn't wait for one.
    assert "thumbs" not in SYSTEM_PROMPT.lower()
