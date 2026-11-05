import type * as React from 'react'
import { Platform, TextInput } from 'react-native'
import { cn } from './utils'

type InputProps = React.ComponentProps<typeof TextInput> &
  React.RefAttributes<TextInput>

function Input({
  className,
  placeholderTextColor,
  ...props
}: InputProps) {
  return (
    <TextInput
      className={cn(
        'border-input bg-background text-foreground h-9 rounded-md border px-3 py-1 text-sm',
        Platform.select({
          web: 'outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]',
        }),
        props.editable === false ? 'opacity-50' : null,
        className,
      )}
      placeholderTextColor={placeholderTextColor ?? '#787774'}
      {...props}
    />
  )
}

export { Input }
export type { InputProps }
