"""Tool-level error types. Tool functions catch these and return {"status": "error", ...}."""
from __future__ import annotations


class ToolError(Exception):
    code = "TOOL_ERROR"

    def __init__(self, message: str, code: str | None = None):
        super().__init__(message)
        if code:
            self.code = code


class NotFoundError(ToolError):
    code = "NOT_FOUND"


class ConflictError(ToolError):
    code = "CONFLICT"


class InvalidTransitionError(ToolError):
    code = "INVALID_TRANSITION"
