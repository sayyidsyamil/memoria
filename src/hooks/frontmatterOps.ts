import { invoke } from '@tauri-apps/api/core'
import type { FrontmatterValue } from '../components/Inspector'
import { updateFrontmatterContent } from '../lib/frontmatterText'
import { assertVaultWritable } from '../lib/offline/offlineMode'
import { editRemoteFrontmatter } from '../lib/remoteFrontmatter'
import { createVaultBackend, hasRemoteVault, type VaultFileOps } from '../lib/vaultBackend'
import { isTauri, trackMockChange, updateMockContent } from '../mock-tauri'
import type { VaultEntry, VaultPropertyValue } from '../types'
import { parseFrontmatter } from '../utils/frontmatter'
import { normalizeNoteFormat } from '../utils/noteFormat'
import { normalizeNoteWidthMode } from '../utils/noteWidth'
import { canonicalFrontmatterKey, isSystemMetadataKey } from '../utils/systemMetadata'

type FrontmatterCommand = 'update_frontmatter' | 'delete_frontmatter_property'
type FrontmatterKey = string
type FrontmatterOp = 'update' | 'delete'
type MarkdownContent = string
type ToastMessage = string | null
type VaultPath = string
type WikilinkText = string
type PropertyPatchValue = VaultEntry['properties'][string]

const ENTRY_DELETE_MAP: Record<string, Partial<VaultEntry>> = {
  title: { title: '' },
  type: { isA: null }, status: { status: null }, color: { color: null },
  _icon: { icon: null }, _sidebar_label: { sidebarLabel: null },
  aliases: { aliases: [] }, belongs_to: { belongsTo: [] }, related_to: { relatedTo: [] },
  _archived: { archived: false },
  _order: { order: null },
  template: { template: null }, _sort: { sort: null }, view: { view: null },
  _width: { noteWidth: null }, _display: { display: null }, visible: { visible: null },
  _organized: { organized: false },
  _favorite: { favorite: false }, _favorite_index: { favoriteIndex: null },
  _list_properties_display: { listPropertiesDisplay: [] },
}

/** Check if a string contains a wikilink pattern `[[...]]`. */
function isWikilink(value: WikilinkText): boolean {
  return value.startsWith('[[') && value.includes(']]')
}

/** Extract wikilink strings from a FrontmatterValue. Returns empty array if none. */
function extractWikilinks(value: FrontmatterValue): WikilinkText[] {
  if (typeof value === 'string') return isWikilink(value) ? [value] : []
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === 'string' && isWikilink(v))
  return []
}

/**
 * Relationship patch: a partial update to merge into `entry.relationships`.
 * Keys map to their new ref arrays. A `null` value means "remove this key".
 */
export type RelationshipPatch = Record<FrontmatterKey, WikilinkText[] | null>

/** Properties patch: a partial update to merge into `entry.properties`.
 *  Keys map to their new property values. A `null` value means "remove this key". */
export type PropertiesPatch = Record<FrontmatterKey, PropertyPatchValue>

export interface EntryPatchResult {
  patch: Partial<VaultEntry>
  relationshipPatch: RelationshipPatch | null
  propertiesPatch: PropertiesPatch | null
}

interface FrontmatterPatchInput {
  key: FrontmatterKey
  lookupKey: FrontmatterKey
  systemMetadataKey: boolean
  value?: FrontmatterValue
}

function singleEntryRecord<T>({ key, value }: { key: FrontmatterKey; value: T }): Record<FrontmatterKey, T> {
  return Object.fromEntries([[key, value]])
}

function applyRecordPatch<T>(
  existing: Record<string, T>,
  patch: Record<string, T | null>,
): Record<string, T> {
  const merged = { ...existing }
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) Reflect.deleteProperty(merged, key)
    else Reflect.set(merged, key, value)
  }
  return merged
}

function frontmatterString(value: FrontmatterValue | undefined): string | null {
  return value != null ? String(value) : null
}

function frontmatterStringList(value: FrontmatterValue | undefined): string[] {
  return Array.isArray(value) ? value.map(String) : []
}

function frontmatterNumber(value: FrontmatterValue | undefined): number | null {
  return typeof value === 'number' ? value : null
}

function visibleValue(value: FrontmatterValue | undefined): false | null {
  return value === false ? false : null
}

