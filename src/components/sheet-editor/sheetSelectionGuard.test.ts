import type { Model } from '@ironcalc/workbook'
import { describe, expect, it, vi } from 'vitest'
import { installSheetSelectionGuard } from './sheetSelectionGuard'

function modelWithSelectionSpy() {
  const setSelectedCell = vi.fn()
  const model = { setSelectedCell } as unknown as Model
  return { model, setSelectedCell }
}

describe('sheet selection guard', () => {
  it.each([
    [0, 1],
    [1, 0],
    [1_048_577, 1],
    [1, 16_385],
    [Number.NaN, 1],
  ])('ignores invalid cell coordinates (%s, %s)', (row, column) => {
    const { model, setSelectedCell } = modelWithSelectionSpy()
    installSheetSelectionGuard(model)

    model.setSelectedCell(row, column)

    expect(setSelectedCell).not.toHaveBeenCalled()
  })

  it('forwards valid cell coordinates exactly once after repeated installation', () => {
    const { model, setSelectedCell } = modelWithSelectionSpy()
    installSheetSelectionGuard(model)
    installSheetSelectionGuard(model)

    model.setSelectedCell(4, 7)

    expect(setSelectedCell).toHaveBeenCalledOnce()
    expect(setSelectedCell).toHaveBeenCalledWith(4, 7)
  })
})
