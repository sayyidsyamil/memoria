import type { RegistryAttribute } from '../../lib/ledgerApi'
import { Input } from '../ui/input'
import { selectClass } from './ui'

interface ValueInputProps {
  id: string
  spec: RegistryAttribute | undefined
  people: Record<string, string>
  value: string
  onChange: (value: string) => void
}

export function ValueInput({ id, spec, people, value, onChange }: ValueInputProps) {
  if (spec?.type === 'enum' || spec?.type === 'person') {
    const options = spec.type === 'enum'
      ? spec.values.map((v) => ({ value: v, label: v }))
      : Object.entries(people).map(([pid, name]) => ({ value: pid, label: name }))
    return (
      <select id={id} className={selectClass} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Choose…</option>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    )
  }
  const type = spec?.type === 'date' ? 'date' : spec?.type === 'number' ? 'number' : 'text'
  return <Input id={id} type={type} value={value} onChange={(e) => onChange(e.target.value)} />
}
