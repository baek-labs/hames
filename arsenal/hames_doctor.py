import os
import re
import json
import sys
import subprocess

# [Hames Doctor v17.0 - System Integrity Checker]
# Changes over v16:
# - New: scan_hook_parity — cross-env hook script registration parity
#        (.claude/.codex/.gemini/.cursor) catches drift like a script registered
#        in some envs but not others.
# - New: scan_hook_matcher_drift — same (event, script) matcher consistency
#        across envs after token normalization (Write↔write_file, Edit↔replace,
#        Bash↔run_shell_command).
# - New: scan_inline_hooks — surfaces inline `python -c` / `node -e` hook
#        commands per env so cross-env presence can be compared by the CEO.
# - Kept v16 behavior: scan_hook_surface still verifies referenced files exist;
#        the new parity check operates on registration, not file existence.

SCHEMA_VERSION = "doctor-2026-05-08.v2"

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')


class HamesDoctor:
    def __init__(self, root_dir: str = ".", workspace_filter: str = None):
        self.root_dir = os.path.abspath(root_dir)
        self.workspace_filter = workspace_filter  # /doctor <workspace> 모드용 필터
        self.scope = (
            f"workspace:{workspace_filter}" if workspace_filter else "root"
        )
        self.report = {
            "schema_version": SCHEMA_VERSION,
            "scope": self.scope,
            "issues": {
                "stale_permissions": [],
                "arsenal_issues": [],
                "rule_module_issues": [],
                "workspace_isolation_issues": [],
                "path_reference_issues": [],
                "command_surface_issues": [],
                "hook_surface_issues": [],
                "hook_parity_issues": [],
                "hook_matcher_drift_issues": [],
                "inline_hook_issues": [],
                "runtime_encoding_issues": [],
                "workspace_registry_issues": [],
            },
            "documentation_drift_warnings": [],
            "recommended_actions": [],
        }
        # Backward-compat: also expose top-level keys so old consumers
        # that read `report["stale_permissions"]` directly keep working.
        # These aliases point to the same lists in `issues`.
        for key in [
            "stale_permissions", "arsenal_issues", "rule_module_issues",
            "workspace_isolation_issues", "runtime_encoding_issues",
        ]:
            self.report[key] = self.report["issues"][key]

    def scan_runtime_encoding(self):
        """
        Detect Windows shell states that commonly mojibake UTF-8 Korean output.
        A Hames UTF-8 bootstrap marks the session with HAMES_UTF8_READY=1.
        """
        if os.name != "nt":
            return

        observed = {
            "hames_utf8_ready": os.environ.get("HAMES_UTF8_READY", ""),
            "pythonioencoding": os.environ.get("PYTHONIOENCODING", ""),
        }

        ps = r"""
$ErrorActionPreference = 'SilentlyContinue'
$cpText = (chcp.com) -join ''
$active = ($cpText -replace '[^\d]', '')
[ordered]@{
  output_encoding = $OutputEncoding.WebName
  output_codepage = $OutputEncoding.CodePage
  console_input_codepage = [Console]::InputEncoding.CodePage
  console_output_codepage = [Console]::OutputEncoding.CodePage
  active_code_page = $active
  pythonioencoding = $env:PYTHONIOENCODING
  hames_utf8_ready = $env:HAMES_UTF8_READY
} | ConvertTo-Json -Compress
"""
        try:
            proc = subprocess.run(
                ["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", ps],
                cwd=self.root_dir,
                text=True,
                encoding="utf-8",
                errors="replace",
                capture_output=True,
                timeout=5,
            )
            if proc.stdout.strip().startswith("{"):
                observed.update(json.loads(proc.stdout.strip()))
        except Exception as exc:
            observed["probe_error"] = str(exc)

        ready = observed.get("hames_utf8_ready") == "1"
        active_cp = str(observed.get("active_code_page", "")).strip()
        output_cp = str(observed.get("output_codepage", "")).strip()
        console_output_cp = str(observed.get("console_output_codepage", "")).strip()
        pyenc = str(observed.get("pythonioencoding", "")).lower()

        if ready:
            return

        if (
            active_cp != "65001"
            or output_cp != "65001"
            or console_output_cp != "65001"
            or "utf-8" not in pyenc
        ):
            self.report["issues"]["runtime_encoding_issues"].append({
                "surface": "powershell_runtime",
                "issue": "Codex/PowerShell session is not Hames UTF-8 bootstrapped; Korean shell output may appear mojibaked even when files are valid UTF-8.",
                "observed": observed,
                "expected": {
                    "active_code_page": "65001",
                    "pythonioencoding": "utf-8",
                    "hames_utf8_ready": "1",
                },
                "remediation": "Dot-source arsenal/set_hames_utf8.ps1 before Korean-heavy shell output or launch Codex through arsenal/start_hames_codex.ps1 / hames_wrap.ps1.",
            })

    def scan_permissions(self):
        """
        settings.local.json의 permissions.allow 목록에서 불필요한 항목을 탐지한다.
        판단 기준:
        1. __TRACKED_VAR__ — 플레이스홀더 텍스트 잔재
        2. Arsenal에 존재하지 않는 파일 참조
        3. 특정 경로가 하드코딩된 일회성 mv/cp 명령
        """
        settings_path = os.path.join(self.root_dir, ".claude", "settings.local.json")
        if not os.path.exists(settings_path):
            return

        try:
            with open(settings_path, 'r', encoding='utf-8') as f:
                data = json.load(f)
        except Exception:
            return

        allows = data.get("permissions", {}).get("allow", [])
        arsenal_path = os.path.join(self.root_dir, "Anti", ".Arsenal")

        for entry in allows:
            reasons = []

            # 기준 1: 플레이스홀더 텍스트
            if "__TRACKED_VAR__" in entry:
                reasons.append("placeholder_text")

            # 기준 2: Arsenal에 없는 파일 참조
            # \b 경계로 .js가 .json/.jsx 등을 잘못 잡지 않도록 차단.
            for match in re.findall(r'arsenal/([\w\-]+\.(?:ps1|py|js|sh))\b', entry):
                if not os.path.exists(os.path.join(arsenal_path, match)):
                    reasons.append(f"missing_arsenal_file:{match}")

            # 기준 3: 절대 경로가 하드코딩된 일회성 mv/cp 명령
            if re.search(r'Bash\(mv\s', entry) and re.search(r'[A-Z]:[/\\]|/[a-z]/Users/', entry):
                reasons.append("one_off_path_command")

            if reasons:
                label = entry[:100] + "..." if len(entry) > 100 else entry
                self.report["stale_permissions"].append({
                    "entry": label,
                    "reasons": reasons
                })

    def scan_arsenal_registry(self):
        """
        arsenal/CLAUDE.md에 등록된 파일들이 실제로 존재하는지 확인한다.
        """
        arsenal_claude = os.path.join(self.root_dir, "Anti", ".Arsenal", "CLAUDE.md")
        arsenal_dir = os.path.join(self.root_dir, "Anti", ".Arsenal")

        if not os.path.exists(arsenal_claude):
            self.report["arsenal_issues"].append("arsenal/CLAUDE.md not found")
            return

        with open(arsenal_claude, 'r', encoding='utf-8') as f:
            content = f.read()

        # Extract backtick-wrapped filenames/paths from tables
        refs = re.findall(r'`([\w\-./]+\.(?:py|js|ps1|sh))`', content)

        for ref in set(refs):
            # 루트 기준 경로(.claude/..., arsenal/, workspaces/...)와 Arsenal 내부 경로(manager.py,
            # legacy_tool/scraper.js)를 분리해 해석한다. 과거에는 모두
            # arsenal_dir 기준이라 .claude/hooks/workspace_guard.js가 오탐됐다.
            if ref.startswith('.') or ref.startswith('workspaces/'):
                full_path = os.path.join(self.root_dir, ref.replace("/", os.sep))
            else:
                full_path = os.path.join(arsenal_dir, ref.replace("/", os.sep))
            if not os.path.exists(full_path):
                self.report["arsenal_issues"].append(f"Missing: {ref}")

    def scan_rule_modules(self):
        """
        루트 CLAUDE.md의 @-import 대상 모듈들이 실제로 존재하는지 확인한다.
        """
        root_claude = os.path.join(self.root_dir, "CLAUDE.md")
        if not os.path.exists(root_claude):
            self.report["rule_module_issues"].append("Root CLAUDE.md not found")
            return

        with open(root_claude, 'r', encoding='utf-8') as f:
            content = f.read()

        # Find @path/to/file.md import patterns
        imports = re.findall(r'^@([\w./\-]+\.md)', content, re.MULTILINE)
        for imp in imports:
            full_path = os.path.join(self.root_dir, imp.replace("/", os.sep))
            if not os.path.exists(full_path):
                self.report["rule_module_issues"].append(f"Missing: {imp}")

    def scan_path_references(self):
        """
        주요 메타 문서들이 인용한 백틱-감싼 상대 경로가 실제로 존재하는지 검사.
        대상: 루트 CLAUDE.md, AGENTS.md, .cursor/rules/*.md
        제외: HamesSystem_Public.md (정본 아님, 설명 문서)
        """
        targets = [
            "CLAUDE.md",
            "AGENTS.md",
        ]
        rules_dir = os.path.join(self.root_dir, ".cursor", "rules")
        if os.path.isdir(rules_dir):
            for f in sorted(os.listdir(rules_dir)):
                if f.endswith(".md"):
                    targets.append(os.path.join(".cursor", "rules", f))

        # 백틱-감싼 상대 경로 추출 (URL 제외, 확장자 제한)
        path_re = re.compile(
            r'`((?:\.claude|\.gemini|\.codex|\.cursor|\.agent|arsenal|workspaces)/'
            r'[\w\-./]+\.(?:py|js|ps1|sh|toml|json|md|html))`'
        )

        for rel in targets:
            full = os.path.join(self.root_dir, rel.replace("/", os.sep))
            if not os.path.exists(full):
                continue
            try:
                with open(full, 'r', encoding='utf-8') as f:
                    content = f.read()
            except Exception:
                continue
            for ref in set(path_re.findall(content)):
                ref_full = os.path.join(self.root_dir, ref.replace("/", os.sep))
                if not os.path.exists(ref_full):
                    self.report["issues"]["path_reference_issues"].append({
                        "source": rel.replace("\\", "/"),
                        "ref": ref,
                        "issue": "referenced path does not exist",
                    })

    def scan_workspace_isolation(self):
        """
        isolated domain 구조가 올바른지 점검한다.
        - required: 반드시 존재해야 하는 항목
        - recommended: 없으면 경고 (fallback 허용 여부 명시)

        기본 설치에는 isolated domain이 없다. 사용자가 자체 isolated domain을
        추가했다면 이 dict를 직접 채우거나, 향후 audit_exclusions.json에서
        선언적으로 읽어오도록 확장 가능. docs/04_workspace_model.md advanced
        절의 isolated domain pattern 참조.
        """
        isolated = {}

        for ws_name, spec in isolated.items():
            ws_path = os.path.join(self.root_dir, ws_name)
            if not os.path.exists(ws_path):
                self.report["workspace_isolation_issues"].append(
                    f"{ws_name}: workspace directory not found"
                )
                continue

            for req in spec["required"]:
                req_path = os.path.join(ws_path, req.replace("/", os.sep))
                if not os.path.exists(req_path):
                    self.report["workspace_isolation_issues"].append(
                        f"{ws_name}: missing required — {req}"
                    )

            for rec in spec.get("recommended", []):
                rec_path = os.path.join(ws_path, rec.replace("/", os.sep))
                if not os.path.exists(rec_path):
                    note = spec.get("fallback_note", "")
                    msg = f"{ws_name}: missing recommended — {rec}"
                    if note:
                        msg += f" ({note})"
                    self.report["workspace_isolation_issues"].append(msg)

    def scan_command_surface(self):
        """
        .claude/commands, .gemini/commands, .codex/skills, .agent/skills
        4개 환경 간 커맨드 surface가 동기화돼 있는지 검사.
        """
        envs = {
            ".claude": (".claude/commands", "*.md", lambda f: f[:-3]),
            ".gemini": (".gemini/commands", "*.toml", lambda f: f[:-5]),
            ".codex":  (".codex/skills",   "source-command-*",
                        lambda f: f.replace("source-command-", "")),
            ".agent":  (".agent/skills",   "source-command-*",
                        lambda f: f.replace("source-command-", "")),
        }
        per_env = {}
        for env, (subdir, _pat, namer) in envs.items():
            full = os.path.join(self.root_dir, subdir.replace("/", os.sep))
            if not os.path.isdir(full):
                per_env[env] = None  # 환경 없음 → 비교 대상에서 제외
                continue
            names = set()
            for entry in os.listdir(full):
                ep = os.path.join(full, entry)
                if env in (".codex", ".agent"):
                    if os.path.isdir(ep) and entry.startswith("source-command-"):
                        names.add(namer(entry))
                else:
                    if os.path.isfile(ep):
                        if env == ".claude" and entry.endswith(".md"):
                            names.add(namer(entry))
                        elif env == ".gemini" and entry.endswith(".toml"):
                            names.add(namer(entry))
            per_env[env] = names

        active = {e: n for e, n in per_env.items() if n is not None}
        if len(active) < 2:
            return  # 비교 불가
        union = set().union(*active.values())
        for cmd in sorted(union):
            missing = [e for e, n in active.items() if cmd not in n]
            if missing:
                self.report["issues"]["command_surface_issues"].append({
                    "command": cmd,
                    "missing_in": missing,
                })

    def scan_hook_surface(self):
        """
        .claude/settings.json, .codex/config.toml, .codex/hooks.json 의
        hook command 문자열에서 참조된 스크립트 경로가 실제로 있는지 검사.
        """
        hook_sources = [
            ".claude/settings.json",
            ".codex/hooks.json",
            ".codex/config.toml",
        ]
        # 경로 패턴: Arsenal/* 또는 .claude/hooks/* 등
        ref_re = re.compile(
            r'(?:\$CLAUDE_PROJECT_DIR/|\$\(git rev-parse --show-toplevel\)/|"|\'|\s)'
            r'((?:arsenal|\.claude/hooks|\.codex/hooks)/[\w\-./]+\.(?:js|py|ps1|sh))'
        )
        for rel in hook_sources:
            full = os.path.join(self.root_dir, rel.replace("/", os.sep))
            if not os.path.exists(full):
                continue
            try:
                with open(full, 'r', encoding='utf-8') as f:
                    content = f.read()
            except Exception:
                continue
            for ref in set(ref_re.findall(content)):
                ref_full = os.path.join(self.root_dir, ref.replace("/", os.sep))
                if not os.path.exists(ref_full):
                    self.report["issues"]["hook_surface_issues"].append({
                        "surface": rel,
                        "ref": ref,
                        "issue": "hook script does not exist",
                    })

    # ── Hook surface (cross-environment) helpers ─────────────────────────
    HOOK_ENV_FILES = {
        ".claude": ".claude/settings.json",
        ".codex":  ".codex/hooks.json",
        ".gemini": ".gemini/settings.json",
        ".cursor": ".cursor/hooks.json",
    }

    # Cursor 가 구조적으로 지원 못 하는 hook 은 parity 검사에서 제외.
    # (Cursor 자체 _comment 로 beforeFileEdit/beforeWriteFile 미지원 명시)
    CURSOR_PARITY_EXEMPT = {
        "verify_frontmatter_block.js",  # Write 사전 차단 — Cursor 불가
    }

    # Environment-specific helper hooks. These are intentionally not required
    # everywhere because they support one host's integration surface rather
    # than a shared safety gate.
    PARITY_MISSING_EXEMPT = {
        "index_post_write_auditor.py": {".claude", ".cursor", ".gemini"},
    }

    # 이벤트 정규화 (matcher drift 용)
    HOOK_EVENT_NORM = {
        "PreToolUse": "pre",
        "BeforeTool": "pre",
        "PostToolUse": "post",
        "AfterTool": "post",
    }

    # matcher 토큰 정규화 (Claude/Codex ↔ Gemini 도구명 차이 흡수)
    HOOK_MATCHER_NORM = {
        "Write": "write", "write_file": "write",
        "Edit": "edit",   "replace": "edit",
        "MultiEdit": "multiedit",
        "NotebookEdit": "notebookedit",
        "Bash": "bash",   "run_shell_command": "bash",
    }

    def _parse_hook_command(self, cmd):
        """
        hook command 문자열을 파싱해 (real script basename, inline 여부) 추출.
        - hook_adapter.js 는 transport 라 실제 hook 으로 간주하지 않음.
        - python -c / node -e 는 inline 으로 분류.
        """
        cmd_strip = (cmd or "").strip()
        if re.match(r'^"?python\d*"?\s+-c\s', cmd_strip):
            return {
                "raw_command": cmd, "script_basename": None,
                "is_inline": True, "inline_kind": "python",
            }
        if re.match(r'^"?node"?\s+-e\s', cmd_strip):
            return {
                "raw_command": cmd, "script_basename": None,
                "is_inline": True, "inline_kind": "node",
            }
        # 마지막에 등장하는 .js/.py/.ps1/.sh basename 을 실제 hook 으로 본다.
        # hook_adapter.js 는 제외.
        matches = re.findall(
            r'([\w\-]+\.(?:js|py|ps1|sh))', cmd_strip
        )
        real = [m for m in matches if m != "hook_adapter.js"]
        return {
            "raw_command": cmd,
            "script_basename": real[-1] if real else (matches[-1] if matches else None),
            "is_inline": False,
            "inline_kind": None,
        }

    def _load_env_hooks(self, env, rel):
        """
        환경별 hook 설정을 평탄화한 entry 리스트로 반환.
        entry: {env, event, matcher, raw_command, script_basename, is_inline, inline_kind}
        env 자체가 없으면 None 반환.
        """
        full = os.path.join(self.root_dir, rel.replace("/", os.sep))
        if not os.path.exists(full):
            return None
        try:
            with open(full, "r", encoding="utf-8") as f:
                data = json.load(f)
        except Exception:
            return None

        hooks_root = data.get("hooks", {})
        entries = []

        if env == ".cursor":
            # Cursor: hooks.{eventName}: [{command, ...}, ...] (matcher 없음)
            for event_name, lst in hooks_root.items():
                if not isinstance(lst, list) or event_name.startswith("_"):
                    continue
                for h in lst:
                    parsed = self._parse_hook_command(h.get("command", ""))
                    parsed.update({
                        "env": env, "event": event_name, "matcher": None,
                    })
                    entries.append(parsed)
        else:
            # Claude/Codex/Gemini: hooks.{eventName}: [{matcher, hooks: [{command,...}]}]
            for event_name, lst in hooks_root.items():
                if not isinstance(lst, list) or event_name.startswith("_"):
                    continue
                for block in lst:
                    matcher = block.get("matcher", "")
                    for h in block.get("hooks", []):
                        parsed = self._parse_hook_command(h.get("command", ""))
                        parsed.update({
                            "env": env, "event": event_name, "matcher": matcher,
                        })
                        entries.append(parsed)
        return entries

    # 환경별 고유 이벤트 — 다른 환경엔 동일 이벤트 자체가 없어 parity 비교 무의미.
    # 이 이벤트에서만 등록된 hook 은 parity 검사 대상에서 제외.
    ENV_EXCLUSIVE_EVENTS = {
        ".claude": {"SessionStart"},
        ".codex":  set(),
        ".gemini": set(),
        ".cursor": {"beforeSubmitPrompt"},  # Cursor 고유
    }

    def scan_hook_parity(self):
        """
        4 환경 간 hook 스크립트 등록 정합성 점검.
        파일 존재(scan_hook_surface)와 별도 — 이 검사는 *등록 여부* 비교.

        규칙:
        - 환경이 script 를 등록(어떤 이벤트로든) → registered_in 에 포함.
        - 어떤 환경에서도 표준 이벤트(PreToolUse/PostToolUse/BeforeTool/AfterTool)
          로 등록되지 않은 script (= 모든 등록이 환경 고유 이벤트) 는 비교 제외.
          (예: session_capture.js — Claude SessionStart 전용)
        - Cursor 는 Write 사전 차단 미지원이므로 일부 스크립트 면제.
        """
        per_env_scripts = {}  # env -> set of all scripts registered in any event
        script_in_standard_event = set()  # scripts with ≥1 registration in a non-exclusive event
        for env, rel in self.HOOK_ENV_FILES.items():
            entries = self._load_env_hooks(env, rel)
            if entries is None:
                per_env_scripts[env] = None
                continue
            scripts = set()
            exclusive = self.ENV_EXCLUSIVE_EVENTS.get(env, set())
            for e in entries:
                if e["script_basename"] and not e["is_inline"]:
                    scripts.add(e["script_basename"])
                    if e["event"] not in exclusive:
                        script_in_standard_event.add(e["script_basename"])
            per_env_scripts[env] = scripts

        active = {e: s for e, s in per_env_scripts.items() if s is not None}
        if len(active) < 2:
            return

        union = set().union(*active.values())
        for script in sorted(union):
            # 환경 고유 이벤트 전용으로만 등록된 script 는 비교 대상 아님
            if script not in script_in_standard_event:
                continue
            registered_in = sorted([e for e, s in active.items() if script in s])
            missing_in    = sorted([e for e, s in active.items() if script not in s])
            # Cursor 면제 적용
            if ".cursor" in missing_in and script in self.CURSOR_PARITY_EXEMPT:
                missing_in = [m for m in missing_in if m != ".cursor"]
            exempt_envs = self.PARITY_MISSING_EXEMPT.get(script, set())
            if exempt_envs:
                missing_in = [m for m in missing_in if m not in exempt_envs]
            if missing_in:
                self.report["issues"]["hook_parity_issues"].append({
                    "script": script,
                    "registered_in": registered_in,
                    "missing_in": missing_in,
                })

    # 환경별로 그 환경이 *지원하지 않는* 도구 토큰. matcher drift 비교 시
    # 비교 양쪽이 가진 공통 토큰 집합 안에서만 차이를 본다 (능력 차이는 무시).
    ENV_UNSUPPORTED_TOOLS = {
        ".claude": set(),
        ".codex":  set(),
        ".gemini": {"multiedit", "notebookedit"},  # Gemini 는 해당 도구 없음
    }

    def scan_hook_matcher_drift(self):
        """
        같은 (event, script) 가 환경 간 동일한 정규화 matcher 셋을 갖는지 검사.
        Claude/Codex/Gemini 만 비교 (Cursor 는 matcher 개념 없음 — 별도).
        환경별 미지원 도구는 비교에서 제외하여 false positive 방지.
        """
        envs = {k: v for k, v in self.HOOK_ENV_FILES.items() if k != ".cursor"}
        drift_map = {}  # (event_canon, script) -> {env: matcher_token_set}
        for env, rel in envs.items():
            entries = self._load_env_hooks(env, rel)
            if entries is None:
                continue
            for e in entries:
                if not e["script_basename"] or e["is_inline"]:
                    continue
                ec = self.HOOK_EVENT_NORM.get(e["event"])
                if ec is None:
                    continue
                tokens = set()
                for tok in (e["matcher"] or "").split("|"):
                    tok = tok.strip()
                    if not tok:
                        continue
                    tokens.add(self.HOOK_MATCHER_NORM.get(tok, tok.lower()))
                drift_map.setdefault((ec, e["script_basename"]), {})[env] = tokens

        for (event, script), env_matchers in sorted(drift_map.items()):
            if len(env_matchers) < 2:
                continue
            # 비교는 *모든 비교 환경이 공통으로 지원* 하는 토큰 안에서만.
            # = 전체 토큰 합집합 - (각 비교 환경이 미지원하는 토큰 합집합)
            universe = set()
            for env, tokens in env_matchers.items():
                universe |= tokens
            universe |= set().union(*(
                self.ENV_UNSUPPORTED_TOOLS.get(e, set()) for e in env_matchers
            ))
            common = universe.copy()
            for env in env_matchers:
                common -= self.ENV_UNSUPPORTED_TOOLS.get(env, set())
            common_per_env = {e: m & common for e, m in env_matchers.items()}

            vals = list(common_per_env.values())
            if not all(v == vals[0] for v in vals[1:]):
                self.report["issues"]["hook_matcher_drift_issues"].append({
                    "event": event,
                    "script": script,
                    "per_env_normalized": {e: sorted(m) for e, m in common_per_env.items()},
                    "per_env_raw": {e: sorted(m) for e, m in env_matchers.items()},
                })

    def scan_inline_hooks(self):
        """
        인라인 hook (python -c / node -e) 를 환경별로 표면화.
        의도된 차이인지 drift 인지 사람이 판단할 수 있도록 raw 보고만.
        """
        for env, rel in self.HOOK_ENV_FILES.items():
            entries = self._load_env_hooks(env, rel)
            if entries is None:
                continue
            for e in entries:
                if e["is_inline"]:
                    snippet = (e["raw_command"] or "").strip()
                    if len(snippet) > 160:
                        snippet = snippet[:160] + "..."
                    self.report["issues"]["inline_hook_issues"].append({
                        "env": env,
                        "event": e["event"],
                        "matcher": e.get("matcher"),
                        "interpreter": e["inline_kind"],
                        "snippet": snippet,
                    })

    def scan_workspace_registry(self):
        """
        .claude/workspace_paths.json 의 alias→경로 매핑이 실제로 존재하는지 검사.
        """
        reg_path = os.path.join(
            self.root_dir, ".claude", "workspace_paths.json"
        )
        if not os.path.exists(reg_path):
            self.report["issues"]["workspace_registry_issues"].append({
                "alias": None,
                "path": ".claude/workspace_paths.json",
                "issue": "registry file not found",
            })
            return
        try:
            with open(reg_path, 'r', encoding='utf-8') as f:
                reg = json.load(f)
        except Exception as e:
            self.report["issues"]["workspace_registry_issues"].append({
                "alias": None,
                "path": ".claude/workspace_paths.json",
                "issue": f"parse error: {e}",
            })
            return
        for alias, ws_rel in reg.items():
            full = os.path.join(self.root_dir, ws_rel.replace("/", os.sep))
            if not os.path.exists(full):
                self.report["issues"]["workspace_registry_issues"].append({
                    "alias": alias,
                    "path": ws_rel,
                    "issue": "workspace path does not exist on disk",
                })

    def scan_documentation_drift(self):
        """
        HamesSystem_Public.md 는 정본이 아닌 설명 문서. 따라서 source-of-truth 검사
        대상에서 제외하되, 인용된 핵심 서명(예: 커널 버전 라인)이 실제 시스템
        파일과 어긋날 때만 좁게 경고를 발한다.
        """
        hs_path = os.path.join(self.root_dir, "HamesSystem_Public.md")
        kernel_path = os.path.join(self.root_dir, "CLAUDE.md")
        if not os.path.exists(hs_path) or not os.path.exists(kernel_path):
            return

        kernel_re = re.compile(r'HAMES SYSTEM KERNEL\s+v\d+\.\d+')

        try:
            with open(kernel_path, 'r', encoding='utf-8') as f:
                kernel_text = f.read()
            with open(hs_path, 'r', encoding='utf-8') as f:
                hs_text = f.read()
        except Exception:
            return

        kernel_versions = set(kernel_re.findall(kernel_text))
        hs_versions = set(kernel_re.findall(hs_text))

        if not kernel_versions or not hs_versions:
            return

        drifted = hs_versions - kernel_versions
        if drifted:
            self.report["documentation_drift_warnings"].append({
                "file": "HamesSystem_Public.md",
                "warning": (
                    "HamesSystem_Public.md 는 설명 문서로, 정본은 루트 CLAUDE.md 입니다. "
                    f"HamesSystem_Public.md 가 인용한 커널 서명 {sorted(drifted)} 이 "
                    f"현재 커널 {sorted(kernel_versions)} 과 다릅니다. "
                    "사람이 직접 갱신하세요."
                ),
            })

    def build_recommended_actions(self):
        """
        issues 목록을 구조화된 action 리스트로 변환. 다운스트림 도구나
        후속 승인 워크플로우가 그대로 사용할 수 있도록 고정 스키마.
        """
        actions = []
        counter = [0]

        def _next_id():
            counter[0] += 1
            return f"RA-doctor-{counter[0]:03d}"

        for entry in self.report["issues"]["stale_permissions"]:
            actions.append({
                "id": _next_id(),
                "action_type": "remove_permission",
                "target_path": ".claude/settings.local.json",
                "proposed_change": (
                    f"permissions.allow 항목 제거: {entry['entry']}"
                ),
                "risk_level": "low",
                "rationale": ", ".join(entry.get("reasons", [])),
                "source_issue": "issues.stale_permissions",
            })

        for missing in self.report["issues"]["arsenal_issues"]:
            actions.append({
                "id": _next_id(),
                "action_type": "investigate",
                "target_path": "arsenal/CLAUDE.md",
                "proposed_change": (
                    f"레지스트리 항목 확인 및 정정: {missing}"
                ),
                "risk_level": "medium",
                "rationale": "registered tool path not found on disk",
                "source_issue": "issues.arsenal_issues",
            })

        for missing in self.report["issues"]["rule_module_issues"]:
            actions.append({
                "id": _next_id(),
                "action_type": "investigate",
                "target_path": "CLAUDE.md",
                "proposed_change": (
                    f"@-import 모듈 복구 또는 import 제거: {missing}"
                ),
                "risk_level": "high",
                "rationale": "kernel @-import target missing — kernel load may fail",
                "source_issue": "issues.rule_module_issues",
            })

        for issue in self.report["issues"]["workspace_isolation_issues"]:
            actions.append({
                "id": _next_id(),
                "action_type": "create_file",
                "target_path": issue,
                "proposed_change": "격리 워크스페이스 누락 항목 생성",
                "risk_level": "low",
                "rationale": "isolated workspace structural requirement",
                "source_issue": "issues.workspace_isolation_issues",
            })

        for issue in self.report["issues"]["path_reference_issues"]:
            actions.append({
                "id": _next_id(),
                "action_type": "investigate",
                "target_path": issue["source"],
                "proposed_change": (
                    f"인용된 경로 정정 또는 인용 제거: {issue['ref']}"
                ),
                "risk_level": "medium",
                "rationale": issue["issue"],
                "source_issue": "issues.path_reference_issues",
            })

        for issue in self.report["issues"]["command_surface_issues"]:
            actions.append({
                "id": _next_id(),
                "action_type": "investigate",
                "target_path": ", ".join(issue["missing_in"]),
                "proposed_change": (
                    f"/{issue['command']} 커맨드 미러 생성 또는 단일화"
                ),
                "risk_level": "medium",
                "rationale": "command surface drift across environments",
                "source_issue": "issues.command_surface_issues",
            })

        for issue in self.report["issues"]["hook_surface_issues"]:
            actions.append({
                "id": _next_id(),
                "action_type": "investigate",
                "target_path": issue["surface"],
                "proposed_change": (
                    f"hook 참조 정정 또는 스크립트 복구: {issue['ref']}"
                ),
                "risk_level": "high",
                "rationale": issue["issue"],
                "source_issue": "issues.hook_surface_issues",
            })

        for issue in self.report["issues"]["hook_parity_issues"]:
            actions.append({
                "id": _next_id(),
                "action_type": "investigate",
                "target_path": ", ".join(issue["missing_in"]),
                "proposed_change": (
                    f"hook 등록 동기화: {issue['script']} 가 "
                    f"{issue['registered_in']} 에는 있고 "
                    f"{issue['missing_in']} 에는 누락"
                ),
                "risk_level": "high",
                "rationale": "hook registration parity drift across envs",
                "source_issue": "issues.hook_parity_issues",
            })

        for issue in self.report["issues"]["hook_matcher_drift_issues"]:
            actions.append({
                "id": _next_id(),
                "action_type": "investigate",
                "target_path": ", ".join(sorted(
                    issue.get("per_env_normalized", issue.get("per_env", {})).keys()
                )),
                "proposed_change": (
                    f"matcher 통일: {issue['event']}/{issue['script']} 의 "
                    f"환경별 matcher 가 다름 — "
                    f"{issue.get('per_env_normalized', issue.get('per_env'))}"
                ),
                "risk_level": "medium",
                "rationale": "same hook fires on different tool sets across envs",
                "source_issue": "issues.hook_matcher_drift_issues",
            })

        for issue in self.report["issues"]["inline_hook_issues"]:
            actions.append({
                "id": _next_id(),
                "action_type": "investigate",
                "target_path": issue["env"],
                "proposed_change": (
                    f"인라인 {issue['interpreter']} hook 검토 "
                    f"({issue['event']}, matcher={issue['matcher']}): "
                    f"{issue['snippet']}"
                ),
                "risk_level": "low",
                "rationale": "inline hook detected — verify cross-env intent",
                "source_issue": "issues.inline_hook_issues",
            })

        for issue in self.report["issues"]["runtime_encoding_issues"]:
            actions.append({
                "id": _next_id(),
                "action_type": "run_bootstrap",
                "target_path": "arsenal/set_hames_utf8.ps1",
                "proposed_change": (
                    "Codex/PowerShell session UTF-8 bootstrap 적용 "
                    "(chcp 65001, Console/Input/OutputEncoding UTF-8, PYTHONIOENCODING=utf-8)"
                ),
                "risk_level": "low",
                "rationale": issue["issue"],
                "source_issue": "issues.runtime_encoding_issues",
            })

        for issue in self.report["issues"]["workspace_registry_issues"]:
            actions.append({
                "id": _next_id(),
                "action_type": "remove_registry_entry"
                                if issue.get("alias") else "investigate",
                "target_path": ".claude/workspace_paths.json",
                "proposed_change": (
                    f"alias '{issue.get('alias')}' → '{issue.get('path')}' "
                    f"항목 제거 또는 경로 생성"
                ),
                "risk_level": "low",
                "rationale": issue["issue"],
                "source_issue": "issues.workspace_registry_issues",
            })

        self.report["recommended_actions"] = actions

    def apply_workspace_filter(self):
        """
        /doctor <workspace> 모드에서 workspace_isolation_issues 만 필터링.
        나머지 항목은 시스템 전체이므로 그대로 둠.
        """
        if not self.workspace_filter:
            return
        ws = self.workspace_filter
        filtered = [
            x for x in self.report["issues"]["workspace_isolation_issues"]
            if x.startswith(f"{ws}:")
        ]
        self.report["issues"]["workspace_isolation_issues"] = filtered
        self.report["stale_permissions"] = self.report["issues"]["stale_permissions"]
        # alias 재바인딩 (이전 alias가 가리키던 list 참조 유지)

    def run(self):
        self.scan_permissions()
        self.scan_arsenal_registry()
        self.scan_rule_modules()
        self.scan_workspace_isolation()
        self.scan_path_references()
        self.scan_command_surface()
        self.scan_hook_surface()
        self.scan_hook_parity()
        self.scan_hook_matcher_drift()
        self.scan_inline_hooks()
        self.scan_runtime_encoding()
        self.scan_workspace_registry()
        self.scan_documentation_drift()
        self.apply_workspace_filter()
        self.build_recommended_actions()
        print("=== HAMES DOCTOR MRI REPORT ===")
        print(json.dumps(self.report, indent=2, ensure_ascii=False))


def _parse_args(argv):
    workspace = None
    rest = []
    for a in argv:
        if a.startswith("--workspace="):
            workspace = a.split("=", 1)[1]
        elif a in ("--workspace", "-w"):
            # 다음 인자에서 값 받기
            rest.append(("__expect_ws__", True))
        elif rest and rest[-1] == ("__expect_ws__", True):
            workspace = a
            rest.pop()
        else:
            rest.append(a)
    # positional: 첫 번째 비-플래그 인자를 workspace로 허용
    positionals = [a for a in rest if not (isinstance(a, tuple) or a.startswith("-"))]
    if positionals and not workspace:
        workspace = positionals[0]
    return workspace


if __name__ == "__main__":
    ws = _parse_args(sys.argv[1:])
    doctor = HamesDoctor(".", workspace_filter=ws)
    doctor.run()
