# Changelog

## 0.2.2 — 2026-09-30

- Share model routing across desktop conversations within the account/profile, including
  new chats, resumed history and cloud-imported conversations. Ignore stale session
  provider snapshots that caused missing DeepSeek credentials in otherwise configured apps.
- Composer model picks save the shared default. Settings explain scope and next-turn
  activation; ongoing responses finish on their original runtime.
- Resolve endpoint and credentials at each turn, including changes with the same model
  name. Preserve the cached system prefix when replacing the inference transport.
- Retain independent account/profile settings and upstream CLI/TUI routing behavior.
- Restore the omitted upstream plugins/web tree (all bundled search providers, including
  Tavily). Packaging now fails if tool imports or declared web-provider registration fail,
  and verifies Tavily authentication and search against a local HTTP fixture.


## 0.2.1 — 2026-09-30

- Fix installer rejection of sibling data folders such as `D:\Hermes-GUI-data` beside
  `D:\Hermes-GUI`. Compare directory boundaries after Windows path normalization,
  including folders that do not yet exist, case differences and dot segments.
- Keep blocking the application directory and its descendants; translate data-page
  instructions and errors into Chinese and show both paths in overlap errors.
- Validate the shared installer function by compiling and executing a real NSIS
  regression fixture, plus focused tests and the packaged application smoke test.

## 0.2.0 — 2026-09-30

- Optional username/password/email accounts, with guest mode and isolated account data.
  Email is recorded only; verification fields are reserved, no email is sent.
- PostgreSQL-backed multi-device conversation and embedded attachment sync, encrypted
  local login tokens, revocable devices, optimistic versions and preserved conflict branches.
- Apply downloaded history after restart to preserve running Hermes conversation context;
  keep model credentials local and require per-device model configuration.
- Conversation-level retention: expire 180 days from original creation, with daily cleanup
  and seven-day private database backups. Default account quota is 256 MiB.
- Private ECS service deployment and SSH development tunnel. Public login requires a
  future HTTPS domain; no public plaintext authentication endpoint is provided.
- Validation: 45 focused desktop tests; two real PostgreSQL/HTTP/Hermes integration
  contracts covering isolation, retries, attachments, expiration and offline conflicts;
  packaged two-device registration/login/history continuation; guest chat, restart,
  full data migration and empty-home onboarding regression tests.

## 0.1.1 — 2026-09-30

- Choose a separate user data directory during first installation. Upgrades preserve it.
- Settings → About can migrate Hermes and Electron data together after graceful shutdown.
- Verify every copied file before committing the location; preserve original data on success or failure.
- Reject overlapping/nonempty destinations and retain legacy paths until explicitly migrated.
- Validation: 43 focused tests, plus packaged migration via settings IPC, Chinese paths,
  credentials/history retention and continued chat after migration.


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
