from typing import Any, Callable, TypeVar, cast

from mcp.server.fastmcp import FastMCP  # type: ignore[import-not-found]


F = TypeVar("F", bound=Callable[..., Any])


def _typed_tool(server: Any) -> Callable[[F], F]:
    return cast(Callable[[F], F], server.tool())


mcp = FastMCP("omnifocus-mcp")


@_typed_tool(mcp)
async def ping() -> dict[str, str]:
    return {"status": "ok", "message": "pong"}
