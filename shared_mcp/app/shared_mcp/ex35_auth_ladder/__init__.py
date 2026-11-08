"""Example 35 authentication ladder (KBA -> OTP -> SMS) for /mcp/ex35-auth-ladder, with its OTP console at /ex35-otp."""

from .pack import build_http_routes, register, register_tools
from .service import AuthLadderService

__all__ = ["AuthLadderService", "build_http_routes", "register", "register_tools"]