function propertyValue(value: FrontmatterValue): PropertyPatchValue {
  if (Array.isArray(value)) {
    const values = value.map(String)
    return values.length === 1 ? values[0] ?? '' : values
  }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value
  return String(value)
}

function knownFrontmatterUpdates(value: FrontmatterValue | undefined): Record<FrontmatterKey, Partial<VaultEntry>> {
  const str = frontmatterString(value)
  const arr = frontmatterStringList(value)
  return {
    title: { title: str ?? '' },
    type: { isA: str }, status: { status: str }, color: { color: str },
    _icon: { icon: str }, _sidebar_label: { sidebarLabel: str },
    aliases: { aliases: arr }, belongs_to: { belongsTo: arr }, related_to: { relatedTo: arr },
    _archived: { archived: Boolean(value) },
    _order: { order: frontmatterNumber(value) },
    template: { template: str },
    _sort: { sort: str },
    view: { view: str },
    _width: { noteWidth: normalizeNoteWidthMode(value) },
    _display: { display: normalizeNoteFormat(value) },
    visible: { visible: visibleValue(value) },
    _organized: { organized: Boolean(value) },
    _favorite: { favorite: Boolean(value) },
    _favorite_index: { favoriteIndex: frontmatterNumber(value) },
    _list_properties_display: { listPropertiesDisplay: arr },
  }
}

function deleteEntryPatch({ key, lookupKey, systemMetadataKey }: FrontmatterPatchInput): EntryPatchResult {
  const relationshipPatch = systemMetadataKey ? null : singleEntryRecord({ key, value: null })
  const hasKnownDelete = Object.hasOwn(ENTRY_DELETE_MAP, lookupKey)
  const propertiesPatch = !systemMetadataKey && !hasKnownDelete ? singleEntryRecord({ key, value: null }) : null
  return {
    patch: (Reflect.get(ENTRY_DELETE_MAP, lookupKey) as Partial<VaultEntry> | undefined) ?? {},
    relationshipPatch,
    propertiesPatch,
  }
}

function relationshipUpdatePatch(
  key: FrontmatterKey,
  systemMetadataKey: boolean,
  value: FrontmatterValue | undefined,
): RelationshipPatch | null {
  const wikilinks = value != null ? extractWikilinks(value) : []
  return !systemMetadataKey && wikilinks.length > 0 ? singleEntryRecord({ key, value: wikilinks }) : null
}

function propertiesUpdatePatch({
  key,
  lookupKey,
  systemMetadataKey,
  value,
}: FrontmatterPatchInput): PropertiesPatch | null {
  const knownUpdates = knownFrontmatterUpdates(value)
  if (systemMetadataKey || Object.hasOwn(knownUpdates, lookupKey) || value == null) return null
  return singleEntryRecord({ key, value: propertyValue(value) })
}

function updateEntryPatch(input: FrontmatterPatchInput): EntryPatchResult {
  const updates = knownFrontmatterUpdates(input.value)
  return {
    patch: (Reflect.get(updates, input.lookupKey) as Partial<VaultEntry> | undefined) ?? {},
    relationshipPatch: relationshipUpdatePatch(input.key, input.systemMetadataKey, input.value),
    propertiesPatch: propertiesUpdatePatch(input),
  }
}

/** Map a frontmatter key+value to the corresponding VaultEntry field(s). */
export function frontmatterToEntryPatch(
  op: FrontmatterOp, key: FrontmatterKey, value?: FrontmatterValue,
): EntryPatchResult {
  const lookupKey = canonicalFrontmatterKey(key)
  const systemMetadataKey = isSystemMetadataKey(key)
  const input = { key, lookupKey, systemMetadataKey, value }
  return op === 'delete' ? deleteEntryPatch(input) : updateEntryPatch(input)
}

/** Parse frontmatter from full content and return a merged VaultEntry patch for all known fields. */
export function contentToEntryPatch(content: MarkdownContent): Partial<VaultEntry> {
  const fm = parseFrontmatter(content)
  const merged: Partial<VaultEntry> = {}
  const customProps: Record<FrontmatterKey, PropertyPatchValue> = {}
  for (const [key, value] of Object.entries(fm)) {
    const { patch, propertiesPatch } = frontmatterToEntryPatch('update', key, value)
    Object.assign(merged, patch)
    if (propertiesPatch) Object.assign(customProps, propertiesPatch)
  }
  if (Object.keys(customProps).length > 0) merged.properties = customProps
  return merged
}

