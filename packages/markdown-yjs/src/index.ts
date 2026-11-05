export { patchBlocks, patchText } from './blockPatch.ts'
export { type DocVocabulary, docVocabulary, vocabularyViolation } from './docVocabulary.ts'
export { installHeadlessDom } from './headlessDom.ts'
export { hasConflict, type LineMatch, type MergeChunk, matchLines, merge3 } from './lineMerge.ts'
export { blocksToMarkdown, createHeadlessEditor, type HeadlessEditor, markdownToBlocks, type NoteBlock } from './markdownBlocks.ts'
export {
  baseRevision,
  type FileContent,
  NoteCodec,
  type NoteVersion,
  type ParsedNote,
  setRevision,
} from './noteCodec.ts'
export { type Reconciliation, type ReconcileInput, reconcile } from './reconcile.ts'
export { headlessSchema } from './schema.ts'
export { preserveSource, type SourceVersions } from './sourcePreserve.ts'
