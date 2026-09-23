import * as React from 'react'
import { AlertCircleIcon, PaletteIcon, RotateCcwIcon, XIcon } from 'lucide-react'
import {
  defaultThemeConfig,
  type ThemeConfig,
  type ThemeFont,
  type ThemeLayout,
  type ThemeMode,
  type ThemeRadius,
  type ThemeSidebar,
} from '@contextweave/contracts'
import { useI18n, type TranslationKey } from '@/i18n'
import { useTheme } from '../theme-provider'
import { Button } from '@/components/ui/button'
import {
  Drawer,
  DrawerContent,
  DrawerClose,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from '@/components/ui/drawer'
import { Input } from '@/components/ui/input'
import { ThemeAccessibility } from '@/features/theme/components/theme-accessibility'
import {
  AppPreview,
  ColorPreview,
  ContentWidthPreview,
  DensityPreview,
  DirectionPreview,
  FontPreview,
  RadiusPreview,
  ThemeModePreview,
} from '@/features/theme/components/theme-option-previews'
import { themeRadiusValues } from '@/features/theme/theme-radius'
import { ChoiceGrid, type Choice } from './theme-choice-grid'
import { ThemeSection } from './theme-section'
import { Alert, AlertAction, AlertDescription, AlertTitle } from '@/components/ui/alert'

const radiusOptions = [
  'default',
  'none',
  'sm',
  'md',
  'lg',
  'xl',
] as const satisfies readonly ThemeRadius[]

const colorOptions: ReadonlyArray<readonly [string, TranslationKey]> = [
  ['#2563EB', 'theme.colorBlue'],
  ['#0891B2', 'theme.colorCyan'],
  ['#7C3AED', 'theme.colorViolet'],
  ['#DB2777', 'theme.colorPink'],
  ['#EA580C', 'theme.colorOrange'],
  ['#16A34A', 'theme.colorGreen'],
] as const

export function ThemeDrawer() {
  const { theme, setTheme, resetTheme, saveStatus, retrySave } = useTheme()
  const { t } = useI18n()
  const [draftColor, setDraftColor] = React.useState(theme.color)
  React.useEffect(() => setDraftColor(theme.color), [theme.color])

  const setColor = (value: string) => {
    if (/^#[\da-f]{6}$/i.test(value)) setTheme({ color: value.toUpperCase() })
  }
  const side = theme.direction === 'rtl' ? 'left' : 'right'
  const reset = (...keys: Array<keyof Omit<ThemeConfig, 'version'>>) =>
    setTheme(
      Object.fromEntries(keys.map((key) => [key, defaultThemeConfig[key]])) as Partial<
        Omit<ThemeConfig, 'version'>
      >,
    )

  const modes: Choice<ThemeMode>[] = [
    { value: 'system', label: t('theme.system'), preview: <ThemeModePreview mode="system" /> },
    { value: 'light', label: t('theme.light'), preview: <ThemeModePreview mode="light" /> },
    { value: 'dark', label: t('theme.dark'), preview: <ThemeModePreview mode="dark" /> },
  ]
  const fonts: Choice<ThemeFont>[] = [
    { value: 'default', label: t('theme.fontAuto'), preview: <FontPreview font="default" /> },
    {
      value: 'sans',
      label: t('theme.fontSans'),
      preview: <FontPreview font="sans" />,
    },
    { value: 'serif', label: t('theme.fontSerif'), preview: <FontPreview font="serif" /> },
  ]
  const radii: Choice<ThemeRadius>[] = radiusOptions.map((value) => ({
    value,
    label: value === 'default' ? t('theme.auto') : themeRadiusValues[value].replace('rem', ''),
    preview: <RadiusPreview radius={value} />,
  }))
  const densityPreviews = {
    compact: { rows: 4, rowGap: '2px' },
    default: { rows: 3, rowGap: '5px' },
    comfortable: { rows: 2, rowGap: '9px' },
    spacious: { rows: 2, rowGap: '13px' },
  } as const
  const densityLabels = {
    compact: t('theme.compact'),
    default: t('theme.defaultDensity'),
    comfortable: t('theme.comfortable'),
    spacious: t('theme.spacious'),
  }
  const sidebars: Choice<ThemeSidebar>[] = [
    { value: 'sidebar', label: t('theme.sidebar'), preview: <AppPreview kind="sidebar" /> },
    { value: 'inset', label: t('theme.inset'), preview: <AppPreview kind="inset" /> },
    { value: 'floating', label: t('theme.floating'), preview: <AppPreview kind="floating" /> },
  ]
  const layouts: Choice<ThemeLayout>[] = [
    { value: 'default', label: t('theme.layoutDefault'), preview: <AppPreview kind="default" /> },
    { value: 'icon', label: t('theme.layoutIcon'), preview: <AppPreview kind="icon" /> },
    {
      value: 'offcanvas',
      label: t('theme.layoutOffcanvas'),
      preview: <AppPreview kind="offcanvas" />,
    },
  ]

  return (
    <Drawer swipeDirection={side} modal>
      <DrawerTrigger
        render={
          <Button
            variant="ghost"
            size="icon-lg"
            aria-label={t('header.theme')}
            title={t('header.theme')}
          />
        }
      >
        <PaletteIcon />
      </DrawerTrigger>
      <DrawerContent className="w-full sm:max-w-md">
        <DrawerHeader className="border-b px-5 py-4">
          <div className="flex items-center justify-between gap-3">
            <DrawerTitle>{t('header.themeTitle')}</DrawerTitle>
            <DrawerClose
              render={<Button variant="ghost" size="icon-sm" aria-label={t('common.close')} />}
            >
              <XIcon />
            </DrawerClose>
          </div>
          <DrawerDescription>{t('header.themeDescription')}</DrawerDescription>
        </DrawerHeader>
        <div className="flex-1 overflow-y-auto px-5 py-5">
          <div className="flex flex-col gap-7">
            {saveStatus === 'error' && (
              <Alert variant="destructive">
                <AlertCircleIcon />
                <AlertTitle>{t('theme.saveErrorTitle')}</AlertTitle>
                <AlertDescription>{t('theme.saveErrorDescription')}</AlertDescription>
                <AlertAction>
                  <Button variant="outline" size="sm" onClick={retrySave}>
                    {t('common.retry')}
                  </Button>
                </AlertAction>
              </Alert>
            )}
            <ThemeSection
              title={t('header.mode')}
              showReset={theme.mode !== defaultThemeConfig.mode}
              onReset={() => reset('mode')}
            >
              <ChoiceGrid
                value={theme.mode}
                choices={modes}
                onChange={(mode) => setTheme({ mode })}
                columns={3}
                gap={4}
                ariaLabel={t('header.mode')}
                previewSize="illustration"
              />
            </ThemeSection>
            <ThemeSection
              title={t('header.palette')}
              showReset={theme.color !== defaultThemeConfig.color}
              onReset={() => reset('color')}
            >
              <p className="text-sm leading-relaxed text-muted-foreground">
                {t('theme.accentHelp')}
              </p>
              <ChoiceGrid
                value={theme.color}
                choices={colorOptions.map(([value, labelKey]) => ({
                  value,
                  label: t(labelKey),
                  preview: <ColorPreview color={value} />,
                }))}
                onChange={setColor}
                columns={3}
                gap={3}
                ariaLabel={t('header.palette')}
              />
              <div className="mt-1 flex items-center gap-2">
                <input
                  aria-label={t('theme.customColor')}
                  type="color"
                  value={theme.color}
                  onChange={(event) => setColor(event.target.value)}
                  className="theme-color-input size-(--control-height) shrink-0 cursor-pointer appearance-none overflow-hidden rounded-md border border-input bg-transparent p-0 outline-none focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                />
                <Input
                  aria-label={t('theme.customColor')}
                  dir="ltr"
                  value={draftColor}
                  maxLength={7}
                  onChange={(event) => {
                    setDraftColor(event.target.value)
                    setColor(event.target.value)
                  }}
                  placeholder="#2563EB"
                  className="font-mono uppercase"
                />
              </div>
            </ThemeSection>
            <ThemeSection
              title={t('header.font')}
              showReset={theme.font !== defaultThemeConfig.font}
              onReset={() => reset('font')}
            >
              <ChoiceGrid
                value={theme.font}
                choices={fonts}
                onChange={(font) => setTheme({ font })}
                columns={3}
                gap={4}
                ariaLabel={t('header.font')}
              />
            </ThemeSection>
            <ThemeSection
              title={t('header.radius')}
              showReset={theme.radius !== defaultThemeConfig.radius}
              onReset={() => reset('radius')}
            >
              <ChoiceGrid
                value={theme.radius}
                choices={radii}
                onChange={(radius) => setTheme({ radius })}
                columns={6}
                gap={2}
                ariaLabel={t('header.radius')}
              />
            </ThemeSection>
            <ThemeSection
              title={t('header.density')}
              showReset={theme.density !== defaultThemeConfig.density}
              onReset={() => reset('density')}
            >
              <p className="text-sm leading-relaxed text-muted-foreground">
                {t('theme.densityHelp')}
              </p>
              <ChoiceGrid
                value={theme.density}
                choices={(Object.keys(densityPreviews) as Array<keyof typeof densityPreviews>).map(
                  (value) => ({
                    value,
                    label: densityLabels[value],
                    preview: <DensityPreview {...densityPreviews[value]} />,
                  }),
                )}
                columns={4}
                gap={3}
                onChange={(density) => setTheme({ density })}
                ariaLabel={t('header.density')}
              />
            </ThemeSection>
            <ThemeSection
              title={t('header.sidebar')}
              showReset={theme.sidebar !== defaultThemeConfig.sidebar}
              onReset={() => reset('sidebar')}
            >
              <ChoiceGrid
                value={theme.sidebar}
                choices={sidebars}
                onChange={(sidebar) => setTheme({ sidebar })}
                columns={3}
                gap={4}
                ariaLabel={t('header.sidebar')}
                previewSize="illustration"
              />
            </ThemeSection>
            <ThemeSection
              title={t('header.layout')}
              showReset={theme.layout !== defaultThemeConfig.layout}
              onReset={() => reset('layout')}
            >
              <ChoiceGrid
                value={theme.layout}
                choices={layouts}
                onChange={(layout) => setTheme({ layout })}
                columns={3}
                gap={4}
                ariaLabel={t('header.layout')}
                previewSize="illustration"
              />
            </ThemeSection>
            <ThemeSection
              title={t('header.contentWidth')}
              showReset={theme.contentWidth !== defaultThemeConfig.contentWidth}
              onReset={() => reset('contentWidth')}
            >
              <ChoiceGrid
                value={theme.contentWidth}
                choices={[
                  {
                    value: 'full',
                    label: t('theme.full'),
                    preview: <ContentWidthPreview centered={false} />,
                  },
                  {
                    value: 'centered',
                    label: t('theme.centered'),
                    preview: <ContentWidthPreview centered />,
                  },
                ]}
                columns={2}
                gap={4}
                onChange={(contentWidth) => setTheme({ contentWidth })}
                ariaLabel={t('header.contentWidth')}
              />
            </ThemeSection>
            <ThemeSection
              title={t('header.direction')}
              showReset={theme.direction !== defaultThemeConfig.direction}
              onReset={() => reset('direction')}
            >
              <ChoiceGrid
                value={theme.direction}
                choices={[
                  {
                    value: 'ltr',
                    label: t('theme.ltr'),
                    preview: <DirectionPreview direction="ltr" />,
                  },
                  {
                    value: 'rtl',
                    label: t('theme.rtl'),
                    preview: <DirectionPreview direction="rtl" />,
                  },
                ]}
                columns={2}
                gap={4}
                onChange={(direction) => setTheme({ direction })}
                ariaLabel={t('header.direction')}
                previewSize="illustration"
              />
            </ThemeSection>
            <ThemeSection
              title={t('header.accessibility')}
              showReset={
                theme.scale !== defaultThemeConfig.scale ||
                theme.motion !== defaultThemeConfig.motion
              }
              onReset={() => reset('scale', 'motion')}
            >
              <ThemeAccessibility
                scale={theme.scale}
                motion={theme.motion}
                onScaleChange={(scale) => setTheme({ scale })}
                onMotionChange={(motion) => setTheme({ motion })}
              />
            </ThemeSection>
          </div>
        </div>
        <DrawerFooter className="border-t px-5 py-3 sm:flex-row sm:justify-end">
          <Button variant="destructive" onClick={resetTheme}>
            <RotateCcwIcon data-icon="inline-start" />
            {t('header.resetTheme')}
          </Button>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  )
}
