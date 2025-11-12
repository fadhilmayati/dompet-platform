"""Ollama client configuration for Dompet AI."""

from ollama import Client

MODEL_NAME = "gemma3:1b"
client = Client(host="http://127.0.0.1:11434")
