import type { ThemeFont, ThemeMode, ThemeRadius } from '@contextweave/contracts'
import { cn } from 'cn'
import { themeFontFamilies } from '../theme-fonts'
import { themeRadiusValues } from '../theme-radius'

export function ThemeModePreview({ mode }: { mode: ThemeMode }) {
  const light = '#f8fafc'
  const lightPanel = '#e2e8f0'
  const dark = '#111827'
  const darkPanel = '#1f2937'
  const lightLine = '#64748b'
  const darkLine = '#94a3b8'
  return (
    <svg
      viewBox="0 0 120 72"
      className="size-full"
      style={{
        background:
          mode === 'system'
            ? `linear-gradient(to right, ${light} 50%, ${dark} 50%)`
            : mode === 'light'
              ? light
              : dark,
      }}
      aria-hidden="true"
    >
      {mode === 'system' ? (
        <>
          <rect width="13" height="72" fill={lightPanel} />
          <rect x="60" width="13" height="72" fill={darkPanel} />
          <path
            d="M20 20h28M20 30h22M20 40h25"
            stroke={lightLine}
            strokeWidth="2.4"
            strokeLinecap="round"
            opacity=".7"
          />
          <path
            d="M80 20h28M80 30h22M80 40h25"
            stroke={darkLine}
            strokeWidth="2.4"
            strokeLinecap="round"
            opacity=".7"
          />
          <circle cx="7" cy="10" r="2.5" fill="#2563eb" />
          <circle cx="67" cy="10" r="2.5" fill="#60a5fa" />
          <rect x="20" y="51" width="29" height="12" rx="2" fill={lightPanel} />
          <rect x="80" y="51" width="29" height="12" rx="2" fill={darkPanel} />
        </>
      ) : (
        <>
          <rect width="22" height="72" fill={mode === 'light' ? lightPanel : darkPanel} />
          <path
            d="M32 20h54M32 30h43M32 40h49"
            stroke={mode === 'light' ? lightLine : darkLine}
            strokeWidth="2.8"
            strokeLinecap="round"
            opacity=".7"
          />
          {mode === 'light' ? (
            <circle cx="101" cy="18" r="6" fill="#f59e0b" opacity=".9" />
          ) : (
            <path d="M103 12a6 6 0 1 0 4 10 5.4 5.4 0 0 1-4-10Z" fill="#93c5fd" opacity=".9" />
          )}
          <rect
            x="32"
            y="51"
            width="72"
            height="12"
            rx="2"
            fill={mode === 'light' ? lightPanel : darkPanel}
          />
        </>
      )}
    </svg>
  )
}

export function ColorPreview({ color }: { color: string }) {
  return (
    <span
      className="absolute inset-0"
      style={{
        background: `linear-gradient(135deg, ${color} 0%, color-mix(in oklch, ${color} 72%, white) 48%, color-mix(in oklch, ${color} 55%, black) 100%)`,
      }}
      aria-hidden="true"
    >
      <span className="absolute -top-5 -right-3 size-12 rounded-full bg-white/20" />
      <span className="absolute -bottom-6 -left-3 size-14 rounded-full bg-black/10" />
    </span>
  )
}

export function FontPreview({ font }: { font: ThemeFont }) {
  return (
    <span
      className="absolute inset-0 flex items-center justify-center text-2xl leading-none font-normal text-foreground"
      style={{ fontFamily: themeFontFamilies[font] }}
      aria-hidden="true"
    >
      Aa
    </span>
  )
}

export function RadiusPreview({ radius }: { radius: ThemeRadius }) {
  return (
    <span
      className="absolute top-2.5 left-2.5 size-[1.25rem] border-t-[1.5px] border-l-[1.5px] border-foreground/70"
      style={{ borderTopLeftRadius: themeRadiusValues[radius] }}
      aria-hidden="true"
    />
  )
}

export function DensityPreview({ rows, rowGap }: { rows: number; rowGap: string }) {
  return (
    <span
      className="absolute inset-2.5 flex flex-col justify-center"
      style={{ gap: rowGap }}
      aria-hidden="true"
    >
      {Array.from({ length: rows }, (_, index) => (
        <span
          key={index}
          className="block h-1 rounded-full bg-foreground/55"
          style={{ width: `${88 - index * 11}%` }}
        />
      ))}
    </span>
  )
}

type AppPreviewKind = 'sidebar' | 'inset' | 'floating' | 'default' | 'icon' | 'offcanvas'

