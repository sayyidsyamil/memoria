import { type FrontmatterTextValue, formatYamlField, formatYamlKey } from './yaml'

export { UnsafeFrontmatterEditError } from './unsafeText'

/**
 * Throws `UnsafeFrontmatterEditError` for an edit the frontmatter writer would refuse: the
 * same check `updateFrontmatterContent` makes, for callers that check before any I/O.
 */
export function assertSafeFrontmatterEdit(key: string, value: FrontmatterTextValue | undefined): void {
  if (value === undefined) formatYamlKey(key)
  else formatYamlField(key, value)
}
