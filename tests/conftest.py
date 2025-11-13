import tempfile
import sys
from importlib import util
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import pytest

storage_spec = util.spec_from_file_location("dompet_ai.storage", ROOT / "dompet_ai" / "storage.py")
storage_module = util.module_from_spec(storage_spec)
assert storage_spec and storage_spec.loader
storage_spec.loader.exec_module(storage_module)
SessionStore = storage_module.SessionStore

orchestrator_spec = util.spec_from_file_location(
    "dompet_ai.orchestrator", ROOT / "dompet_ai" / "orchestrator.py"
)
orchestrator_module = util.module_from_spec(orchestrator_spec)
assert orchestrator_spec and orchestrator_spec.loader
orchestrator_spec.loader.exec_module(orchestrator_module)
Transaction = orchestrator_module.Transaction


@pytest.fixture
def temp_db():
    """Create isolated test database."""
    with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as f:
        db_path = f.name
    try:
        yield db_path
    finally:
        Path(db_path).unlink(missing_ok=True)


@pytest.fixture
def store(temp_db):
    """Provide test-ready SessionStore."""
    return SessionStore(db_path=temp_db)


@pytest.fixture
def sample_transactions():
    """Realistic Malaysian user transactions."""
    return [
        Transaction(date="2024-01-01", description="Salary", amount=5000),
        Transaction(date="2024-01-02", description="Groceries Tesco", amount=-150.50),
        Transaction(date="2024-01-03", description="GrabFood dinner", amount=-45.20),
        Transaction(date="2024-01-04", description="Electricity bill", amount=-120),
        Transaction(date="2024-01-05", description="LRT reload", amount=-25),
    ]


@pytest.fixture
def user_with_profile(store):
    """User with established behavioral profile."""
    user_id = "test_user_001"
    store.add_transactions(
        user_id=user_id,
        transactions=[
            Transaction(date="2024-01-01", description="Salary", amount=5000),
            Transaction(date="2024-01-02", description="GrabFood", amount=-60),
        ],
        source="test",
    )
    store.update_user_profile(
        user_id=user_id,
        risk_tolerance="balanced",
        response_style="numbers-first",
        success_notes="Responds well to automation tips",
    )
    return user_id, store
