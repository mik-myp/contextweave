import assert from 'node:assert/strict'
import { join } from 'node:path'
import {
  hardenElectron,
  packagedLayout,
  qualifiedElectronVersion,
  signAdHocBundle,
  verifyEmbeddedIntegrity,
} from './electron-fuses.mjs'

export default async function afterPack(context) {
  assert.equal(context.packager.config.electronFuses, undefined, 'DUPLICATE_FUSE_CONFIGURATION')
  assert.equal(context.packager.config.asar, true, 'ASAR_REQUIRED')
  assert.equal(
    context.packager.info.framework.version,
    qualifiedElectronVersion,
    'UNQUALIFIED_ELECTRON_VERSION',
  )
  assert.equal(context.packager.appInfo.productFilename, 'ContextWeave', 'UNEXPECTED_PRODUCT_NAME')
  const platform = context.electronPlatformName
  const archive =
    platform === 'darwin'
      ? join(context.appOutDir, 'ContextWeave.app/Contents/Resources/app.asar')
      : join(context.appOutDir, 'resources/app.asar')
  const layout = packagedLayout(archive, platform)
  await verifyEmbeddedIntegrity(layout)
  await hardenElectron(layout.fuseBinary)
  if (platform === 'darwin') await signAdHocBundle(layout.bundle)
  console.log(
    JSON.stringify({
      packagedFuses: 'all-nine-verified',
      platform,
      electronVersion: qualifiedElectronVersion,
      signature: platform === 'darwin' ? 'ad-hoc-not-distribution-identity' : 'unchanged',
    }),
  )
}
