import { expect, it } from 'vitest'
import { relationshipKeyForKind } from './relationshipKeys'

it.each(['__proto__', 'constructor', 'toString', 'unknown'])(
  'rejects an unrecognized runtime relationship kind %s', (kind) => {
    expect(Reflect.apply(relationshipKeyForKind, undefined, [kind])).toBeNull()
  },
)
