# Dompet AI (Offline)

Dompet AI is a fully offline personal finance assistant that runs on top of your local Ollama installation. It ingests a CSV export of your transactions, sends the latest entries to a small on-device LLM, and prints concise Malaysian-English coaching about cash flow, categories, and savings ideas.

## Key Features

- Reuses the lightweight Ollama orchestration stack with `gemma3:1b` for reasoning and dialogue.
- Splits work into four focused agents: ExpenseCategorizer, CashflowAnalyzer, SavingsPlanner, and BudgetAuditor.
- Loads recent CSV rows with pandas and injects them directly into the LLM context—no external APIs.
- Persists transactions and analyses locally with SQLite so each user builds a longitudinal coaching trail.
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

## Reasoning API (Path C)

Dompet AI can now operate as an infrastructure layer that other finance apps embed. A lightweight FastAPI service exposes endpoints to ingest transactions, trigger agent runs, and retrieve the latest insights for a given user. The entire stack stays local by default and writes context to `dompet_ai.sqlite`.

### Start the service

```bash
uvicorn dompet_ai.service:app --reload
```

### Example workflow

1. **Push new transactions**

    ```bash
    curl -X POST http://127.0.0.1:8000/users/alya/transactions \
      -H "Content-Type: application/json" \
      -d '{
        "source": "sandbox",
        "transactions": [
          {"date": "2024-08-01", "description": "Salary", "amount": 5200},
          {"date": "2024-08-02", "description": "GrabFood dinner", "amount": -48.5},
          {"date": "2024-08-03", "description": "PTPTN repayment", "amount": -150}
        ]
      }'
    ```

2. **Run the agents for the latest context**

    ```bash
    curl -X POST "http://127.0.0.1:8000/users/alya/analyze?limit=25"
    ```

3. **Retrieve the most recent recommendations**

    ```bash
    curl http://127.0.0.1:8000/users/alya/analyses/latest
    ```

This mode lets partner banks, fintechs, or wallet apps layer Dompet's reasoning and localisation into their own experiences without shipping sensitive data off-device.

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
