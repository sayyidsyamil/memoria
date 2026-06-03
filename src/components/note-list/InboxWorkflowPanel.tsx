import { useState } from 'react'
import { ArrowRight, FileArrowUp, LinkSimple, MagicWand, Microphone, NotePencil } from '@phosphor-icons/react'
import { Button } from '@/components/ui/button'
import { FileUpload } from '@/components/ui/file-upload'
import { Input } from '@/components/ui/input'
import { MultiStepLoader, type LoadingState } from '@/components/ui/multi-step-loader'
import { StatefulButton } from '@/components/ui/stateful-button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { queueAiPrompt, requestOpenAiChat } from '../../utils/aiPromptBridge'
import { COMPILE_INBOX_PROMPT, requestImportSource, requestStartMeeting } from '../../utils/memoriaWorkflow'

interface InboxWorkflowPanelProps {
  itemCount: number
  onCreateNote: () => void
}

type CompileState = 'idle' | 'queued'

const COMPILE_STATES: LoadingState[] = [
  { text: 'Reading Inbox' },
  { text: 'Extracting knowledge' },
  { text: 'Updating Wiki' },
  { text: 'Moving originals to Sources' },
]

function compileLabel(itemCount: number) {
  if (itemCount <= 0) return 'Compile Inbox'
  return `Compile ${itemCount} item${itemCount === 1 ? '' : 's'}`
}

function readyLabel(itemCount: number) {
  if (itemCount <= 0) return 'No inbox items'
  return `${itemCount} item${itemCount === 1 ? '' : 's'} ready`
}

export function InboxWorkflowPanel({ itemCount, onCreateNote }: InboxWorkflowPanelProps) {
  const [sourceInput, setSourceInput] = useState('')
  const [compileState, setCompileState] = useState<CompileState>('idle')
  const trimmedInput = sourceInput.trim()

  const handleImportInput = () => {
    if (!trimmedInput) return
    requestImportSource({ input: trimmedInput })
    setSourceInput('')
  }

  const handleDroppedFiles = (files: File[]) => {
    const path = files
      .map((file) => (file as File & { path?: string }).path)
      .find((candidate): candidate is string => typeof candidate === 'string' && candidate.length > 0)

    if (path) {
      requestImportSource({ input: path })
      return
    }

    requestImportSource({ mode: 'file' })
  }

  const handleCompile = async () => {
    queueAiPrompt(COMPILE_INBOX_PROMPT, [])
    requestOpenAiChat()
    setCompileState('queued')
    await new Promise((resolve) => window.setTimeout(resolve, 2600))
    setCompileState('idle')
  }

  return (
    <div className="shrink-0 border-b border-border bg-card px-3 py-3" data-testid="inbox-workflow-panel">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[12px] font-semibold text-foreground">Capture</div>
          <div className="truncate text-[11px] text-muted-foreground">{readyLabel(itemCount)}</div>
        </div>
        <Button type="button" variant="ghost" size="icon-xs" className="!h-7 !w-7 !min-w-0 !rounded-md !p-0" onClick={onCreateNote} title="New minute" aria-label="New minute">
          <NotePencil size={15} />
        </Button>
      </div>

      <Tabs defaultValue="paste" className="gap-2">
        <TabsList className="grid h-8 w-full grid-cols-3 rounded-md p-0.5">
          <TabsTrigger value="paste" className="gap-1 rounded text-[11px]">
            <LinkSimple size={13} /> Paste
          </TabsTrigger>
          <TabsTrigger value="upload" className="gap-1 rounded text-[11px]">
            <FileArrowUp size={13} /> Upload
          </TabsTrigger>
          <TabsTrigger value="record" className="gap-1 rounded text-[11px]">
            <Microphone size={13} /> Record
          </TabsTrigger>
        </TabsList>
        <TabsContent value="paste" className="mt-0">
          <div className="flex items-center gap-1.5">
            <Input
              value={sourceInput}
              onChange={(event) => setSourceInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') handleImportInput()
              }}
              placeholder="Paste source link..."
              className="h-8 min-w-0 text-[12px]"
            />
            <Button
              type="button"
              variant="secondary"
              size="icon-xs"
              className="!h-8 !w-8 !min-w-0 !rounded-md"
              onClick={handleImportInput}
              disabled={!trimmedInput}
              title="Import source"
              aria-label="Import source"
            >
              <ArrowRight size={14} />
            </Button>
          </div>
        </TabsContent>
        <TabsContent value="upload" className="mt-0">
          <FileUpload
            compact
            title="Choose PDF, deck, doc"
            description="Click to open file picker"
            onChooseFile={() => requestImportSource({ mode: 'file' })}
            onChange={handleDroppedFiles}
          />
        </TabsContent>
        <TabsContent value="record" className="mt-0">
          <Button type="button" variant="secondary" size="sm" className="h-10 w-full justify-center gap-2 rounded-md text-[12px]" onClick={() => requestStartMeeting({ autoStart: true })}>
            <Microphone size={15} /> Record meeting
          </Button>
        </TabsContent>
      </Tabs>

      <MultiStepLoader
        loading={compileState === 'queued'}
        loadingStates={COMPILE_STATES}
        duration={650}
        variant="inline"
        className="mt-3 rounded-md border border-border bg-background px-3 py-2"
      />

      <StatefulButton type="button" className="mt-3 h-8 w-full rounded-md text-[12px] font-semibold" onClick={handleCompile}>
        <MagicWand size={14} />
        {compileLabel(itemCount)}
      </StatefulButton>
    </div>
  )
}
