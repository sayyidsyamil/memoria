export type SimulatorRect = {
  height: number
  width: number
  x: number
  y: number
}

type SimulatorPoint = {
  x: number
  y: number
}

export function simulatorWindowTargetPoint({
  logicalScreen,
  simulatorSurface,
  target,
}: {
  logicalScreen: SimulatorRect
  simulatorSurface: SimulatorRect
  target: SimulatorRect
}): SimulatorPoint {
  assertPositiveRect(logicalScreen, 'logical Simulator screen')
  assertPositiveRect(simulatorSurface, 'Simulator display surface')
  assertTargetInsideScreen(logicalScreen, target)

  const targetCenterX = target.x + target.width / 2 - logicalScreen.x
  const targetCenterY = target.y + target.height / 2 - logicalScreen.y

  return {
    x: simulatorSurface.x + targetCenterX * simulatorSurface.width / logicalScreen.width,
    y: simulatorSurface.y + targetCenterY * simulatorSurface.height / logicalScreen.height,
  }
}

function assertPositiveRect(rect: SimulatorRect, label: string) {
  const values = [rect.height, rect.width, rect.x, rect.y]
  if (!values.every(Number.isFinite)) throwInvalidGeometry(label)
  if (rect.height <= 0) throwInvalidGeometry(label)
  if (rect.width <= 0) throwInvalidGeometry(label)
}

function assertTargetInsideScreen(screen: SimulatorRect, target: SimulatorRect) {
  assertPositiveRect(target, 'Simulator target')
  const targetRight = target.x + target.width
  const targetBottom = target.y + target.height
  const screenRight = screen.x + screen.width
  const screenBottom = screen.y + screen.height
  if (target.x < screen.x) throwOutsideScreen()
  if (target.y < screen.y) throwOutsideScreen()
  if (targetRight > screenRight) throwOutsideScreen()
  if (targetBottom > screenBottom) throwOutsideScreen()
}

function throwInvalidGeometry(label: string): never {
  throw new Error(`${label} has invalid geometry`)
}

function throwOutsideScreen(): never {
  throw new Error('Simulator target is outside the logical Simulator screen')
}
