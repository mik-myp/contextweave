import { useCallback, useEffect, useRef } from 'react'
import type { ThemeLayout } from '@contextweave/contracts'
import { useTheme } from './theme-provider'

export function useThemeSidebar() {
  const { theme, setTheme } = useTheme()
  const collapsedLayout = useRef<Exclude<ThemeLayout, 'default'>>(
    theme.layout === 'offcanvas' ? 'offcanvas' : 'icon',
  )
  useEffect(() => {
    if (theme.layout !== 'default') collapsedLayout.current = theme.layout
  }, [theme.layout])
  const setOpen = useCallback(
    (open: boolean) => {
      setTheme({ layout: open ? 'default' : collapsedLayout.current })
    },
    [setTheme],
  )
  return { open: theme.layout === 'default', setOpen }
}
