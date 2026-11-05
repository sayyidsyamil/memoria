import { fileURLToPath } from 'node:url'

const RUST_UNSAFE_USAGE_RULE = 'codacy.tools-configs.rust.lang.security.unsafe-usage.unsafe-usage'

export function scannerOutputFailures(result, additions, repositoryRoot, tool) {
  const failures = scannerProcessFailures(result, tool)
  if (failures.length > 0) return failures
  try {
    return sarifGateFailures(JSON.parse(result.stdout), additions, repositoryRoot, tool)
  } catch {
    return [{ message: `${tool} report was not valid SARIF`, tool }]
  }
}

export function isAuditedRustUnsafe(finding, additions) {
  if (finding.rule !== RUST_UNSAFE_USAGE_RULE || !finding.line) return false
  return additions.get(finding.path)?.auditedRustUnsafeLines?.has(finding.line) ?? false
}

export function scannerProcessFailures(result, tool) {
  // The pinned legacy CLI logs child failures but still returns exit status zero.
  const loggedFailure = /Tool failed to run:/u.test(`${result.stdout ?? ''}\n${result.stderr ?? ''}`)
  const failed = [result.status !== 0, result.signal, result.error, loggedFailure].some(Boolean)
  if (failed) {
    return [{ message: `${tool} did not complete successfully`, tool }]
  }
  return []
}

export function sarifGateFailures(sarif, additions, repositoryRoot = '', expectedTool) {
  if (!hasScannerRuns(sarif)) {
    return [{ message: 'SARIF report contains no scanner runs', tool: expectedTool ?? 'Codacy' }]
  }
  if (expectedTool && !hasExpectedRun(sarif, expectedTool)) {
    return [{ message: 'SARIF report does not identify the expected scanner', tool: expectedTool }]
  }
  return sarif.runs.flatMap((run) => failuresForRun(run, additions, repositoryRoot))
}

function hasScannerRuns(sarif) {
  if (!Array.isArray(sarif?.runs)) return false
  return sarif.runs.length > 0
}

function hasExpectedRun(sarif, expectedTool) {
  const names = new Map([['opengrep', 'Opengrep OSS'], ['trivy', 'Trivy']])
  if (sarif.runs.length !== 1) return false
  return sarif.version === '2.1.0' && sarif.runs[0]?.tool?.driver?.name === names.get(expectedTool)
}

function failuresForRun(run, additions, repositoryRoot) {
  const tool = run?.tool?.driver?.name ?? 'unknown tool'
  const failures = scannerFailures(run?.invocations, tool)
  if (failures.length > 0) return failures
  if (!Array.isArray(run?.results)) {
    return [{ message: `${tool} did not produce a results array`, tool }]
  }
  return run.results.flatMap((result) => resultFailure(result, additions, tool, repositoryRoot))
}

function scannerFailures(invocations, tool) {
  return (invocations ?? [])
    .filter(invocationFailed)
    .map(() => ({ message: `${tool} did not complete successfully`, tool }))
}

function invocationFailed(invocation) {
  if (invocation.executionSuccessful !== true) return true
  return hasExecutionErrors(invocation)
}

function hasExecutionErrors(invocation) {
  const notifications = invocation.toolExecutionNotifications ?? []
  if (notifications.some((notification) => notification.level === 'error')) return true
  return invocation.exitCode !== undefined && invocation.exitCode !== 0
}

function resultFailure(result, additions, tool, repositoryRoot) {
  const { line, path } = resultPosition(result, repositoryRoot)
  if (!isAddedLine(additions, path, line)) return []
  const failure = {
    line,
    message: result.message?.text ?? 'Codacy issue',
    path,
    rule: result.ruleId ?? 'unknown rule',
    tool,
  }
  return isAuditedRustUnsafe(failure, additions) ? [] : [failure]
}

function resultPosition(result, repositoryRoot) {
  const physicalLocation = result.locations?.at(0)?.physicalLocation
  return {
    line: physicalLocation?.region?.startLine,
    path: normalizedPath(physicalLocation?.artifactLocation?.uri, repositoryRoot),
  }
}

function normalizedPath(uri, repositoryRoot) {
  if (!uri) return ''
  if (uri.startsWith('file:')) return fileURLToPath(uri)
  return uri.startsWith('/') ? uri : `${repositoryRoot}/${uri}`
}

function isAddedLine(additions, path, line) {
  return Boolean(line && additions.get(path)?.has(line))
}
