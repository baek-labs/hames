import os
import re
import sys
import json
import time
from typing import List, Dict, Set
from urllib.parse import unquote

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')

# [Hames Manager v13.0 - Full Workspace Auditor]
# Changes over v12:
# - No-arg now == --all (full HamesSystem audit) instead of error
# - Alias support: COMPANY / nested-project/sub-app / workspaces/Company 모두 허용
# - Tier rule: ANTI workspaces deep, others light (override: workspace 루트에 _Index.md 있으면 deep)
# - Light tier skips filesystem hygiene (temp/archive/orphan/missing_indexes)
# - Expanded SKIP_DIRS: _vendor, output, cache 추가 (vendor/build noise 제거)
# - Arsenal registry audit section attached when scope == "all"
# - Structured recommended_actions per workspace
# - workspace_paths.json 의 등록된 alias 도 스캔 대상에 포함 (중첩 child 는 부모와 중복 제거)

SCHEMA_VERSION = "index-2026-05-08"

ANTI_WORKSPACE_PREFIXES = (
    "workspaces/Investment",
    "workspaces/Business",
    "workspaces/Company",
    "workspaces/Hobby",
)

# Static fallback list (workspace_paths.json 가 우선)
# Default workspaces only. User-added isolated domains are picked up via
# .claude/workspace_paths.json at runtime.
KNOWN_WORKSPACES = [
    "workspaces/Investment",
    "workspaces/Business",
    "workspaces/Company",
    "workspaces/Hobby",
]

ARCHIVE_THRESHOLD_DAYS = 60
TEMP_EXTENSIONS = {".tmp", ".bak", ".log", ".swp", ".DS_Store"}
FOOTER_MARKERS = ["## 관련노트", "## 관련문서", "## Related", "## Links"]
FIELD_ORDER = ["Related", "Topic", "Type", "tags"]
INVENTORY_EXTENSIONS = {
    ".md", ".json", ".txt", ".html", ".py", ".toml", ".yml", ".yaml", ".js", ".css"
}
INVENTORY_SKIP_FILENAMES = {".env", "credentials.json", "token.json"}
INVENTORY_SKIP_DIRS = {"analysis", "raw", "__pycache__"}

# 예외 정의는 audit_exclusions.json 단일 출처에서 로드. 폴더 리네임/새 모드 문서/
# 새 출력 폴더가 생기면 본 파일이 아니라 audit_exclusions.json 만 갱신한다.
_ARSENAL_DIR = os.path.dirname(os.path.abspath(__file__))
_EXCLUSIONS_PATH = os.path.join(_ARSENAL_DIR, "audit_exclusions.json")

# 정적 폴백 (JSON 로드 실패 시에만 사용). v13 기준 최소 안전망.
_FALLBACK_COMMON_SKIP_DIRS = {
    "_Archive", "98_Archive", "_Master", "_Agent", "99_Korean_Book",
    "node_modules", "999_AI_Communication",
    ".next", "dist", "build", "01_Novel",
    "_vendor", "output", "cache", ".turbo", ".vercel", ".cache",
}
_FALLBACK_META_SKIP_FILENAMES = {
    "README.md", "CLAUDE.md", "AGENTS.md", "GEMINI.md",
    "_Index.md", "Project_A.md",
    "Business_Overview.md", "Company_Dashboard.md",
    "HamesSystem_Public.md",
}
_FALLBACK_CONTENT_SKIP_DIRS = {"wall.st_william_mdFiles"}


