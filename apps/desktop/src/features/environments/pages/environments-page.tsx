import * as React from 'react'
import { useNavigate } from '@tanstack/react-router'
import { defaultCommonEnvironmentConfig, protocolVersion } from '@contextweave/contracts'
import type { EnvironmentSummary } from '@contextweave/contracts'
import { useAppData } from '@/app/use-app-data'
import { appRoutes } from '@/shared/config/navigation'
import { WorkspacePage } from '@/components/layout/workspace-page'
import { EnvironmentActionBar } from '../components/environment-action-bar'
import { EnvironmentCreateDialog } from '../components/environment-create-dialog'
import { EnvironmentDeleteDialog } from '../components/environment-delete-dialog'
import { EnvironmentEditDialog } from '../components/environment-edit-dialog'
import { EnvironmentTable } from '../components/environment-table'

export function EnvironmentsPage() {
  const {
    environments,
    proxies,
    kernels,
    selectedEnvironment,
    setSelectedEnvironment,
    setNotice,
    refresh,
    loading,
    perform,
    setLastWorkerResult,
  } = useAppData()
  const navigate = useNavigate()
  const [name, setName] = React.useState('我的浏览环境')
  const [kernelId, setKernelId] = React.useState('standard-chromium')
  const [proxyId, setProxyId] = React.useState('')
  const [createOpen, setCreateOpen] = React.useState(false)
  const [editing, setEditing] = React.useState<EnvironmentSummary>()
  const [editName, setEditName] = React.useState('')
  const [editProxyId, setEditProxyId] = React.useState('')
  const [deleteTarget, setDeleteTarget] = React.useState<EnvironmentSummary>()
  const [saving, setSaving] = React.useState(false)
  const selected = environments.find((item) => item.id === selectedEnvironment)

  const create = async () => {
    if (saving) return
    setSaving(true)
    const result = await window.contextweave.environment.create({
      name,
      kernelId,
      proxyId: proxyId || undefined,
      commonConfig: defaultCommonEnvironmentConfig,
      kernelConfig: {},
    })
    if (result.ok) {
      setNotice({ kind: 'success', message: `环境“${result.data.name}”已创建` })
      setName('我的浏览环境')
      setCreateOpen(false)
      await refresh()
      setSelectedEnvironment(result.data.id)
    } else setNotice({ kind: 'error', message: result.message })
    setSaving(false)
  }

  const openEdit = (environment: EnvironmentSummary) => {
    setEditing(environment)
    setEditName(environment.name)
    setEditProxyId(environment.proxyId ?? '')
  }

  const update = async () => {
    if (!editing || saving) return
    setSaving(true)
    const result = await window.contextweave.environment.update({
      version: 1,
      environmentId: editing.id,
      name: editName,
      proxyId: editProxyId || null,
    })
    if (result.ok) {
      setNotice({ kind: 'success', message: '环境配置已更新' })
      setEditing(undefined)
      await refresh()
    } else setNotice({ kind: 'error', message: result.message })
    setSaving(false)
  }

  const remove = async () => {
    if (!deleteTarget || saving) return
    setSaving(true)
    const result = await window.contextweave.environment.delete(deleteTarget.id)
    if (result.ok) {
      setNotice({ kind: 'success', message: `环境“${deleteTarget.name}”已删除` })
      setDeleteTarget(undefined)
      await refresh()
    } else setNotice({ kind: 'error', message: result.message })
    setSaving(false)
  }

  const canManage = (environment: EnvironmentSummary) =>
    !['starting', 'running', 'stopping', 'needs-recovery'].includes(environment.status)
  const start = () => {
    if (selected)
      void perform(() => window.contextweave.environment.start(selected.id), '环境已启动')
  }
  const stop = () => {
    if (selected)
      void perform(() => window.contextweave.environment.stop(selected.id), '环境已停止')
  }
  const recover = () => {
    if (selected)
      void perform(() => window.contextweave.environment.recover(selected.id), '环境已恢复')
  }
  const smoke = async () => {
    if (!selected || selected.status !== 'running') return
    const result = await window.contextweave.worker.runSmoke({
      protocolVersion,
      taskId: `smoke-${Date.now()}`,
      environmentId: selected.id,
      kind: 'browser-smoke',
      input: { url: 'https://example.com', timeoutMs: 30000 },
    })
    if (result.ok && result.data.ok) {
      setLastWorkerResult(
        `成功读取页面标题：${result.data.title ?? '无标题'}${result.data.screenshotPath ? `；截图：${result.data.screenshotPath}` : ''}`,
      )
      void navigate({ to: appRoutes.activity })
    } else {
      setNotice({
        kind: 'error',
        message: result.ok ? (result.data.errorMessage ?? 'Worker 执行失败') : result.message,
      })
    }
  }

  return (
    <WorkspacePage
      content={
        <EnvironmentTable
          environments={environments}
          proxies={proxies}
          selectedEnvironment={selectedEnvironment}
          onSelect={setSelectedEnvironment}
          canManage={canManage}
          onEdit={openEdit}
          onDelete={setDeleteTarget}
          loading={loading}
          onRefresh={() => void refresh()}
          onCreate={() => setCreateOpen(true)}
        />
      }
      selectionBar={
        selected ? (
          <EnvironmentActionBar
            selected={selected}
            proxies={proxies}
            onStart={start}
            onStop={stop}
            onRecover={recover}
            onSmoke={() => void smoke()}
          />
        ) : undefined
      }
    >
      <EnvironmentCreateDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        name={name}
        setName={setName}
        kernelId={kernelId}
        setKernelId={setKernelId}
        proxyId={proxyId}
        setProxyId={setProxyId}
        kernels={kernels}
        proxies={proxies}
        saving={saving}
        onCreate={() => void create()}
      />
      <EnvironmentEditDialog
        editing={editing}
        onOpenChange={(open) => !open && setEditing(undefined)}
        editName={editName}
        setEditName={setEditName}
        editProxyId={editProxyId}
        setEditProxyId={setEditProxyId}
        proxies={proxies}
        saving={saving}
        onUpdate={() => void update()}
      />
      <EnvironmentDeleteDialog
        target={deleteTarget}
        saving={saving}
        onOpenChange={(open) => !open && setDeleteTarget(undefined)}
        onRemove={() => void remove()}
      />
    </WorkspacePage>
  )
}
