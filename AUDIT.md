# Dompet AI – Offline Safety Notes

Dompet AI now runs as a Python CLI that talks exclusively to a local Ollama server. It processes CSV files on disk and never reaches out to cloud APIs or third-party services.

## Risks

- Financial data is read straight from the CSV you provide. Keep source files on a trusted machine.
- Outputs are printed to stdout only; nothing is persisted unless you redirect the stream.
- LLM reasoning depends on the quality of the CSV context. Double-check categories and advice before acting.

## Staying Safe

- Store transaction exports securely and delete any temporary copies when done.
- Ensure the Ollama instance stays on localhost so data never leaves your device.
- Treat suggestions as budgeting tips, not certified financial planning.
