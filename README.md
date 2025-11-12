# Dompet AI (Offline)

Dompet AI is a fully offline personal finance assistant that runs on top of your local Ollama installation. It ingests a CSV export of your transactions, sends the latest entries to a small on-device LLM, and prints concise Malaysian-English coaching about cash flow, categories, and savings ideas.

## Key Features

- Reuses the lightweight Ollama orchestration stack with `gemma3:1b` for reasoning and dialogue.
- Splits work into four focused agents: ExpenseCategorizer, CashflowAnalyzer, SavingsPlanner, and BudgetAuditor.
- Loads recent CSV rows with pandas and injects them directly into the LLM context—no external APIs.
- Produces Malaysian-English summaries that highlight income vs expenses, irregular spending, and actionable monthly tweaks.

## Requirements

- Python 3.11+
- [Ollama](https://ollama.com/) running locally with the `gemma3:1b` model pulled.
- CSV file with `date`, `description`, and `amount` columns (case insensitive).

Install the Python dependencies:

```bash
pip install -r requirements.txt
```

## Usage

1. Ensure Ollama is running on `http://127.0.0.1:11434` and that `gemma3:1b` is available (`ollama pull gemma3:1b`).
2. Prepare a CSV file, for example:

```csv
date,description,amount
2024-05-01,Salary,5000
2024-05-02,GrabFood dinner,-35.50
2024-05-03,LRT reload,-25
```

3. Run the CLI and review the agent outputs:

```bash
python -m dompet_ai transactions.csv
```

Each agent prints its findings directly in the terminal, keeping all processing on your machine.

## Project Structure

```
requirements.txt
dompet_ai/
  __init__.py           # Public exports
  __main__.py           # Enables `python -m dompet_ai`
  agents.py             # Agent prompts and metadata
  cli.py                # Argument parsing and console output
  config.py             # Ollama client + model name
  orchestrator.py       # CSV loader and task runner
```

## Safety Notes

- The CSV is only read locally; nothing is uploaded or cached online.
- Gemma 3 runs via Ollama on your device, so there are no external API calls.
- Review suggestions before acting; Dompet AI offers heuristics, not professional advice.
