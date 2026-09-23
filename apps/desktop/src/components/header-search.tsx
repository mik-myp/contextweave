import * as React from 'react'
import { useNavigate } from '@tanstack/react-router'
import { ArrowRightIcon, SearchIcon } from 'lucide-react'
import { useI18n } from '@/i18n'
import { appRoutes } from '@/shared/config/navigation'
import { Button } from '@/components/ui/button'
import {
  Command,
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandShortcut,
} from '@/components/ui/command'

type SearchItem = {
  url: string
  labelKey:
    | 'nav.environments'
    | 'nav.proxies'
    | 'nav.kernels'
    | 'nav.activity'
    | 'nav.settings'
    | 'nav.about'
    | 'nav.fingerprints'
  keywords: string
  icon: React.ReactNode
}

export function HeaderSearch() {
  const { t } = useI18n()
  const navigate = useNavigate()
  const [open, setOpen] = React.useState(false)
  const [query, setQuery] = React.useState('')
  const returnFocus = React.useRef<HTMLElement | null>(null)
  const shortcut = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘K' : 'Ctrl K'
  const items = React.useMemo<SearchItem[]>(
    () => [
      {
        url: appRoutes.environments,
        labelKey: 'nav.environments',
        keywords: 'browser environment 环境',
        icon: <SearchIcon />,
      },
      {
        url: appRoutes.proxies,
        labelKey: 'nav.proxies',
        keywords: 'proxy 代理',
        icon: <SearchIcon />,
      },
      {
        url: appRoutes.kernels,
        labelKey: 'nav.kernels',
        keywords: 'kernel browser 内核',
        icon: <SearchIcon />,
      },
      {
        url: appRoutes.activity,
        labelKey: 'nav.activity',
        keywords: 'activity runtime 运行记录',
        icon: <SearchIcon />,
      },
      {
        url: appRoutes.settings,
        labelKey: 'nav.settings',
        keywords: 'settings theme 设置 主题',
        icon: <SearchIcon />,
      },
      {
        url: appRoutes.fingerprints,
        labelKey: 'nav.fingerprints',
        keywords: 'fingerprint 指纹',
        icon: <SearchIcon />,
      },
      {
        url: appRoutes.about,
        labelKey: 'nav.about',
        keywords: 'about version 关于',
        icon: <SearchIcon />,
      },
    ],
    [],
  )

  const changeOpen = React.useCallback((next: boolean) => {
    if (next) setQuery('')
    setOpen(next)
  }, [])
  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        if (!open && document.activeElement instanceof HTMLElement)
          returnFocus.current = document.activeElement
        changeOpen(!open)
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open, changeOpen])

  const openSearch = (event: React.MouseEvent<HTMLButtonElement>) => {
    returnFocus.current = event.currentTarget
    changeOpen(true)
  }
  return (
    <>
      <Button
        variant="outline"
        aria-keyshortcuts="Meta+K Control+K"
        aria-label={t('header.search') + ' (' + shortcut + ')'}
        title={t('header.search') + ' (' + shortcut + ')'}
        onClick={openSearch}
        className="group relative hidden h-8 min-w-0 justify-start rounded-md bg-muted/25 px-2.5 text-sm font-normal text-muted-foreground shadow-none hover:bg-accent sm:flex sm:w-40 sm:pe-16 md:w-52 lg:w-64"
      >
        <SearchIcon className="shrink-0" />
        <span className="truncate">{t('header.search')}</span>
        <kbd
          dir="ltr"
          className="pointer-events-none absolute end-1 top-1 flex h-6 items-center rounded border bg-muted px-1.5 font-mono text-[10px] font-medium select-none group-hover:bg-accent"
        >
          {shortcut}
        </kbd>
      </Button>
      <Button
        variant="ghost"
        size="icon-lg"
        className="sm:hidden"
        aria-label={t('header.search')}
        onClick={openSearch}
      >
        <SearchIcon />
      </Button>
      <CommandDialog
        open={open}
        onOpenChange={changeOpen}
        title={t('header.search')}
        description={t('header.searchPlaceholder')}
        contentProps={{ finalFocus: returnFocus }}
        className="top-[18%] sm:max-w-lg"
      >
        <Command
          loop
          label={t('header.search')}
          filter={(_value, search, keywords) =>
            (keywords ?? []).join(' ').toLowerCase().includes(search.trim().toLowerCase()) ? 1 : 0
          }
        >
          <CommandInput
            value={query}
            onValueChange={setQuery}
            placeholder={t('header.searchPlaceholder')}
            aria-label={t('header.searchPlaceholder')}
          />
          <CommandList>
            <CommandEmpty>{t('common.noResults')}</CommandEmpty>
            <CommandGroup>
              {items.map((item) => (
                <CommandItem
                  key={item.url}
                  value={item.url}
                  keywords={[t(item.labelKey), item.keywords]}
                  onSelect={() => {
                    changeOpen(false)
                    void navigate({ to: item.url })
                  }}
                >
                  {item.icon}
                  <span>{t(item.labelKey)}</span>
                  <CommandShortcut>
                    <ArrowRightIcon className="rtl:rotate-180" />
                  </CommandShortcut>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
        <div className="flex items-center justify-between border-t bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
          <span>{t('common.search')}</span>
          <kbd dir="ltr">{shortcut}</kbd>
        </div>
      </CommandDialog>
    </>
  )
}
