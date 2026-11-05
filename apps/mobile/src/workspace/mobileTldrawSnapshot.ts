type JsonPrimitive = boolean | null | number | string
type JsonValue = JsonArray | JsonObject | JsonPrimitive
type JsonArray = JsonValue[]
type JsonObject = { [key: string]: JsonValue }

const defaultDocumentId = 'document:document'
const defaultPageId = 'page:page'

export type MobileTldrawSnapshotEditResult = {
  added: boolean
  snapshot: string
}

export type MobileTldrawTextShape = {
  id: string
  text: string
}

export type MobileTldrawTextShapeUpdateResult = {
  snapshot: string
  updated: boolean
}

export type MobileTldrawTextShapeRemoveResult = {
  removed: boolean
  snapshot: string
}

type MobileTldrawTextShapeRecord = {
  id: string
  record: JsonObject
  recordKey: string
}

export function canAddMobileTldrawTextShapeToSnapshot({ snapshot }: { snapshot: string }): boolean {
  const root = readSnapshotObject({ snapshot })
  return root ? snapshotRecordsOwner({ root }) !== null : false
}

export function readMobileTldrawTextShapesFromSnapshot({ snapshot }: { snapshot: string }): MobileTldrawTextShape[] {
  const root = readSnapshotObject({ snapshot })
  const recordsOwner = root ? snapshotRecordsOwner({ root }) : null
  if (!recordsOwner) return []

  return textShapeRecords({ records: recordsOwner.records }).map(({ id, record }) => ({
    id,
    text: readTextShapePlainText({ record }),
  }))
}

export function updateMobileTldrawTextShapeInSnapshot({
  shapeId,
  snapshot,
  text,
}: {
  shapeId: string
  snapshot: string
  text: string
}): MobileTldrawTextShapeUpdateResult {
  const root = readSnapshotObject({ snapshot })
  const recordsOwner = root ? snapshotRecordsOwner({ root }) : null
  if (!recordsOwner) return { snapshot, updated: false }

  const shape = textShapeRecords({ records: recordsOwner.records }).find(candidate => candidate.id === shapeId)
  if (!shape) return { snapshot, updated: false }

  const props = isJsonObject(shape.record.props) ? shape.record.props : {}
  const nextProps: JsonObject = {
    ...props,
    richText: mobileTldrawRichText({ text }),
  }
  if (typeof props.text === 'string') nextProps.text = text
  shape.record.props = nextProps

  return {
    snapshot: JSON.stringify(root, null, 2),
    updated: true,
  }
}

export function removeMobileTldrawTextShapeFromSnapshot({
  shapeId,
  snapshot,
}: {
  shapeId: string
  snapshot: string
}): MobileTldrawTextShapeRemoveResult {
  const root = readSnapshotObject({ snapshot })
  const recordsOwner = root ? snapshotRecordsOwner({ root }) : null
  if (!recordsOwner) return { snapshot, removed: false }

  const shape = textShapeRecords({ records: recordsOwner.records }).find(candidate => candidate.id === shapeId)
  if (!shape) return { snapshot, removed: false }

  delete recordsOwner.records[shape.recordKey]
  removeBindingsForShape({ records: recordsOwner.records, shapeId })

  return {
    removed: true,
    snapshot: JSON.stringify(root, null, 2),
  }
}

export function addMobileTldrawTextShapeToSnapshot({
  snapshot,
  text,
}: {
  snapshot: string
  text: string
}): MobileTldrawSnapshotEditResult {
  const label = text.trim()
  if (!label) return { added: false, snapshot }

  const root = readSnapshotObject({ snapshot })
  if (!root) return { added: false, snapshot }

  const recordsOwner = snapshotRecordsOwner({ root })
  if (!recordsOwner) return { added: false, snapshot }

  const records = recordsOwner.records
  ensureDocumentRecord({ records })
  const pageId = firstPageId({ records }) ?? ensurePageRecord({ records })
  const shapeId = nextShapeId({ records })
  records[shapeId] = mobileTldrawTextShape({
    index: nextShapeIndex({ records }),
    pageId,
    shapeId,
    text: label,
  })

  return {
    added: true,
    snapshot: JSON.stringify(root, null, 2),
  }
}

function readSnapshotObject({ snapshot }: { snapshot: string }): JsonObject | null {
  try {
    const parsed = JSON.parse(snapshot) as unknown
    return isJsonObject(parsed) ? parsed : null
  } catch {
    return null
  }
}

function snapshotRecordsOwner({ root }: { root: JsonObject }): (JsonObject & { records: JsonObject }) | null {
  const store = root.store
  if (isJsonObject(store)) return { ...root, records: store }

  const directRecords = root.records
  if (isJsonObject(directRecords)) return root as JsonObject & { records: JsonObject }

  const document = root.document
  if (isJsonObject(document) && isJsonObject(document.records)) {
    return document as JsonObject & { records: JsonObject }
  }

  return null
}

