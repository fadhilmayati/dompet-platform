"""Dompet AI configuration for model providers."""

from .models import ModelFactory, ModelConfig

# Default LLM provider resolved from environment variables.
llm_provider = ModelFactory.from_env()

# Example explicit configuration usage (kept for reference):
#
# config = ModelConfig(
#     provider="anthropic",
#     model_name="claude-3-5-sonnet-20241022",
#     api_key="sk-ant-...",
# )
# llm_provider = ModelFactory.create(config)
