# Import from server, not app — this import triggers tool registration as a side effect
from omnifocus_mcp.server import mcp


def main() -> None:
    mcp.run()


if __name__ == "__main__":
    main()
