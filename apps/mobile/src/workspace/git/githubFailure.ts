const messages = {
  uncommittedChanges: 'mobile.git.uncommitted',
  emptyCommitMessage: 'mobile.git.emptyCommitMessage',
  githubAuthorizationExpired: 'mobile.vaults.authFailed',
  githubAuthorizationFailed: 'mobile.vaults.authFailed',
  githubNotConfigured: 'mobile.vaults.notConfigured',
  githubNetworkFailed: 'mobile.vaults.networkFailed',
  githubRequestTimeout: 'mobile.vaults.requestTimeout',
  githubCredentialStoreFailed: 'mobile.vaults.credentialFailed',
} as const

export function githubFailure(error: unknown): typeof messages[keyof typeof messages] | 'mobile.vaults.requestFailed' {
  const code = error instanceof Error ? error.message : ''
  if (Object.hasOwn(messages, code)) return messages[code as keyof typeof messages]
  return 'mobile.vaults.requestFailed'
}
