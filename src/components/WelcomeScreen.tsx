import { CircleNotch as Loader2, FolderOpen, Plus } from '@phosphor-icons/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { OnboardingShell } from './OnboardingShell'
import { Button } from '@/components/ui/button'
import memoriaIcon from '@/assets/memoria-icon.svg'
import { translate, type AppLocale } from '@/lib/i18n'

// Memoria starts from a workspace folder on this Mac: open one or create one. Nothing is downloaded at first run; the
// inherited Getting Started template stays available from the workspace menu.
interface WelcomeScreenProps {
  mode: 'welcome' | 'vault-missing'
  missingPath?: string
  locale?: AppLocale
  defaultVaultPath: string
  onCreateEmptyVault: () => void
  onOpenFolder: () => void
  creatingAction: 'template' | 'empty' | null
  error: string | null
}

interface WelcomeScreenPresentation {
  heroBackground: string
  heroIcon: ReactNode
  subtitle: string
  title: string
}

type WelcomeActionButtonRef = React.RefObject<HTMLButtonElement | null>

interface WelcomeAction {
  disabled: boolean
  run: () => void
}

function isWelcomeActivationKey(event: globalThis.KeyboardEvent): boolean {
  return event.key === 'Enter' || event.key === ' '
}

function isWelcomeNavigationKey(event: globalThis.KeyboardEvent): boolean {
  return event.key === 'Tab' || event.key === 'ArrowDown' || event.key === 'ArrowUp'
}

function nextWelcomeActionIndex(currentIndex: number, event: globalThis.KeyboardEvent, actionCount: number): number {
  const direction = event.key === 'ArrowUp' || (event.key === 'Tab' && event.shiftKey) ? -1 : 1
  return (currentIndex + direction + actionCount) % actionCount
}

function focusBelongsToWelcomeActions(
  activeElement: Element | null,
  actionButtonRefs: WelcomeActionButtonRef[],
): boolean {
  return activeElement === document.body || actionButtonRefs.some(({ current }) => current === activeElement)
}

function getFocusedWelcomeActionIndex(
  activeElement: Element | null,
  actionButtonRefs: WelcomeActionButtonRef[],
): number {
  return Math.max(
    0,
    actionButtonRefs.findIndex(({ current }) => current === activeElement),
  )
}

function focusWelcomeAction(actionButtonRefs: WelcomeActionButtonRef[], actionIndex: number): void {
  actionButtonRefs.at(actionIndex)?.current?.focus()
}

function triggerWelcomeAction(actionIndex: number, actions: WelcomeAction[]): void {
  const action = actions.at(actionIndex)
  if (action && !action.disabled) action.run()
}

const CARD_STYLE: React.CSSProperties = {
  width: 'min(520px, 100%)',
  background: 'var(--background)',
  borderRadius: 12,
  border: '1px solid var(--border)',
  padding: 48,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 24,
}

const ICON_WRAP_STYLE: React.CSSProperties = {
  width: 64,
  height: 64,
  borderRadius: 16,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
}

const BRAND_ICON_STYLE: React.CSSProperties = {
  width: 64,
  height: 64,
  display: 'block',
}

const TITLE_STYLE: React.CSSProperties = {
  fontSize: 28,
  fontWeight: 700,
  letterSpacing: 0,
  color: 'var(--foreground)',
  textAlign: 'center',
  margin: 0,
}

const SUBTITLE_STYLE: React.CSSProperties = {
  fontSize: 14,
  lineHeight: 1.6,
  color: 'var(--muted-foreground)',
  textAlign: 'center',
  margin: 0,
}

const DIVIDER_STYLE: React.CSSProperties = {
  width: '100%',
  height: 1,
  background: 'var(--border)',
}

const OPTION_BTN_STYLE: React.CSSProperties = {
  width: '100%',
  borderRadius: 8,
  border: '1px solid var(--border)',
  background: 'var(--background)',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  gap: 14,
  padding: '14px 16px',
  textAlign: 'left',
  transition: 'background 0.15s',
}

const OPTION_ICON_STYLE: React.CSSProperties = {
  width: 36,
  height: 36,
  borderRadius: 8,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  flexShrink: 0,
}

const OPTION_TEXT_STYLE: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
}

