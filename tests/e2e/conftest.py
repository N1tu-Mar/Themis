import socket
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scripts/demo"))  # world.py (also wires service packages)


@pytest.fixture(autouse=True)
def no_paid_or_network_calls(monkeypatch):
    """Normal tests never reach AWS or any socket: boto3 cannot be imported and connect() fails loudly."""
    def deny(*_a, **_k):
        raise RuntimeError("network access attempted in a normal e2e test")
    monkeypatch.setattr(socket.socket, "connect", deny)
    monkeypatch.setitem(sys.modules, "boto3", None)
