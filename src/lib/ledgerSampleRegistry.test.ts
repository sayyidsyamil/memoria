import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { SAMPLE_REGISTRY } from './ledgerSampleRegistry'

const DEMO_REGISTRY = '/Users/sayyid/Desktop/FYP/engine/data/demo/registry.json'

describe('sample registry', () => {
  it('declares three decisions, three promises and three people', () => {
    expect(SAMPLE_REGISTRY.objects.map((o) => `${o.kind}:${o.object_id}`)).toEqual([
      'decision:vendor', 'decision:budget', 'decision:golive', 'commitment:training', 'commitment:migration', 'commitment:security',
    ])
    expect(Object.values(SAMPLE_REGISTRY.people)).toEqual(['Aisha', 'Raj', 'Wei Ling'])
  })

  it('gives every item at least one attribute and every choice some values', () => {
    for (const object of SAMPLE_REGISTRY.objects) {
      expect(object.attributes.length).toBeGreaterThan(0)
      for (const a of object.attributes) if (a.type === 'enum') expect(a.values.length).toBeGreaterThanOrEqual(2)
    }
  })

  it.skipIf(!existsSync(DEMO_REGISTRY))('is identical to the engine demo registry when it is present', () => {
    expect(JSON.parse(JSON.stringify(SAMPLE_REGISTRY))).toEqual(JSON.parse(readFileSync(DEMO_REGISTRY, 'utf8')))
  })
})