const OPTION_LABEL_STYLE: React.CSSProperties = {
  fontSize: 14,
  fontWeight: 600,
  color: 'var(--foreground)',
  margin: 0,
  overflowWrap: 'anywhere',
  whiteSpace: 'normal',
}

const OPTION_DESC_STYLE: React.CSSProperties = {
  fontSize: 12,
  color: 'var(--muted-foreground)',
  margin: 0,
  marginTop: 2,
  overflowWrap: 'anywhere',
  whiteSpace: 'normal',
}

const ERROR_STYLE: React.CSSProperties = {
  fontSize: 13,
  color: 'var(--destructive)',
  textAlign: 'center',
  margin: 0,
}

const ERROR_BLOCK_STYLE: React.CSSProperties = {
  width: '100%',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 10,
}

interface OptionButtonProps {
  icon: React.ReactNode
  iconBg: string
  label: string
  description: string
  loadingLabel?: string
  loadingDescription?: string
  onClick: () => void
  disabled: boolean
  loading?: boolean
  testId: string
  autoFocus?: boolean
  buttonRef?: React.RefObject<HTMLButtonElement | null>
}

function OptionButton(options: OptionButtonProps) {
  const {
    icon,
    iconBg,
    label,
    description,
    loadingLabel,
    loadingDescription,
    onClick,
    disabled,
    loading,
    testId,
    autoFocus = false,
    buttonRef,
  } = options
  const [hover, setHover] = useState(false)

  return (
    <Button
      type="button"
      variant="outline"
      size="lg"
      style={{
        ...OPTION_BTN_STYLE,
        background: hover ? 'var(--sidebar)' : 'var(--background)',
        opacity: disabled ? 0.7 : 1,
      }}
      onClick={onClick}
      disabled={disabled}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      data-testid={testId}
      autoFocus={autoFocus}
      className="h-auto justify-start shadow-none"
      ref={buttonRef}
    >
      <div style={{ ...OPTION_ICON_STYLE, background: iconBg }}>
        {loading ? <Loader2 size={18} className="animate-spin" style={{ color: 'var(--muted-foreground)' }} /> : icon}
      </div>
      <div style={OPTION_TEXT_STYLE}>
        <p style={OPTION_LABEL_STYLE}>{loading ? (loadingLabel ?? label) : label}</p>
        <p style={OPTION_DESC_STYLE}>{loading ? (loadingDescription ?? description) : description}</p>
      </div>
    </Button>
  )
}

function getWelcomeScreenPresentation(
  mode: WelcomeScreenProps['mode'],
  locale: AppLocale,
): WelcomeScreenPresentation {
  return {
    heroBackground: 'transparent',
    heroIcon: <img src={memoriaIcon} alt="Memoria icon" style={BRAND_ICON_STYLE} />,
    subtitle: translate(locale, mode === 'welcome' ? 'onboarding.welcome.subtitle' : 'onboarding.welcome.missingSubtitle'),
    title: translate(locale, 'onboarding.welcome.title'),
  }
}

