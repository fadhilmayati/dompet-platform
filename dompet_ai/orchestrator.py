"""Core orchestration logic for Dompet AI agents."""

from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path
from typing import Iterator, List, Mapping, Sequence

import pandas as pd

from .agents import AGENTS, Agent
from .config import MODEL_NAME, client


@dataclass
class Transaction:
    date: str
    description: str
    amount: float

    def to_prompt_row(self) -> str:
        sign = "-" if self.amount < 0 else ""
        value = abs(self.amount)
        return f"{self.date} | {self.description} | {sign}RM{value:,.2f}"

    @classmethod
    def from_mapping(cls, data: Mapping[str, object]) -> "Transaction":
        """Create a transaction from a mapping of values."""

        date = str(data.get("date") or data.get("Date") or "").strip()
        description = str(
            data.get("description") or data.get("Description") or ""
        ).strip()
        raw_amount = data.get("amount") or data.get("Amount")
        if isinstance(raw_amount, str):
            cleaned = re.sub(r"(?i)rm", "", raw_amount)
            cleaned = cleaned.replace(",", "").strip()
            amount = float(cleaned)
        elif raw_amount is None:
            amount = 0.0
        else:
            amount = float(raw_amount)

        return cls(date=date, description=description, amount=amount)


class DompetPipeline:
    """Loads transaction data and orchestrates the Ollama-backed agents."""

    def __init__(
        self,
        transactions: Sequence[Transaction],
        *,
        persona_context: str | None = None,
        goal_context: str | None = None,
    ):
        self.transactions = list(transactions)
        if not self.transactions:
            raise ValueError("No transactions available for analysis.")
        self.persona_context = (persona_context or "").strip()
        self.goal_context = (goal_context or "").strip()

    @classmethod
    def from_csv(cls, csv_path: str | Path, preview_rows: int = 20) -> "DompetPipeline":
        """Build a pipeline instance by loading transactions from a CSV file."""

        transactions = cls._load_transactions(csv_path, preview_rows=preview_rows)
        return cls(transactions)

    @staticmethod
    def _load_transactions(
        csv_path: str | Path, preview_rows: int = 20
    ) -> List[Transaction]:
        df = pd.read_csv(csv_path)
        required_columns = {"date", "description", "amount"}
        lower_columns = {col.lower() for col in df.columns}
        missing = required_columns - lower_columns
        if missing:
            raise ValueError(
                "CSV must contain columns date, description, amount (case insensitive)."
            )

        normalised = df.rename(columns={orig: orig.lower() for orig in df.columns})
        amount_series = normalised["amount"].astype(str)
        amount_series = amount_series.str.replace(r"RM", "", regex=True, case=False)
        amount_series = amount_series.str.replace(r",", "", regex=False)
        amount_series = amount_series.str.strip()
        normalised["amount"] = amount_series.astype(float)
        normalised = normalised.sort_values("date", ascending=False)

        rows: List[Transaction] = []
        for _, row in normalised.head(preview_rows).iterrows():
            rows.append(
                Transaction(
                    date=str(row["date"]),
                    description=str(row["description"]),
                    amount=float(row["amount"]),
                )
            )
        return rows

    def build_prompt_context(self) -> str:
        header = "date | description | amount"
        lines = "\n".join(tx.to_prompt_row() for tx in self.transactions)
        blocks = [f"Latest {len(self.transactions)} transactions:\n{header}\n{lines}"]
        if self.persona_context:
            blocks.append(f"User behaviour notes: {self.persona_context}")
        if self.goal_context:
            blocks.append(f"Active goals: {self.goal_context}")
        return "\n\n".join(blocks)

    def _call_agent(self, agent: Agent, user_prompt: str) -> str:
        response = client.chat(
            model=MODEL_NAME,
            messages=[
                {"role": "system", "content": agent.system_prompt},
                {"role": "user", "content": user_prompt},
            ],
        )
        message = response.get("message") or {}
        return message.get("content", "")

    def run(self) -> Iterator[tuple[str, str]]:
        context = self.build_prompt_context()
        yield from self.run_with_context(context)

    def run_with_context(self, context: str) -> Iterator[tuple[str, str]]:
        for agent_key, agent in AGENTS.items():
            prompt_parts = [context, f"Focus task: {agent.description}"]
            if self.persona_context:
                prompt_parts.append(
                    "Remember the user prefers personalised coaching: "
                    f"{self.persona_context}"
                )
            if self.goal_context and agent_key == "GoalArchitect":
                prompt_parts.append(
                    "Incorporate the stated goals directly in your plan."
                )
            prompt = "\n\n".join(prompt_parts)
            yield agent_key, self._call_agent(agent, prompt)
