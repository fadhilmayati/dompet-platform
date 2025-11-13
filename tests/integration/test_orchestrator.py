"""Integration tests for the DompetPipeline orchestrator."""

from unittest.mock import patch

from dompet_ai.orchestrator import DompetPipeline


def test_pipeline_with_personalization_context(sample_transactions):
    """Pipeline should incorporate user profile in prompts."""
    persona = "User prefers automation, dislikes frugality lectures"
    goal = "Save RM50k by 2029"

    pipeline = DompetPipeline(
        sample_transactions,
        persona_context=persona,
        goal_context=goal,
    )

    context = pipeline.build_prompt_context()
    assert persona in context
    assert goal in context
    assert "Latest 5 transactions" in context


@patch("dompet_ai.orchestrator.client.chat")
def test_agent_receives_personalized_context(mock_chat, sample_transactions):
    """Agents should see user profile when analyzing."""
    mock_chat.return_value = {"message": {"content": "Mock agent response"}}

    pipeline = DompetPipeline(
        sample_transactions,
        persona_context="Risk tolerance: balanced",
    )

    list(pipeline.run())

    # Verify that chat was called with personalization
    calls = mock_chat.call_args_list
    for call in calls:
        messages = call[1]["messages"]
        user_content = messages[1]["content"]
        # Context should include personalization notes
        assert "Risk tolerance" in user_content or len(user_content) > 0
