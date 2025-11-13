"""FastAPI service exposing Dompet AI as an embeddable reasoning layer."""

from __future__ import annotations

import uuid
from datetime import date
from typing import List, Optional

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from .orchestrator import DompetPipeline, Transaction
from .storage import SessionStore


class TransactionPayload(BaseModel):
    date: date = Field(..., description="Transaction date in ISO format")
    description: str = Field(..., description="Merchant or note")
    amount: float = Field(..., description="Positive for income, negative for expenses")


class TransactionsRequest(BaseModel):
    transactions: List[TransactionPayload]
    source: str = Field(
        "api",
        description="Identifier for the upstream source (e.g. bank, partner app)",
        max_length=32,
    )


class AnalysisResult(BaseModel):
    agent_key: str
    content: str


class AnalysisResponse(BaseModel):
    run_id: str
    run_at: str
    context: str
    results: List[AnalysisResult]


def create_app(store: Optional[SessionStore] = None) -> FastAPI:
    """Create a FastAPI app exposing Dompet AI orchestration endpoints."""

    session_store = store or SessionStore()

    app = FastAPI(
        title="Dompet AI Reasoning API",
        description=(
            "Embed Dompet AI agents inside your finance product. "
            "Ingest transactions, trigger goal-focused analyses, and fetch personalised insights."
        ),
        version="0.2.0",
    )

    @app.post("/users/{user_id}/transactions", response_model=dict)
    def ingest_transactions(user_id: str, payload: TransactionsRequest) -> dict:
        transactions = [
            Transaction(
                date=item.date.isoformat(),
                description=item.description.strip(),
                amount=float(item.amount),
            )
            for item in payload.transactions
        ]
        inserted = session_store.add_transactions(
            user_id=user_id, transactions=transactions, source=payload.source
        )
        return {"user_id": user_id, "ingested": inserted}

    @app.post("/users/{user_id}/analyze", response_model=AnalysisResponse)
    def run_analysis(user_id: str, limit: int = 30) -> AnalysisResponse:
        transactions = session_store.fetch_recent_transactions(user_id, limit=limit)
        if not transactions:
            raise HTTPException(status_code=404, detail="No transactions for this user")

        pipeline = DompetPipeline(transactions)
        context = pipeline.build_prompt_context()
        run_id = uuid.uuid4().hex

        results: List[AnalysisResult] = []
        for agent_key, output in pipeline.run_with_context(context):
            session_store.record_analysis(
                user_id=user_id,
                run_id=run_id,
                agent_key=agent_key,
                content=output,
                context=context,
            )
            results.append(AnalysisResult(agent_key=agent_key, content=output))

        latest_records = session_store.latest_analysis(user_id)
        run_at = latest_records[0].run_at.isoformat() if latest_records else date.today().isoformat()
        return AnalysisResponse(run_id=run_id, run_at=run_at, context=context, results=results)

    @app.get("/users/{user_id}/analyses/latest", response_model=AnalysisResponse)
    def latest_analysis(user_id: str) -> AnalysisResponse:
        records = session_store.latest_analysis(user_id)
        if not records:
            raise HTTPException(status_code=404, detail="No analyses recorded")

        run_at = records[0].run_at.isoformat()
        context = records[0].context
        results = [
            AnalysisResult(agent_key=record.agent_key, content=record.content)
            for record in records
        ]
        return AnalysisResponse(
            run_id=records[0].run_id,
            run_at=run_at,
            context=context,
            results=results,
        )

    return app


app = create_app()


__all__ = ["app", "create_app"]
