"""Mock LLM responses for testing without hitting Ollama."""

MOCK_AGENT_RESPONSES = {
    "ExpenseCategorizer": """
|date      |description     |amount_rm|category |short_reason     |
|----------|----------------|---------|---------|-----------------|
|2024-01-02|Groceries Tesco |-RM150.50|Food     |Regular groceries|
|2024-01-03|GrabFood dinner |-RM45.20 |Food     |Dining delivery  |
|2024-01-04|Electricity bill|-RM120.00|Utilities|Monthly bill     |
""",
    "CashflowAnalyzer": """
Income this month: RM5,000.00
Expenses this month: RM340.70
Net cashflow: +RM4,659.30 (SURPLUS)

Your spending is stable with a small food delivery spike mid-month.
""",
    "SavingsPlanner": """
1. Reduce GrabFood by pausing 2 days/week → Save RM30/month
1. Automate RM300 to fixed deposit → Build discipline
""",
    "BudgetAuditor": """
• Food spending: RM195.70 (slightly high, mostly delivery)
• Utilities: On track
• No unusual spikes detected
""",
    "GoalArchitect": """
Goal: Save RM50,000 by 2029
Required monthly savings: RM833

Option A (Automation): Set up RM833 auto-transfer
Option B (Hybrid): Auto-transfer RM500 + reduce dining RM333
Target completion: Dec 2028 (slightly ahead)
""",
}


def mock_llm_responses():
    """Inject mock responses instead of calling Ollama."""
    return MOCK_AGENT_RESPONSES
