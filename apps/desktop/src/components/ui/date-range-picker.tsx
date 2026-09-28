import { useState } from 'react'
import { format } from 'date-fns'
import { enUS, zhCN } from 'date-fns/locale'
import type { DateRange } from 'react-day-picker'
import { CalendarIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

/** Official shadcn Base Range Picker composition with local, minute-precision bounds. */
export function DateRangePicker({
  id,
  from,
  to,
  onChange,
  locale,
  label,
  placeholder,
  fromLabel,
  toLabel,
  clearLabel,
  invalid,
}: {
  id: string
  from: string
  to: string
  onChange(value: { from: string; to: string }): void
  locale: 'zh-CN' | 'en-US'
  label: string
  placeholder: string
  fromLabel: string
  toLabel: string
  clearLabel: string
  invalid?: boolean
}) {
  const [open, setOpen] = useState(false)
  const parse = (value: string) => {
    const date = value ? new Date(value) : undefined
    return date && Number.isFinite(date.getTime()) ? date : undefined
  }
  const start = parse(from),
    end = parse(to)
  const range: DateRange | undefined = start ? { from: start, to: end } : undefined
  const formatter = new Intl.DateTimeFormat(locale, { dateStyle: 'medium' })
  const fromTime = from.split('T')[1]?.slice(0, 5) || '00:00'
  const toTime = to.split('T')[1]?.slice(0, 5) || '23:59'
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            id={id}
            variant="outline"
            className="w-full justify-between"
            aria-label={label}
            aria-invalid={invalid || undefined}
          />
        }
      >
        <span>
          {start
            ? `${formatter.format(start)}${end ? ` – ${formatter.format(end)}` : ' – …'}`
            : placeholder}
        </span>
        <CalendarIcon data-icon="inline-end" />
      </PopoverTrigger>
      <PopoverContent
        className="w-auto max-w-[calc(100vw-2rem)] p-0"
        align="end"
        aria-label={label}
      >
        <Calendar
          mode="range"
          numberOfMonths={2}
          autoFocus
          locale={locale === 'zh-CN' ? zhCN : enUS}
          defaultMonth={start}
          selected={range}
          onSelect={(value) =>
            onChange({
              from: value?.from ? `${format(value.from, 'yyyy-MM-dd')}T${fromTime}` : '',
              to: value?.to ? `${format(value.to, 'yyyy-MM-dd')}T${toTime}` : '',
            })
          }
        />
        <div className="flex flex-col gap-3 p-3 pt-0">
          <FieldGroup className="grid grid-cols-2 gap-3">
            <Field>
              <FieldLabel htmlFor={`${id}-from-time`}>{fromLabel}</FieldLabel>
              <Input
                id={`${id}-from-time`}
                type="time"
                step={60}
                value={fromTime}
                disabled={!start}
                onChange={(event) => {
                  if (start && event.target.value)
                    onChange({ from: `${format(start, 'yyyy-MM-dd')}T${event.target.value}`, to })
                }}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor={`${id}-to-time`}>{toLabel}</FieldLabel>
              <Input
                id={`${id}-to-time`}
                type="time"
                step={60}
                value={toTime}
                disabled={!end}
                onChange={(event) => {
                  if (end && event.target.value)
                    onChange({ from, to: `${format(end, 'yyyy-MM-dd')}T${event.target.value}` })
                }}
              />
            </Field>
          </FieldGroup>
          <Button
            variant="ghost"
            size="sm"
            disabled={!from && !to}
            onClick={() => {
              onChange({ from: '', to: '' })
              setOpen(false)
            }}
          >
            {clearLabel}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
