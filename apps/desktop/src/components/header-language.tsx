import * as React from 'react'
import { LanguagesIcon } from 'lucide-react'
import { useI18n, type Locale } from '@/i18n'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

const localeLabels: Record<Locale, string> = {
  'zh-CN': '简体中文',
  'en-US': 'English',
}

export function HeaderLanguage() {
  const { locale, setLocale, t } = useI18n()
  const [open, setOpen] = React.useState(false)
  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon-lg"
            aria-label={t('header.language')}
            title={t('header.language')}
          />
        }
      >
        <LanguagesIcon />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={8} className="min-w-40">
        <DropdownMenuRadioGroup
          value={locale}
          onValueChange={(value) => {
            setLocale(value as Locale)
            setOpen(false)
          }}
        >
          {(Object.keys(localeLabels) as Locale[]).map((value) => (
            <DropdownMenuRadioItem key={value} value={value} className="pe-8">
              {localeLabels[value]}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
