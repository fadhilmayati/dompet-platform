"""Model abstraction layer for Dompet AI."""

from __future__ import annotations

import os
from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import ClassVar, Dict, List, Optional, Sequence, Type


def _ensure_messages(
    system_prompt: Optional[str],
    user_message: Optional[str],
    messages: Optional[Sequence[Dict[str, str]]],
) -> List[Dict[str, str]]:
    if messages is not None:
        return [dict(message) for message in messages]

    compiled: List[Dict[str, str]] = []
    if system_prompt:
        compiled.append({"role": "system", "content": system_prompt})
    if user_message:
        compiled.append({"role": "user", "content": user_message})
    return compiled


def _extract_system_prompt(
    system_prompt: Optional[str], messages: Sequence[Dict[str, str]]
) -> str:
    if system_prompt is not None:
        return system_prompt
    for message in messages:
        if message.get("role") == "system":
            return str(message.get("content", ""))
    return ""


@dataclass
class ModelConfig:
    """Configuration for a large language model provider."""

    provider: str
    model_name: str
    api_key: Optional[str] = None
    api_endpoint: Optional[str] = None
    temperature: float = 0.7
    max_tokens: int = 1000


class LLMProvider(ABC):
    """Base interface that all Dompet AI LLM providers must implement."""

    @abstractmethod
    def chat(
        self,
        *,
        system_prompt: Optional[str] = None,
        user_message: Optional[str] = None,
        messages: Optional[Sequence[Dict[str, str]]] = None,
        temperature: float = 0.7,
        max_tokens: int = 1000,
    ) -> str:
        """Send a chat completion request and return the provider response."""

    @abstractmethod
    def health_check(self) -> bool:
        """Return ``True`` when the provider is ready for use."""


class OllamaProvider(LLMProvider):
    """Local Ollama inference provider."""

    def __init__(self, config: ModelConfig):
        self.config = config
        from ollama import Client

        self.client = Client(host=config.api_endpoint or "http://127.0.0.1:11434")

    def chat(
        self,
        *,
        system_prompt: Optional[str] = None,
        user_message: Optional[str] = None,
        messages: Optional[Sequence[Dict[str, str]]] = None,
        temperature: float = 0.7,
        max_tokens: int = 1000,
    ) -> str:
        compiled_messages = _ensure_messages(system_prompt, user_message, messages)
        try:
            response = self.client.chat(
                model=self.config.model_name,
                messages=compiled_messages,
                stream=False,
                options={"temperature": temperature, "num_predict": max_tokens},
            )
            return response.get("message", {}).get("content", "")
        except Exception as exc:  # pragma: no cover - network dependent
            raise RuntimeError(f"Ollama error: {exc}") from exc

    def health_check(self) -> bool:  # pragma: no cover - network dependent
        try:
            self.client.list()
            return True
        except Exception:
            return False


class AnthropicProvider(LLMProvider):
    """Anthropic Claude API provider."""

    def __init__(self, config: ModelConfig):
        self.config = config
        import anthropic

        self.client = anthropic.Anthropic(api_key=config.api_key)

    def chat(
        self,
        *,
        system_prompt: Optional[str] = None,
        user_message: Optional[str] = None,
        messages: Optional[Sequence[Dict[str, str]]] = None,
        temperature: float = 0.7,
        max_tokens: int = 1000,
    ) -> str:
        compiled_messages = _ensure_messages(system_prompt, user_message, messages)
        system_prompt_value = _extract_system_prompt(system_prompt, compiled_messages)
        user_messages = [
            message
            for message in compiled_messages
            if message.get("role") != "system"
        ]
        try:
            response = self.client.messages.create(
                model=self.config.model_name,
                max_tokens=max_tokens,
                temperature=temperature,
                system=system_prompt_value,
                messages=user_messages,
            )
            return response.content[0].text
        except Exception as exc:  # pragma: no cover - network dependent
            raise RuntimeError(f"Anthropic error: {exc}") from exc

    def health_check(self) -> bool:  # pragma: no cover - network dependent
        try:
            return bool(self.client)
        except Exception:
            return False


