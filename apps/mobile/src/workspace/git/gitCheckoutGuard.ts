import type { File } from 'expo-file-system'

// Keep this module independent of Git's runtime for the synchronous read boundary.
export function assertGitCheckoutComplete(module: { File: typeof File }, rootUri: string) {
  if (new module.File(rootUri, '.git', 'memoria-checkout.json').exists) {
    throw new Error('checkoutRecoveryRequired')
  }
}
