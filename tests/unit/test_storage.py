"""Unit tests for the SQLite-backed SessionStore."""

from dompet_ai.orchestrator import Transaction


def test_add_transactions_persists_data(store, sample_transactions):
    """Transactions should be stored and retrievable."""
    user_id = "user_123"
    count = store.add_transactions(user_id, sample_transactions)

    assert count == len(sample_transactions)

    retrieved = store.fetch_recent_transactions(user_id)
    assert len(retrieved) == len(sample_transactions)
    assert retrieved[0].description == "LRT reload"  # Most recent first


def test_user_profile_defaults_created_on_demand(store):
    """Profile should auto-create with defaults."""
    user_id = "new_user"
    profile = store.get_or_create_user_profile(user_id)

    assert profile.user_id == user_id
    assert profile.risk_tolerance == "balanced"
    assert profile.response_style == "supportive"
    assert profile.success_notes == ""


def test_update_user_profile_persists_changes(store):
    """Profile updates should be saved and retrieved."""
    user_id = "user_456"
    store.update_user_profile(
        user_id,
        risk_tolerance="adventurous",
        response_style="direct",
        success_notes="Loves data-driven decisions",
    )

    profile = store.get_or_create_user_profile(user_id)
    assert profile.risk_tolerance == "adventurous"
    assert profile.response_style == "direct"
    assert "data-driven" in profile.success_notes


def test_record_suggestions_tracks_outcomes(store, sample_transactions):
    """Suggestions should be storable and trackable."""
    user_id = "user_789"
    store.add_transactions(user_id, sample_transactions)

    suggestions = store.record_suggestions(
        user_id=user_id,
        run_id="run_001",
        agent_key="SavingsPlanner",
        suggestion_type="savings_tip",
        suggestions=[
            "Save RM50/month on GrabFood",
            "Automate RM300 to fixed deposit",
        ],
    )

    assert len(suggestions) == 2
    assert suggestions[0].suggestion_type == "savings_tip"
    assert suggestions[0].latest_outcome is None  # No outcome yet

    # Record outcome
    owner = store.record_suggestion_outcome(
        suggestion_id=suggestions[0].id,
        outcome_status="acted",
        impact=50.0,
        notes="Paused GrabFood for 1 month",
    )

    assert owner == user_id

    # Verify outcome tracking
    impact = store.get_impact_snapshot(user_id)
    assert impact.acted_upon == 1
    assert impact.estimated_savings == 50.0


def test_goal_storage_and_retrieval(store):
    """Goals should persist and track progress."""
    user_id = "goal_user"
    store.upsert_goal(
        user_id=user_id,
        name="Rumah deposit",
        target_amount=50000,
        target_date="2029-12-31",
        notes="Prefer automation",
    )

    goals = store.list_goals(user_id)
    assert len(goals) == 1
    assert goals[0]["name"] == "Rumah deposit"
    assert goals[0]["status"] == "active"
