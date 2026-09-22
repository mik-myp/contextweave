import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from '@tanstack/react-router'
import { router } from './router'
import './index.css'
import { ThemeProvider } from './theme'
import { defaultThemeConfig, themeConfigSchema } from '@contextweave/contracts'

async function bootstrap(): Promise<void> {
  let initialTheme = defaultThemeConfig
  try {
    const result = await window.contextweave?.settings.getTheme()
    if (result?.ok) {
      const parsed = themeConfigSchema.safeParse(result.data)
      if (parsed.success) initialTheme = parsed.data
    }
  } catch {
    // The renderer still starts with the safe built-in theme if settings are unavailable.
  }
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <ThemeProvider initialTheme={initialTheme}>
        <RouterProvider router={router} />
      </ThemeProvider>
    </StrictMode>,
  )
}

void bootstrap()
