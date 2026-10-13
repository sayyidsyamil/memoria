import { useId, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { isTauri, mockInvoke } from '../mock-tauri'
import { SettingsGroupItem } from './SettingsControls'
import { Button } from './ui/button'
import { Checkbox } from './ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog'

interface VoiceProfilesSettingsProps {
  rememberVoices: boolean
  setRememberVoices: (value: boolean) => void
}

const call = <T,>(command: string): Promise<T> =>
  isTauri() ? invoke<T>(command) : mockInvoke<T>(command)

export function VoiceProfilesSettings({ rememberVoices, setRememberVoices }: VoiceProfilesSettingsProps) {
  const checkboxId = useId()
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const deleteAll = async () => {
    setBusy(true)
    try {
      const removed = await call<number>('delete_voice_profiles')
      setMessage(removed > 0 ? 'All saved voice profiles were deleted.' : 'There were no saved voice profiles to delete.')
      setConfirming(false)
    } catch (e) {
      setMessage(typeof e === 'string' ? e : (e as Error).message)
      setConfirming(false)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <SettingsGroupItem testId="settings-remember-voices">
        <label htmlFor={checkboxId} className="flex cursor-pointer items-start gap-3">
          <Checkbox
            id={checkboxId}
            checked={rememberVoices}
            onCheckedChange={(value) => setRememberVoices(value === true)}
            className="mt-0.5"
          />
          <span className="space-y-1">
            <span className="block text-sm font-medium text-foreground">Remember voices to recognise people in future meetings</span>
            <span className="block text-xs leading-5 text-muted-foreground">
              Off by default. A voice profile is a numeric fingerprint of someone&apos;s voice. It is saved only on this
              computer, never uploaded, and you can delete it below at any time.
            </span>
          </span>
        </label>
      </SettingsGroupItem>
      <SettingsGroupItem testId="settings-delete-voices">
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs leading-5 text-muted-foreground" role="status">
            {message ?? 'Remove every voice profile stored on this computer.'}
          </span>
          <Button type="button" variant="outline" size="sm" onClick={() => setConfirming(true)}>
            Delete all saved voice profiles
          </Button>
        </div>
      </SettingsGroupItem>
      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete all saved voice profiles?</DialogTitle>
            <DialogDescription>
              People will no longer be recognised automatically by their voice. Your transcripts and notes are not touched.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setConfirming(false)}>Cancel</Button>
            <Button type="button" variant="destructive" disabled={busy} onClick={() => void deleteAll()}>
              {busy ? 'Deleting…' : 'Delete profiles'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
