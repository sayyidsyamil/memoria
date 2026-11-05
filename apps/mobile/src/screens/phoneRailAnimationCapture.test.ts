import { expect, it } from 'vitest'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'

type AnimationWorklet = (() => object) & {
  __closure: Record<string, unknown>
  __initData: { code: string }
}

const require = createRequire(import.meta.url)
const babel = createRequire(require.resolve('babel-preset-expo'))('@babel/core')

it('copies the compiled rail animation without transferring the native gesture instance', () => {
  class PanGesture {}
  let offset = -304
  const sharedOffset = { __isSharedValue: true, get: () => offset }
  const worklets: AnimationWorklet[] = []
  const modules: Record<string, object> = {
    '@babel/runtime/helpers/interopRequireWildcard': require('@babel/runtime/helpers/interopRequireWildcard'),
    'react-native': { View: 'View', StyleSheet: { create: (value: unknown) => value } },
    'react-native-reanimated': {
      __esModule: true, default: { View: 'AnimatedView' },
      useAnimatedStyle: (worklet: AnimationWorklet) => { worklets.push(worklet); return worklet() },
    },
    'react-native-gesture-handler': { GestureDetector: 'GestureDetector' },
    './phoneWorkspaceTransitions': { phoneWorkspaceSidebarDrawerWidth: () => 304 },
    './usePhoneViewportWidth': { usePhoneViewportWidth: () => 390 },
    'react-native-css-interop/jsx-runtime': { jsx: () => null },
  }
  const compiled = babel.transformFileSync(new URL('./PhoneWorkspaceTransition.tsx', import.meta.url).pathname, {
    configFile: new URL('../../babel.config.js', import.meta.url).pathname, babelrc: false,
  })
  const exports = runInNewContext(`${compiled.code}; exports`, {
    exports: {}, global: { Error }, require: (name: string) => {
      if (!modules[name]) throw new Error(`Unexpected animation dependency: ${name}`)
      return modules[name]
    },
  })
  exports.PhoneWorkspaceTransition({
    children: null, panelRail: { enabled: true, gesture: new PanGesture(), offset: sharedOffset },
  })
  expect(worklets).toHaveLength(1)
  const worklet = worklets[0]
  if (!worklet) throw new Error('Missing compiled animation')
  const closure = copyCapture(worklet.__closure)
  const invoke = runInNewContext(`(${worklet.__initData.code})`, { global: { Error } })
  expect(invoke.call({ __closure: closure })).toEqual({ transform: [{ translateX: -304 }] })
  offset = -694
  expect(invoke.call({ __closure: closure })).toEqual({ transform: [{ translateX: -694 }] })
})

// Shared values cross runtimes by reference; native gesture instances cannot be copied.
function copyCapture(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value
  if ('__isSharedValue' in value) return value
  if (Object.getPrototypeOf(value)?.constructor?.name !== 'Object') {
    throw new Error(`Cannot copy value of type ${value.constructor.name}`)
  }
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, copyCapture(entry)]))
}