export function AppPreview({ kind }: { kind: AppPreviewKind }) {
  const config = {
    sidebar: { x: 0, y: 0, width: 32, height: 72, contentX: 43, radius: 0 },
    inset: { x: 4, y: 4, width: 30, height: 64, contentX: 43, radius: 3 },
    floating: { x: 4, y: 4, width: 30, height: 64, contentX: 43, radius: 5 },
    default: { x: 0, y: 0, width: 22, height: 72, contentX: 30, radius: 0 },
    icon: { x: 4, y: 4, width: 12, height: 64, contentX: 24, radius: 4 },
    offcanvas: { x: 0, y: 0, width: 0, height: 0, contentX: 5, radius: 0 },
  }[kind]
  const isLayout = kind === 'default' || kind === 'icon' || kind === 'offcanvas'
  return (
    <svg
      viewBox="0 0 120 72"
      className="size-full text-muted-foreground group-data-[selected=true]:text-primary"
      aria-hidden="true"
    >
      <rect width="120" height="72" fill="currentColor" opacity=".06" />
      {config.width > 0 && (
        <rect
          x={config.x}
          y={config.y}
          width={config.width}
          height={config.height}
          rx={config.radius}
          fill="currentColor"
          opacity={isLayout ? '.72' : '.58'}
        />
      )}
      {config.width > 0 && (
        <>
          <circle
            cx={config.x + config.width / 2}
            cy={config.y + 10}
            r={2.2}
            fill="white"
            opacity=".72"
          />
          <path
            d={`M${config.x + 6} ${config.y + 25}h${Math.max(config.width - 12, 4)}M${config.x + 6} ${config.y + 36}h${Math.max(config.width - 15, 3)}M${config.x + 6} ${config.y + 47}h${Math.max(config.width - 11, 4)}`}
            stroke="white"
            strokeWidth="1.8"
            strokeLinecap="round"
            opacity=".62"
          />
        </>
      )}
      <rect
        x={config.contentX}
        y="8"
        width={120 - config.contentX - 5}
        height="2.8"
        rx="1.4"
        fill="currentColor"
        opacity=".72"
      />
      <rect
        x={config.contentX}
        y="18"
        width={isLayout ? 38 : 47}
        height="2.2"
        rx="1.1"
        fill="currentColor"
        opacity=".42"
      />
      <rect
        x={config.contentX}
        y="28"
        width={isLayout ? 60 : 67}
        height="35"
        rx="2.5"
        fill="currentColor"
        opacity=".18"
      />
      {isLayout && (
        <>
          <rect x="87" y="48" width="3" height="12" rx="1" fill="currentColor" opacity=".35" />
          <rect x="92" y="42" width="3" height="18" rx="1" fill="currentColor" opacity=".48" />
          <rect x="97" y="36" width="3" height="24" rx="1" fill="currentColor" opacity=".62" />
          <rect x="102" y="30" width="3" height="30" rx="1" fill="currentColor" opacity=".74" />
        </>
      )}
    </svg>
  )
}

export function ContentWidthPreview({ centered }: { centered: boolean }) {
  return (
    <span className="absolute inset-2 flex flex-col gap-1.5" aria-hidden="true">
      <span className="h-1.5 w-full rounded-sm bg-foreground/40" />
      <span className={cn('flex flex-1 flex-col gap-1', centered ? 'mx-auto w-1/2' : 'w-full')}>
        <span className="h-1 rounded-full bg-foreground/60" />
        <span className="h-1 w-3/4 rounded-full bg-foreground/40" />
        <span className="h-1 w-5/6 rounded-full bg-foreground/25" />
      </span>
    </span>
  )
}

export function DirectionPreview({ direction }: { direction: 'ltr' | 'rtl' }) {
  return (
    <svg
      viewBox="0 0 192 72"
      className="size-full text-muted-foreground group-data-[selected=true]:text-primary"
      style={direction === 'rtl' ? { transform: 'scaleX(-1)' } : undefined}
      aria-hidden="true"
    >
      <rect width="192" height="72" fill="currentColor" opacity=".06" />
      <rect x="134" y="7" width="50" height="58" rx="4" fill="currentColor" opacity=".2" />
      <circle cx="15" cy="17" r="3" fill="currentColor" opacity=".7" />
      <path
        d="M28 16h81M28 28h64M28 40h74"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        opacity=".58"
      />
      <rect x="28" y="51" width="91" height="11" rx="2.5" fill="currentColor" opacity=".18" />
    </svg>
  )
}
