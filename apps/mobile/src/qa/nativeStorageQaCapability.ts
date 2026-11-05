/** Production URLs cannot opt a binary into fixture-writing storage probes. */
export function nativeStorageQaEnabled(development: boolean, nativeCapability: unknown): boolean {
  return development || nativeCapability === true
}
