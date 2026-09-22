import { useAppData } from '@/app/use-app-data'
import { WorkspacePage } from '@/components/layout/workspace-page'
import { KernelList } from '../components/kernel-list'
import { KernelToolbar } from '../components/kernel-toolbar'

export function KernelsPage() {
  const { kernels, setNotice, refresh } = useAppData()

  const install = async (kernelId: string) => {
    const result = await window.contextweave.kernel.install(kernelId)
    if (result.ok) {
      setNotice({ kind: 'success', message: '内核已安装并通过校验' })
      await refresh()
    } else setNotice({ kind: 'error', message: result.message })
  }

  return (
    <WorkspacePage
      toolbar={<KernelToolbar count={kernels.length} />}
      content={<KernelList kernels={kernels} onInstall={(kernelId) => void install(kernelId)} />}
    />
  )
}
