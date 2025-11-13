"""OCR abstraction layer for Dompet AI."""

from __future__ import annotations

import base64
import json
from abc import ABC, abstractmethod
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Optional


@dataclass
class OCRResult:
    """Structured OCR output."""

    raw_text: str
    extracted_transactions: List[Dict[str, object]]
    confidence: float
    provider: str


class OCRProvider(ABC):
    """Base interface for OCR providers."""

    @abstractmethod
    def extract_text(self, image_path: str | Path) -> str:
        """Extract raw text from *image_path*."""

    @abstractmethod
    def extract_transactions(self, image_path: str | Path) -> OCRResult:
        """Extract structured transaction data from *image_path*."""


class TesseractOCR(OCRProvider):
    """Free, on-device OCR using Tesseract."""

    def __init__(self) -> None:
        try:
            import pytesseract
            from PIL import Image
        except ImportError as exc:  # pragma: no cover - optional dependency
            raise RuntimeError("Install dependencies: pip install pytesseract pillow") from exc

        self._pytesseract = pytesseract
        self._image_cls = Image

    def extract_text(self, image_path: str | Path) -> str:
        image = self._image_cls.open(image_path)
        text = self._pytesseract.image_to_string(image, lang="eng+msa")
        return text.strip()

    def extract_transactions(self, image_path: str | Path) -> OCRResult:
        raw_text = self.extract_text(image_path)
        transactions = self._parse_transactions(raw_text)
        return OCRResult(
            raw_text=raw_text,
            extracted_transactions=transactions,
            confidence=0.7,
            provider="tesseract",
        )

    def _parse_transactions(self, text: str) -> List[Dict[str, object]]:
        import re

        transactions: List[Dict[str, object]] = []
        for line in text.splitlines():
            match = re.search(r"(.+?)\s+RM?([\d,]+\.?\d*)", line)
            if match:
                transactions.append(
                    {
                        "description": match.group(1).strip(),
                        "amount": -float(match.group(2).replace(",", "")),
                        "date": None,
                    }
                )
        return transactions


class PaddleOCRProvider(OCRProvider):
    """Free, faster on-device OCR using PaddleOCR."""

    def __init__(self) -> None:
        try:
            from paddleocr import PaddleOCR
        except ImportError as exc:  # pragma: no cover - optional dependency
            raise RuntimeError("Install dependency: pip install paddleocr") from exc

        self._ocr = PaddleOCR(use_angle_cls=True, lang="en")

    def extract_text(self, image_path: str | Path) -> str:
        result = self._ocr.ocr(str(image_path), cls=True)
        lines: List[str] = []
        for page in result:
            for entry in page:
                try:
                    _, (text, *_rest) = entry
                except (ValueError, TypeError):
                    continue
                lines.append(str(text))
        return "\n".join(lines).strip()

    def extract_transactions(self, image_path: str | Path) -> OCRResult:
        raw_text = self.extract_text(image_path)
        transactions = self._parse_transactions(raw_text)
        return OCRResult(
            raw_text=raw_text,
            extracted_transactions=transactions,
            confidence=0.78,
            provider="paddle",
        )

    def _parse_transactions(self, text: str) -> List[Dict[str, object]]:
        import re

        transactions: List[Dict[str, object]] = []
        for line in text.splitlines():
            match = re.search(r"(.+?)\s+RM?([\d,]+\.?\d*)", line)
            if match:
                transactions.append(
                    {
                        "description": match.group(1).strip(),
                        "amount": -float(match.group(2).replace(",", "")),
                        "date": None,
                    }
                )
        return transactions


