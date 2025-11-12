"""Pipeline to run Dompet AI agents on CSV transaction data."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, List

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


class DompetPipeline:
    """Loads transaction data and orchestrates the Ollama-backed agents."""

    def __init__(self, csv_path: str | Path, preview_rows: int = 20) -> None:
        self.csv_path = Path(csv_path)
        self.preview_rows = preview_rows
        self.transactions = self._load_transactions()

    def _load_transactions(self) -> List[Transaction]:
        df = pd.read_csv(self.csv_path)
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
        for _, row in normalised.head(self.preview_rows).iterrows():
            rows.append(
                Transaction(
                    date=str(row["date"]),
                    description=str(row["description"]),
                    amount=float(row["amount"]),
                )
            )
        return rows

    def _build_context(self) -> str:
        header = "date | description | amount"
        lines = "\n".join(tx.to_prompt_row() for tx in self.transactions)
        return f"Latest {len(self.transactions)} transactions:\n{header}\n{lines}"

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

    def run(self) -> Iterable[tuple[str, str]]:
        if not self.transactions:
            raise ValueError("No transactions available in the CSV file.")

        context = self._build_context()
        for agent_key, agent in AGENTS.items():
            prompt = f"{context}\n\nFocus task: {agent.description}"
            yield agent_key, self._call_agent(agent, prompt)
