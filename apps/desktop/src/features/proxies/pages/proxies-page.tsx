import * as React from 'react'
import type { ProxyConfig, ProxyType } from '@contextweave/contracts'
import { useAppData } from '@/app/use-app-data'
import { WorkspacePage } from '@/components/layout/workspace-page'
import type { ProxySummary } from '@/shared/types/app'
import { ProxyDeleteDialog } from '../components/proxy-delete-dialog'
import { ProxyFormDialog } from '../components/proxy-form-dialog'
import { ProxyTable } from '../components/proxy-table'

export function ProxiesPage() {
  const { proxies, setNotice, refresh, loading } = useAppData()
  const [editing, setEditing] = React.useState<string>()
  const [dialogOpen, setDialogOpen] = React.useState(false)
  const [deleteTarget, setDeleteTarget] = React.useState<ProxySummary>()
  const [saving, setSaving] = React.useState(false)
  const [type, setType] = React.useState<ProxyType>('http')
  const [host, setHost] = React.useState('127.0.0.1')
  const [port, setPort] = React.useState('8080')
  const [username, setUsername] = React.useState('')
  const [password, setPassword] = React.useState('')

  const save = async () => {
    if (saving) return
    setSaving(true)
    const config: ProxyConfig = { type, host, port: Number(port), username: username || undefined }
    const result = await window.contextweave.proxy.save({
      proxyId: editing,
      config,
      password: password || undefined,
    })
    if (result.ok) {
      setNotice({ kind: 'success', message: '代理配置已保存，密码仅保存在系统安全存储中。' })
      setEditing(undefined)
      setDialogOpen(false)
      setPassword('')
      await refresh()
    } else setNotice({ kind: 'error', message: result.message })
    setSaving(false)
  }

  const edit = (proxy: ProxySummary) => {
    setEditing(proxy.proxyId)
    setType(proxy.type as ProxyType)
    setHost(proxy.host)
    setPort(String(proxy.port))
    setUsername(proxy.username ?? '')
    setPassword('')
    setDialogOpen(true)
  }

  const add = () => {
    setEditing(undefined)
    setType('http')
    setHost('127.0.0.1')
    setPort('8080')
    setUsername('')
    setPassword('')
    setDialogOpen(true)
  }

  const remove = async () => {
    if (!deleteTarget || saving) return
    setSaving(true)
    const result = await window.contextweave.proxy.delete(deleteTarget.proxyId)
    if (result.ok) {
      setNotice({ kind: 'success', message: '代理已删除' })
      await refresh()
    } else setNotice({ kind: 'error', message: result.message })
    setDeleteTarget(undefined)
    setSaving(false)
  }

  return (
    <WorkspacePage
      content={
        <ProxyTable
          proxies={proxies}
          onEdit={edit}
          onDelete={setDeleteTarget}
          loading={loading}
          onRefresh={() => void refresh()}
          onCreate={add}
        />
      }
    >
      <ProxyFormDialog
        open={dialogOpen}
        editing={editing}
        onOpenChange={(open) => {
          setDialogOpen(open)
          if (!open) setEditing(undefined)
        }}
        type={type}
        setType={setType}
        host={host}
        setHost={setHost}
        port={port}
        setPort={setPort}
        username={username}
        setUsername={setUsername}
        password={password}
        setPassword={setPassword}
        saving={saving}
        onSave={() => void save()}
      />
      <ProxyDeleteDialog
        target={deleteTarget}
        saving={saving}
        onOpenChange={(open) => !open && setDeleteTarget(undefined)}
        onRemove={() => void remove()}
      />
    </WorkspacePage>
  )
}
