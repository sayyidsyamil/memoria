const pendingOperations = new WeakMap<object, Map<string, string>>()

/** A failed attempt keeps its identity until that exact native mutation succeeds. */
export function runNativeWorkspaceMutation(
  owner: object,
  key: string,
  createIdentifier: () => string,
  perform: (identifier: string) => Promise<void>,
) {
  let pending = pendingOperations.get(owner)
  if (!pending) {
    pending = new Map<string, string>()
    pendingOperations.set(owner, pending)
  }
  const identifier = pending.get(key) ?? createIdentifier()
  pending.set(key, identifier)
  const attempts = pending
  return perform(identifier).then(() => {
    if (attempts.get(key) === identifier) attempts.delete(key)
  })
}