function textShapeRecords({ records }: { records: JsonObject }): MobileTldrawTextShapeRecord[] {
  return Object.entries(records).flatMap(([recordId, record]) => {
    if (!isTextShapeRecord(record)) return []
    return [{
      id: typeof record.id === 'string' ? record.id : recordId,
      record,
      recordKey: recordId,
    }]
  })
}

function isTextShapeRecord(record: JsonValue | undefined): record is JsonObject {
  if (!isJsonObject(record)) return false
  return record.typeName === 'shape' && record.type === 'text'
}

function readTextShapePlainText({ record }: { record: JsonObject }): string {
  const props = isJsonObject(record.props) ? record.props : null
  if (!props) return ''
  if (typeof props.text === 'string') return props.text
  return readRichTextDocumentText(props.richText)
}

function readRichTextDocumentText(value: JsonValue | undefined): string {
  if (!isJsonObject(value)) return ''

  const content = value.content
  if (!Array.isArray(content)) return readRichTextInlineText(value)

  return content.map(readRichTextInlineText).join('\n')
}

function readRichTextInlineText(value: JsonValue | undefined): string {
  if (!isJsonObject(value)) return ''
  if (typeof value.text === 'string') return value.text
  if (value.type === 'hardBreak') return '\n'

  const content = value.content
  if (!Array.isArray(content)) return ''
  return content.map(readRichTextInlineText).join('')
}

function removeBindingsForShape({ records, shapeId }: { records: JsonObject; shapeId: string }) {
  for (const [recordId, record] of Object.entries(records)) {
    if (!isJsonObject(record) || record.typeName !== 'binding') continue
    if (record.fromId === shapeId || record.toId === shapeId) delete records[recordId]
  }
}

function ensureDocumentRecord({ records }: { records: JsonObject }) {
  if (records[defaultDocumentId] !== undefined) return
  records[defaultDocumentId] = {
    gridSize: 20,
    id: defaultDocumentId,
    meta: {},
    name: '',
    typeName: 'document',
  }
}

function ensurePageRecord({ records }: { records: JsonObject }): string {
  const pageId = records[defaultPageId] === undefined ? defaultPageId : nextPageId({ records })
  records[pageId] = {
    id: pageId,
    index: 'a1',
    meta: {},
    name: 'Page 1',
    typeName: 'page',
  }
  return pageId
}

function firstPageId({ records }: { records: JsonObject }): string | null {
  for (const record of Object.values(records)) {
    if (isJsonObject(record) && record.typeName === 'page' && typeof record.id === 'string') return record.id
  }
  return null
}

function nextPageId({ records }: { records: JsonObject }): string {
  let index = 1
  while (records[`page:mobile-${index}`] !== undefined) index += 1
  return `page:mobile-${index}`
}

function nextShapeId({ records }: { records: JsonObject }): string {
  let index = shapeRecords({ records }).length + 1
  while (records[`shape:mobile-text-${index}`] !== undefined) index += 1
  return `shape:mobile-text-${index}`
}

function nextShapeIndex({ records }: { records: JsonObject }): string {
  const usedIndexes = new Set(shapeRecords({ records }).map((record) => record.index).filter(isString))
  let index = usedIndexes.size + 1
  while (usedIndexes.has(`a${index}`)) index += 1
  return `a${index}`
}

function shapeRecords({ records }: { records: JsonObject }): JsonObject[] {
  return Object.values(records).filter((record): record is JsonObject => {
    return isJsonObject(record) && record.typeName === 'shape'
  })
}

function mobileTldrawTextShape({
  index,
  pageId,
  shapeId,
  text,
}: {
  index: string
  pageId: string
  shapeId: string
  text: string
}): JsonObject {
  return {
    id: shapeId,
    index,
    isLocked: false,
    meta: {},
    opacity: 1,
    parentId: pageId,
    props: {
      autoSize: true,
      color: 'black',
      font: 'draw',
      richText: mobileTldrawRichText({ text }),
      scale: 1,
      size: 'm',
      textAlign: 'start',
      w: 260,
    },
    rotation: 0,
    type: 'text',
    typeName: 'shape',
    x: 96,
    y: 96 + (Number.parseInt(index.slice(1), 10) - 1) * 56,
  }
}

function mobileTldrawRichText({ text }: { text: string }): JsonObject {
  return {
    content: [
      {
        content: [{ text, type: 'text' }],
        type: 'paragraph',
      },
    ],
    type: 'doc',
  }
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isString(value: unknown): value is string {
  return typeof value === 'string'
}
