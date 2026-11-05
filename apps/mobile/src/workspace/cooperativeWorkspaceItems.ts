import { createGitTaskRunner } from './git/gitTaskRunner'

const metadataBatchSize = 32

/** Keep cached metadata conversion on the same input/task budget as fresh parsing. */
export async function mapWorkspaceItems<Value, Result>(values: readonly Value[], convert: (value: Value) => Result, signal?: AbortSignal) {
  const { run } = createGitTaskRunner()
  const result: Result[] = []
  for (let start = 0; start < values.length; start += metadataBatchSize) {
    await run(() => {
      const end = Math.min(start + metadataBatchSize, values.length)
      for (let index = start; index < end; index++) {
        requireActiveWorkspaceTask(signal)
        result.push(convert(values[index]))
      }
    })
  }
  requireActiveWorkspaceTask(signal)
  return result
}

function requireActiveWorkspaceTask(signal?: AbortSignal) {
  if (signal?.aborted) throw new Error('workspaceLoadCancelled')
}
