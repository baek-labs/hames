# Shared operating rules

Use the selected workspace's purpose and file rules from `.hames/workspaces/` before creating a file. Keep work inside the configured root. Preserve existing user files and manual index text.

Read the root map, the selected workspace index, and only the shared documents whose registered scope or dependency is relevant. Do not read every document or copy a document set into each workspace.

Observed file changes update indexes automatically. `/index` diagnoses inventory and rule issues without modifying files; repairs require a specific request. Report indexing failures without removing the original file.

Ordinary work does not require Git or a task contract. Use `/ready` and `/go` for work that needs explicit scope and verification. Run Git mutations only when the user requests them. Do not publish, send, delete, or change permissions without authorization for that action.
