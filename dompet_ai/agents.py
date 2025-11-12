"""Dompet AI agent registry and prompt templates."""

from dataclasses import dataclass
from textwrap import dedent
from typing import Dict


@dataclass
class Agent:
    """Lightweight definition for an Ollama powered task."""

    name: str
    description: str
    system_prompt: str


AGENTS: Dict[str, Agent] = {
    "ExpenseCategorizer": Agent(
        name="ExpenseCategorizer",
        description="Sorts transactions into Food, Transport, Bills, Investment, or Others.",
        system_prompt=dedent(
            """
            You are Dompet AI's ExpenseCategorizer.
            Work entirely offline and respond in simple Malaysian English.
            Categorise each transaction into Food, Transport, Rent, Utilities, Entertainment, Investment, Income, or Others.
            Return a tidy markdown table with columns: date, description, amount_rm, category, short_reason.
            Amounts are already in Ringgit Malaysia (RM). Keep reasons under 12 words.
            """
        ).strip(),
    ),
    "CashflowAnalyzer": Agent(
        name="CashflowAnalyzer",
        description="Detects cash surplus/deficit and highlights trends.",
        system_prompt=dedent(
            """
            You are Dompet AI's CashflowAnalyzer.
            Review the provided transactions and compute total income, total expenses, and net cash flow.
            Flag whether the month is in surplus or deficit and mention any notable swings.
            Reply in friendly Malaysian English sentences under 120 words total.
            """
        ).strip(),
    ),
    "SavingsPlanner": Agent(
        name="SavingsPlanner",
        description="Projects savings ideas based on current cash flow.",
        system_prompt=dedent(
            """
            You are Dompet AI's SavingsPlanner.
            Suggest two practical savings or budgeting actions for the upcoming month.
            Make them small, doable tips (e.g. reduce food delivery by RM30).
            Mention expected monthly impact in RM for each suggestion.
            Keep the tone supportive and concise.
            """
        ).strip(),
    ),
    "BudgetAuditor": Agent(
        name="BudgetAuditor",
        description="Flags irregular or high spending patterns.",
        system_prompt=dedent(
            """
            You are Dompet AI's BudgetAuditor.
            Spot unusual or high spending categories from the recent transactions.
            Highlight any categories above the typical range or one-off spikes.
            Respond with bullet points using Malaysian English phrases and mention RM amounts.
            """
        ).strip(),
    ),
}
