import { useEffect, useRef } from 'react'
import { toast } from '@/components/ui/toast'
import { useI18n } from '@/i18n'
import { useTheme } from '../theme-provider'

/** Keep failed saves reachable even when the settings drawer is closed. */
export function ThemeSaveNotice() {
  const { saveStatus, retrySave } = useTheme()
  const { t } = useI18n()
  const toastId = useRef<string | undefined>(undefined)
  useEffect(() => {
    if (saveStatus === 'saved') {
      if (toastId.current) toast.close(toastId.current)
      toastId.current = undefined
      return
    }
    if (saveStatus === 'saving' && !toastId.current) return
    const options = {
      type: saveStatus === 'error' ? 'error' : 'loading',
      title: t(saveStatus === 'error' ? 'theme.saveErrorTitle' : 'theme.saving'),
      description: t('theme.saveErrorDescription'),
      timeout: 0,
      actionProps: {
        children: t('common.retry'),
        onClick: retrySave,
        disabled: saveStatus === 'saving',
      },
      onClose: () => {
        toastId.current = undefined
      },
    }
    if (toastId.current) toast.update(toastId.current, options)
    else toastId.current = toast.add(options)
  }, [saveStatus, retrySave, t])
  return null
}
