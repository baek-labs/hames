"""Manual native-host workflow check; writes only its fixture and evidence files."""
import json
import subprocess
import uuid
from pathlib import Path

repo = Path(__file__).resolve().parents[2]
run_id = uuid.uuid4().hex[:8]
root = repo / f"tests/.tmp/claude-workflow-{run_id}"
root.mkdir(parents=True)
setup_code = "const s=require(\'./src/runtime/setup\'); const p=s.planSetup({root:process.argv[1],skipLegacy:true,contractTracking:\'untracked\',workspaces:[{id:\'work\',path:\'work\',purpose:\'Test documents\'}]});s.applySetup(p,{approved:true});"
subprocess.run(["node","-e",setup_code,str(root)],cwd=repo,check=True)
evidence = repo / "tests/.tmp/claude-smoke"
evidence.mkdir(parents=True, exist_ok=True)
(evidence / "latest-workflow.json").write_text(json.dumps({"run_id":run_id,"root":str(root)}))
messages = [
    "Use the hames:ready skill. Prepare one simple task contract to create work/brief.md with exactly '# Brief\\nVerified outcome.\\n'. The workspace is work. This is a reversible text-file creation, so direct verification is sufficient and no independent reviewer is needed. Verify the exact file contents using Node. Keep scope to that one document plus derived index maintenance; no external service, no Git operations, no extra long-lived knowledge. Present the contract and wait. All workspace choices are already configured. The contract CLI --help describes its exact arguments; use it rather than reading the entire runtime.",
    "Use the hames:go skill to approve and execute exactly the contract you just presented in this same conversation. You may use Node for verification. Do not initialize Git or use any Git state-changing command. After verification, show the result and wait for acceptance.",
    "I accept the verified result. Archive the same contract using the Hames runtime. Then invoke hames:index for a read-only audit of the work workspace. Do not repair or move any source file during that audit."
]
args = ["claude", "-p", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose", "--model", "sonnet", "--plugin-dir", str(repo / "packages/claude"), "--setting-sources", "", "--strict-mcp-config", "--mcp-config", '{"mcpServers":{}}', "--no-session-persistence", "--permission-mode", "acceptEdits", "--tools", "Read,Write,Edit,Glob,Grep,Bash,Skill", "--allowedTools", "Read,Write,Edit,Glob,Grep,Skill,Bash(node *),Bash(pwd),Bash(ls *)"]
with (evidence / f"workflow-{run_id}.stderr").open("w") as err, (evidence / f"workflow-{run_id}.jsonl").open("w") as log:
    process = subprocess.Popen(args, cwd=root, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=err, text=True, bufsize=1)
    phase = 0
    def send(text):
        process.stdin.write(json.dumps({"type": "user", "message": {"role": "user", "content": text}}) + "\n")
        process.stdin.flush()
    send(messages[0])
    for line in process.stdout:
        log.write(line); log.flush()
        try:
            event = json.loads(line)
        except ValueError:
            continue
        if event.get("type") == "result":
            if event.get("is_error"):
                process.stdin.close()
                break
            phase += 1
            if phase < len(messages):
                send(messages[phase])
            else:
                process.stdin.close()
    code = process.wait(timeout=30)
    (evidence / f"workflow-{run_id}.exit").write_text(str(code))
    print(f"Claude workflow exit {code}; completed user turns {phase}")
