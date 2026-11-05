import { useEffect, useMemo, useState } from 'react'
import {
  buildMobileInspectorReferenceGroups,
  type MobileNeighborhoodGroup,
} from '../workspace/mobileNeighborhood'
import type { MobileNote, MobileWorkspaceSnapshot } from '../workspace/mobileWorkspaceModel'

type ReferenceGroupState = {
  groups: MobileNeighborhoodGroup[]
  noteId: string | null
}

const emptyReferenceGroupState: ReferenceGroupState = {
  groups: [],
  noteId: null,
}

export function useMobileInspectorReferenceGroups(
  note: MobileNote | null,
  snapshot: MobileWorkspaceSnapshot,
): MobileNeighborhoodGroup[] {
  const notes = snapshot.allNotes ?? snapshot.notes
  const { id, title = '', type = '', path, aliases, workspaceAlias } = note ?? {}
  const source = useMemo(() => id === undefined ? null : {
    id, title, type, path, aliases, workspaceAlias,
  }, [id, title, type, path, aliases, workspaceAlias])
  const [state, setState] = useState<ReferenceGroupState>(emptyReferenceGroupState)

  useEffect(() => {
    if (!source) {
      return undefined
    }

    let cancelled = false
    const noteId = source.id
    const timeoutId = setTimeout(() => {
      if (cancelled) return
      setState({
        groups: buildMobileInspectorReferenceGroups(source, notes),
        noteId,
      })
    }, 0)

    return () => {
      cancelled = true
      clearTimeout(timeoutId)
    }
  }, [source, notes])

  return state.noteId === note?.id ? state.groups : []
}
