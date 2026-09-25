import { createHashHistory, createRouter } from '@tanstack/react-router'
import { routeTree } from './routeTree.gen'
import { RouteError } from './app/route-error'

const hashHistory = createHashHistory()

export const router = createRouter({
  routeTree,
  defaultErrorComponent: RouteError,
  history: hashHistory,
})

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
