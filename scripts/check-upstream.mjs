import fs from 'node:fs'
const current = JSON.parse(fs.readFileSync(new URL('../upstream.json', import.meta.url), 'utf8'))
const response = await fetch('https://api.github.com/repos/NousResearch/hermes-agent/releases/latest', {
  headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Herness-GUI-maintainer' },
  signal: AbortSignal.timeout(30000),
})
if (!response.ok) throw new Error(`Upstream release check failed: HTTP ${response.status}`)
const latest = await response.json()
console.log(JSON.stringify({ current: current.release, latest: latest.tag_name, url: latest.html_url,
  reviewRequired: current.release !== latest.tag_name }, null, 2))
// Deliberately no installation here. Import, adapt, test, then release this project.
