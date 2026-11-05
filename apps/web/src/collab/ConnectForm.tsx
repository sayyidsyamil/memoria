import { type FormEvent, useState } from 'react'
import { Button } from '../../../../src/components/ui/button'
import { Input } from '../../../../src/components/ui/input'
import { type AppLocale, translate } from '../../../../src/lib/i18n'
import { type CollabSession, noteFromLocation, saveSession } from './session'

interface ConnectFormProps {
  locale: AppLocale
  onConnect(session: CollabSession): void
}

interface FieldProps {
  id: string
  label: string
  value: string
  type?: string
  invalid: boolean
  onChange(value: string): void
}

function Field({ id, label, value, type = 'text', invalid, onChange }: FieldProps) {
  return (
    <label className="collab-connect__field" htmlFor={id}>
      <span className="text-sm text-muted-foreground">{label}</span>
      <Input
        id={id}
        name={id}
        type={type}
        value={value}
        required
        autoComplete="off"
        aria-invalid={invalid}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  )
}

/** Asks for what the spike has no account system for: the server token, a name and a note. */
export function ConnectForm({ locale, onConnect }: ConnectFormProps) {
  const [token, setToken] = useState('')
  const [name, setName] = useState('')
  const [note, setNote] = useState(noteFromLocation)
  const [refused, setRefused] = useState(false)

  /** Nothing is sent anywhere unless the whole input passes the checks in `sessionInput`. */
  function submit(event: FormEvent): void {
    event.preventDefault()
    const session = saveSession({ token, name, note })
    setRefused(session === null)
    if (session) onConnect(session)
  }

  return (
    <form className="collab-connect" onSubmit={submit} data-refused={refused}>
      <h1 className="text-lg font-semibold">{translate(locale, 'collab.connect.title')}</h1>
      <Field id="collab-token" type="password" label={translate(locale, 'collab.connect.token')} value={token} invalid={refused} onChange={setToken} />
      <Field id="collab-name" label={translate(locale, 'collab.connect.name')} value={name} invalid={refused} onChange={setName} />
      <Field id="collab-note" label={translate(locale, 'collab.connect.note')} value={note} invalid={refused} onChange={setNote} />
      <Button type="submit">{translate(locale, 'collab.connect.submit')}</Button>
    </form>
  )
}
