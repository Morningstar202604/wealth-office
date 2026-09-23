from __future__ import annotations

from mcp.server.mcpserver import MCPServer

from .tools import demo_data as T

server = MCPServer(
    name="wealth-office",
    description="Wealth Office demo data tools over MCP",
    instructions="Read-only demo portfolio / ledger tools.",
)


def _wrap(fn):
    def call(*args, **kwargs):
        return fn(*args, **kwargs)

    call.__name__ = fn.__name__
    call.__doc__ = fn.__doc__
    call.__annotations__ = getattr(fn, "__annotations__", {})
    import inspect

    call.__signature__ = inspect.signature(fn)
    return call


for _name in T.__all__:
    server.tool()(_wrap(getattr(T, _name)))


def main() -> None:
    import anyio

    anyio.run(server.run_stdio_async)


if __name__ == "__main__":
    main()
