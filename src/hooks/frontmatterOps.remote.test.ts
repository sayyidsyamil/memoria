import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runFrontmatterAndApply, type FrontmatterApplyCallbacks } from './frontmatterOps'

const { editRemoteFrontmatter } = vi.hoisted(() => ({ editRemoteFrontmatter: vi.fn() }))

vi.mock('../lib/remoteFrontmatter', () => ({ editRemoteFrontmatter }))

const PATH = 'notes/remote.md'
const EDITED = '---\nStatus: Active\n---\n# Remote\n'

function callbacks(): FrontmatterApplyCallbacks {
  return { updateTab: vi.fn(), updateEntry: vi.fn(), toast: vi.fn() }
}

describe('runFrontmatterAndApply with a Memoria remote', () => {
  beforeEach(() => {
    window.MEMORIA_REMOTE_URL = 'http://127.0.0.1:9'
    window.MEMORIA_REMOTE_TOKEN = 'test-token'
    editRemoteFrontmatter.mockResolvedValue(EDITED)
  })

  afterEach(() => {
    Reflect.deleteProperty(window, 'MEMORIA_REMOTE_URL')
    Reflect.deleteProperty(window, 'MEMORIA_REMOTE_TOKEN')
    editRemoteFrontmatter.mockReset()
  })

  it('sends an update to the remote writer and applies the content it returns', async () => {
    const apply = callbacks()
    const content = await runFrontmatterAndApply({ op: 'update', path: PATH, key: 'Status', value: 'Active', callbacks: apply })

    expect(content).toBe(EDITED)
    expect(editRemoteFrontmatter).toHaveBeenCalledWith(expect.anything(), { path: PATH, key: 'Status', value: 'Active' })
    expect(apply.updateTab).toHaveBeenCalledWith(PATH, EDITED)
    expect(apply.updateEntry).toHaveBeenCalledWith(PATH, { status: 'Active' })
    expect(apply.toast).toHaveBeenCalledWith('Property updated')
  })

  it('sends a delete as a key without a value', async () => {
    await runFrontmatterAndApply({ op: 'delete', path: PATH, key: 'Status', callbacks: callbacks() })
    expect(editRemoteFrontmatter).toHaveBeenCalledWith(expect.anything(), { path: PATH, key: 'Status', value: undefined })
  })

  it('reports a failed remote edit', async () => {
    editRemoteFrontmatter.mockRejectedValue(new Error('changed on the server'))
    const apply = callbacks()
    vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(runFrontmatterAndApply({ op: 'update', path: PATH, key: 'Status', value: 'X', callbacks: apply }))
      .resolves.toBeUndefined()
    expect(apply.toast).toHaveBeenCalledWith('Failed to update property')
  })

  it('refuses an update without a value instead of deleting the property', async () => {
    const apply = callbacks()
    vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(runFrontmatterAndApply({ op: 'update', path: PATH, key: 'Status', callbacks: apply }))
      .resolves.toBeUndefined()
    expect(editRemoteFrontmatter).not.toHaveBeenCalled()
    expect(apply.toast).toHaveBeenCalledWith('Failed to update property')
  })
})