class ClaudeVisionOCR(OCRProvider):
    """Claude vision model for OCR and transaction extraction."""

    def __init__(self, api_key: str):
        import anthropic

        self._client = anthropic.Anthropic(api_key=api_key)

    def extract_text(self, image_path: str | Path) -> str:
        image_data = Path(image_path).read_bytes()
        encoded = base64.standard_b64encode(image_data).decode("utf-8")
        message = self._client.messages.create(
            model="claude-3-5-sonnet-20241022",
            max_tokens=1024,
            messages=[
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "image",
                            "source": {
                                "type": "base64",
                                "media_type": "image/jpeg",
                                "data": encoded,
                            },
                        },
                        {
                            "type": "text",
                            "text": "Extract all text from this receipt or bank statement. Include dates, descriptions, and amounts.",
                        },
                    ],
                }
            ],
        )
        return message.content[0].text

    def extract_transactions(self, image_path: str | Path) -> OCRResult:
        image_data = Path(image_path).read_bytes()
        encoded = base64.standard_b64encode(image_data).decode("utf-8")
        message = self._client.messages.create(
            model="claude-3-5-sonnet-20241022",
            max_tokens=2048,
            messages=[
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "image",
                            "source": {
                                "type": "base64",
                                "media_type": "image/jpeg",
                                "data": encoded,
                            },
                        },
                        {
                            "type": "text",
                            "text": (
                                "Extract transactions from this Malaysian receipt or bank statement.\n"
                                "Return ONLY valid JSON (no markdown, no preamble):\n"
                                "{\n"
                                '"transactions": [\n'
                                '{"date": "YYYY-MM-DD", "description": "...", "amount": -123.45},\n'
                                "...]\n"
                                "}\n\n"
                                "For expenses, use negative amounts. For income, use positive.\n"
                                "If date is unclear, use today's date.\n"
                                "Malaysian context: Look for MYR, RM, sen amounts."
                            ),
                        },
                    ],
                }
            ],
        )
        raw_text = message.content[0].text
        try:
            parsed = json.loads(raw_text)
            transactions = parsed.get("transactions", [])
            confidence = 0.95
        except Exception:
            transactions = []
            confidence = 0.0
        return OCRResult(
            raw_text=raw_text,
            extracted_transactions=transactions,
            confidence=confidence,
            provider="claude_vision",
        )


class GoogleVisionOCR(OCRProvider):
    """Google Cloud Vision OCR provider."""

    def __init__(self, api_key: str):
        from google.cloud import vision
        from google.oauth2.service_account import Credentials

        credentials = Credentials.from_service_account_file(api_key)
        self._client = vision.ImageAnnotatorClient(credentials=credentials)

    def extract_text(self, image_path: str | Path) -> str:
        from google.cloud import vision

        image_content = Path(image_path).read_bytes()
        image = vision.Image(content=image_content)
        response = self._client.document_text_detection(image=image)
        return response.full_text_annotation.text.strip()

    def extract_transactions(self, image_path: str | Path) -> OCRResult:
        raw_text = self.extract_text(image_path)
        transactions = self._parse_transactions(raw_text)
        return OCRResult(
            raw_text=raw_text,
            extracted_transactions=transactions,
            confidence=0.92,
            provider="google_vision",
        )

    def _parse_transactions(self, text: str) -> List[Dict[str, object]]:
        import re

        transactions: List[Dict[str, object]] = []
        for line in text.splitlines():
            match = re.search(r"(.+?)\s+RM?([\d,]+\.?\d*)", line)
            if match:
                transactions.append(
                    {
                        "description": match.group(1).strip(),
                        "amount": -float(match.group(2).replace(",", "")),
                        "date": None,
                    }
                )
        return transactions


class OCRFactory:
    """Factory for OCR providers."""

    _providers: Dict[str, type[OCRProvider]] = {
        "tesseract": TesseractOCR,
        "paddle": PaddleOCRProvider,
        "claude_vision": ClaudeVisionOCR,
        "google_vision": GoogleVisionOCR,
    }

    @classmethod
    def create(cls, provider: str, api_key: Optional[str] = None) -> OCRProvider:
        try:
            provider_class = cls._providers[provider]
        except KeyError as exc:
            raise ValueError(f"Unknown OCR provider: {provider}") from exc

        if provider in {"claude_vision", "google_vision"}:
            if not api_key:
                raise ValueError(f"{provider} requires an API key")
            return provider_class(api_key)

        return provider_class()
