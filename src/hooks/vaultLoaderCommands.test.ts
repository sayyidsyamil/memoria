import { describe, expect, it, vi, beforeEach } from 'vitest'
import { loadVaultFolders, loadVaultViews } from './vaultLoaderCommands'
import { createVaultBackend } from '../lib/vaultBackend'

vi.mock('../lib/vaultBackend', () => ({
  createVaultBackend: vi.fn(),
}))

describe('vaultLoaderCommands chrome operations', () => {
  const mockListFolders = vi.fn()
  const mockListViews = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(createVaultBackend).mockReturnValue({
      chrome: {
        listFolders: mockListFolders,
        listViews: mockListViews,
      },
    } as never)
  })

  describe('loadVaultFolders', () => {
    it('loads folders using backend chrome operations', async () => {
      const folders = [
        { name: 'Inbox', path: 'Inbox', children: [] },
        { name: 'Archive', path: 'Archive', children: [] },
      ]
      mockListFolders.mockResolvedValue(folders)

      const result = await loadVaultFolders({ vaultPath: '/vault' })

      expect(createVaultBackend).toHaveBeenCalledWith('/vault')
      expect(mockListFolders).toHaveBeenCalled()
      expect(result).toBe(folders)
    })

    it('handles empty folder list', async () => {
      mockListFolders.mockResolvedValue([])

      const result = await loadVaultFolders({ vaultPath: '/vault' })

      expect(result).toEqual([])
    })

    it('propagates errors from backend', async () => {
      mockListFolders.mockRejectedValue(new Error('Failed to load folders'))

      await expect(loadVaultFolders({ vaultPath: '/vault' })).rejects.toThrow('Failed to load folders')
    })
  })

  describe('loadVaultViews', () => {
    it('loads views using backend chrome operations', async () => {
      const rawViews = [
        { filename: 'active.yml', definition: { name: 'Active', filters: { all: [] }, color: null, icon: null, sort: null } },
        { filename: 'inbox.yml', definition: { name: 'Inbox', filters: { all: [] }, color: null, icon: null, sort: null } },
      ]
      mockListViews.mockResolvedValue(rawViews)

      const result = await loadVaultViews({ vaultPath: '/vault' })

      expect(createVaultBackend).toHaveBeenCalledWith('/vault')
      expect(mockListViews).toHaveBeenCalled()
      expect(result.length).toBe(2)
      expect(result[0].filename).toBe('active.yml')
      expect(result[1].filename).toBe('inbox.yml')
    })

    it('handles empty views list', async () => {
      mockListViews.mockResolvedValue([])

      const result = await loadVaultViews({ vaultPath: '/vault' })

      expect(result).toEqual([])
    })

    it('propagates errors from backend', async () => {
      mockListViews.mockRejectedValue(new Error('Failed to load views'))

      await expect(loadVaultViews({ vaultPath: '/vault' })).rejects.toThrow('Failed to load views')
    })
  })
})
