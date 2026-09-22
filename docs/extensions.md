# Extensions

Hames Core includes setup, ready, go, index and doctor. Workspace roles, indexes and the adapted execution workflow are part of the single installation, not optional packs.

Optional domain packs may add document-production or service integrations through their own plugin manifest. They must use the selected workspace rules and existing contract authority. They may not silently install another runtime, grant approval, remove critical-action protections or add a fixed personal folder taxonomy.

Project-specific extension settings belong under their unique key in `.hames/config.yaml` `extensions`. Core preserves these settings; each extension validates its own object. New target/evidence types require explicit schema compatibility rather than silently reinterpreting existing contracts.
