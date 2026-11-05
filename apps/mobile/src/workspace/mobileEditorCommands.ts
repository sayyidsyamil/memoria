import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

export type MobileEditorCommands = {
  blur?: () => void
  findInNote?: () => void
  replaceInNote?: () => void
  pastePlainText?: () => void
  save?: () => void
  toggleRawEditor?: () => void
}

export type RegisterMobileEditorCommands = (commands: MobileEditorCommands) => () => void
type MobileEditorCommandCapabilities = {
  blur: boolean
  findInNote: boolean
  replaceInNote: boolean
  pastePlainText: boolean
  save: boolean
  toggleRawEditor: boolean
}

const emptyEditorCommands: MobileEditorCommands = {}
type MobileEditorCommandRegistration = {
  commands: MobileEditorCommands
}

export function useMobileEditorCommandRegistry() {
  const [registrations, setRegistrations] = useState<MobileEditorCommandRegistration[]>([])

  const register = useCallback<RegisterMobileEditorCommands>((commands) => {
    const registration = { commands }
    setRegistrations((current) => [...current, registration])

    return () => {
      setRegistrations((current) => current.filter((entry) => entry !== registration))
    }
  }, [])
  const commands = useMemo(
    () => mergeMobileEditorCommands(registrations.map((registration) => registration.commands)),
    [registrations],
  )

  return useMemo(() => ({
    commands,
    register,
  }), [commands, register])
}

export function useMobileEditorOverlayFocus(overlayOpen: boolean, { blur }: MobileEditorCommands) {
  useEffect(() => {
    if (overlayOpen) blur?.()
  }, [blur, overlayOpen])
}

export function useRegisteredMobileEditorCommands(
  register: RegisterMobileEditorCommands | undefined,
  commands: MobileEditorCommands,
) {
  const commandsRef = useRef(commands)
  useEffect(() => {
    commandsRef.current = commands
  }, [commands])

  const { blur, findInNote, replaceInNote, pastePlainText, save, toggleRawEditor } = mobileEditorCommandCapabilities(commands)
  useEffect(() => {
    if (!register) return undefined
    return register(createMobileEditorCommandForwarders(
      { blur, findInNote, replaceInNote, pastePlainText, save, toggleRawEditor }, () => commandsRef.current,
    ))
  }, [register, blur, findInNote, replaceInNote, pastePlainText, save, toggleRawEditor])
}

const mobileEditorCommandNames = ['blur', 'findInNote', 'replaceInNote', 'pastePlainText', 'save', 'toggleRawEditor'] as const

export function createMobileEditorCommandForwarders(
  capabilities: MobileEditorCommandCapabilities,
  readCommands: () => MobileEditorCommands,
): MobileEditorCommands {
  const registered: MobileEditorCommands = {}
  for (const name of mobileEditorCommandNames) {
    if (!capabilities[name]) continue
    registered[name] = () => {
      const command = readCommands()[name]
      command?.()
    }
  }
  return registered
}

export function mobileEditorCommandCapabilities(
  commands: MobileEditorCommands,
): MobileEditorCommandCapabilities {
  return {
    blur: commands.blur !== undefined,
    findInNote: commands.findInNote !== undefined,
    replaceInNote: commands.replaceInNote !== undefined,
    pastePlainText: commands.pastePlainText !== undefined,
    save: commands.save !== undefined,
    toggleRawEditor: commands.toggleRawEditor !== undefined,
  }
}

export function mergeMobileEditorCommands(
  registrations: readonly MobileEditorCommands[],
): MobileEditorCommands {
  if (registrations.length === 0) return emptyEditorCommands

  const merged: MobileEditorCommands = {}
  for (const commands of registrations) {
    for (const name of mobileEditorCommandNames) {
      if (commands[name]) merged[name] = commands[name]
    }
  }
  return merged
}
