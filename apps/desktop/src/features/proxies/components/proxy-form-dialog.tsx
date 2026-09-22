import type { Dispatch, SetStateAction } from 'react'
import type { ProxyType } from '@contextweave/contracts'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'

export function ProxyFormDialog({
  open,
  editing,
  onOpenChange,
  type,
  setType,
  host,
  setHost,
  port,
  setPort,
  username,
  setUsername,
  password,
  setPassword,
  saving,
  onSave,
}: {
  open: boolean
  editing?: string
  onOpenChange: (open: boolean) => void
  type: ProxyType
  setType: Dispatch<SetStateAction<ProxyType>>
  host: string
  setHost: Dispatch<SetStateAction<string>>
  port: string
  setPort: Dispatch<SetStateAction<string>>
  username: string
  setUsername: Dispatch<SetStateAction<string>>
  password: string
  setPassword: Dispatch<SetStateAction<string>>
  saving: boolean
  onSave: () => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editing ? '编辑代理' : '添加代理'}</DialogTitle>
          <DialogDescription>HTTP、HTTPS 或 SOCKS5。密码仅保存在系统安全存储中。</DialogDescription>
        </DialogHeader>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="proxy-type">类型</FieldLabel>
            <Select value={type} onValueChange={(value) => setType((value ?? 'http') as ProxyType)}>
              <SelectTrigger id="proxy-type" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="http">HTTP</SelectItem>
                  <SelectItem value="https">HTTPS</SelectItem>
                  <SelectItem value="socks5">SOCKS5</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
          <div className="grid grid-cols-[1fr_110px] gap-2">
            <Field>
              <FieldLabel htmlFor="proxy-host">主机</FieldLabel>
              <Input
                id="proxy-host"
                value={host}
                onChange={(event) => setHost(event.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="proxy-port">端口</FieldLabel>
              <Input
                id="proxy-port"
                type="number"
                min="1"
                max="65535"
                value={port}
                onChange={(event) => setPort(event.target.value)}
              />
            </Field>
          </div>
          <Field>
            <FieldLabel htmlFor="proxy-username">用户名（可选）</FieldLabel>
            <Input
              id="proxy-username"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="proxy-password">密码（可选）</FieldLabel>
            <Input
              id="proxy-password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder={editing ? '留空表示保持原密码' : ''}
            />
          </Field>
        </FieldGroup>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button onClick={onSave} disabled={!host.trim() || !port || saving}>
            {saving && <Spinner />}
            保存代理
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
