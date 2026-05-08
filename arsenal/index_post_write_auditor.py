import json
import os
import subprocess
import sys


WORKSPACE_MARKERS = {
    "00_Investment": "workspaces/Investment",
    "01_Business": "workspaces/Business",
    "02_Company": "workspaces/Company",
    "03_Hobby": "workspaces/Hobby",
}


def main() -> int:
    try:
        payload = json.load(sys.stdin)
    except Exception:
        return 0

    file_path = payload.get("tool_input", {}).get("file_path", "")
    if not file_path:
        return 0

    try:
        root = subprocess.check_output(
            ["git", "rev-parse", "--show-toplevel"],
            text=True,
            stderr=subprocess.DEVNULL,
        ).strip()
    except Exception:
        root = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))

    normalized = file_path.replace("\\", "/")
    workspace = next(
        (ws for marker, ws in WORKSPACE_MARKERS.items() if marker in normalized),
        None,
    )
    if not workspace:
        return 0

    subprocess.run(
        [sys.executable, "arsenal/manager.py", workspace],
        cwd=root,
        check=False,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
