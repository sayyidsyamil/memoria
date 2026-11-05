import { Buffer } from 'buffer'
import git, { type PromiseFsClient } from 'isomorphic-git'
import { createGitVault } from '../workspace/git/gitVault'

type Context = { fs: PromiseFsClient; dir: string }
type ReadOperation = 'readFile' | 'readdir'
const author = { name: 'Native QA', email: 'qa@example.invalid' }
const content = '---\ncustom: preserved\n---\n# Read safety\n'

/** The caller supplies a new, disposable directory, never a published vault. */
export async function assertGitReadFailureSafety(context: Context) {
  await git.init({ ...context, defaultBranch: 'main' })
  await context.fs.promises.writeFile(`${context.dir}/read-safety.md`, content)
  await createGitVault(context).checkpoint(author)
  for (const operation of ['readFile', 'readdir'] as const) {
    for (const code of ['EIO', 'EACCES']) await assertGitReadFailure(context, operation, code)
  }
  await assertGitCorruptObjectFailure(context)
  if ((await createGitVault(context).requireClean()).changedFiles !== 0) throw new Error('readSafetyChangedWorkspace')
  return true
}

export async function assertGitReadFailure(context: Context, operation: ReadOperation, code: string) {
  const before = await savedState(context)
  const injected = Object.assign(new Error('simulatedReadFailure'), { code })
  const oid = await git.writeBlob({ ...context, blob: Buffer.from('Disposable object\n') })
  const objectPath = `${context.dir}/.git/objects/${oid.slice(0, 2)}/${oid.slice(2)}`
  const target = operation === 'readdir' ? context.dir : objectPath
  const failing = { ...context, fs: { promises: { ...context.fs.promises, [operation]: async (path: string, ...args: unknown[]) => {
    if (path === target) throw injected
    return operation === 'readdir' ? context.fs.promises.readdir(path, ...args) : context.fs.promises.readFile(path, ...args)
  } } } }
  const error = await failure(() => operation === 'readdir'
    ? createGitVault(failing).checkpoint(author)
    : git.readObject({ ...failing, oid }))
  await assertSavedState(context, before)
  if (error !== injected) throw new Error(`gitMasked${operation}Failure`)
}

export async function assertGitCorruptObjectFailure(context: Context) {
  const before = await savedState(context)
  const oid = await git.writeBlob({ ...context, blob: Buffer.from('Disposable corrupt object\n') })
  const path = `${context.dir}/.git/objects/${oid.slice(0, 2)}/${oid.slice(2)}`
  await context.fs.promises.writeFile(path, new Uint8Array([0, 0]))
  const error = await failure(() => git.readObject({ ...context, oid }))
  await assertSavedState(context, before)
  const diagnostic = requireErrorName(error, 'DecompressionError')
  if (!diagnostic.message.includes('Invalid compressed buffer')) throw new Error('gitMaskedCorruptObjectFailure')
  const missing = await failure(() => git.readObject({ ...context, oid: '0'.repeat(40) }))
  requireErrorName(missing, 'NotFoundError')
}

function requireErrorName(error: unknown, name: string) {
  if (!(error instanceof Error)) throw new Error('gitMissingErrorDiagnostic')
  if (error.name !== name) throw new Error('gitChangedErrorDiagnostic')
  return error
}

async function savedState(context: Context) {
  const read = async (file: string) => Buffer.from(await context.fs.promises.readFile(`${context.dir}/${file}`)).toString('base64')
  return { head: await git.resolveRef({ ...context, ref: 'HEAD' }), index: await read('.git/index'), note: await read('read-safety.md') }
}

async function assertSavedState(context: Context, before: Awaited<ReturnType<typeof savedState>>) {
  if (JSON.stringify(await savedState(context)) !== JSON.stringify(before)) throw new Error('gitReadFailureChangedSavedState')
}

async function failure(operation: () => Promise<unknown>) {
  try { await operation() } catch (error) { return error }
  return undefined
}
