import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { cn } from '@/lib/utils'

export type LoadingState = {
  text: string
}

interface MultiStepLoaderProps {
  loadingStates: LoadingState[]
  loading?: boolean
  duration?: number
  loop?: boolean
  className?: string
  variant?: 'inline' | 'overlay'
}

export function MultiStepLoader({
  loadingStates,
  loading,
  duration = 900,
  loop = false,
  className,
  variant = 'overlay',
}: MultiStepLoaderProps) {
  const [currentState, setCurrentState] = useState(0)

  useEffect(() => {
    if (!loading) {
      const resetTimer = window.setTimeout(() => setCurrentState(0), 0)
      return () => window.clearTimeout(resetTimer)
    }

    const timeout = window.setTimeout(() => {
      setCurrentState((previous) => (
        loop
          ? previous === loadingStates.length - 1 ? 0 : previous + 1
          : Math.min(previous + 1, loadingStates.length - 1)
      ))
    }, duration)

    return () => window.clearTimeout(timeout)
  }, [currentState, duration, loading, loadingStates.length, loop])

  if (variant === 'inline') {
    return (
      <AnimatePresence initial={false}>
        {loading && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className={cn('overflow-hidden', className)}
          >
            <LoaderCore loadingStates={loadingStates} value={currentState} />
          </motion.div>
        )}
      </AnimatePresence>
    )
  }

  return (
    <AnimatePresence mode="wait">
      {loading && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className={cn('fixed inset-0 z-[100] flex items-center justify-center bg-background/70 backdrop-blur-xl', className)}
        >
          <div className="relative w-full max-w-sm rounded-lg border border-border bg-card p-6 shadow-lg">
            <LoaderCore loadingStates={loadingStates} value={currentState} />
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

function LoaderCore({ loadingStates, value = 0 }: { loadingStates: LoadingState[]; value?: number }) {
  return (
    <div className="flex flex-col gap-2">
      {loadingStates.map((loadingState, index) => {
        const isDone = index < value
        const isActive = index === value

        return (
          <motion.div
            key={loadingState.text}
            className="flex items-center gap-2 text-left"
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: isActive || isDone ? 1 : 0.45, y: 0 }}
            transition={{ duration: 0.22 }}
          >
            {isDone ? (
              <CheckFilled className="text-primary" />
            ) : (
              <CheckOutline className={isActive ? 'text-primary' : 'text-muted-foreground'} />
            )}
            <span className={cn('text-[12px]', isActive || isDone ? 'text-foreground' : 'text-muted-foreground')}>
              {loadingState.text}
            </span>
          </motion.div>
        )
      })}
    </div>
  )
}

function CheckOutline({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.7} stroke="currentColor" className={cn('h-4 w-4 shrink-0', className)}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
    </svg>
  )
}

function CheckFilled({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className={cn('h-4 w-4 shrink-0', className)}>
      <path
        fillRule="evenodd"
        d="M2.25 12c0-5.385 4.365-9.75 9.75-9.75s9.75 4.365 9.75 9.75-4.365 9.75-9.75 9.75S2.25 17.385 2.25 12Zm13.36-1.814a.75.75 0 1 0-1.22-.872l-3.236 4.53-1.624-1.624a.75.75 0 0 0-1.06 1.06l2.25 2.25a.75.75 0 0 0 1.14-.094l3.75-5.25Z"
        clipRule="evenodd"
      />
    </svg>
  )
}
