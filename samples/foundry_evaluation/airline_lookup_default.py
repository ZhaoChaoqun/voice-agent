"""Fixed reservation response for a Code Interpreter smoke test, not a real lookup."""

from datetime import datetime, timedelta


def lookup_reservation(user_id: str, reservation_id: str) -> dict:
    """Return mock booking details for any two nonempty alphanumeric identifiers."""
    for name, value in (("user_id", user_id), ("reservation_id", reservation_id)):
        if not isinstance(value, str) or not any(char.isalnum() for char in value):
            raise ValueError(f"{name} must contain at least one letter or digit")
    return {
        "mock": True,
        "customer_name": "Emma Kim",
        "reference_time": "2024-05-15T15:00:00",
        "time_zone": "EST (benchmark fixed time)",
        "reservation": {
            "user_id": user_id,
            "reservation_id": reservation_id,
            "created_at": "2024-05-04T23:12:06",
        },
    }


def check_refund_eligibility(created_at: str, reference_time: str) -> dict:
    """Apply the test's 24-hour refund rule without modifying a reservation."""
    for name, value in (("created_at", created_at), ("reference_time", reference_time)):
        if not isinstance(value, str):
            raise ValueError(f"{name} must be an ISO 8601 timestamp string")
    booked = datetime.fromisoformat(created_at)
    reference = datetime.fromisoformat(reference_time)
    if (booked.utcoffset() is None) != (reference.utcoffset() is None):
        raise ValueError("Both timestamps must use compatible timezone information")
    elapsed = reference - booked
    if elapsed < timedelta(0):
        raise ValueError("reference_time must not precede created_at")
    eligible = elapsed <= timedelta(hours=24)
    return {
        "cancellation_with_refund_eligible": eligible,
        "booking_age_hours": elapsed.total_seconds() / 3600,
        "policy": "Cancellation with a refund is not eligible more than 24 hours after booking.",
        "reason": "within_24_hours" if eligible else "booking_older_than_24_hours",
        "reservation_changed": False,
        "refund_processed": False,
    }
