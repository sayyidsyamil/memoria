import * as Y from 'yjs'
import { DOC_BLOCKS_FRAGMENT, DOC_FRONTMATTER_FIELD, DOC_META_MAP } from '../../protocol/src/index.ts'
import type { HeadlessEditor } from './markdownBlocks.ts'

/**
 * What a `memoria.blocknote/1` document may be made of: the shared types of the format, the
 * node types of the editor schema with their attributes, and its marks.
 *
 * This is deliberately a check of vocabulary, not of structure. Two edits that are each valid
 * can merge into a structure the schema does not allow (two people splitting the same block);
 * editors repair that when they read it, and a server that refused such a merge would lock a
 * client out for doing nothing wrong. A merge can never introduce a new node type, attribute
 * or mark, so refusing unknown vocabulary is safe.
 */
export interface DocVocabulary {
  nodes: ReadonlyMap<string, ReadonlySet<string>>
  marks: ReadonlySet<string>
}

const SHARED_TYPES = new Set<string>([DOC_BLOCKS_FRAGMENT, DOC_FRONTMATTER_FIELD, DOC_META_MAP])
/** y-prosemirror keeps the marks of a node itself, if it has any, under this attribute. */
const NODE_MARKS_ATTRIBUTE = 'marks'
/** y-prosemirror names an overlapping mark `<name>--<hash>`. */
const MARK_HASH_SEPARATOR = '--'

export function docVocabulary(editor: HeadlessEditor): DocVocabulary {
  const { nodes, marks } = editor.pmSchema
  const attributes = Object.entries(nodes).map(([name, type]): [string, Set<string>] => [
    name,
    new Set([...Object.keys(type.spec.attrs ?? {}), NODE_MARKS_ATTRIBUTE]),
  ])
  return { nodes: new Map(attributes), marks: new Set(Object.keys(marks)) }
}

function markName(key: string): string {
  return key.split(MARK_HASH_SEPARATOR)[0]
}

function textViolation(text: Y.XmlText, { marks }: DocVocabulary): string | null {
  for (const { attributes = {} } of text.toDelta() as { attributes?: Record<string, unknown> }[]) {
    const unknown = Object.keys(attributes).find((key) => !marks.has(markName(key)))
    if (unknown) return `unknown mark ${unknown}`
  }
  return null
}

function elementViolation(element: Y.XmlElement, vocabulary: DocVocabulary): string | null {
  const allowed = vocabulary.nodes.get(element.nodeName)
  if (!allowed) return `unknown node ${element.nodeName}`
  const unknown = Object.keys(element.getAttributes()).find((name) => !allowed.has(name))
  return unknown ? `unknown attribute ${unknown} on ${element.nodeName}` : null
}

function nodeViolation(node: unknown, vocabulary: DocVocabulary): string | null {
  if (node instanceof Y.XmlText) return textViolation(node, vocabulary)
  if (node instanceof Y.XmlElement) return elementViolation(node, vocabulary)
  return 'a node that is neither an element nor text'
}

/** Why a document is not acceptable, or null when everything in it is known vocabulary. */
export function vocabularyViolation(doc: Y.Doc, vocabulary: DocVocabulary): string | null {
  const stray = [...doc.share.keys()].find((name) => !SHARED_TYPES.has(name))
  if (stray) return `unknown shared type ${stray}`
  for (const node of doc.getXmlFragment(DOC_BLOCKS_FRAGMENT).createTreeWalker(() => true)) {
    const violation = nodeViolation(node, vocabulary)
    if (violation) return violation
  }
  return null
}
