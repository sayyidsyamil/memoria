import type { Model } from '@ironcalc/workbook'
import { MAX_SHEET_COLUMNS, MAX_SHEET_ROWS } from '../../utils/sheetWorkbook'

const guardedSheetModels = new WeakSet<Model>()

function isValidSheetCoordinate(row: number, column: number): boolean {
  return Number.isInteger(row)
    && row >= 1
    && row <= MAX_SHEET_ROWS
    && Number.isInteger(column)
    && column >= 1
    && column <= MAX_SHEET_COLUMNS
}

export function installSheetSelectionGuard(model: Model): void {
  if (guardedSheetModels.has(model)) return

  const setSelectedCell = model.setSelectedCell.bind(model)
  model.setSelectedCell = (row, column) => {
    if (isValidSheetCoordinate(row, column)) setSelectedCell(row, column)
  }
  guardedSheetModels.add(model)
}
