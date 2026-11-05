import { describe, expect, it } from 'vitest'
import type { NativeLayoutMetric, NativeLayoutMetricMap } from './nativeLayoutMetricCore'
import { assertNativeSidebarLayoutMetrics } from './nativeLayoutMetrics'
import { assertFolderTreeLayout } from './nativeFolderLayoutMetrics'
import { projectNativeSidebarMetrics } from './nativeSidebarLayoutProjection'
import { assertSectionTitleLayouts } from './nativeSidebarSectionLayoutMetrics'

describe('native sidebar measurement accuracy', () => {
  it('resolves header label position through its measured toggle parent', () => {
    expect(headerFailures(headers())).toEqual([])
  })

  it('rejects a genuinely displaced header label', () => {
    const metrics = headers()
    metrics['sidebar.section.types.label'].y += 4
    expect(headerFailures(metrics)).toEqual([
      expect.objectContaining({ actual: 17, expected: 13, id: 'sidebar.section.types' }),
    ])
  })

  it('requires the toggle measurement for native header checks', () => {
    const metrics = headers()
    delete metrics['sidebar.section.types.toggle']
    expect(assertSectionTitleLayouts(metrics, true)).toContainEqual(expect.objectContaining({
      actual: null, id: 'sidebar.section.types.toggle',
    }))
  })

  it('projects sidebar spacing from fixed 120% without changing other panels', () => {
    const metrics = scaledHeaders()
    const phone = metric('phone.root', { width: 402, height: 760 })
    const original = structuredClone(metrics)
    const projected = projectNativeSidebarMetrics({ ...metrics, [phone.id]: phone }, 1.2)
    expect(headerFailures(projected)).toEqual([])
    expect(projected['sidebar.section.types.row'].height).toBe(40)
    expect(projected[phone.id]).toBe(phone)
    expect(metrics).toEqual(original)
  })

  it('uses fixed density before checking headers through the public sidebar API', () => {
    const failures = assertNativeSidebarLayoutMetrics(scaledHeaders(), 1.2)
    expect(failures.filter(isHeaderPlacementFailure)).toEqual([])
  })

  it('keeps canonical measurements unchanged when no projection is requested', () => {
    const metrics = headers()
    expect(projectNativeSidebarMetrics(metrics, 1)).toBe(metrics)
  })

  it('allows only the bounded native edge-rounding discrepancy in folder stacking', () => {
    expect(assertFolderTreeLayout(folders(29.75))).toEqual([])
    expect(assertFolderTreeLayout(folders(29.5))).toEqual([])
  })

  it('still rejects real folder overlap and retains the actual measured delta', () => {
    expect(assertFolderTreeLayout(folders(29.4))).toEqual([
      expect.objectContaining({ actual: expect.closeTo(-0.6, 5), expected: 0, id: 'sidebar.folder.memoria-releases' }),
    ])
  })

  it('allows folder gaps without treating a gap as overlap', () => {
    expect(assertFolderTreeLayout(folders(38))).toEqual([])
  })
})

function headerFailures(metrics: NativeLayoutMetricMap) {
  return assertSectionTitleLayouts(metrics, true).filter(isHeaderPlacementFailure)
}

function isHeaderPlacementFailure(failure: { message: string }) {
  return failure.message.includes('section title label')
}

function headers(): NativeLayoutMetricMap {
  return Object.fromEntries(['favorites', 'views', 'types', 'folders'].flatMap(section => {
    const id = `sidebar.section.${section}`
    return [
      metric(`${id}.row`, { x: 6, height: 40 }),
      metric(`${id}.toggle`, { x: 12, y: 8, height: 24 }),
      metric(`${id}.label`, { x: 15, y: 5, height: 14 }),
    ].map(value => [value.id, value])
  }))
}

function scaledHeaders(): NativeLayoutMetricMap {
  return Object.fromEntries(Object.entries(headers()).map(([id, value]) => [id, {
    ...value, x: value.x * 1.2, y: value.y * 1.2, width: value.width * 1.2, height: value.height * 1.2,
  }]))
}

function folders(releasesY: number): NativeLayoutMetricMap {
  return Object.fromEntries([
    metric('sidebar.folderTree.root', { x: 6, height: 190 }),
    metric('sidebar.folder.writing.container', { height: 90 }),
    metric('sidebar.folder.writing-essays.container', { height: 30 }),
    metric('sidebar.folder.writing-drafts.container', { height: 30, y: 30 }),
    metric('sidebar.folder.memoria.container', { height: 90, y: 90 }),
    metric('sidebar.folder.memoria-mobile-ui.container', { height: 30 }),
    metric('sidebar.folder.memoria-releases.container', { height: 30, y: releasesY }),
  ].map(value => [value.id, value]))
}

function metric(id: string, dimensions: Partial<NativeLayoutMetric>): NativeLayoutMetric {
  return { id, platform: 'ios', x: 0, y: 0, width: 240, height: 0, ...dimensions }
}
