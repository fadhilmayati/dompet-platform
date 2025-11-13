"""Integration tests targeting the FastAPI service layer."""

from fastapi.testclient import TestClient

from dompet_ai.service import create_app


def test_api_transaction_ingestion(store):
    """POST /users/{user_id}/transactions should persist data."""
    app = create_app(store=store)
    client = TestClient(app)

    response = client.post(
        "/users/test_user/transactions",
        json={
            "source": "test_bank",
            "transactions": [
                {"date": "2024-01-01", "description": "Salary", "amount": 5000},
                {"date": "2024-01-02", "description": "Groceries", "amount": -150},
            ],
        },
    )

    assert response.status_code == 200
    assert response.json()["ingested"] == 2


def test_api_user_profile_management(store):
    """PUT /users/{user_id}/profile should update preferences."""
    app = create_app(store=store)
    client = TestClient(app)

    # Get default profile
    resp1 = client.get("/users/test_user/profile")
    assert resp1.status_code == 200
    assert resp1.json()["risk_tolerance"] == "balanced"

    # Update profile
    resp2 = client.put(
        "/users/test_user/profile",
        json={
            "risk_tolerance": "adventurous",
            "response_style": "direct",
        },
    )
    assert resp2.status_code == 200

    # Verify update
    resp3 = client.get("/users/test_user/profile")
    assert resp3.json()["risk_tolerance"] == "adventurous"


def test_api_goal_management(store):
    """POST /users/{user_id}/goals should create goals."""
    app = create_app(store=store)
    client = TestClient(app)

    response = client.post(
        "/users/test_user/goals",
        json={
            "name": "Emergency fund",
            "target_amount": 10000,
            "target_date": "2025-12-31",
        },
    )

    assert response.status_code == 200
    goals = response.json()
    assert len(goals) == 1
    assert goals[0]["name"] == "Emergency fund"


def test_api_impact_tracking(store):
    """GET /users/{user_id}/impact should aggregate metrics."""
    app = create_app(store=store)
    client = TestClient(app)
    user_id = "impact_user"

    # Add transactions
    client.post(
        f"/users/{user_id}/transactions",
        json={
            "source": "test",
            "transactions": [
                {"date": "2024-01-01", "description": "Salary", "amount": 5000},
                {"date": "2024-01-02", "description": "GrabFood", "amount": -60},
            ],
        },
    )

    # Manually add suggestions and outcomes (normally from /analyze)
    store.record_suggestions(
        user_id=user_id,
        run_id="run_001",
        agent_key="SavingsPlanner",
        suggestion_type="savings_tip",
        suggestions=["Save on food delivery"],
    )

    # Check impact
    response = client.get(f"/users/{user_id}/impact")
    assert response.status_code == 200
    impact = response.json()
    assert impact["total_suggestions"] == 1
    assert impact["acted_upon"] == 0  # Not acted yet
