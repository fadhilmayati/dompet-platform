# Dompet AI (Offline)

Dompet AI is a fully offline personal finance assistant that runs on top of your local Ollama installation. It ingests a CSV export of your transactions, sends the latest entries to a small on-device LLM, and prints concise Malaysian-English coaching about cash flow, categories, and savings ideas.

## Key Features

- Runs fully offline using Ollama's `gemma3:1b` so transaction data never leaves the device.
- Deploys five focused agents – ExpenseCategorizer, CashflowAnalyzer, SavingsPlanner, BudgetAuditor, and GoalArchitect – to cover daily habits and long-term planning.
- Loads recent CSV rows with pandas and injects them directly into the LLM context—no external APIs.
- Persists transactions, personalised user profiles, suggestions, and behavioural outcomes locally with SQLite.
- Learns each user's tone, wins, and misses to produce Malaysian-English coaching that feels bespoke.
- Surfaces partner-ready metrics (suggestions acted on, RM savings generated, recency of engagement) via the API.

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

2. **Optionally capture behavioural preferences**

    ```bash
    curl -X PUT http://127.0.0.1:8000/users/alya/profile \
      -H "Content-Type: application/json" \
      -d '{
        "risk_tolerance": "balanced",
        "response_style": "numbers-first",
        "success_notes": "Responded well to automation but dislikes strict frugality"
      }'
    ```

3. **Define a goal for the GoalArchitect agent**

    ```bash
    curl -X POST http://127.0.0.1:8000/users/alya/goals \
      -H "Content-Type: application/json" \
      -d '{
        "name": "Rumah deposit",
        "target_amount": 50000,
        "target_date": "2029-12-31",
        "notes": "Prefer automated savings vs lifestyle cuts"
      }'
    ```

4. **Run the agents for the latest context**

    ```bash
    curl -X POST "http://127.0.0.1:8000/users/alya/analyze?limit=25"
    ```

    Savings, alert, and goal agents now return structured suggestions with IDs you can track.

5. **Record real-world outcomes when the user acts**

    ```bash
    curl -X POST http://127.0.0.1:8000/users/alya/suggestions/12/outcomes \
      -H "Content-Type: application/json" \
      -d '{
        "outcome_status": "acted",
        "impact": 180.0,
        "notes": "Paused GrabFood orders for four weeks"
      }'
    ```

6. **Retrieve the most recent recommendations**

    ```bash
    curl http://127.0.0.1:8000/users/alya/analyses/latest
    ```

7. **Share behavioural impact back to stakeholders**

    ```bash
    curl http://127.0.0.1:8000/users/alya/impact
    ```

This mode lets partner banks, fintechs, or wallet apps layer Dompet's reasoning, localisation, and retention metrics into their own experiences without shipping sensitive data off-device.

### Partner integration playbook

1. **Sync transactions nightly** using `/users/{user_id}/transactions`.
2. **Hydrate behavioural context** with `/users/{user_id}/profile` so Dompet can tailor tone and strategy.
3. **Capture user goals** via `/users/{user_id}/goals` to unlock GoalArchitect planning.
4. **Trigger fresh reasoning** using `/users/{user_id}/analyze` on demand or after important events.
5. **Render insights** by calling `/users/{user_id}/analyses/latest`; each suggestion carries an ID and latest outcome.
6. **Report what happened** by posting to `/users/{user_id}/suggestions/{suggestion_id}/outcomes` whenever the app detects user action.
7. **Track ROI** through `/users/{user_id}/impact`, which surfaces acted-on tips, estimated RM savings, and engagement recency.

## Project Structure

```
requirements.txt
dompet_ai/
  __init__.py           # Public exports
  __main__.py           # Enables `python -m dompet_ai`
  agents.py             # Agent prompts and metadata
  cli.py                # Argument parsing and console output
  config.py             # Ollama client + model name
  orchestrator.py       # CSV loader and task runner with personalised context
  service.py            # FastAPI application exposing the reasoning layer
  storage.py            # SQLite-backed persistence (transactions, profiles, goals, metrics)
```

## Safety Notes

- The CSV is only read locally; nothing is uploaded or cached online.
- Gemma 3 runs via Ollama on your device, so there are no external API calls.
- Review suggestions before acting; Dompet AI offers heuristics, not professional advice.
