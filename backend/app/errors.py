"""Domain errors raised by services and mapped to HTTP responses in main.py.

Every error response has the shape ``{"detail": "message"}`` (ARCHITECTURE.md section 14).
"""


class NotFound(Exception):
    """Unknown zone, month, field, edge... -> HTTP 404."""


class BadRequest(Exception):
    """Well-formed but invalid request -> HTTP 400."""


class DataMissing(Exception):
    """A required file is missing from data/ -> HTTP 503 (run the mock generator or the pipeline)."""
