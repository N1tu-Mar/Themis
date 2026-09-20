"""Stage the Python deployment assets under infra/build/ (gitignored). Run by `npm run build` in infra.

tools-adapter/  Gateway Lambda: handler + router + bank_tools, merchant_intel, orchestrator packages,
                synthetic merchant profiles and the contract JSON schemas merchant_intel validates against.
agent-runtime/  AgentCore Runtime zip root: src/orchestrator (entry `python3 src/orchestrator/main.py`)
                + customers.json sender directory. `--with-boto3` vendors boto3 (not in the Runtime image).
"""
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "infra" / "build"
IGNORE = shutil.ignore_patterns("__pycache__", "*.pyc", "*.egg-info")


def stage(name: str) -> Path:
    dest = OUT / name
    shutil.rmtree(dest, ignore_errors=True)
    dest.mkdir(parents=True)
    return dest


def main() -> None:
    tools = stage("tools-adapter")
    for f in ("handler.py", "router.py"):
        shutil.copy(ROOT / "infra/lambda/tools-adapter" / f, tools / f)
    for pkg in ("bank-tools/src/bank_tools", "merchant-intel/src/merchant_intel", "agent/src/orchestrator"):
        shutil.copytree(ROOT / "services" / pkg, tools / Path(pkg).name, ignore=IGNORE)
    shutil.copy(ROOT / "fixtures/merchants/demo-profiles.json", tools / "merchant-profiles.json")
    shutil.copy(ROOT / "packages/contracts/schemas.json", tools / "schemas.json")

    runtime = stage("agent-runtime")
    shutil.copytree(ROOT / "services/agent/src/orchestrator", runtime / "src/orchestrator", ignore=IGNORE)
    shutil.copy(ROOT / "fixtures/customers/demo.json", runtime / "customers.json")
    if "--with-boto3" in sys.argv:
        subprocess.run([sys.executable, "-m", "pip", "install", "--quiet", "--target", str(runtime), "boto3"], check=True)


if __name__ == "__main__":
    main()
