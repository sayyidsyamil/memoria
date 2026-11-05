import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  createStaticReachability,
  iconModuleName,
  iconModuleNameOf,
  LAZY_ICON_CHUNK,
  phosphorIconImports,
  phosphorStaticIconChunk,
  STATIC_ICON_CHUNK,
  type ModuleStatementNode,
} from './phosphorIconChunk.ts'

const ICON_DIR = '/repo/node_modules/@phosphor-icons/react/dist/csr'

function importOf(source: string, ...names: string[]): ModuleStatementNode {
  return {
    type: 'ImportDeclaration',
    source: { value: source },
    specifiers: names.map((name) => ({ type: 'ImportSpecifier', imported: { name } })),
  }
}

type ModuleGraph = Record<string, { importers: string[]; isEntry?: boolean }>

function moduleInfo(graph: ModuleGraph) {
  return (id: string) => {
    const node = graph[id]
    return node ? { importers: node.importers, isEntry: node.isEntry ?? false } : null
  }
}

describe('phosphor icon imports', () => {
  it('maps both export spellings to the icon module', () => {
    assert.equal(iconModuleName('FolderIcon'), 'Folder')
    assert.equal(iconModuleName('Folder'), 'Folder')
    assert.equal(iconModuleName('Icon'), 'Icon')
  })

  it('reads named imports and re-exports from the package only', () => {
    const body: ModuleStatementNode[] = [
      importOf('@phosphor-icons/react', 'Archive', 'ArrowUpIcon'),
      { type: 'ExportNamedDeclaration', source: { value: '@phosphor-icons/react' }, specifiers: [{ type: 'ExportSpecifier', imported: { value: 'Gear' } }] },
      { type: 'ImportDeclaration', source: { value: '@phosphor-icons/react' }, specifiers: [{ type: 'ImportNamespaceSpecifier' }] },
      importOf('react', 'useState'),
      { type: 'VariableDeclaration' },
    ]
    assert.deepEqual(phosphorIconImports(body), ['Archive', 'ArrowUp', 'Gear'])
  })

  it('recognises icon modules by path', () => {
    assert.equal(iconModuleNameOf(`${ICON_DIR}/Archive.es.js`), 'Archive')
    assert.equal(iconModuleNameOf('/repo/src/App.tsx'), null)
  })
})

describe('static reachability', () => {
  it('follows static importers up to an entry, through cycles', () => {
    const isStatic = createStaticReachability(moduleInfo({
      entry: { importers: [], isEntry: true },
      shell: { importers: ['entry', 'cycle'] },
      cycle: { importers: ['shell'] },
      lazy: { importers: [] },
    }))
    assert.equal(isStatic('cycle'), true)
    assert.equal(isStatic('shell'), true)
    assert.equal(isStatic('lazy'), false)
    assert.equal(isStatic('missing'), false)
  })
})

describe('phosphorStaticIconChunk', () => {
  it('groups named icons by whether the first page imports them, and leaves the rest alone', () => {
    const { plugin, manualChunks } = phosphorStaticIconChunk()
    const parsed = plugin.moduleParsed as (info: { id: string; ast: { body: ModuleStatementNode[] } | null }) => void
    ;(plugin.buildStart as () => void)()
    parsed({ id: '/repo/src/main.tsx', ast: { body: [importOf('@phosphor-icons/react', 'Archive')] } })
    parsed({ id: '/repo/src/App.tsx', ast: { body: [importOf('@phosphor-icons/react', 'Gear')] } })
    parsed({ id: `${ICON_DIR}/index.es.js`, ast: { body: [importOf('@phosphor-icons/react', 'Smiley')] } })
    parsed({ id: '/repo/src/empty.ts', ast: null })

    const getModuleInfo = moduleInfo({
      '/repo/src/main.tsx': { importers: [], isEntry: true },
      '/repo/src/App.tsx': { importers: [] },
    })
    assert.equal(manualChunks(`${ICON_DIR}/Archive.es.js`, { getModuleInfo }), STATIC_ICON_CHUNK)
    assert.equal(manualChunks(`${ICON_DIR}/Gear.es.js`, { getModuleInfo }), LAZY_ICON_CHUNK)
    assert.equal(manualChunks(`${ICON_DIR}/Smiley.es.js`, { getModuleInfo }), undefined)
    assert.equal(manualChunks('/repo/src/App.tsx', { getModuleInfo }), undefined)
  })
})
