import { FilterIcon, RotateCcwIcon } from 'lucide-react'
import { useI18n } from '@/i18n'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Field, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  defaultLogFilters,
  hasLogFilters,
  hasInvalidLogTimeRange,
  type LogFilters,
} from '../lib/log-filters'

const levels = ['all', 'debug', 'info', 'warn', 'error'] as const
const sources = ['app', 'environment', 'proxy', 'kernel', 'update'] as const

export function AppLogToolbar({
  filters,
  onChange,
  methods,
}: {
  filters: LogFilters
  onChange: (filters: LogFilters) => void
  methods: string[]
}) {
  const { t } = useI18n()
  const setFilter = <Key extends keyof LogFilters>(key: Key, value: LogFilters[Key]) =>
    onChange({ ...filters, [key]: value })
  const invalidTime = hasInvalidLogTimeRange(filters)
  const advancedActive = Boolean(filters.from || filters.to || filters.minDuration)
  return (
    <div className="flex shrink-0 flex-col gap-3">
      <ToggleGroup
        variant="outline"
        size="sm"
        spacing={0}
        value={[filters.level]}
        onValueChange={(values: string[]) => {
          const level = levels.find((item) => item === values[0])
          if (level) setFilter('level', level)
        }}
        aria-label={t('logs.level')}
        className="max-w-full flex-wrap"
      >
        {levels.map((level) => (
          <ToggleGroupItem key={level} value={level}>
            {t(level === 'all' ? 'logs.allLevels' : `logs.level.${level}`)}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          type="search"
          value={filters.query}
          onChange={(event) => setFilter('query', event.target.value)}
          placeholder={t('logs.search')}
          aria-label={t('logs.search')}
          className="w-full sm:w-72 lg:w-80"
        />
        <Select
          value={filters.source}
          onValueChange={(value) => {
            const source = value === 'all' ? 'all' : sources.find((item) => item === value)
            if (source) onChange({ ...filters, source, method: 'all' })
          }}
        >
          <SelectTrigger aria-label={t('logs.source')}>
            <SelectValue>
              {t(filters.source === 'all' ? 'logs.allSources' : `logs.source.${filters.source}`)}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value="all">{t('logs.allSources')}</SelectItem>
              {sources.map((source) => (
                <SelectItem value={source} key={source}>
                  {t(`logs.source.${source}`)}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        <Select
          value={filters.method}
          onValueChange={(value) => setFilter('method', value ?? 'all')}
        >
          <SelectTrigger className="max-w-full sm:max-w-64" aria-label={t('logs.method')}>
            <SelectValue>
              {filters.method === 'all' ? t('logs.allMethods') : filters.method}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value="all">{t('logs.allMethods')}</SelectItem>
              {methods.map((method) => (
                <SelectItem value={method} key={method}>
                  {method}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        <Popover>
          <PopoverTrigger
            render={<Button variant={advancedActive ? 'accent' : 'outline'} size="sm" />}
          >
            <FilterIcon data-icon="inline-start" />
            {t('logs.advanced')}
          </PopoverTrigger>
          <PopoverContent align="end" className="w-80">
            <PopoverHeader>
              <PopoverTitle>{t('logs.advanced')}</PopoverTitle>
              <PopoverDescription>{t('logs.advancedHelp')}</PopoverDescription>
            </PopoverHeader>
            <FieldGroup>
              <Field data-invalid={invalidTime || undefined}>
                <FieldLabel htmlFor="log-from">{t('logs.from')}</FieldLabel>
                <Input
                  id="log-from"
                  type="datetime-local"
                  value={filters.from}
                  max={filters.to || undefined}
                  aria-invalid={invalidTime || undefined}
                  onChange={(event) => setFilter('from', event.target.value)}
                />
              </Field>
              <Field data-invalid={invalidTime || undefined}>
                <FieldLabel htmlFor="log-to">{t('logs.to')}</FieldLabel>
                <Input
                  id="log-to"
                  type="datetime-local"
                  value={filters.to}
                  min={filters.from || undefined}
                  aria-invalid={invalidTime || undefined}
                  onChange={(event) => setFilter('to', event.target.value)}
                />
                {invalidTime && <FieldError>{t('logs.invalidTime')}</FieldError>}
              </Field>
              <Field>
                <FieldLabel htmlFor="log-duration">{t('logs.minDuration')}</FieldLabel>
                <Input
                  id="log-duration"
                  type="number"
                  min={0}
                  step={1}
                  inputMode="numeric"
                  placeholder="0"
                  value={filters.minDuration}
                  onChange={(event) => setFilter('minDuration', event.target.value)}
                />
              </Field>
            </FieldGroup>
          </PopoverContent>
        </Popover>
        {hasLogFilters(filters) && (
          <Button variant="ghost" size="sm" onClick={() => onChange(defaultLogFilters)}>
            <RotateCcwIcon data-icon="inline-start" />
            {t('common.reset')}
          </Button>
        )}
      </div>
    </div>
  )
}
