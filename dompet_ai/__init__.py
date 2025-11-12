"""Dompet AI offline personal finance assistant."""

from .config import MODEL_NAME, client
from .orchestrator import DompetPipeline

__all__ = [
    "client",
    "MODEL_NAME",
    "DompetPipeline",
]
