import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { relative } from 'node:path'

// Luca's exact false-positive approval, call_355180105f3041c2888d7259418acb80.
// Reports stay visible; changed bytes and expired approvals fail closed.
const expiresAt = Date.parse('2026-10-30T23:59:00Z')
const approvals = [
  { path: 'src/components/editorDependencyCompatibility.test.ts', lines: [27],
    rule: 'security/detect-object-injection', sha256: 'b14dbf4b01398d00951919ba37390fdf2b87da42093a6a0422d11705b9ca43c0' },
  { path: 'src/utils/systemMetadata.ts', lines: [75],
    rule: 'security/detect-object-injection', sha256: '9f701f6e1d819887096e9c2c0d07f963e433c05e2743d4da92ead05899dbba5b' },
  { path: 'apps/mobile/scripts/test-ios-panel-gestures.mjs', lines: [18],
    rule: 'codacy.tools-configs.typescript.react.security.react-insecure-request.react-insecure-request',
    sha256: '9c7e3c082656acdc111dbe011a1ac466211e4543473032b591648c39a96bde29' },
  { path: 'apps/mobile/src/workspace/git/expoGitFileSystem.test.ts', lines: [21, 22, 23, 25, 31, 32, 33, 36, 42],
    rule: 'codacy.tools-configs.javascript_pathtraversal_rule-non-literal-fs-filename',
    sha256: '9ac8729e7d5c61b3dfc0d9f8adef79d0e82bb6e27b4b85db39f14bfa9de2b3c3' },
  { path: 'apps/mobile/src/workspace/mobileMarkdownListHtml.ts', lines: [104],
    rule: 'codacy.tools-configs.javascript.browser.security.raw-html-join.raw-html-join',
    sha256: 'ae1de0717a97369777cd34154d2a325da1e5053a52534be9bf27327539aac008' },
  // R2BlobStore fetch: endpoint is validated operator config, not user input (decision: Karn, 2026-10-23)
  { path: 'apps/server/src/store.ts', lines: [93, 106, 121, 135],
    rule: 'codacy.tools-configs.rules_lgpl_javascript_ssrf_rule-node-ssrf',
    sha256: 'b21837f65bb5b4d00f3743634b460d91e60fe5d208ad7552c95ce667e272ad35' },
]

export function partitionApprovedReports(failures, root, options = {}) {
  const { now = Date.now(), read = readFileSync, channel } = options
  const result = { approved: [], blocking: [] }
  const available = now < expiresAt && channel !== 'stable'
  for (const failure of failures) {
    const approved = available && matchesApproval(failure, root, read)
    result[approved ? 'approved' : 'blocking'].push(failure)
  }
  return result
}

function matchesApproval(failure, root, read) {
  if (!failure.path) return false
  const path = relative(root, failure.path)
  const approval = approvals.find(row => row.path === path && row.rule === failure.rule && row.lines.includes(failure.line))
  if (!approval) return false
  try {
    return createHash('sha256').update(read(failure.path)).digest('hex') === approval.sha256
  } catch {
    return false
  }
}
