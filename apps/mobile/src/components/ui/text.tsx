import { Slot } from '@rn-primitives/slot'
import { cva, type VariantProps } from 'class-variance-authority'
import * as React from 'react'
import { Platform, Text as RNText, type Role } from 'react-native'
import { cn } from './utils'

const textVariants = cva(
  cn(
    Platform.select({
      web: 'select-text',
    }),
  ),
  {
    variants: {
      variant: {
        blockquote: 'mt-4 border-l-2 pl-3 italic sm:mt-6 sm:pl-6',
        code: 'bg-muted relative rounded px-[0.3rem] py-[0.2rem] font-mono text-sm font-semibold',
        default: '',
        h1: cn('text-center text-4xl font-extrabold tracking-tight', Platform.select({ web: 'scroll-m-20 text-balance' })),
        h2: cn('border-border border-b pb-2 text-3xl font-semibold tracking-tight', Platform.select({ web: 'scroll-m-20 first:mt-0' })),
        h3: cn('text-2xl font-semibold tracking-tight', Platform.select({ web: 'scroll-m-20' })),
        h4: cn('text-xl font-semibold tracking-tight', Platform.select({ web: 'scroll-m-20' })),
        large: 'text-lg font-semibold',
        lead: 'text-muted-foreground text-xl',
        muted: 'text-muted-foreground text-sm',
        p: 'mt-3 leading-7 sm:mt-6',
        small: 'text-sm font-medium leading-none',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
)

type TextVariantProps = VariantProps<typeof textVariants>
type TextVariant = NonNullable<TextVariantProps['variant']>

const roleByVariant: Partial<Record<TextVariant, Role>> = {
  blockquote: Platform.select({ web: 'blockquote' as Role }),
  code: Platform.select({ web: 'code' as Role }),
  h1: 'heading',
  h2: 'heading',
  h3: 'heading',
  h4: 'heading',
}

const ariaLevelByVariant: Partial<Record<TextVariant, string>> = {
  h1: '1',
  h2: '2',
  h3: '3',
  h4: '4',
}

const TextClassContext = React.createContext<string | undefined>(undefined)

type TextProps = React.ComponentProps<typeof RNText> &
  React.RefAttributes<typeof RNText> &
  TextVariantProps & {
    asChild?: boolean
  }

function Text({
  asChild = false,
  className,
  style,
  variant = 'default',
  ...props
}: TextProps) {
  const textClass = React.useContext(TextClassContext)
  const Component = asChild ? Slot : RNText
  const defaultClassName = style === undefined ? 'text-foreground text-base' : undefined

  return (
    <Component
      aria-level={variant ? ariaLevelByVariant[variant] : undefined}
      className={cn(defaultClassName, textVariants({ variant }), textClass, className)}
      role={variant ? roleByVariant[variant] : undefined}
      style={style}
      {...props}
    />
  )
}

export { Text, TextClassContext }
export type { TextProps }
