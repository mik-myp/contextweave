import originalFileSystem from 'original-fs'
import { prepareAppInstaller } from './app-update-installer'

/** Keep Electron's ASAR virtual filesystem out of installer inspection and cleanup. */
export function prepareElectronAppInstaller(
  options: Omit<Parameters<typeof prepareAppInstaller>[0], 'fileSystem'>,
  dependencies?: Parameters<typeof prepareAppInstaller>[1],
) {
  return prepareAppInstaller({ ...options, fileSystem: originalFileSystem.promises }, dependencies)
}
