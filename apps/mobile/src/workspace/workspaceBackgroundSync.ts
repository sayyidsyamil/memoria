import { optionalNativeWorkspaceAccessModule, type NativeWorkspaceAccessModule } from './nativeWorkspaceAccess'

/** A finite iOS execution lease, not a suspended/background polling service. */
export async function withWorkspaceBackgroundSync(
  run: (signal: AbortSignal) => Promise<unknown>,
  module: NativeWorkspaceAccessModule | null = optionalNativeWorkspaceAccessModule(),
) {
  const controller = new AbortController()
  if (!module?.beginWorkspaceSync || !module.endWorkspaceSync || !module.addListener) return run(controller.signal)
  const identifier = module.createWorkspaceOperationId?.()
  if (!identifier) return
  const subscription = module.addListener('workspaceSyncExpired', event => {
    if (event.identifier === identifier) controller.abort()
  })
  let granted = false
  try {
    granted = await module.beginWorkspaceSync(identifier)
    if (granted && !controller.signal.aborted) await run(controller.signal)
  } finally {
    subscription.remove()
    if (granted) await module.endWorkspaceSync(identifier)
  }
}
