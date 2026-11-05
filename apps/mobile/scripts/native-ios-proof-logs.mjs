/* global setTimeout */

const defaultProofPollIntervalMs = 1000

export async function waitForNativeProof({
  assertProofs,
  collectLogs,
  parseProofs,
  timeoutMs,
}) {
  const deadline = Date.now() + Math.max(timeoutMs, 0)
  let latestFailures = []
  let latestLogs = ''
  let latestProofs = []

  for (;;) {
    latestLogs = collectLogs()
    latestProofs = parseProofs(latestLogs)
    latestFailures = assertProofs(latestProofs)
    if (latestFailures.length === 0 || Date.now() >= deadline) {
      return {
        failures: latestFailures,
        logs: latestLogs,
        proofs: latestProofs,
      }
    }

    await sleep(Math.min(defaultProofPollIntervalMs, deadline - Date.now()))
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
