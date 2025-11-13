"""FastAPI service exposing Dompet AI as an embeddable reasoning layer."""

from __future__ import annotations

import uuid
from datetime import date
from typing import List, Optional

from fastapi import FastAPI, HTTPException, status
from pydantic import BaseModel, Field, validator

import logging

from .orchestrator import DompetPipeline, Transaction
from .storage import (
    ImpactSnapshot,
    SessionStore,
    SuggestionRecord,
    UserProfile,
)


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
    suggestions: List["SuggestionPayload"] = Field(default_factory=list)


class AnalysisResponse(BaseModel):
    run_id: str
    run_at: str
    context: str
    results: List[AnalysisResult]


class SuggestionPayload(BaseModel):
    id: int
    suggestion: str
    suggestion_type: str
    created_at: str
    latest_outcome: Optional[str] = None
    latest_impact: Optional[float] = None


class UserProfileResponse(BaseModel):
    user_id: str
    risk_tolerance: str
    response_style: str
    success_notes: str
    success_metrics: dict
    created_at: str
    updated_at: str


class UserProfileUpdateRequest(BaseModel):
    risk_tolerance: Optional[str] = Field(
        None, description="e.g. low, balanced, adventurous"
    )
    response_style: Optional[str] = Field(
        None, description="e.g. numbers-first, supportive, direct"
    )
    success_notes: Optional[str] = Field(
        None,
        description="Free-form observations about what the user responds to",
        max_length=500,
    )


class GoalRequest(BaseModel):
    name: str = Field(..., description="Human readable goal name")
    target_amount: float = Field(..., gt=0, description="Goal amount in RM")
    target_date: Optional[date] = Field(None, description="Target completion date")
    notes: Optional[str] = Field(None, max_length=300)

    @validator("name")
    def validate_name(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("name must not be empty")
        return cleaned


class GoalResponse(BaseModel):
    id: int
    name: str
    target_amount: float
    target_date: Optional[str]
    current_progress: float
    notes: Optional[str]
    status: str
    created_at: str
    updated_at: str


class ImpactResponse(BaseModel):
    total_suggestions: int
    acted_upon: int
    failed: int
    ignored: int
    estimated_savings: float
    last_action_at: Optional[str]


class OutcomeRequest(BaseModel):
    outcome_status: str = Field(..., description="acted, ignored, or failed")
    impact: Optional[float] = Field(None, description="Estimated RM impact if acted")
    notes: Optional[str] = Field(None, max_length=300)

    @validator("outcome_status")
    def validate_status(cls, value: str) -> str:
        normalised = value.strip().lower()
        allowed = {"acted", "ignored", "failed"}
        if normalised not in allowed:
            raise ValueError(f"outcome_status must be one of {', '.join(sorted(allowed))}")
        return normalised


SuggestionPayload.update_forward_refs()


def create_app(store: Optional[SessionStore] = None) -> FastAPI:
    """Create a FastAPI app exposing Dompet AI orchestration endpoints."""

    session_store = store or SessionStore()
    logger = logging.getLogger("dompet_ai.service")
    if not logger.handlers:
        logging.basicConfig(level=logging.INFO)

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

        persona_notes = session_store.get_personalisation_notes(user_id)
        goal_context = session_store.goal_context(user_id)
        pipeline = DompetPipeline(
            transactions,
            persona_context=persona_notes,
            goal_context=goal_context,
        )
        context = pipeline.build_prompt_context()
        run_id = uuid.uuid4().hex

        results: List[AnalysisResult] = []
        try:
            for agent_key, output in pipeline.run_with_context(context):
                session_store.record_analysis(
                    user_id=user_id,
                    run_id=run_id,
                    agent_key=agent_key,
                    content=output,
                    context=context,
                )
                suggestions = _extract_and_store_suggestions(
                    session_store,
                    user_id=user_id,
                    run_id=run_id,
                    agent_key=agent_key,
                    content=output,
                )
                results.append(
                    AnalysisResult(
                        agent_key=agent_key,
                        content=output,
                        suggestions=[_to_payload(item) for item in suggestions],
                    )
                )
        except Exception as exc:  # pragma: no cover - defensive guard
            logger.exception("Analysis pipeline failed for user %s", user_id)
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="Upstream reasoning model failed",
            ) from exc

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
        suggestions = session_store.get_suggestions_for_run(user_id, records[0].run_id)
        suggestions_map: dict[str, List[SuggestionRecord]] = {}
        for item in suggestions:
            suggestions_map.setdefault(item.agent_key, []).append(item)
        results = []
        for record in records:
            per_agent = suggestions_map.get(record.agent_key, [])
            results.append(
                AnalysisResult(
                    agent_key=record.agent_key,
                    content=record.content,
                    suggestions=[_to_payload(item) for item in per_agent],
                )
            )
        return AnalysisResponse(
            run_id=records[0].run_id,
            run_at=run_at,
            context=context,
            results=results,
        )

    @app.get("/users/{user_id}/profile", response_model=UserProfileResponse)
    def get_profile(user_id: str) -> UserProfileResponse:
        profile = session_store.get_or_create_user_profile(user_id)
        return _profile_to_response(profile)

    @app.put("/users/{user_id}/profile", response_model=UserProfileResponse)
    def update_profile(user_id: str, payload: UserProfileUpdateRequest) -> UserProfileResponse:
        profile = session_store.update_user_profile(
            user_id,
            risk_tolerance=payload.risk_tolerance,
            response_style=payload.response_style,
            success_notes=payload.success_notes,
        )
        return _profile_to_response(profile)

    @app.post("/users/{user_id}/goals", response_model=List[GoalResponse])
    def upsert_goal(user_id: str, payload: GoalRequest) -> List[GoalResponse]:
        session_store.upsert_goal(
            user_id=user_id,
            name=payload.name.strip(),
            target_amount=float(payload.target_amount),
            target_date=payload.target_date.isoformat() if payload.target_date else None,
            notes=payload.notes.strip() if payload.notes else None,
        )
        return [_goal_to_response(item) for item in session_store.list_goals(user_id)]

    @app.get("/users/{user_id}/goals", response_model=List[GoalResponse])
    def list_goals(user_id: str) -> List[GoalResponse]:
        return [_goal_to_response(item) for item in session_store.list_goals(user_id)]

    @app.post(
        "/users/{user_id}/suggestions/{suggestion_id}/outcomes",
        response_model=ImpactResponse,
    )
    def record_outcome(user_id: str, suggestion_id: int, payload: OutcomeRequest) -> ImpactResponse:
        try:
            owner = session_store.record_suggestion_outcome(
                suggestion_id=suggestion_id,
                outcome_status=payload.outcome_status,
                impact=payload.impact,
                notes=payload.notes,
            )
        except ValueError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        if owner != user_id:
            raise HTTPException(status_code=403, detail="Suggestion does not belong to this user")
        impact = session_store.get_impact_snapshot(user_id)
        return _impact_to_response(impact)

    @app.get("/users/{user_id}/impact", response_model=ImpactResponse)
    def impact_summary(user_id: str) -> ImpactResponse:
        impact = session_store.get_impact_snapshot(user_id)
        return _impact_to_response(impact)

    return app