def _load_exclusions() -> Dict:
    try:
        with open(_EXCLUSIONS_PATH, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception:
        return {}


_EXCL = _load_exclusions()
COMMON_SKIP_DIRS = set(_EXCL.get("common_skip_dirs") or _FALLBACK_COMMON_SKIP_DIRS)
META_SKIP_FILENAMES = set(_EXCL.get("meta_skip_filenames") or _FALLBACK_META_SKIP_FILENAMES)
CONTENT_SKIP_DIRS_DEFAULT = set(_EXCL.get("content_skip_dirs") or _FALLBACK_CONTENT_SKIP_DIRS)
_DUP = _EXCL.get("duplicate_detection") or {}
DUP_EXCLUDE_FILENAMES = set(_DUP.get("exclude_filenames") or [])
DUP_DATE_SERIES = bool(_DUP.get("treat_date_prefix_series_as_single", True))
DATE_PREFIX_RE = re.compile(r'^\d{4}-\d{2}-\d{2}_')


class HamesAuditor:
    def __init__(self, target_root: str, root_dir: str = ".",
                 child_excludes: List[str] = None):
        self.target_root = os.path.abspath(target_root)
        self.root_dir = os.path.abspath(root_dir)

        # Determine if this is an Anti workspace
        rel = os.path.relpath(self.target_root, self.root_dir).replace("\\", "/")
        self.is_anti = any(
            rel == p or rel.startswith(p + "/")
            for p in ANTI_WORKSPACE_PREFIXES
        )

        # Tier 결정: ANTI = deep, 그 외 = light. light 워크스페이스라도
        # 루트에 _Index.md 가 있으면 deep 으로 승격(워크스페이스 계약을
        # 갖췄다는 신호로 본다).
        has_index = os.path.exists(
            os.path.join(self.target_root, "_Index.md")
        )
        self.has_index = has_index
        content_audit_workspaces = set(_EXCL.get("content_audit_workspaces") or [])
        inventory_index_workspaces = set(_EXCL.get("inventory_index_workspaces") or [])
        self.tier = "deep" if (self.is_anti or rel in content_audit_workspaces) else "light"
        self.runs_filesystem_checks = self.is_anti  # temp/archive/orphan/index
        self.requires_inventory_index = rel in inventory_index_workspaces
        self.runs_index_inventory_checks = has_index and (
            self.requires_inventory_index or not self.is_anti
        )

        self.frontmatter_skip_filenames = set(META_SKIP_FILENAMES)
        # 본 어댑터의 컨텐츠 검사 활성 여부.
        # Anti = 항상 ON. 그 외는 워크스페이스 루트에 _Index.md 가 있어
        # 명시적 워크스페이스 계약을 갖춘 경우에만 ON.
        # 이 게이트가 OFF 면 frontmatter/footer/duplicate/wikilink 모두 skip.
        self.runs_content_checks = self.is_anti or rel in content_audit_workspaces
        self.SKIP_DIRS = set(COMMON_SKIP_DIRS)
        # 격리 도메인: 부모 스캔에서 제외 (자기 자신을 직접 타겟할 때만 들어감)
        if rel == "." or rel == "":
            # isolated domains and personal submodules: configure via audit_exclusions.json

        # 부모 스캔에서 child 워크스페이스 경로 제외 (중복 집계 방지)
        self.child_excludes = set(child_excludes or [])

        self.SKIP_PATHS = {
            ".Arsenal", ".git", ".vscode", "999_AI_Communication",
        }
        if rel == "." or rel == "":
            # isolated domains and personal submodules: configure via audit_exclusions.json

        self.CONTENT_SKIP_DIRS = set(CONTENT_SKIP_DIRS_DEFAULT)

        self.report: Dict = {
            "target": rel,
            "tier": self.tier,
            "is_anti_workspace": self.is_anti,
            "audit": {
                "missing_frontmatter": [],
                "footer_missing": [],
                "links_found_for_agent_verification": [],
                "potential_duplicates": [],
                "index_inventory_missing_refs": [],
                "index_inventory_unlisted": [],
                "missing_inventory_index": [],
                "value_inventory": {
                    "Related": {}, "Topic": {}, "Type": {}, "tags": {}
                },
                "all_markdown_files": [],
            },
            "recommended_actions": [],
        }

        # 백워드 호환: 기존 consumer 가 report["missing_frontmatter"] 등 평면
        # 키로 읽던 코드를 그대로 유지하기 위해 audit 내부 list 를 alias.
        for k in [
            "missing_frontmatter", "footer_missing",
            "links_found_for_agent_verification",
            "potential_duplicates", "index_inventory_missing_refs",
            "index_inventory_unlisted", "missing_inventory_index",
            "value_inventory", "all_markdown_files",
        ]:
            self.report[k] = self.report["audit"][k]

        if self.runs_filesystem_checks:
            self.report["audit"]["temp_files"] = []
            self.report["audit"]["archive_candidates"] = []
            self.report["audit"]["orphaned_files"] = []
            self.report["audit"]["missing_indexes"] = []
            for k in ["temp_files", "archive_candidates",
                      "orphaned_files", "missing_indexes"]:
                self.report[k] = self.report["audit"][k]

        self.all_files_cache: Set[str] = set()
        self.basenames_cache: Dict[str, List[str]] = {}

        # Load index for orphan detection (filesystem-check tier only)
        self.indexed_files: Set[str] = set()
        self.indexed_dirs: Set[str] = set()
        if self.runs_filesystem_checks:
            self._load_index()
        self.inventory_indexed_refs: Set[str] = set()
        if self.requires_inventory_index and not has_index:
            self.report["missing_inventory_index"].append(rel)
        if self.runs_index_inventory_checks:
            self._load_index_inventory()

    def _load_index(self):
        index_path = os.path.join(self.target_root, "_Index.md")
        if not os.path.exists(index_path):
            rel_ws = os.path.relpath(self.target_root, self.root_dir).replace("\\", "/")
            self.report["missing_indexes"].append(rel_ws)
            return
        with open(index_path, 'r', encoding='utf-8') as f:
            content = f.read()
        for raw in re.findall(r'\]\(\.\/(.*?\.md)\)', content):
            norm = os.path.normpath(unquote(raw)).replace("\\", "/")
            self.indexed_files.add(norm)
        for raw in re.findall(r'\]\(\.\/((?:[^)]*?/)+)\)', content):
            if raw.endswith('.md'):
                continue
            norm = os.path.normpath(unquote(raw).rstrip('/')).replace("\\", "/")
            self.indexed_dirs.add(norm)

    def _load_index_inventory(self):
        index_path = os.path.join(self.target_root, "_Index.md")
        if not os.path.exists(index_path):
            return
        with open(index_path, 'r', encoding='utf-8') as f:
            content = f.read()

        refs = set()
        refs.update(re.findall(r'`([^`]+\.[A-Za-z0-9_]+)`', content))
        refs.update(re.findall(r'\]\(\.\/([^)]+)\)', content))

        for raw in refs:
            if any(ch in raw for ch in ["*", "[", "]", "<", ">"]):
                continue
            ref = os.path.normpath(unquote(raw.strip())).replace("\\", "/")
            if not ref or ref.startswith("output/"):
                continue
            self.inventory_indexed_refs.add(ref)
            full = os.path.join(self.target_root, ref.replace("/", os.sep))
            if not os.path.exists(full):
                self.report["index_inventory_missing_refs"].append(ref)

    def is_indexed(self, rel_to_ws: str) -> bool:
        if rel_to_ws in self.indexed_files:
            return True
        parts = rel_to_ws.replace("\\", "/").split("/")
        for depth in range(1, len(parts)):
            if "/".join(parts[:depth]) in self.indexed_dirs:
                return True
        return False

    def is_skipped(self, path: str) -> bool:
        return any(x in path for x in self.SKIP_PATHS)

    def is_temp_file(self, filename: str) -> bool:
        if filename.startswith("~"):
            return True
        if filename.lower() == "thumbs.db":
            return True
        _, ext = os.path.splitext(filename)
        return ext.lower() in TEMP_EXTENSIONS

    def is_meta_file(self, filepath: str, filename: str) -> bool:
        return (
            "_Master" in filepath
            or filename == "_Index.md"
            or filename.endswith("_MOC.md")
            or filename == "CLAUDE.md"
            or filename == "README.md"
        )

    def _tally(self, field: str, value):
        inv = self.report["value_inventory"][field]
        if isinstance(value, list):
            for v in value:
                v = str(v).strip()
                if v:
                    inv[v] = inv.get(v, 0) + 1
        else:
            v = str(value).strip()
            if v:
                inv[v] = inv.get(v, 0) + 1

    def build_file_caches(self):
        for root, dirs, files in os.walk(self.target_root):
            dirs[:] = [
                d for d in dirs
                if not d.startswith('.')
                and d not in self.SKIP_DIRS
                and os.path.relpath(
                    os.path.join(root, d), self.root_dir
                ).replace("\\", "/") not in self.child_excludes
            ]
            if self.is_skipped(root):
                continue
            for f in files:
                if f.endswith('.md'):
                    full_path = os.path.join(root, f)
                    self.all_files_cache.add(full_path)
                    # duplicate 후보에서 META/exclude 파일은 처음부터 제외.
                    if f in DUP_EXCLUDE_FILENAMES or f in self.frontmatter_skip_filenames:
                        continue
                    clean_name = re.sub(r'^\d{4}-\d{2}-\d{2}_', '', f)
                    if clean_name not in self.basenames_cache:
                        self.basenames_cache[clean_name] = []
                    # 원본 파일명도 함께 저장해서 series 판정에 사용.
                    self.basenames_cache[clean_name].append((full_path, f))

    def analyze_duplicates(self):
        for clean_name, entries in self.basenames_cache.items():
            if len(entries) <= 1:
                continue
            # 같은 부모 디렉토리 + 모두 YYYY-MM-DD_ 접두 → 일자별 시리즈로 인정, skip.
            if DUP_DATE_SERIES:
                parents = {os.path.dirname(p) for p, _ in entries}
                all_dated = all(DATE_PREFIX_RE.match(name) for _, name in entries)
                if len(parents) == 1 and all_dated:
                    continue
            self.report["potential_duplicates"].append({
                "base_name": clean_name,
                "files": [p for p, _ in entries]
            })

    def analyze_file(self, file_path: str):
        filename = os.path.basename(file_path)
        rel_path_norm = os.path.relpath(file_path, self.target_root).replace("\\", "/")
        rel_to_root = os.path.relpath(file_path, self.root_dir).replace("\\", "/")
        self.report["all_markdown_files"].append(rel_path_norm)

        is_meta = self.is_meta_file(file_path, filename)
        rel_root = os.path.dirname(rel_path_norm)
        in_content_skip = any(skip in rel_root for skip in self.CONTENT_SKIP_DIRS)

        # Anti-workspace filesystem checks
        if self.is_anti and not is_meta and not in_content_skip:
            current_time = time.time()
            mtime = os.path.getmtime(file_path)
            age_days = (current_time - mtime) / (60 * 60 * 24)
            if age_days > ARCHIVE_THRESHOLD_DAYS:
                self.report["archive_candidates"].append({
                    "file": rel_to_root,
                    "age_days": int(age_days)
                })
            rel_to_ws = os.path.relpath(file_path, self.target_root).replace("\\", "/")
            if not self.is_indexed(rel_to_ws):
                self.report["orphaned_files"].append(rel_to_root)

        # 컨텐츠 검사 미적용 워크스페이스는 frontmatter/footer/wikilinks 모두 skip.
        # (예: external submodules / nested project repos 등)
        if not self.runs_content_checks:
            return

        # Skip content analysis for special files and content-skip directories
        if (filename in self.frontmatter_skip_filenames
                or filename.endswith("_MOC.md")
                or filename.startswith('_')
                or in_content_skip):
            return

        try:
            with open(file_path, 'r', encoding='utf-8-sig') as f:
                content = f.read()

            # ── Frontmatter ──────────────────────────────────────────────────
            if not content.startswith("---"):
                self.report["missing_frontmatter"].append({
                    "file": rel_path_norm, "issue": "No frontmatter"
                })
            else:
                fm_end = content.find("---", 3)
                fm_block = content[3:fm_end] if fm_end != -1 else content[3:]

                # Missing fields check
                missing = [f for f in FIELD_ORDER if not re.search(rf"^{f}:", fm_block, re.MULTILINE)]
                if missing:
                    self.report["missing_frontmatter"].append({
                        "file": rel_path_norm,
                        "issue": f"Missing: {', '.join(missing)}"
                    })

                # Field order check: Related → Topic → Type → tags
                positions = {}
                for field in FIELD_ORDER:
                    m = re.search(rf"^{field}:", fm_block, re.MULTILINE)
                    if m:
                        positions[field] = m.start()
                expected_present = [f for f in FIELD_ORDER if f in positions]
                actual_order = sorted(positions.keys(), key=lambda f: positions[f])
                if actual_order != expected_present:
                    self.report["missing_frontmatter"].append({
                        "file": rel_path_norm,
                        "issue": f"Wrong order: found {actual_order}, expected {expected_present}"
                    })

                # Value inventory
                for field in ["Related", "Topic", "Type"]:
                    m = re.search(rf"^{field}:\s*(.+)$", fm_block, re.MULTILINE)
                    if m:
                        self._tally(field, m.group(1).strip().strip('"\''))

                # tags (YAML block list or inline)
                tags_m = re.search(r'^tags:(.*?)(?=^\S|\Z)', fm_block, re.MULTILINE | re.DOTALL)
                if tags_m:
                    block_tags = re.findall(r'^\s+-\s+(.+)', tags_m.group(0), re.MULTILINE)
                    if block_tags:
                        self._tally("tags", [t.strip() for t in block_tags])
                    else:
                        inline = re.search(r'tags:\s*\[(.+)\]', tags_m.group(0))
                        if inline:
                            self._tally("tags", [t.strip() for t in inline.group(1).split(',')])

            # ── Footer check ─────────────────────────────────────────────────
            if not any(marker in content for marker in FOOTER_MARKERS):
                self.report["footer_missing"].append(rel_path_norm)

            # ── Wikilinks ────────────────────────────────────────────────────
            for raw in re.findall(r'\[\[(.*?)\]\]', content):
                stem = raw.split('|')[0].strip().split('#')[0].strip()
                if stem:
                    self.report["links_found_for_agent_verification"].append({
                        "file": rel_path_norm, "link": stem
                    })

        except Exception:
            pass

    def is_inventory_candidate(self, full_path: str) -> bool:
        rel = os.path.relpath(full_path, self.target_root).replace("\\", "/")
        parts = rel.split("/")
        filename = os.path.basename(full_path)
        if filename in INVENTORY_SKIP_FILENAMES:
            return False
        if any(part in COMMON_SKIP_DIRS or part in INVENTORY_SKIP_DIRS for part in parts):
            return False
        if any(part.startswith(".") for part in parts):
            allowed_hidden = rel.startswith(".claude/agents/") or rel.startswith(".claude/skills/")
            if not allowed_hidden:
                return False
        _, ext = os.path.splitext(filename)
        return ext.lower() in INVENTORY_EXTENSIONS

    def scan_index_inventory(self):
        if not self.runs_index_inventory_checks:
            return
        candidates = []
        for root, dirs, files in os.walk(self.target_root):
            dirs[:] = [
                d for d in dirs
                if d not in COMMON_SKIP_DIRS
                and d not in INVENTORY_SKIP_DIRS
                and not (d.startswith(".") and d != ".claude")
            ]
            for f in files:
                full_path = os.path.join(root, f)
                if self.is_inventory_candidate(full_path):
                    rel = os.path.relpath(full_path, self.target_root).replace("\\", "/")
                    candidates.append(rel)
        for rel in sorted(set(candidates)):
            if rel == "_Index.md":
                continue
            if rel not in self.inventory_indexed_refs:
                self.report["index_inventory_unlisted"].append(rel)

    def run_audit(self, print_output: bool = True):
        # Temp files (Anti only) — separate walk before .md analysis
        if self.is_anti:
            for root, dirs, files in os.walk(self.target_root):
                dirs[:] = [
                    d for d in dirs
                    if not d.startswith('.')
                    and d not in self.SKIP_DIRS
                    and os.path.relpath(
                        os.path.join(root, d), self.root_dir
                    ).replace("\\", "/") not in self.child_excludes
                ]
                for f in files:
                    if self.is_temp_file(f):
                        full_path = os.path.join(root, f)
                        self.report["temp_files"].append(
                            os.path.relpath(full_path, self.root_dir).replace("\\", "/")
                        )

        self.build_file_caches()
        # 컨텐츠 검사 미적용 워크스페이스는 duplicate 분석도 skip.
        if self.runs_content_checks:
            self.analyze_duplicates()
        for file_path in sorted(self.all_files_cache):
            self.analyze_file(file_path)
        self.scan_index_inventory()

        if print_output:
            print("=== HAMES SYSTEM AUDIT REPORT ===")
            print(json.dumps(self.report, indent=2, ensure_ascii=False))


def _load_workspace_registry(root_dir: str) -> Dict[str, str]:
    """workspace_paths.json 로드. 없으면 빈 dict."""
    reg_path = os.path.join(
        root_dir, ".claude", "workspace_paths.json"
    )
    if not os.path.exists(reg_path):
        return {}
    try:
        with open(reg_path, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception:
        return {}


def _resolve_target(arg: str, root_dir: str) -> str:
    """
    arg 를 워크스페이스 절대 경로로 해석한다.
    우선순위: 1) workspace_paths.json alias (대소문자 무시) 2) 상대 경로 3) 절대 경로
    """
    registry = _load_workspace_registry(root_dir)
    # case-insensitive alias lookup
    lower_map = {k.lower(): v for k, v in registry.items()}
    a = arg.strip()
    if a.lower() in lower_map:
        return os.path.join(root_dir, lower_map[a.lower()].replace("/", os.sep))
    if os.path.isabs(a):
        return a
    return os.path.join(root_dir, a.replace("/", os.sep))


def _collect_full_scope(root_dir: str) -> List[str]:
    """
    no-arg / --all 시 스캔할 워크스페이스 경로 목록을 결정.
    workspace_paths.json 의 등록 워크스페이스 + KNOWN_WORKSPACES 합집합 중
    실제로 존재하는 경로만 채택. 중첩된 child 워크스페이스는 부모 스캔에서
    제외되도록 호출 측에서 child_excludes 로 전달.
    """
    registry = _load_workspace_registry(root_dir)
    seen = []
    seen_paths = set()
    # registry 우선
    for ws_rel in registry.values():
        full = os.path.join(root_dir, ws_rel.replace("/", os.sep))
        norm = os.path.normpath(full)
        if os.path.exists(full) and norm not in seen_paths:
            seen.append(full)
            seen_paths.add(norm)
    # 정적 fallback 보완
    for ws_rel in KNOWN_WORKSPACES:
        full = os.path.join(root_dir, ws_rel.replace("/", os.sep))
        norm = os.path.normpath(full)
        if os.path.exists(full) and norm not in seen_paths:
            seen.append(full)
            seen_paths.add(norm)
    return seen


def _compute_child_excludes(roots: List[str], root_dir: str) -> Dict[str, List[str]]:
    """
    부모 워크스페이스 스캔이 child 워크스페이스 디렉토리를 중복 집계하지
    않도록, 각 부모에 대한 제외 목록을 만든다.
    예: nested-project/sub-app 가 등록되어 있으면 nested-project 부모 스캔에서 sub-app 디렉토리 제외.
    """
    rel_paths = sorted(
        [os.path.relpath(p, root_dir).replace("\\", "/") for p in roots]
    )
    excludes: Dict[str, List[str]] = {p: [] for p in rel_paths}
    for parent in rel_paths:
        for child in rel_paths:
            if child != parent and child.startswith(parent + "/"):
                excludes[parent].append(child)
    return excludes


def _arsenal_registry_audit(root_dir: str) -> Dict:
    """
    arsenal/CLAUDE.md 레지스트리에 등재된 도구가 실제로 존재하는지,
    그리고 .Arsenal 안에 있지만 레지스트리에 누락된 도구가 있는지 검사.
    """
    arsenal_dir = os.path.join(root_dir, "Anti", ".Arsenal")
    arsenal_md = os.path.join(arsenal_dir, "CLAUDE.md")
    result = {
        "missing_files": [],
        "unregistered_files": [],
        "registered_count": 0,
        "filesystem_count": 0,
    }
    if not os.path.exists(arsenal_md):
        result["missing_files"].append({
            "ref": "arsenal/CLAUDE.md",
            "issue": "registry file not found",
        })
        return result
    with open(arsenal_md, 'r', encoding='utf-8') as f:
        content = f.read()
    refs = set(
        re.findall(r'`([\w\-./]+\.(?:py|js|ps1|sh))`', content)
    )
    result["registered_count"] = len(refs)
    for ref in refs:
        if ref.startswith('.') or ref.startswith('workspaces/'):
            full = os.path.join(root_dir, ref.replace("/", os.sep))
        else:
            full = os.path.join(arsenal_dir, ref.replace("/", os.sep))
        if not os.path.exists(full):
            result["missing_files"].append(
                {"ref": ref, "issue": "registered but not on disk"}
            )

    # Filesystem-side: list arsenal scripts and warn unregistered ones
    on_disk = set()
    for fname in os.listdir(arsenal_dir):
        fpath = os.path.join(arsenal_dir, fname)
        if os.path.isfile(fpath) and fname.endswith(
            (".py", ".js", ".ps1", ".sh")
        ):
            on_disk.add(fname)
    result["filesystem_count"] = len(on_disk)
    registered_basenames = set(
        os.path.basename(r) for r in refs
        if not (r.startswith('.') or r.startswith('workspaces/'))
    )
    for fname in sorted(on_disk - registered_basenames):
        # 노이즈 차단: 임시/실험 스크립트 prefix 걸러내기
        if fname.startswith(("_", "test_", "tmp_")):
            continue
        result["unregistered_files"].append(
            {"file": fname, "issue": "on disk but not in registry"}
        )
    return result


def _build_workspace_actions(report: Dict) -> List[Dict]:
    """워크스페이스 audit 리포트를 구조화 action 리스트로 변환."""
    actions = []
    counter = [0]
    target = report.get("target", "")

    def _next_id():
        counter[0] += 1
        return f"RA-index-{counter[0]:03d}"

    for issue in report["audit"]["missing_frontmatter"]:
        actions.append({
            "id": _next_id(),
            "action_type": "edit_file",
            "target_path": f"{target}/{issue['file']}",
            "proposed_change": f"frontmatter 보정: {issue['issue']}",
            "risk_level": "low",
            "rationale": "frontmatter contract enforcement",
            "source_issue": "audit.missing_frontmatter",
        })
    for fpath in report["audit"]["footer_missing"]:
        actions.append({
            "id": _next_id(),
            "action_type": "edit_file",
            "target_path": f"{target}/{fpath}",
            "proposed_change": "## 관련노트 footer 추가",
            "risk_level": "low",
            "rationale": "footer marker missing",
            "source_issue": "audit.footer_missing",
        })
    for tf in report["audit"].get("temp_files", []):
        actions.append({
            "id": _next_id(),
            "action_type": "remove_file",
            "target_path": tf,
            "proposed_change": "임시 파일 삭제",
            "risk_level": "low",
            "rationale": "temp file by extension/prefix",
            "source_issue": "audit.temp_files",
        })
    for cand in report["audit"].get("archive_candidates", []):
        actions.append({
            "id": _next_id(),
            "action_type": "rename_file",
            "target_path": cand["file"],
            "proposed_change": (
                f"_Archive/ 로 이동 (age: {cand['age_days']}일)"
            ),
            "risk_level": "medium",
            "rationale": "archive threshold exceeded",
            "source_issue": "audit.archive_candidates",
        })
    for orphan in report["audit"].get("orphaned_files", []):
        actions.append({
            "id": _next_id(),
            "action_type": "register_doc",
            "target_path": f"{target}/_Index.md",
            "proposed_change": f"_Index.md 에 등록: {orphan}",
            "risk_level": "low",
            "rationale": "orphan file not in index",
            "source_issue": "audit.orphaned_files",
        })
    for ref in report["audit"].get("index_inventory_missing_refs", []):
        actions.append({
            "id": _next_id(),
            "action_type": "investigate",
            "target_path": f"{target}/_Index.md",
            "proposed_change": f"_Index.md 의 존재하지 않는 inventory 참조 확인: {ref}",
            "risk_level": "medium",
            "rationale": "indexed inventory reference missing on disk",
            "source_issue": "audit.index_inventory_missing_refs",
        })
    for rel in report["audit"].get("index_inventory_unlisted", []):
        actions.append({
            "id": _next_id(),
            "action_type": "register_inventory",
            "target_path": f"{target}/_Index.md",
            "proposed_change": f"_Index.md inventory 에 추가 검토: {rel}",
            "risk_level": "low",
            "rationale": "index inventory candidate not listed",
            "source_issue": "audit.index_inventory_unlisted",
        })
    for missing in report["audit"].get("missing_inventory_index", []):
        actions.append({
            "id": _next_id(),
            "action_type": "create_file",
            "target_path": f"{missing}/_Index.md",
            "proposed_change": "실행형 워크스페이스 inventory index 생성",
            "risk_level": "low",
            "rationale": "workspace is configured to require an inventory index",
            "source_issue": "audit.missing_inventory_index",
        })
    for missing in report["audit"].get("missing_indexes", []):
        actions.append({
            "id": _next_id(),
            "action_type": "create_file",
            "target_path": f"{missing}/_Index.md",
            "proposed_change": "워크스페이스 _Index.md 생성",
            "risk_level": "low",
            "rationale": "workspace lacks _Index.md",
            "source_issue": "audit.missing_indexes",
        })
    for dup in report["audit"]["potential_duplicates"]:
        actions.append({
            "id": _next_id(),
            "action_type": "investigate",
            "target_path": dup["base_name"],
            "proposed_change": (
                f"중복 의심 — 단일화 또는 명시적 분리 결재: "
                f"{', '.join(dup['files'])}"
            ),
            "risk_level": "medium",
            "rationale": "duplicate basename across paths",
            "source_issue": "audit.potential_duplicates",
        })
    return actions


def main():
    args = sys.argv[1:]
    args = [a for a in args if a != "--dry-run"]

    root_dir = os.path.abspath(".")

    full_scope = (not args) or ("--all" in args)
    args = [a for a in args if a != "--all"]

    if full_scope:
        roots = _collect_full_scope(root_dir)
        if not roots:
            print(json.dumps({"error": "No workspace roots found"}))
            sys.exit(1)

        excludes = _compute_child_excludes(roots, root_dir)
        combined: Dict = {
            "schema_version": SCHEMA_VERSION,
            "scope": "all",
            "args": {"raw": " ".join(sys.argv[1:]), "resolved": []},
            "workspaces": [],
            "arsenal_registry_audit": _arsenal_registry_audit(root_dir),
        }
        for ws_path in roots:
            rel = os.path.relpath(ws_path, root_dir).replace("\\", "/")
            child_ex = excludes.get(rel, [])
            auditor = HamesAuditor(ws_path, root_dir, child_excludes=child_ex)
            auditor.run_audit(print_output=False)
            auditor.report["recommended_actions"] = _build_workspace_actions(
                auditor.report
            )
            combined["workspaces"].append(auditor.report)
            combined["args"]["resolved"].append(rel)

        print("=== HAMES SYSTEM AUDIT REPORT (ALL WORKSPACES) ===")
        print(json.dumps(combined, indent=2, ensure_ascii=False))
        return

    target_arg = args[0]
    target_path = _resolve_target(target_arg, root_dir)
    if not os.path.exists(target_path):
        print(json.dumps({
            "error": f"Path not found: {target_arg} → {target_path}"
        }))
        sys.exit(1)

    auditor = HamesAuditor(target_path, root_dir)
    auditor.run_audit(print_output=False)
    auditor.report["recommended_actions"] = _build_workspace_actions(
        auditor.report
    )
    out = {
        "schema_version": SCHEMA_VERSION,
        "scope": "single",
        "args": {
            "raw": " ".join(sys.argv[1:]),
            "resolved": [
                os.path.relpath(target_path, root_dir).replace("\\", "/")
            ],
        },
        "workspaces": [auditor.report],
    }
    print("=== HAMES SYSTEM AUDIT REPORT ===")
    print(json.dumps(out, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
