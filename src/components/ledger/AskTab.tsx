import { useState } from 'react'
import type { AskResult, LedgerEvidence, QueryType } from '../../lib/ledgerApi'
import { attributeLabel, findAttribute, formatDate, formatValue } from '../../lib/ledgerFormat'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { useLedger } from './ledgerContext'
import { Busy, ErrorNotice, QuoteBlock } from './ui'

const EXAMPLES = [
  'What is the current go-live date?',
  'What was the budget on 20 September?',
  'How many times did the go-live date change?',
]

const TYPE_LABEL: Record<QueryType, string> = {
  current: 'Current value',
  as_of_valid: 'Value on a past date',
  as_of_tx: 'What was known on a past date',
  n_changes: 'Number of changes',
}

interface Answer {
  text: string
  type: QueryType
  evidence: LedgerEvidence[]
}

function useAskAnswer() {
  const { api, data } = useLedger()
  return async (result: AskResult): Promise<Answer | null> => {
    if (!result.ok || result.answer === null || result.answer === undefined) return null
    const { object_id: objectId, attribute, valid_at: validAt } = result.route
    const spec = objectId && attribute ? findAttribute(data.registry, objectId, attribute) : undefined
    let evidence = result.evidence
    if (result.type === 'n_changes' && objectId && attribute) {
      const history = await api.factHistory(objectId, attribute)
      evidence = history.filter((h) => !h.retracted).flatMap((h) => h.evidence)
    }
    if (evidence.length === 0) return null
    const attributeCount = objectId ? data.registry.objects.find((o) => o.object_id === objectId)?.attributes.length ?? 1 : 1
    const subject = attributeCount > 1 ? `${result.label} ${attributeLabel(attribute ?? '').toLowerCase()}` : result.label
    const value = formatValue(result.answer, spec, data.registry.people)
    const text = result.type === 'n_changes'
      ? `The ${subject} changed ${value} ${value === '1' ? 'time' : 'times'}.`
      : result.type === 'current'
        ? `The ${subject} is ${value}.`
        : `On ${formatDate(validAt) || 'that date'}, the ${subject} was ${value}.`
    return { text, type: result.type, evidence }
  }
}

export function AskTab() {
  const { api, meetingLabel } = useLedger()
  const toAnswer = useAskAnswer()
  const [question, setQuestion] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [asked, setAsked] = useState<string | null>(null)
  const [answer, setAnswer] = useState<Answer | null>(null)

  const submit = async (text: string) => {
    const q = text.trim()
    if (!q || busy) return
    setBusy(true)
    setError(null)
    setAsked(null)
    setAnswer(null)
    try {
      const result = await api.ask(q)
      setAnswer(await toAnswer(result))
      setAsked(q)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid max-w-3xl gap-4">
      <p className="m-0 text-sm text-muted-foreground">Ask about a decision or promise in plain words. Every answer comes with the quote it is based on.</p>
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); void submit(question) }}>
        <Input aria-label="Your question" value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="For example: What is the current go-live date?" />
        <Button type="submit" disabled={busy || !question.trim()}>Ask</Button>
      </form>
      <div className="flex flex-wrap gap-2" aria-label="Example questions">
        {EXAMPLES.map((example) => (
          <Button key={example} size="sm" variant="outline" disabled={busy} onClick={() => { setQuestion(example); void submit(example) }}>{example}</Button>
        ))}
      </div>
      {busy ? <Busy label="Looking through your meetings… the first question can take a minute." /> : null}
      {error ? <ErrorNotice message={error} /> : null}
      {asked && !answer ? (
        <div role="status" className="rounded-md border border-border bg-muted/40 p-4 text-sm text-foreground">
          I could not find this in your meetings.
          <div className="mt-1 text-xs text-muted-foreground">Memoria only answers when it can show you the words someone said. Try naming the item, for example &ldquo;go-live date&rdquo;, or add the relevant meeting first.</div>
        </div>
      ) : null}
      {answer ? (
        <section aria-label="Answer" className="grid gap-3 rounded-md border border-border p-4">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{TYPE_LABEL[answer.type]}</div>
          <div className="text-base font-semibold text-foreground">{answer.text}</div>
          <div className="text-xs font-medium text-muted-foreground">Evidence</div>
          {answer.evidence.map((e, i) => <QuoteBlock key={i} evidence={e} meetingLabel={meetingLabel(e.meeting)} />)}
        </section>
      ) : null}
    </div>
  )
}
