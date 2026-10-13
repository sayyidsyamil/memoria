import type { LedgerRegistry, RegistryAttribute, RegistryObject } from './ledgerApi'

const attribute = (name: string, type: RegistryAttribute['type'], values: string[] = [], change_kind: RegistryAttribute['change_kind'] = 'REVISE'): RegistryAttribute =>
  ({ name, type, values, change_kind })

const decision = (object_id: string, label: string, ...attributes: RegistryAttribute[]): RegistryObject =>
  ({ object_id, kind: 'decision', label, attributes })

const commitment = (object_id: string, label: string): RegistryObject => ({
  object_id,
  kind: 'commitment',
  label,
  attributes: [attribute('owner', 'person'), attribute('deadline', 'date'), attribute('status', 'enum', ['done', 'cancelled'])],
})

/** Fictional "Digital Procurement Pilot" steering committee; identical to the engine's demo registry. */
export const SAMPLE_REGISTRY: LedgerRegistry = {
  objects: [
    decision('vendor', 'Vendor', attribute('outcome', 'enum', ['Alpha Systems', 'Beta Cloud', 'Gamma Soft'], 'REVERSE')),
    decision('budget', 'Pilot budget (RM)', attribute('amount', 'number')),
    decision('golive', 'Go-live date', attribute('date', 'date')),
    commitment('training', 'Staff training'),
    commitment('migration', 'Data migration'),
    commitment('security', 'Security review'),
  ],
  people: { aisha: 'Aisha', raj: 'Raj', wei_ling: 'Wei Ling' },
}
