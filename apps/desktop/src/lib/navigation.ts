/** Keep the parent module selected on its child routes without matching sibling prefixes. */
export function isRouteActive(pathname: string, route: string): boolean {
  return pathname === route || (route !== '/' && pathname.startsWith(route + '/'))
}
