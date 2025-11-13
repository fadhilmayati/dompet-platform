"""Unit tests for transaction parsing and formatting."""

import pytest

from dompet_ai.orchestrator import Transaction


def test_to_prompt_row_formats_malaysian_currency():
    """Prompt rows should render RM values with thousands separators."""
    tx = Transaction(date="2024-01-15", description="Salary", amount=5230.5)

    assert tx.to_prompt_row() == "2024-01-15 | Salary | RM5,230.50"


def test_to_prompt_row_handles_negative_amount():
    """Expenses should include a negative sign before RM."""
    tx = Transaction(date="2024-01-16", description="GrabFood", amount=-42.75)

    assert tx.to_prompt_row() == "2024-01-16 | GrabFood | -RM42.75"


@pytest.mark.parametrize(
    "payload, expected",
    [
        (
            {"date": "2024-02-01", "description": "Salary", "amount": "RM5,000.00"},
            Transaction(date="2024-02-01", description="Salary", amount=5000.0),
        ),
        (
            {"Date": "2024-02-02", "Description": "Groceries", "Amount": "-150"},
            Transaction(date="2024-02-02", description="Groceries", amount=-150.0),
        ),
        (
            {"date": "2024-02-03", "description": "Bonus", "amount": 800},
            Transaction(date="2024-02-03", description="Bonus", amount=800.0),
        ),
    ],
)
def test_from_mapping_normalises_fields(payload, expected):
    """Input mappings should be normalised regardless of column casing or RM labels."""
    actual = Transaction.from_mapping(payload)

    assert actual == expected