app = create_app()


def _extract_and_store_suggestions(
    store: SessionStore,
    *,
    user_id: str,
    run_id: str,
    agent_key: str,
    content: str,
) -> List[SuggestionRecord]:
    mapping = {
        "SavingsPlanner": "savings_tip",
        "BudgetAuditor": "spending_alert",
        "GoalArchitect": "goal_plan",
    }
    suggestion_type = mapping.get(agent_key)
    if suggestion_type is None:
        return []

    suggestions = _parse_suggestions(content)
    if not suggestions:
        return []

    return store.record_suggestions(
        user_id=user_id,
        run_id=run_id,
        agent_key=agent_key,
        suggestion_type=suggestion_type,
        suggestions=suggestions,
    )


def _parse_suggestions(content: str) -> List[str]:
    lines: List[str] = []
    for raw_line in content.splitlines():
        stripped = raw_line.strip()
        if not stripped:
            continue
        if stripped[0] in "-•*":
            stripped = stripped.lstrip("-•* ")
        elif stripped[0].isdigit():
            stripped = stripped.lstrip("0123456789. )")
        if len(stripped) < 3:
            continue
        lines.append(stripped)
    if not lines:
        return [content.strip()]
    return lines


def _to_payload(record: SuggestionRecord) -> SuggestionPayload:
    return SuggestionPayload(
        id=record.id,
        suggestion=record.suggestion,
        suggestion_type=record.suggestion_type,
        created_at=record.created_at.isoformat(),
        latest_outcome=record.latest_outcome,
        latest_impact=record.latest_impact,
    )


def _profile_to_response(profile: UserProfile) -> UserProfileResponse:
    return UserProfileResponse(
        user_id=profile.user_id,
        risk_tolerance=profile.risk_tolerance,
        response_style=profile.response_style,
        success_notes=profile.success_notes,
        success_metrics=profile.success_metrics,
        created_at=profile.created_at.isoformat(),
        updated_at=profile.updated_at.isoformat(),
    )


def _goal_to_response(goal: dict) -> GoalResponse:
    return GoalResponse(
        id=goal["id"],
        name=goal["name"],
        target_amount=float(goal["target_amount"]),
        target_date=goal["target_date"],
        current_progress=float(goal["current_progress"] or 0.0),
        notes=goal["notes"],
        status=goal["status"],
        created_at=goal["created_at"],
        updated_at=goal["updated_at"],
    )


def _impact_to_response(snapshot: ImpactSnapshot) -> ImpactResponse:
    return ImpactResponse(
        total_suggestions=snapshot.total_suggestions,
        acted_upon=snapshot.acted_upon,
        failed=snapshot.failed,
        ignored=snapshot.ignored,
        estimated_savings=round(snapshot.estimated_savings, 2),
        last_action_at=snapshot.last_action_at.isoformat()
        if snapshot.last_action_at
        else None,
    )


__all__ = ["app", "create_app"]
