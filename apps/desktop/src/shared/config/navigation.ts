export const appRoutes = {
  environments: '/environments',
  proxies: '/proxies',
  kernels: '/kernels',
  activity: '/activity',
  settings: '/settings',
  fingerprints: '/fingerprints',
  about: '/settings/about',
} as const

export const pageLabels: Record<string, string> = {
  [appRoutes.environments]: '环境',
  [appRoutes.proxies]: '代理',
  [appRoutes.kernels]: '内核',
  [appRoutes.activity]: '日志查看',
  [appRoutes.settings]: '设置',
  [appRoutes.fingerprints]: '指纹策略',
  [appRoutes.about]: '关于 ContextWeave',
}
