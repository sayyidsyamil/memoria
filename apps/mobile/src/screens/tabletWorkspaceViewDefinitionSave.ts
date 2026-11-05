import type { MobileWorkspaceEdit } from '../workspace/mobileWorkspaceEditing'
import { normalizedDisplayProperties } from '../workspace/mobileWorkspaceEditing'
import {
  formatMobileCommaListText,
  parseMobileCommaListText,
} from '../workspace/mobileCommaListText'
import type {
  MobileSavedView,
  MobileViewFilterCondition,
  MobileViewFilterGroup,
  MobileViewFilterNode,
  MobileViewFilterOp,
} from '../workspace/mobileWorkspaceModel'
import type { TabletReadOnlyForm } from './tabletWorkspaceTypes'
import { normalizedOptionalIcon, normalizedOptionalSort } from './tabletWorkspaceViewDefinitionNormalization'

type ViewDefinitionCreateEdit = Extract<MobileWorkspaceEdit, { type: 'createView' }>
type ViewDefinitionSaveEdit = Extract<MobileWorkspaceEdit, { type: 'updateView' }>

type ViewDefinitionForm = Pick<
  TabletReadOnlyForm,
  'viewDisplayProperties' | 'viewFilters' | 'viewIcon' | 'viewName' | 'viewSort' | 'viewTone'
>
const listFilterOps = new Set<MobileViewFilterOp>(['any_of', 'none_of'])
const noValueFilterOps = new Set<MobileViewFilterOp>(['is_empty', 'is_not_empty'])
const regexFilterOps = new Set<MobileViewFilterOp>(['contains', 'equals', 'not_contains', 'not_equals'])

export function viewDefinitionCreateEdit(
  form: ViewDefinitionForm,
): ViewDefinitionCreateEdit | null {
  const trimmedName = form.viewName.trim()
  if (!trimmedName) return null

  return {
    definition: {
      color: form.viewTone,
      filters: cloneFilterGroup(form.viewFilters),
      icon: normalizedOptionalIcon(form.viewIcon),
      listPropertiesDisplay: normalizedDisplayProperties(form.viewDisplayProperties),
      name: trimmedName,
      sort: normalizedOptionalSort(form.viewSort),
    },
    type: 'createView',
  }
}

export function viewDefinitionSaveEdit(
  form: ViewDefinitionForm,
  viewId: string,
  views: MobileSavedView[],
): ViewDefinitionSaveEdit | null {
  const view = views.find((candidate) => candidate.id === viewId)
  const trimmedName = form.viewName.trim()
  if (!view || !trimmedName) return null

  return {
    definition: {
      ...view.definition,
      color: form.viewTone,
      filters: cloneFilterGroup(form.viewFilters),
      icon: normalizedOptionalIcon(form.viewIcon),
      listPropertiesDisplay: normalizedDisplayProperties(form.viewDisplayProperties),
      name: trimmedName,
      sort: normalizedOptionalSort(form.viewSort),
    },
    type: 'updateView',
    viewId,
  }
}

function cloneFilterGroup(group: MobileViewFilterGroup): MobileViewFilterGroup {
  if ('any' in group) return { any: group.any.map(cloneFilterNode) }
  return { all: group.all.map(cloneFilterNode) }
}

function cloneFilterNode(node: MobileViewFilterNode): MobileViewFilterNode {
  if ('all' in node || 'any' in node) return cloneFilterGroup(node)
  return normalizedFilterCondition(node)
}

function normalizedFilterCondition(
  condition: MobileViewFilterCondition,
): MobileViewFilterCondition {
  const next: MobileViewFilterCondition = {
    field: condition.field,
    op: condition.op,
  }
  if (noValueFilterOps.has(condition.op)) return next

  next.value = filterValueForSave(condition)
  if (regexFilterOps.has(condition.op) && condition.regex === true) next.regex = true
  return next
}

function filterValueForSave(condition: MobileViewFilterCondition): unknown {
  if (listFilterOps.has(condition.op)) {
    return Array.isArray(condition.value)
      ? [...condition.value]
      : parseMobileCommaListText(String(condition.value ?? ''))
  }

  return Array.isArray(condition.value)
    ? formatMobileCommaListText(condition.value.map(String))
    : condition.value ?? ''
}
