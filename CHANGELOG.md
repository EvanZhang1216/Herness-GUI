# Changelog

## 0.1.0 — 2026-09-30

- Independent Windows x64 distribution with bundled Python, locked Hermes core
  dependencies, Node/npm, Git/Bash, uv and ripgrep; no old Hermes venv dependency.
- Offline installation/startup and local history. Cloud inference and online tools
  still require network access; no local language model is included.
- Matched desktop/backend updates through this repository's stable GitHub Releases.
  The legacy source-updater entry points cannot replace the bundled backend.
- Main and delegated model settings grouped under Models; separate custom endpoints
  support independent URLs, model names and API keys.
- QuickModel-inspired endpoint presets and normalization of pasted completion URLs.
- Persistent development instructions, upstream provenance, Windows release workflow,
  and automatic committed-source mirroring to ECS after main-branch pushes.
- Validation: 41 focused tests; packaged EXE boot/chat/restart/history continuation
  using the bundled backend and a local mock model with host developer PATH removed.

Limitations: unsigned Windows installer; optional service-specific dependencies are
not all bundled; no claim of offline cloud inference or validation on every Windows
hardware configuration. Remote backend versions remain managed by their operators.
