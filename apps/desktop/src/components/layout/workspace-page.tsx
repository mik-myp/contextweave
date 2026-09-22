import type { ReactNode } from 'react'

export function WorkspacePage({
  toolbar,
  content,
  selectionBar,
  children,
}: {
  toolbar?: ReactNode
  content: ReactNode
  selectionBar?: ReactNode
  children?: ReactNode
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-5">
      {toolbar && <div data-slot="workspace-toolbar">{toolbar}</div>}
      <div data-slot="workspace-content" className="min-h-0 flex-1">
        {content}
      </div>
      {selectionBar && <div data-slot="workspace-selection-bar">{selectionBar}</div>}
      {children}
    </div>
  )
}
