import type { Dispatch, SetStateAction } from 'react'
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
import type { KernelSummary, ProxySummary } from '@/shared/types/app'

export function EnvironmentCreateDialog({
  open,
  onOpenChange,
  name,
  setName,
  kernelId,
  setKernelId,
  proxyId,
  setProxyId,
  kernels,
  proxies,
  saving,
  onCreate,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  name: string
  setName: Dispatch<SetStateAction<string>>
  kernelId: string
  setKernelId: Dispatch<SetStateAction<string>>
  proxyId: string
  setProxyId: Dispatch<SetStateAction<string>>
  kernels: KernelSummary[]
  proxies: ProxySummary[]
  saving: boolean
  onCreate: () => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>新建环境</DialogTitle>
          <DialogDescription>配置后将创建独立的本地用户目录。</DialogDescription>
        </DialogHeader>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="environment-name">名称</FieldLabel>
            <Input
              id="environment-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="environment-kernel">浏览器内核</FieldLabel>
            <Select value={kernelId} onValueChange={(value) => setKernelId(value ?? '')}>
              <SelectTrigger id="environment-kernel" className="w-full">
                <SelectValue placeholder="选择内核" />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {kernels.map((kernel) => (
                    <SelectItem key={kernel.id} value={kernel.id}>
                      {kernel.label} · {kernel.version}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
          <Field>
            <FieldLabel htmlFor="environment-proxy">代理（可选）</FieldLabel>
            <Select
              value={proxyId || 'none'}
              onValueChange={(value) => setProxyId(value === 'none' ? '' : (value ?? ''))}
            >
              <SelectTrigger id="environment-proxy" className="w-full">
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
          <Button onClick={onCreate} disabled={!name.trim() || saving}>
            {saving && <Spinner />}
            创建环境
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
