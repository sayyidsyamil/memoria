import { expect, it } from 'vitest'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

type Worklet = ((...args: unknown[]) => unknown) & {
  __closure: Record<string, unknown>
  __initData: { code: string }
}
type CapturedGesture = Record<string, Worklet>

const require = createRequire(import.meta.url)
const presetRequire = createRequire(require.resolve('babel-preset-expo'))
const babel = presetRequire('@babel/core')
const babelOptions = {
  configFile: new URL('../../babel.config.js', import.meta.url).pathname,
  babelrc: false,
}

it('detects a broken serialized capture even when the ordinary JS function works', () => {
  const exports = evaluate(compileFixture(`
    function helper() { 'worklet'; return 42 }
    export function invoke() { 'worklet'; return helper() }
  `), () => ({}))
  const invoke = exports.invoke as Worklet
  invoke.__closure.helper = undefined
  expect(invoke()).toBe(42)
  expect(() => reconstructWorklet(invoke)()).toThrow('helper is not a function')
})

it('runs actual serialized phone gesture helpers through recognition and settlement', () => {
  const callbacks: CapturedGesture = {}
  const trace: Array<{ phase: string }> = []
  const factory = loadPhoneGesture(callbacks)
  const options = {
    geometry: { value: { width: 390 } }, offset: { value: -304 }, epoch: { value: 0 },
    session: { value: {} as Record<string, unknown> },
    onSettle: (state: unknown, epoch: unknown) => settled.push([state, epoch]),
    onTrace: (event: { phase: string }) => trace.push(event),
  }
  const settled: unknown[][] = []
  factory(options)
  const manager = { activate() {}, fail() {} }
  const touch = (x: number) => ({ allTouches: [{ x, y: 100, absoluteX: x, absoluteY: 100 }] })
  reconstructWorklet(callbacks.onTouchesDown)(touch(100), manager)
  reconstructWorklet(callbacks.onTouchesMove)(touch(130), manager)
  reconstructWorklet(callbacks.onStart)({ translationX: 30 })
  reconstructWorklet(callbacks.onUpdate)({ translationX: 350 })
  reconstructWorklet(callbacks.onEnd)({ translationX: 350, velocityX: 0 })
  reconstructWorklet(callbacks.onFinalize)({}, true)
  expect(settled).toEqual([['sidebar', 1]])
  expect(options.offset.value).toBe(0)
  expect(trace.map(event => event.phase)).toEqual([
    'down', 'intent', 'start', 'end', 'settle', 'settled', 'finalize',
  ])
})

function evaluate(code: string, load: (name: string) => object) {
  const exports: Record<string, unknown> = {}
  runInNewContext(code, { exports, require: load, global: { Error } })
  return exports
}

function compileFixture(source: string) {
  const folder = mkdtempSync(join(tmpdir(), 'memoria-capture-order-'))
  const file = join(folder, 'capture-order.ts')
  try {
    writeFileSync(file, source)
    return babel.transformFileSync(file, babelOptions).code as string
  } finally {
    rmSync(folder, { recursive: true, force: true })
  }
}

function loadPhoneGesture(callbacks: CapturedGesture) {
  const pan = new Proxy({}, { get: (_, key) => (callback: unknown) => {
    if (typeof callback === 'function') callbacks[String(key)] = callback as Worklet
    return pan
  } })
  const modules: Record<string, object> = {
    'react-native-gesture-handler': { Gesture: { Pan: () => pan } },
    'react-native-reanimated': {
      cancelAnimation() {}, runOnJS: (callback: unknown) => callback,
      withTiming: (target: number, _config: object, complete: (finished: boolean) => void) => {
        complete(true)
        return target
      },
    },
  }
  const load = (name: string): object => {
    if (modules[name]) return modules[name]
    const file = new URL(`./${name.replace('./', '')}.ts`, import.meta.url).pathname
    const compiled = babel.transformFileSync(file, babelOptions)
    modules[name] = evaluate(compiled.code, load)
    return modules[name]
  }
  return (load('./phoneNativePanGesture') as { createPhonePanGesture: (options: object) => void }).createPhonePanGesture
}

function reconstructWorklet(worklet: Worklet): (...args: unknown[]) => unknown {
  const closure = Object.fromEntries(Object.entries(worklet.__closure).map(([name, value]) => [
    name, typeof value === 'function' && '__closure' in value ? reconstructWorklet(value as Worklet) : value,
  ]))
  const invoke = runInNewContext(`(${worklet.__initData.code})`, { global: { Error } }) as Worklet
  return invoke.bind({ __closure: closure })
}
