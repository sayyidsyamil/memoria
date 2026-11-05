type PullToSyncControls = {
  busy: boolean
  git: boolean
  linked?: boolean
  sync: () => Promise<void>
}

export function mobilePullToSyncProps(controls: PullToSyncControls | null, refreshing = false) {
  if (!controls) return null
  if (!supportsPullToSync(controls)) return null

  return {
    refreshing,
    onRefresh: refreshWhenIdle(controls),
  }
}

function supportsPullToSync(controls: PullToSyncControls) {
  if (controls.git) return true
  return Boolean(controls.linked)
}

function refreshWhenIdle(controls: PullToSyncControls) {
  return () => {
    if (controls.busy) return undefined
    return controls.sync()
  }
}
