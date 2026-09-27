import { useId } from 'react'
import { useI18n } from '@/i18n'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Field, FieldLabel, FieldDescription, FieldError, FieldGroup } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { useArtifactBudget } from '../hooks/use-artifact-budget'

export function ArtifactBudget() {
  const { t, locale } = useI18n()
  const state = useArtifactBudget()
  const id = useId()
  const number = (value: number) => new Intl.NumberFormat(locale).format(value)
  return (
    <section
      className="flex flex-col gap-3"
      aria-label={t('artifactBudget.title')}
      aria-busy={state.query.isFetching || state.isSaving}
    >
      <h3 className="font-medium">{t('artifactBudget.title')}</h3>
      <p className="text-sm text-muted-foreground">{t('artifactBudget.help')}</p>
      <p className="text-sm text-muted-foreground">{t('artifactBudget.scope')}</p>
      <div>
        <Button
          variant="outline"
          disabled={state.query.isFetching || state.isSaving}
          onClick={() => void state.query.refetch()}
        >
          {t('common.refresh')}
        </Button>
      </div>
      {state.query.isPending ? (
        <Skeleton className="h-24" />
      ) : state.query.error ? (
        <Alert variant="destructive">
          <AlertDescription>{state.query.error.message}</AlertDescription>
          <Button variant="outline" size="sm" onClick={() => void state.query.refetch()}>
            {t('common.retry')}
          </Button>
        </Alert>
      ) : (
        state.data && (
          <>
            <dl className="flex flex-wrap gap-4">
              <div>
                <dt className="text-sm text-muted-foreground">{t('artifactBudget.registered')}</dt>
                <dd>{number(state.data.registered.bytes)} B</dd>
              </div>
              <div>
                <dt className="text-sm text-muted-foreground">{t('artifactBudget.reserved')}</dt>
                <dd>
                  {number(state.data.reserved.bytes)} B · {number(state.data.reserved.count)}
                </dd>
              </div>
              <div>
                <dt className="text-sm text-muted-foreground">{t('artifactBudget.available')}</dt>
                <dd>{number(state.data.availableBytes)} B</dd>
              </div>
            </dl>
            <form
              className="flex flex-col gap-3"
              noValidate
              onSubmit={(event) => {
                event.preventDefault()
                void state.save()
              }}
            >
              <FieldGroup className="max-w-sm">
                <Field data-invalid={state.isInvalid} data-disabled={state.isSaving}>
                  <FieldLabel htmlFor={id}>{t('artifactBudget.limit')}</FieldLabel>
                  <Input
                    id={id}
                    type="number"
                    min={32}
                    max={102400}
                    step={1}
                    value={state.text}
                    disabled={state.isSaving}
                    aria-invalid={state.isInvalid}
                    aria-describedby={`${id}-help${state.isInvalid ? ` ${id}-error` : ''}`}
                    onChange={(event) => state.edit(event.target.value)}
                  />
                  <FieldDescription id={`${id}-help`}>{t('artifactBudget.range')}</FieldDescription>
                  {state.isInvalid && (
                    <FieldError id={`${id}-error`}>{t('artifactBudget.invalid')}</FieldError>
                  )}
                </Field>
              </FieldGroup>
              <div className="flex flex-wrap gap-2">
                <Button type="submit" disabled={!state.canSave}>
                  {state.isSaving && (
                    <Spinner aria-label={t('artifactBudget.saving')} data-icon="inline-start" />
                  )}
                  {t('artifactBudget.save')}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  disabled={state.isSaving || !state.isDirty}
                  onClick={state.reset}
                >
                  {t('artifactBudget.reset')}
                </Button>
              </div>
            </form>
            {state.isConflicted && (
              <Alert>
                <AlertDescription>{t('artifactBudget.conflict')}</AlertDescription>
              </Alert>
            )}
            {state.error && (
              <Alert variant="destructive">
                <AlertDescription>{state.error}</AlertDescription>
              </Alert>
            )}
            {state.isSaved && (
              <p role="status" className="text-sm">
                {t('artifactBudget.saved')}
              </p>
            )}
            <p className="text-sm text-muted-foreground">{t('artifactBudget.uncertain')}</p>
          </>
        )
      )}
    </section>
  )
}
