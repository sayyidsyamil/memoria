import React from 'react'
import { motion, useAnimate } from 'motion/react'
import { cn } from '@/lib/utils'

type NativeButtonProps = Omit<
  React.ButtonHTMLAttributes<HTMLButtonElement>,
  'onDrag' | 'onDragStart' | 'onDragEnd' | 'onAnimationStart' | 'onAnimationEnd'
>

interface StatefulButtonProps extends NativeButtonProps {
  className?: string
  children: React.ReactNode
}

export function StatefulButton({ className, children, onClick, disabled, ...props }: StatefulButtonProps) {
  const [scope, animate] = useAnimate()

  const animateLoading = async () => {
    await animate('.loader', { width: '16px', scale: 1, display: 'block' }, { duration: 0.18 })
  }

  const animateSuccess = async () => {
    await animate('.loader', { width: '0px', scale: 0, display: 'none' }, { duration: 0.18 })
    await animate('.check', { width: '16px', scale: 1, display: 'block' }, { duration: 0.18 })
    await animate('.check', { width: '0px', scale: 0, display: 'none' }, { delay: 1.1, duration: 0.18 })
  }

  const handleClick = async (event: React.MouseEvent<HTMLButtonElement>) => {
    if (disabled) return
    await animateLoading()
    await onClick?.(event)
    await animateSuccess()
  }

  return (
    <motion.button
      layout
      ref={scope}
      className={cn(
        'inline-flex cursor-pointer items-center justify-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50',
        className,
      )}
      disabled={disabled}
      {...props}
      onClick={handleClick}
    >
      <motion.span layout className="flex min-w-0 items-center justify-center gap-2">
        <LoaderIcon />
        <CheckIcon />
        <motion.span layout className="flex min-w-0 items-center justify-center gap-2 truncate">{children}</motion.span>
      </motion.span>
    </motion.button>
  )
}

function LoaderIcon() {
  return (
    <motion.svg
      animate={{ rotate: [0, 360] }}
      initial={{ scale: 0, width: 0, display: 'none' }}
      style={{ scale: 0.75, display: 'none' }}
      transition={{ duration: 0.35, repeat: Infinity, ease: 'linear' }}
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="loader shrink-0"
    >
      <path d="M12 3a9 9 0 1 0 9 9" />
    </motion.svg>
  )
}

function CheckIcon() {
  return (
    <motion.svg
      initial={{ scale: 0, width: 0, display: 'none' }}
      style={{ scale: 0.75, display: 'none' }}
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="check shrink-0"
    >
      <path d="M20 6 9 17l-5-5" />
    </motion.svg>
  )
}

export { StatefulButton as Button }
