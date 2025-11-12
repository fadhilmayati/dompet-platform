"""CLI helpers for Dompet AI."""

import argparse
from pathlib import Path

from .orchestrator import DompetPipeline


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run Dompet AI on a CSV file")
    parser.add_argument("csv", type=Path, help="Path to the transactions CSV")
    parser.add_argument(
        "--preview-rows",
        type=int,
        default=20,
        help="Number of most recent rows to send to the agents (default: 20)",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    pipeline = DompetPipeline(args.csv, preview_rows=args.preview_rows)

    print("Dompet AI Offline Financial Review\n===============================")
    for agent_name, output in pipeline.run():
        print(f"\n[{agent_name}]")
        print(output.strip())