async function invokeFrontmatter(command: FrontmatterCommand, args: Record<string, unknown>): Promise<MarkdownContent> {
  return invoke<string>(command, args)
}

function seedMockContent(path: VaultPath, content: MarkdownContent): void {
  updateMockContent(path, content)
}

/** The browser's in-memory copy of a note, when reading it failed. */
function windowMockContent(path: VaultPath): MarkdownContent {
  if (typeof window === 'undefined' || !window.__mockContent) return ''
  return (Reflect.get(window.__mockContent, path) as string | undefined) ?? ''
}

async function loadMockContent(files: VaultFileOps, path: VaultPath): Promise<MarkdownContent> {
  try {
    return (await files.read(path)).content
  } catch (error) {
    void error
    return windowMockContent(path)
  }
}

/** Keeps the browser's in-memory copy, saved or not, so the edit is not lost. */
function rememberMockContent(path: VaultPath, content: MarkdownContent): void {
  updateMockContent(path, content)
  trackMockChange(path)
}

async function persistMockContent(files: VaultFileOps, path: VaultPath, content: MarkdownContent): Promise<void> {
  try {
    await files.write(path, content)
  } catch (error) {
    rememberMockContent(path, content)
    throw error
  }
  rememberMockContent(path, content)
}

interface FrontmatterOpRequest {
  op: FrontmatterOp
  path: VaultPath
  key: FrontmatterKey
  value?: FrontmatterValue
  vaultPath?: string
}

async function executeMockFrontmatterOp(files: VaultFileOps, { op, path, key, value }: FrontmatterOpRequest): Promise<MarkdownContent> {
  assertVaultWritable('editing properties')
  const loadedContent = await loadMockContent(files, path)
  seedMockContent(path, loadedContent)
  const content = updateFrontmatterContent(loadedContent, key, op === 'delete' ? undefined : requireUpdateValue(value))
  await persistMockContent(files, path, content)
  return content
}

function requireUpdateValue(value: FrontmatterValue | undefined): FrontmatterValue {
  if (value === undefined) throw new Error('A frontmatter update requires a value')
  return value
}

/** The web with a Memoria remote: the edit goes into the note's live document or its file. */
async function executeRemoteFrontmatterOp(files: VaultFileOps, { op, path, key, value }: FrontmatterOpRequest): Promise<MarkdownContent> {
  assertVaultWritable('editing properties')
  return editRemoteFrontmatter(files, { path, key, value: op === 'delete' ? undefined : requireUpdateValue(value) })
}

async function executeFrontmatterOp(request: FrontmatterOpRequest): Promise<MarkdownContent> {
  const { op, path, key, value } = request
  if (isTauri()) {
    return op === 'update'
      ? invokeFrontmatter('update_frontmatter', { path, key, value })
      : invokeFrontmatter('delete_frontmatter_property', { path, key })
  }
  const { files } = createVaultBackend(request.vaultPath)
  return hasRemoteVault() ? executeRemoteFrontmatterOp(files, request) : executeMockFrontmatterOp(files, request)
}

export interface FrontmatterOpOptions {
  /** Suppress toast feedback (caller manages its own toast). */
  silent?: boolean
  /** Require this note to still be active before applying UI-side mutation state. */
  requireActivePath?: VaultPath
}

export interface FrontmatterApplyCallbacks {
  updateTab: (path: VaultPath, content: MarkdownContent) => void
  updateEntry: (path: VaultPath, patch: Partial<VaultEntry>) => void
  cacheContent?: (path: VaultPath, content: MarkdownContent) => void
  toast: (message: ToastMessage) => void
  getEntry?: (path: VaultPath) => VaultEntry | undefined
  onMissingNotePath?: (path: VaultPath, error: unknown) => void | Promise<void>
  shouldApply?: (path: VaultPath) => boolean
}

export interface FrontmatterRunRequest {
  op: FrontmatterOp
  path: VaultPath
  key: FrontmatterKey
  value?: FrontmatterValue
  callbacks: FrontmatterApplyCallbacks
  options?: FrontmatterOpOptions
}

