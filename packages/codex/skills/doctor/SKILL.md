---
name: doctor
description: Diagnose a Hames installation without changing it when the user invokes /doctor.
---

# Doctor

Inspect the plugin and project configuration in read-only mode and report actionable recovery options.

Check config parsing and schema, required `.hames/` paths, entry boundary blocks, contract hashes, evidence linkage, session pointers, four skills, and hook files.

Do not modify, clear, recover, or select anything. When state is damaged or interrupted, show the exact failed check and available recovery choices for the user to decide.

Run the bundled `runtime/doctor.js` against the current project root and report its check results without treating warnings or unreadable output as a pass.
