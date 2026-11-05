import { describe, expect, it, vi } from 'vitest'
import { mobilePullToSyncProps } from './mobilePullToSync'

describe('mobile pull-to-sync', () => {
  it.each([true, false])('uses the existing sync callback with AutoGit=%s', async (autoGit) => {
    const syncVault = vi.fn()
    const sync = async () => {
      syncVault(autoGit)
    }
    const props = mobilePullToSyncProps({
      git: true,
      linked: false,
      busy: false,
      sync,
    })

    expect(props?.refreshing).toBe(false)
    props?.onRefresh()
    expect(syncVault).toHaveBeenCalledExactlyOnceWith(autoGit)
  })

  it('allows linked folders, ignores local-only vaults, and prevents duplicate syncs', () => {
    const sync = vi.fn(async () => {})
    expect(
      mobilePullToSyncProps({
        git: false,
        linked: true,
        busy: false,
        sync,
      }),
    ).not.toBeNull()
    expect(
      mobilePullToSyncProps({
        git: false,
        linked: false,
        busy: false,
        sync,
      }),
    ).toBeNull()

    const busyProps = mobilePullToSyncProps({
      git: true,
      linked: false,
      busy: true,
      sync,
    })
    expect(busyProps?.refreshing).toBe(false)
    busyProps?.onRefresh()
    expect(sync).not.toHaveBeenCalled()
  })

  it('shows the pull indicator only for a user-started refresh during background sync', () => {
    const sync = vi.fn(async () => {})
    const controls = {
      git: true,
      linked: false,
      busy: true,
      sync,
    }

    expect(mobilePullToSyncProps(controls)?.refreshing).toBe(false)
    expect(mobilePullToSyncProps(controls, true)?.refreshing).toBe(true)
  })
})
