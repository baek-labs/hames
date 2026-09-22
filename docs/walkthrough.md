# Walkthrough

Install Hames, review its hooks and open the chosen AI work root in a fresh session. If automatic first-use guidance does not appear, invoke `/setup`.

Tell the agent which workspaces you want and what each folder should contain. It offers a tree and concrete rules, then shows the exact change preview. Approval applies that preview once and creates the folder indexes. A second setup with the same choices changes nothing.

Ask for a document in a selected workspace. The agent reads common rules and the relevant workspace/document context, follows placement and naming rules, and creates the file. A successful structured file event updates the index. If the tool failed or a lock prevented maintenance, the agent reports the incomplete index and preserves your file.

Invoke `/index` to audit all managed folders, or name one workspace. Missing entries, broken links, rule violations and judgment gaps are reported separately. Ask to repair chosen index changes and review that preview; the audit itself never repairs.

For a bounded larger task, `/ready` presents requirements, locations, work order, verification and handoff in one contract. `/go` in that conversation approves its exact revision and executes it. Review the evidence and accept the result to archive the contract. No Git operation is implied.

Use `/doctor` when setup, plugin wiring, pending maintenance or contract state needs diagnosis. Shared long-lived docs stay at the AI work root and are loaded selectively.
