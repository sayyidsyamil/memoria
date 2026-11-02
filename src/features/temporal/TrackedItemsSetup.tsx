import { useId, useState } from 'react'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import type { TemporalAttribute, TemporalAttributeType, TemporalObject, TemporalOverview } from './temporalService'
import { DEFAULT_ITEM_KIND, ITEM_KINDS, attributeEditProblem, isItemKind, kindLabel, recordedValues } from './trackedItemRules'

/**
 * What the ledger follows: items (a decision, commitment or issue) and their attributes. Rarely changed once set up, so the
 * board keeps it at the bottom, folded away.
 */
export function TrackedItemsSetup({ overview, disabled, onSave }: {
  overview: TemporalOverview
  disabled: boolean
  onSave: (objects: TemporalObject[]) => void
}) {
  const notes = useId()
  const [objectId, setObjectId] = useState('')
  const [label, setLabel] = useState('')
  const [kind, setKind] = useState<string>(DEFAULT_ITEM_KIND)
  const [attribute, setAttribute] = useState('')
  const [attributeType, setAttributeType] = useState<TemporalAttributeType>('text')
  const [enumValues, setEnumValues] = useState('')

  const objects = overview.registry.objects
  const existingItem = objects.find(item => item.object_id === objectId.trim())
  const allowedValues = [...new Set(enumValues.split(',').map(value => value.trim()).filter(Boolean))]
  const attributeName = attribute.trim()
  // An edit to an attribute that already has values is checked against them before it can be sent; the ledger stays the authority.
  const attributeProblem = existingItem ? attributeEditProblem(existingItem.attributes.find(item => item.name === attributeName),
    { name: attributeName, type: attributeType, ...(attributeType === 'enum' ? { values: allowedValues } : {}) }, recordedValues(overview, existingItem.object_id, attributeName)) : null
  // A new item can only take a kind the ledger accepts; an existing item shows the kind it has, whatever that is.
  const kindOptions: string[] = existingItem && !isItemKind(existingItem.kind) ? [existingItem.kind, ...ITEM_KINDS] : [...ITEM_KINDS]

  function save() {
    if (!objectId.trim() || !attribute.trim()) return
    // The ledger refuses a new item without a label or with a kind outside its list, and an edit that strands recorded values is held back here.
    if ((!existingItem && (!label.trim() || !isItemKind(kind))) || (attributeType === 'enum' && !allowedValues.length) || attributeProblem) return
    const nextAttribute: TemporalAttribute = { name: attribute.trim(), type: attributeType,
      ...(attributeType === 'enum' && allowedValues.length ? { values: allowedValues } : {}) }
    const attributes = existingItem?.attributes ?? []
    const nextObject = { ...existingItem, object_id: objectId.trim(), label: existingItem?.label ?? label.trim(), kind: existingItem?.kind ?? kind,
      attributes: attributes.some(item => item.name === nextAttribute.name)
        ? attributes.map(item => item.name === nextAttribute.name ? nextAttribute : item)
        : [...attributes, nextAttribute] }
    onSave(existingItem ? objects.map(item => item.object_id === nextObject.object_id ? nextObject : item) : [...objects, nextObject])
  }

  return <>
    <p>Name an item and an attribute to follow. Once an item is tracked, its label and kind are fixed. You can still add attributes to it, or change an attribute's type or allowed values while the values already recorded still fit.</p>
    {objects.length > 0 && <ul className="temporal-registry">{objects.map(item => <li key={item.object_id}>
      <strong>{item.label}</strong> <span className="temporal-meta">{kindLabel(item.kind)}</span>
      <div className="temporal-actions">{item.attributes.map(definition => <Button key={definition.name} size="sm" variant="ghost" disabled={disabled} onClick={() => {
        setObjectId(item.object_id); setLabel(item.label); setKind(isItemKind(item.kind) ? item.kind : DEFAULT_ITEM_KIND); setAttribute(definition.name); setAttributeType(definition.type); setEnumValues(definition.values?.join(', ') ?? '')
      }}>Edit {definition.name} ({definition.type})</Button>)}</div>
    </li>)}</ul>}
    <form onSubmit={event => { event.preventDefault(); save() }}>
      <fieldset disabled={disabled} className="temporal-fields">
        <label>Object ID<Input required value={objectId} onChange={event => setObjectId(event.target.value)} placeholder="e.g. launch-project" /></label>
        <label>Item label<Input required disabled={!!existingItem} aria-describedby={existingItem ? `${notes}-fixed` : undefined} value={existingItem?.label ?? label} onChange={event => setLabel(event.target.value)} placeholder="e.g. Launch project" /></label>
        <label>Item kind<select disabled={!!existingItem} aria-describedby={existingItem ? `${notes}-fixed` : undefined} value={existingItem?.kind ?? kind} onChange={event => setKind(event.target.value)}>
          {kindOptions.map(option => <option key={option} value={option}>{kindLabel(option)}</option>)}
        </select></label>
        {existingItem && <p id={`${notes}-fixed`} className="temporal-hint">{`"${existingItem.label}" is already tracked, so its label and kind can't be changed here. Add an attribute, or edit one of its attributes.`}</p>}
        <label>Attribute name<Input required value={attribute} onChange={event => setAttribute(event.target.value)} placeholder="e.g. launch_date" /></label>
        <label>Attribute type<select value={attributeType} aria-invalid={!!attributeProblem} aria-describedby={attributeProblem ? `${notes}-problem` : undefined} onChange={event => setAttributeType(event.target.value as TemporalAttributeType)}>
          <option value="text">Text</option><option value="number">Number</option><option value="date">Date</option><option value="enum">Enum</option>
        </select></label>
        {attributeType === 'enum' && <label>Allowed values (required, comma-separated)<Input required aria-invalid={!!attributeProblem} aria-describedby={attributeProblem ? `${notes}-problem` : undefined} value={enumValues} onChange={event => setEnumValues(event.target.value)} placeholder="e.g. planned, active, complete" /></label>}
        {attributeProblem && <p id={`${notes}-problem`} role="status" className="temporal-hint" data-tone="warn">{attributeProblem}</p>}
        <Button type="submit" variant="outline" disabled={!objectId.trim() || (!existingItem && (!label.trim() || !isItemKind(kind))) || !attribute.trim() || (attributeType === 'enum' && !allowedValues.length) || !!attributeProblem}>Save tracked item</Button>
      </fieldset>
    </form>
  </>
}