function useWelcomeActionButtons({
  mode,
  busy,
  onCreateEmptyVault,
  onOpenFolder,
}: Pick<WelcomeScreenProps, 'mode' | 'onCreateEmptyVault' | 'onOpenFolder'> & {
  busy: boolean
}) {
  const openFolderActionRef = useRef<HTMLButtonElement>(null)
  const createEmptyActionRef = useRef<HTMLButtonElement>(null)
  const actionButtonRefs = useMemo(() => [openFolderActionRef, createEmptyActionRef], [])
  const actions = useMemo<WelcomeAction[]>(
    () => [
      { disabled: false, run: onOpenFolder },
      { disabled: false, run: onCreateEmptyVault },
    ],
    [onCreateEmptyVault, onOpenFolder],
  )

  useEffect(() => {
    void mode
    if (busy) return

    // WKWebView can ignore `autoFocus`; move focus explicitly so keyboard-only
    // onboarding always starts on the first action.
    focusWelcomeAction(actionButtonRefs, 0)
  }, [actionButtonRefs, busy, mode])

  useEffect(() => {
    if (busy) return

    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      const activeElement = document.activeElement
      if (!focusBelongsToWelcomeActions(activeElement, actionButtonRefs)) return

      const actionIndex = getFocusedWelcomeActionIndex(activeElement, actionButtonRefs)
      if (isWelcomeNavigationKey(event)) {
        event.preventDefault()
        focusWelcomeAction(actionButtonRefs, nextWelcomeActionIndex(actionIndex, event, actionButtonRefs.length))
        return
      }

      if (!isWelcomeActivationKey(event)) return

      event.preventDefault()
      triggerWelcomeAction(actionIndex, actions)
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [actionButtonRefs, actions, busy])

  return {
    createEmptyActionRef,
    openFolderActionRef,
  }
}

function WelcomeHeader({ presentation }: { presentation: WelcomeScreenPresentation }) {
  return (
    <>
      <div
        style={{
          ...ICON_WRAP_STYLE,
          background: presentation.heroBackground,
        }}
      >
        {presentation.heroIcon}
      </div>

      <div style={{ textAlign: 'center' }}>
        <h1 style={TITLE_STYLE}>{presentation.title}</h1>
        <p style={{ ...SUBTITLE_STYLE, marginTop: 8 }}>{presentation.subtitle}</p>
      </div>
    </>
  )
}

function WelcomeActions(
  options: Pick<WelcomeScreenProps, 'creatingAction' | 'onCreateEmptyVault' | 'onOpenFolder'> & {
    busy: boolean
    createEmptyActionRef: WelcomeActionButtonRef
    locale: AppLocale
    openFolderActionRef: WelcomeActionButtonRef
  },
) {
  const {
    busy,
    createEmptyActionRef,
    creatingAction,
    locale,
    onCreateEmptyVault,
    onOpenFolder,
    openFolderActionRef,
  } = options
  return (
    <div
      style={{
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}
    >
      <OptionButton
        icon={<FolderOpen size={18} style={{ color: 'var(--muted-foreground)' }} />}
        iconBg="var(--muted)"
        label={translate(locale, 'onboarding.welcome.openExisting')}
        description={translate(locale, 'onboarding.welcome.openExistingDescription')}
        onClick={onOpenFolder}
        disabled={busy}
        testId="welcome-open-folder"
        autoFocus
        buttonRef={openFolderActionRef}
      />

      <OptionButton
        icon={<Plus size={18} style={{ color: 'var(--muted-foreground)' }} />}
        iconBg="var(--muted)"
        label={translate(locale, 'onboarding.welcome.createEmpty')}
        description={translate(locale, 'onboarding.welcome.createEmptyDescription')}
        loadingLabel={translate(locale, 'onboarding.welcome.createEmptyLoading')}
        loadingDescription={translate(locale, 'onboarding.welcome.createEmptyLoadingDescription')}
        onClick={onCreateEmptyVault}
        disabled={busy}
        loading={creatingAction === 'empty'}
        testId="welcome-create-new"
        buttonRef={createEmptyActionRef}
      />
    </div>
  )
}

function WelcomeError({ error }: Pick<WelcomeScreenProps, 'error'>) {
  if (!error) return null

  return (
    <div style={ERROR_BLOCK_STYLE}>
      <p style={ERROR_STYLE} data-testid="welcome-error" role="alert" aria-live="assertive">
        {error}
      </p>
    </div>
  )
}

export function WelcomeScreen(options: WelcomeScreenProps) {
  const {
    mode,
    locale = 'en',
    onCreateEmptyVault,
    onOpenFolder,
    creatingAction,
    error,
  } = options
  const busy = creatingAction !== null
  const presentation = getWelcomeScreenPresentation(mode, locale)
  const { createEmptyActionRef, openFolderActionRef } = useWelcomeActionButtons({
    mode,
    busy,
    onCreateEmptyVault,
    onOpenFolder,
  })

  return (
    <OnboardingShell style={{ background: 'var(--sidebar)' }} contentStyle={CARD_STYLE} testId="welcome-screen">
        <WelcomeHeader presentation={presentation} />
        <div style={DIVIDER_STYLE} />
        <WelcomeActions
          busy={busy}
          createEmptyActionRef={createEmptyActionRef}
          creatingAction={creatingAction}
          locale={locale}
          onCreateEmptyVault={onCreateEmptyVault}
          onOpenFolder={onOpenFolder}
          openFolderActionRef={openFolderActionRef}
        />
        <WelcomeError error={error} />
    </OnboardingShell>
  )
}
