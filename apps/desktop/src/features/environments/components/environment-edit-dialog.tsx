import type { Dispatch, SetStateAction } from 'react'
import type { EnvironmentSummary } from '@contextweave/contracts'
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
import type { ProxySummary } from '@/shared/types/app'

export function EnvironmentEditDialog({
  editing,
  onOpenChange,
  editName,
  setEditName,
  editProxyId,
  setEditProxyId,
  proxies,
  saving,
  onUpdate,
}: {
  editing?: EnvironmentSummary
  onOpenChange: (open: boolean) => void
  editName: string
  setEditName: Dispatch<SetStateAction<string>>
  editProxyId: string
  setEditProxyId: Dispatch<SetStateAction<string>>
  proxies: ProxySummary[]
  saving: boolean
  onUpdate: () => void
}) {
  return (
    <Dialog open={Boolean(editing)} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>编辑环境</DialogTitle>
          <DialogDescription>内核和用户目录属于环境身份，编辑时保持不变。</DialogDescription>
        </DialogHeader>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="edit-environment-name">名称</FieldLabel>
            <Input
              id="edit-environment-name"
              value={editName}
              onChange={(event) => setEditName(event.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="edit-environment-proxy">代理（可选）</FieldLabel>
            <Select
              value={editProxyId || 'none'}
              onValueChange={(value) => setEditProxyId(value === 'none' ? '' : (value ?? ''))}
            >
              <SelectTrigger id="edit-environment-proxy" className="w-full">
                <SelectValue placeholder="不使用代理" />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="none">不使用代理</SelectItem>
                  {proxies.map((proxy) => (
                    <SelectItem key={proxy.proxyId} value={proxy.proxyId}>
                      {proxy.type.toUpperCase()} · {proxy.host}:{proxy.port}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
        </FieldGroup>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button onClick={onUpdate} disabled={!editName.trim() || saving}>
            {saving && <Spinner />}
            保存修改
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
