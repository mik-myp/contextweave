/** libuv on older Windows runtimes can leave the upper volume-serial bits undefined. */
export function sameFileIdentity(
  left: { dev: bigint; ino: bigint },
  right: { dev: bigint; ino: bigint },
  platform: NodeJS.Platform = process.platform,
): boolean {
  const device = (dev: bigint) => (platform === 'win32' ? BigInt.asUintN(32, dev) : dev)
  return left.ino === right.ino && device(left.dev) === device(right.dev)
}