/** Apply a properties patch by merging into the existing properties map. */
export function applyPropertiesPatch(
  existing: Record<FrontmatterKey, VaultPropertyValue>, propPatch: PropertiesPatch,
): Record<FrontmatterKey, VaultPropertyValue> {
  return applyRecordPatch(existing, propPatch)
}

/** Apply a relationship patch by merging into the existing relationships map. */
export function applyRelationshipPatch(
  existing: Record<FrontmatterKey, WikilinkText[]>, relPatch: RelationshipPatch,
): Record<FrontmatterKey, WikilinkText[]> {
  return applyRecordPatch(existing, relPatch)
}

function patchNeedsExistingEntry(result: EntryPatchResult): boolean {
  return Boolean(result.relationshipPatch || result.propertiesPatch)
}

function buildFullEntryPatch(
  path: VaultPath,
  callbacks: FrontmatterApplyCallbacks,
  result: EntryPatchResult,
): Partial<VaultEntry> {
  const fullPatch = { ...result.patch }
  if (!patchNeedsExistingEntry(result) || !callbacks.getEntry) return fullPatch

  const current = callbacks.getEntry(path)
  if (!current) return fullPatch

  if (result.relationshipPatch) {
    fullPatch.relationships = applyRelationshipPatch(current.relationships, result.relationshipPatch)
  }
  if (result.propertiesPatch) {
    fullPatch.properties = applyPropertiesPatch(current.properties, result.propertiesPatch)
  }
  return fullPatch
}

function applyEntryPatch(path: VaultPath, callbacks: FrontmatterApplyCallbacks, result: EntryPatchResult) {
  const fullPatch = buildFullEntryPatch(path, callbacks, result)
  if (Object.keys(fullPatch).length > 0) callbacks.updateEntry(path, fullPatch)
}

function successToastMessage(op: FrontmatterOp): ToastMessage {
  return op === 'update' ? 'Property updated' : 'Property deleted'
}

function notifyFrontmatterSuccess(op: FrontmatterOp, callbacks: FrontmatterApplyCallbacks, options?: FrontmatterOpOptions) {
  if (!options?.silent) callbacks.toast(successToastMessage(op))
}

function failureToastMessage(op: FrontmatterOp): ToastMessage {
  return `Failed to ${op} property`
}

function frontmatterErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  return String(error)
}

export function isMissingFrontmatterTargetError(error: unknown): boolean {
  return /does not exist|not found|enoent/i.test(frontmatterErrorMessage(error))
}

async function runMissingNotePathCallback(
  path: VaultPath,
  error: unknown,
  callbacks: FrontmatterApplyCallbacks,
): Promise<void> {
  try {
    await callbacks.onMissingNotePath?.(path, error)
  } catch (err) {
    console.warn('Failed to handle missing frontmatter target:', err)
  }
}

interface FrontmatterFailureParams {
  callbacks: FrontmatterApplyCallbacks
  err: unknown
  op: FrontmatterOp
  options?: FrontmatterOpOptions
  path: VaultPath
}

async function handleFrontmatterFailure({
  callbacks,
  err,
  op,
  options,
  path,
}: FrontmatterFailureParams): Promise<undefined> {
  const missingTarget = isMissingFrontmatterTargetError(err)
  if (missingTarget) {
    console.warn(`Skipped ${op} frontmatter for missing note:`, err)
    await runMissingNotePathCallback(path, err, callbacks)
  } else {
    console.error(`Failed to ${op} frontmatter:`, err)
  }
  if (options?.silent) throw err
  if (!missingTarget) callbacks.toast(failureToastMessage(op))
  return undefined
}

/** Run a frontmatter update/delete and apply the result to state.
 *  Returns the new file content on success, or undefined on failure. */
export async function runFrontmatterAndApply(request: FrontmatterRunRequest): Promise<MarkdownContent | undefined> {
  const { op, path, key, value, callbacks, options } = request
  try {
    const newContent = await executeFrontmatterOp({ op, path, key, value })
    callbacks.cacheContent?.(path, newContent)
    if (callbacks.shouldApply && !callbacks.shouldApply(path)) return undefined
    callbacks.updateTab(path, newContent)
    applyEntryPatch(path, callbacks, frontmatterToEntryPatch(op, key, value))
    notifyFrontmatterSuccess(op, callbacks, options)
    return newContent
  } catch (err) {
    return handleFrontmatterFailure({ op, path, err, callbacks, options })
  }
}
