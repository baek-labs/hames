<!-- HAMES:START -->
## Hames

When the Hames plugin is enabled, begin an unconfigured project with `/setup`. Review bounded work with `/ready` and use `/go` in the same conversation to approve and execute the exact contract shown. Hames follows declared dependencies, applies proportional review, and writes durable decisions only to approved project locations. Use `/index` for a read-only inventory audit and `/doctor` to diagnose configuration. Project-specific Hames context is in `.hames/`; shared operating documents live in `docs/` and load selectively.
Before producing a file, identify the requested workspace from the task or current directory. Read its configured rules and index, then only the shared docs whose registered scope matches or whose dependencies are required. If a new task changes workspace, use the bundled `runtime/context.js select --root <root> --workspace <id> --session <session-id>` to replace the session selection and read its returned context; do not carry rules from the previous space. Ask only when the target is ambiguous. Context limits and unreadable documents must be reported, not silently ignored.

<!-- HAMES:END -->
