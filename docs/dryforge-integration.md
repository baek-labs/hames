# DryForge integration

Hames includes an adapted intent-to-execution workflow from [DryForge](https://github.com/prekuter/dryforge), pinned to commit `c950599d463d083a48e49c6dc1207904cf0c4374`.

Original ready, go and migration skill texts are retained for provenance under `src/integrations/dryforge/upstream/`. They are not registered as executable skills. `provenance.json` records original paths and SHA-256 digests; `LICENSE` retains the upstream MIT notice. Both generated packages include this provenance.

| Upstream behavior | Hames adaptation |
|---|---|
| Intent extraction and explicit decisions | Built into ready with `references/intent.md` |
| Spec, plan and handoff | One human-readable contract bound to the existing machine specification |
| Dependency-aware execution and proportional review | Existing contract runtime and go workflow |
| Standalone migration | Setup preview and in-place preservation |
| Git/worktree-based execution | No Git prerequisite; Git mutations only on explicit request |
| Full docs generation and broad reads | Needed shared-root documents and scope-based loading |
| `.dryforge/` state | One `.hames/contracts/` state store |

Hames is not the unmodified DryForge distribution. No separate DryForge installation, automatic download or upstream self-update is required. Future updates must be deliberately reviewed against Hames rules before incorporation.
