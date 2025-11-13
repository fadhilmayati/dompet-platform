"""Unit tests covering agent prompt formatting and metadata."""

from dompet_ai.agents import AGENTS


def test_all_agents_have_unique_names():
    """Registry entries should expose distinct agent names."""
    names = [agent.name for agent in AGENTS.values()]
    assert len(names) == len(set(names))


def test_system_prompts_are_stripped():
    """Prompts should not contain leading or trailing whitespace."""
    for agent in AGENTS.values():
        assert agent.system_prompt == agent.system_prompt.strip()


def test_prompts_reference_dompet_ai():
    """Every agent prompt should introduce the Dompet AI persona."""
    for agent in AGENTS.values():
        assert "Dompet AI" in agent.system_prompt.splitlines()[0]
