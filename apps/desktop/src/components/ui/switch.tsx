'use client'

import { Switch as SwitchPrimitive } from '@base-ui/react/switch'
import { cn } from 'cn'

function Switch({
  className,
  size = 'default',
  ...props
}: SwitchPrimitive.Root.Props & { size?: 'sm' | 'default' }) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      data-size={size}
      className={cn(
        'peer group/switch relative inline-flex shrink-0 items-center rounded-full outline-none transition-colors after:absolute after:-inset-x-3 after:-inset-y-2 focus-visible:ring-3 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background aria-invalid:ring-3 aria-invalid:ring-destructive/20 data-checked:bg-primary data-unchecked:bg-input data-disabled:cursor-not-allowed data-disabled:opacity-50',
        '[--switch-thumb:calc(1rem*var(--density-scale,1))] data-[size=sm]:[--switch-thumb:calc(0.75rem*var(--density-scale,1))] [--switch-gap:0.0625rem] h-[calc(var(--switch-thumb)+2*var(--switch-gap))] w-[calc(2*var(--switch-thumb))] p-[var(--switch-gap)]',
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className="pointer-events-none block size-[var(--switch-thumb)] shrink-0 rounded-full bg-background transition-transform data-checked:translate-x-[calc(var(--switch-thumb)-2*var(--switch-gap))] rtl:data-checked:-translate-x-[calc(var(--switch-thumb)-2*var(--switch-gap))]"
      />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
