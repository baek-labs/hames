"""
test_report_shape.py — Golden shape regression test for /doctor and /index reports.

목적:
    스크립트가 출력하는 JSON 리포트의 **스키마(키 + 타입)** 가 의도치 않게
    바뀌는 것을 차단한다. 값 자체는 환경/파일 상태에 따라 변하므로 비교하지
    않고, 키와 타입만 검증한다.

사용:
    python arsenal/test_report_shape.py

종료 코드:
    0 = 통과
    1 = 스키마 어긋남 (어디가 어긋났는지 stderr 출력)
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
from typing import Any, Dict, List, Tuple

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))


# ─── 기대 스키마 정의 ────────────────────────────────────────────────────────

DOCTOR_EXPECTED: Dict[str, type] = {
    "schema_version": str,
    "scope": str,
    "issues": dict,
    "documentation_drift_warnings": list,
    "recommended_actions": list,
}

DOCTOR_ISSUE_KEYS = {
    "stale_permissions",
    "arsenal_issues",
    "rule_module_issues",
    "workspace_isolation_issues",
    "path_reference_issues",
    "command_surface_issues",
    "hook_surface_issues",
    "hook_parity_issues",
    "hook_matcher_drift_issues",
    "inline_hook_issues",
    "runtime_encoding_issues",
    "workspace_registry_issues",
}

DOCTOR_ACTION_KEYS = {
    "id", "action_type", "target_path", "proposed_change",
    "risk_level", "rationale", "source_issue",
}

INDEX_FULL_EXPECTED: Dict[str, type] = {
    "schema_version": str,
    "scope": str,
    "args": dict,
    "workspaces": list,
    "arsenal_registry_audit": dict,
}

INDEX_SINGLE_EXPECTED: Dict[str, type] = {
    "schema_version": str,
    "scope": str,
    "args": dict,
    "workspaces": list,
}

INDEX_WORKSPACE_KEYS = {
    "target", "tier", "is_anti_workspace", "audit", "recommended_actions",
}

INDEX_AUDIT_KEYS = {
    "missing_frontmatter", "footer_missing",
    "links_found_for_agent_verification",
    "potential_duplicates", "value_inventory", "all_markdown_files",
}

INDEX_ARSENAL_KEYS = {
    "missing_files", "unregistered_files",
    "registered_count", "filesystem_count",
}


# ─── 검증 헬퍼 ───────────────────────────────────────────────────────────────

def fail(test_name: str, msg: str, errors: List[str]) -> None:
    errors.append(f"[FAIL] {test_name}: {msg}")


def assert_keys(name: str, obj: Dict[str, Any],
                expected: Dict[str, type], errors: List[str]) -> None:
    for k, t in expected.items():
        if k not in obj:
            fail(name, f"missing key: {k}", errors)
        elif not isinstance(obj[k], t):
            fail(name, f"key {k} expected {t.__name__}, got "
                       f"{type(obj[k]).__name__}", errors)


def assert_subset(name: str, expected: set, actual: set,
                  errors: List[str]) -> None:
    missing = expected - actual
    if missing:
        fail(name, f"missing fields: {sorted(missing)}", errors)


def parse_report(stdout: str) -> Dict[str, Any]:
    """첫 헤더 라인을 버리고 JSON 파싱."""
    lines = stdout.split("\n", 1)
    if len(lines) < 2:
        raise ValueError("no JSON body after header")
    return json.loads(lines[1])


def run_script(args: List[str]) -> Tuple[int, str, str]:
    proc = subprocess.run(
        ["python"] + args,
        cwd=ROOT,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    return proc.returncode, proc.stdout, proc.stderr


# ─── 테스트 케이스 ───────────────────────────────────────────────────────────

def test_doctor_root(errors: List[str]) -> None:
    rc, out, err = run_script(["arsenal/hames_doctor.py"])
    if rc != 0:
        fail("doctor_root", f"non-zero exit {rc}: {err[:200]}", errors)
        return
    try:
        report = parse_report(out)
    except Exception as e:
        fail("doctor_root", f"parse error: {e}", errors)
        return

    assert_keys("doctor_root", report, DOCTOR_EXPECTED, errors)
    if report.get("schema_version") != "doctor-2026-05-08.v2":
        fail("doctor_root",
             f"schema_version mismatch: {report.get('schema_version')}",
             errors)
    if report.get("scope") != "root":
        fail("doctor_root", f"scope expected 'root', got {report.get('scope')}",
             errors)
    if isinstance(report.get("issues"), dict):
        assert_subset("doctor_root.issues",
                      DOCTOR_ISSUE_KEYS, set(report["issues"].keys()), errors)

    # recommended_actions 안의 각 항목이 고정 스키마인지
    for i, action in enumerate(report.get("recommended_actions", [])):
        if not isinstance(action, dict):
            fail("doctor_root.recommended_actions",
                 f"item {i} not dict", errors)
            continue
        assert_subset(f"doctor_root.recommended_actions[{i}]",
                      DOCTOR_ACTION_KEYS, set(action.keys()), errors)


def test_doctor_workspace(errors: List[str]) -> None:
    # Test workspace-filtered doctor run. Uses 'Investment' (default workspace
    # in workspaces/) — replace with any workspace the user has if Investment
    # is absent.
    rc, out, err = run_script(["arsenal/hames_doctor.py", "Investment"])
    if rc != 0:
        fail("doctor_workspace", f"non-zero exit {rc}: {err[:200]}", errors)
        return
    try:
        report = parse_report(out)
    except Exception as e:
        fail("doctor_workspace", f"parse error: {e}", errors)
        return
    if report.get("scope") != "workspace:Investment":
        fail("doctor_workspace",
             f"scope expected 'workspace:Investment', got {report.get('scope')}",
             errors)


def test_index_full(errors: List[str]) -> None:
    rc, out, err = run_script(["arsenal/manager.py"])
    if rc != 0:
        fail("index_full", f"non-zero exit {rc}: {err[:200]}", errors)
        return
    try:
        report = parse_report(out)
    except Exception as e:
        fail("index_full", f"parse error: {e}", errors)
        return

    assert_keys("index_full", report, INDEX_FULL_EXPECTED, errors)
    if report.get("schema_version") != "index-2026-05-08":
        fail("index_full",
             f"schema_version mismatch: {report.get('schema_version')}",
             errors)
    if report.get("scope") != "all":
        fail("index_full", f"scope expected 'all', got {report.get('scope')}",
             errors)

    # 각 워크스페이스 리포트 스키마
    for i, ws in enumerate(report.get("workspaces", [])):
        if not isinstance(ws, dict):
            fail("index_full.workspaces", f"item {i} not dict", errors)
            continue
        assert_subset(f"index_full.workspaces[{i}]",
                      INDEX_WORKSPACE_KEYS, set(ws.keys()), errors)
        if ws.get("tier") not in ("deep", "light"):
            fail(f"index_full.workspaces[{i}].tier",
                 f"expected deep|light, got {ws.get('tier')}", errors)
        audit = ws.get("audit")
        if isinstance(audit, dict):
            assert_subset(f"index_full.workspaces[{i}].audit",
                          INDEX_AUDIT_KEYS, set(audit.keys()), errors)

    # arsenal_registry_audit
    arsenal = report.get("arsenal_registry_audit")
    if isinstance(arsenal, dict):
        assert_subset("index_full.arsenal_registry_audit",
                      INDEX_ARSENAL_KEYS, set(arsenal.keys()), errors)


def test_index_alias(errors: List[str]) -> None:
    rc, out, err = run_script(["arsenal/manager.py", "COMPANY"])
    if rc != 0:
        fail("index_alias", f"non-zero exit {rc}: {err[:200]}", errors)
        return
    try:
        report = parse_report(out)
    except Exception as e:
        fail("index_alias", f"parse error: {e}", errors)
        return

    assert_keys("index_alias", report, INDEX_SINGLE_EXPECTED, errors)
    if report.get("scope") != "single":
        fail("index_alias",
             f"scope expected 'single', got {report.get('scope')}", errors)
    resolved = report.get("args", {}).get("resolved", [])
    if resolved != ["workspaces/Company"]:
        fail("index_alias",
             f"alias COMPANY → resolved {resolved}, expected ['workspaces/Company']",
             errors)


def test_index_path(errors: List[str]) -> None:
    rc, out, err = run_script(["arsenal/manager.py", "nested-project/sub-app"])
    if rc != 0:
        fail("index_path", f"non-zero exit {rc}: {err[:200]}", errors)
        return
    try:
        report = parse_report(out)
    except Exception as e:
        fail("index_path", f"parse error: {e}", errors)
        return
    if not report.get("workspaces"):
        fail("index_path", "no workspaces in report", errors)
        return
    ws = report["workspaces"][0]
    if ws.get("target") != "nested-project/sub-app":
        fail("index_path", f"target expected nested-project/sub-app, got {ws.get('target')}",
             errors)
    if ws.get("tier") != "light":
        fail("index_path",
             f"nested-project/sub-app expected tier=light, got {ws.get('tier')}", errors)


# ─── 진입점 ──────────────────────────────────────────────────────────────────

def main() -> int:
    errors: List[str] = []
    test_doctor_root(errors)
    test_doctor_workspace(errors)
    test_index_full(errors)
    test_index_alias(errors)
    test_index_path(errors)

    if errors:
        sys.stderr.write("\n".join(errors) + "\n")
        sys.stderr.write(f"\n{len(errors)} failure(s).\n")
        return 1
    print("All shape tests passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
