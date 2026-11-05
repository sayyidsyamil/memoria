import type { gitFileSystemSession } from '../workspace/git/gitFileSystemSessions'

type GitFileSystem = ReturnType<typeof gitFileSystemSession>
type Method = keyof GitFileSystem['promises']
type Measurement = { calls: number; failures: number; cumulativeMs: number }

/** QA-only cumulative operation latency, including overlapping waits, not CPU time. */
export function measureGitFileSystem(fs: GitFileSystem, now = () => performance.now()) {
  const measurements = new Map<Method, Measurement>()
  function track<Args extends unknown[], Value>(method: Method, operation: (...args: Args) => Promise<Value>) {
    const metric: Measurement = { calls: 0, failures: 0, cumulativeMs: 0 }
    measurements.set(method, metric)
    return async (...args: Args) => {
      const started = now()
      metric.calls += 1
      try {
        return await operation.apply(fs.promises, args)
      } catch (error) {
        metric.failures += 1
        throw error
      } finally {
        metric.cumulativeMs += now() - started
      }
    }
  }
  return {
    fs: { promises: {
      readFile: track('readFile', fs.promises.readFile),
      writeFile: track('writeFile', fs.promises.writeFile),
      unlink: track('unlink', fs.promises.unlink),
      readdir: track('readdir', fs.promises.readdir),
      mkdir: track('mkdir', fs.promises.mkdir),
      rmdir: track('rmdir', fs.promises.rmdir),
      stat: track('stat', fs.promises.stat),
      lstat: track('lstat', fs.promises.lstat),
      readlink: track('readlink', fs.promises.readlink),
      symlink: track('symlink', fs.promises.symlink),
    } },
    snapshot: () => Array.from(measurements, ([method, metric]) => ({
      method, calls: metric.calls, failures: metric.failures, cumulativeMs: Math.round(metric.cumulativeMs),
    })),
  }
}
