"""Sample user data used across tests."""

SAMPLE_USERS = [
    {
        "user_id": "user_balanced",
        "risk_tolerance": "balanced",
        "response_style": "supportive",
        "success_notes": "Responds to automation tips",
    },
    {
        "user_id": "user_adventurous",
        "risk_tolerance": "adventurous",
        "response_style": "direct",
        "success_notes": "Likes charts and comparisons",
    },
]


def sample_user_ids():
    """Convenience helper returning all test user identifiers."""
    return [user["user_id"] for user in SAMPLE_USERS]
