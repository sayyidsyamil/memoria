import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getIronCalcMock, resetSheetEditorTestState } from './SheetEditor.testUtils'
import { SheetEditor } from './SheetEditor'

const ironCalcMock = getIronCalcMock()

describe('SheetEditor selection guard', () => {
  afterEach(() => {
    resetSheetEditorTestState()
  })

  it('keeps the active cell when IronCalc requests a zero column', async () => {
    render(
      <SheetEditor
        content={'---\n_display: sheet\n---\nMetric,January'}
        path="/vault/budget.md"
        onContentChange={vi.fn()}
      />,
    )
    await screen.findByTestId('ironcalc-workbook')
    const initialSelection = { ...ironCalcMock.state.selectedView }

    expect(() => ironCalcMock.state.lastModel?.setSelectedCell(1, 0)).not.toThrow()

    expect(ironCalcMock.state.selectedView).toEqual(initialSelection)
  })
})