class FireworksAIProvider(LLMProvider):
    """Fireworks AI chat completion provider."""

    def __init__(self, config: ModelConfig):
        self.config = config
        import fireworks.client

        fireworks.client.api_key = config.api_key

    def chat(
        self,
        *,
        system_prompt: Optional[str] = None,
        user_message: Optional[str] = None,
        messages: Optional[Sequence[Dict[str, str]]] = None,
        temperature: float = 0.7,
        max_tokens: int = 1000,
    ) -> str:
        compiled_messages = _ensure_messages(system_prompt, user_message, messages)
        try:
            import fireworks.client

            response = fireworks.client.ChatCompletion.create(
                model=self.config.model_name,
                messages=compiled_messages,
                max_tokens=max_tokens,
                temperature=temperature,
            )
            return response.choices[0].message.content
        except Exception as exc:  # pragma: no cover - network dependent
            raise RuntimeError(f"Fireworks error: {exc}") from exc

    def health_check(self) -> bool:  # pragma: no cover - network dependent
        try:
            import fireworks.client

            return bool(fireworks.client.api_key)
        except Exception:
            return False


class OpenAIProvider(LLMProvider):
    """OpenAI chat completion provider."""

    def __init__(self, config: ModelConfig):
        self.config = config
        from openai import OpenAI

        self.client = OpenAI(api_key=config.api_key)

    def chat(
        self,
        *,
        system_prompt: Optional[str] = None,
        user_message: Optional[str] = None,
        messages: Optional[Sequence[Dict[str, str]]] = None,
        temperature: float = 0.7,
        max_tokens: int = 1000,
    ) -> str:
        compiled_messages = _ensure_messages(system_prompt, user_message, messages)
        try:
            response = self.client.chat.completions.create(
                model=self.config.model_name,
                messages=compiled_messages,
                temperature=temperature,
                max_tokens=max_tokens,
            )
            return response.choices[0].message.content
        except Exception as exc:  # pragma: no cover - network dependent
            raise RuntimeError(f"OpenAI error: {exc}") from exc

    def health_check(self) -> bool:  # pragma: no cover - network dependent
        try:
            return bool(self.client)
        except Exception:
            return False


class ModelFactory:
    """Factory responsible for instantiating LLM providers."""

    _providers: ClassVar[Dict[str, Type[LLMProvider]]] = {
        "ollama": OllamaProvider,
        "anthropic": AnthropicProvider,
        "fireworks": FireworksAIProvider,
        "openai": OpenAIProvider,
    }

    @classmethod
    def create(cls, config: ModelConfig) -> LLMProvider:
        """Instantiate the matching provider for *config*."""

        provider_class = cls._providers.get(config.provider)
        if provider_class is None:
            raise ValueError(f"Unknown provider: {config.provider}")
        return provider_class(config)

    @classmethod
    def from_env(cls) -> LLMProvider:
        """Build a provider by reading environment variables."""

        provider = os.getenv("DOMPET_LLM_PROVIDER", "ollama")
        model_name = os.getenv("DOMPET_LLM_MODEL")
        api_key = os.getenv("DOMPET_LLM_API_KEY")
        api_endpoint = os.getenv("DOMPET_LLM_ENDPOINT")

        if not model_name:
            if provider == "ollama":
                model_name = "gemma3:1b"
            elif provider == "anthropic":
                model_name = "claude-3-5-sonnet-20241022"
            elif provider == "fireworks":
                model_name = "accounts/fireworks/models/llama-v3p1-8b-instruct"

        config = ModelConfig(
            provider=provider,
            model_name=model_name,
            api_key=api_key,
            api_endpoint=api_endpoint,
        )
        return cls.create(config)
