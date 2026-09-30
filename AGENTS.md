# Herness GUI maintenance contract

This is an independent Windows distribution of Hermes Agent. The desktop is in
`apps/desktop`, the shared client in `apps/shared`, vendored backend in
`vendor/hermes`. Read the applicable area AGENTS.md before editing.

- The installer must contain a relocatable Python interpreter, locked dependencies,
  the vendored backend, Node/npm, Git/Bash, uv and ripgrep. Never use a maintainer's
  old Hermes installation or absolute personal filesystem paths at runtime.
- Offline means installation, startup, local history and settings. Cloud models,
  search and external services require network access and credentials. Never claim
  full offline AI without distributing a local model and inference engine.
- Desktop/backend updates ship together through EvanZhang1216/Herness-GUI Releases.
  Never invoke the upstream source updater on the bundled installation. Review and
  validate upstream changes before releasing them.
- Keep credentials and user histories out of Git, installers and ECS source archives.
  Deploy credentials live outside the repository or in GitHub Actions Secrets.
- The user explicitly authorized ongoing GitHub and ECS source publication after
  each completed, validated update. Write a meaningful commit message, update README
  when behavior changes, then run `scripts/publish.ps1 -Message "..."`. Do not ask for
  repeated publication permission. Report failed pushes/syncs honestly and retry.
- Canonical Git remote: git@github.com:EvanZhang1216/Herness-GUI.git. ECS source mirror:
  `/srv/herness-gui/current` on the configured host. Upload committed source only;
  never upload node_modules, personal data, logs or build credentials.
- Validate with the focused Vitest suites plus the packaged EXE smoke test. Python
  tests for vendored Hermes use its `scripts/run_tests.sh`, never bare pytest.
- Account/sync changes additionally require `server/run_tests.py` against the dedicated
  PostgreSQL test database and `apps/desktop/scripts/verify-accounts.ts` against a private
  test service. Never run database contract tests against production.
- After validated server changes are published and mirrored, run
  `scripts/deploy-sync-service.ps1` to deploy that committed revision and verify health.
  Keep PostgreSQL and the API loopback-only until an HTTPS domain is configured.
- Prefer upstream infrastructure over duplicating agents/tools. QuickModel-inspired
  UI features must preserve Hermes' session cache and role-alternation invariants.
