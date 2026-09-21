"""Stage the Python deployment assets under infra/build/ (gitignored). Run by `npm run build` in infra.

tools-adapter/  Gateway Lambda: handler + router; bank_tools, merchant_intel,
                orchestrator packages; synthetic merchant profiles; and contract schemas.
agent-runtime/  AgentCore Runtime zip root: all three Python packages under src/ (entry
                `python3 src/orchestrator/main.py`), customer/profile fixtures, and contract schemas.
                `--with-boto3` vendors boto3 (not in the Runtime image).
"""
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "infra" / "build"
IGNORE = shutil.ignore_patterns("__pycache__", "*.pyc", "*.egg-info")
PACKAGES = {
    "bank_tools": ROOT / "services/bank-tools/src/bank_tools",
    "merchant_intel": ROOT / "services/merchant-intel/src/merchant_intel",
    "orchestrator": ROOT / "services/agent/src/orchestrator",
}


def stage(name: str) -> Path:
    dest = OUT / name
    shutil.rmtree(dest, ignore_errors=True)
    dest.mkdir(parents=True)
    return dest


def require(asset: str, root: Path, paths: tuple[str, ...]) -> None:
    missing = [path for path in paths if not (root / path).exists()]
    if missing:
        raise RuntimeError(f"{asset} asset is incomplete; missing: {', '.join(missing)}")


def main() -> None:
    tools = stage("tools-adapter")
    for f in ("handler.py", "router.py"):
        shutil.copy(ROOT / "infra/lambda/tools-adapter" / f, tools / f)
    for name, source in PACKAGES.items():
        shutil.copytree(source, tools / name, ignore=IGNORE)
    shutil.copy(ROOT / "fixtures/merchants/demo-profiles.json", tools / "merchant-profiles.json")
    shutil.copy(ROOT / "packages/contracts/schemas.json", tools / "schemas.json")

    runtime = stage("agent-runtime")
    for name, source in PACKAGES.items():
        shutil.copytree(source, runtime / "src" / name, ignore=IGNORE)
    shutil.copy(ROOT / "fixtures/customers/demo.json", runtime / "customers.json")
    shutil.copy(ROOT / "fixtures/merchants/demo-profiles.json", runtime / "merchant-profiles.json")
    shutil.copy(ROOT / "packages/contracts/schemas.json", runtime / "src/schemas.json")
    if "--with-boto3" in sys.argv:
        subprocess.run([sys.executable, "-m", "pip", "install", "--quiet", "--target", str(runtime), "boto3"], check=True)

    require("tools-adapter", tools, (
        "handler.py", "router.py", "bank_tools/__init__.py",
        "merchant_intel/__init__.py", "orchestrator/__init__.py", "merchant-profiles.json", "schemas.json",
    ))
    require("agent-runtime", runtime, (
        "src/orchestrator/main.py", "src/bank_tools/__init__.py", "src/merchant_intel/__init__.py",
        "src/orchestrator/__init__.py", "src/schemas.json", "customers.json", "merchant-profiles.json",
    ))
    require("messaging Lambda", ROOT / "services/messaging/dist", ("index.mjs",))
    if "--with-boto3" in sys.argv:
        require("agent-runtime", runtime, ("boto3/__init__.py", "botocore/__init__.py"))


if __name__ == "__main__":
    main()
