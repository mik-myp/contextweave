export const lifecycleMessages = {
  'error.KERNEL_VERSION_MISMATCH':
    'The executable version differs from the version pinned to this environment. Startup was stopped. Install the matching release.',

  'error.CUSTOM_SOURCE_DETAILS_REQUIRED':
    'Custom sources require a kernel version, trusted SHA-256, and confirmation of the source and license.',
  'error.ADAPTER_UNSUPPORTED':
    'This kernel version has no compatible adapter. Choose a supported version.',

  'error.PLATFORM_UNSUPPORTED':
    'This kernel release does not support this platform or architecture.',
  'error.DOWNLOAD_FAILED': 'Kernel download failed. Check your network and retry.',
  'error.DOWNLOAD_TIMEOUT': 'Download timed out. Please retry.',
  'error.DOWNLOAD_SOURCE_INVALID': 'Download blocked: the source is not in the trusted catalog.',
  'error.PACKAGE_SIZE_MISMATCH': 'The downloaded package size is incorrect. Please retry.',
  'error.PACKAGE_HASH_MISMATCH':
    'SHA-256 verification failed. Installation was blocked. Please download again.',
  'error.ARCHIVE_UNSAFE': 'The archive contains unsafe paths or excessive content and was blocked.',
  'error.ARCHIVE_INVALID': 'Invalid browser archive structure. Download it again.',
  'error.EXECUTABLE_INVALID': 'The package does not contain a valid browser executable.',
  'error.ARCHIVE_MOUNT_FAILED':
    'Could not mount the kernel disk image. Eject any mounted image of the same version, then retry.',
  'error.ARCHITECTURE_MISMATCH': 'The browser architecture does not match this platform.',
  'error.INSTALL_FAILED':
    'Kernel installation failed. Existing installs and environment data are retained.',
  'error.PROXY_TEST_FAILED': 'Proxy authentication or HTTPS request failed. Check proxy settings.',
  'error.PROXY_TEST_TIMEOUT': 'Proxy connection test timed out. Check the network.',

  'life.active': 'Environments',
  'life.trash': 'Trash',
  'life.restore': 'Restore',
  'life.restored': 'Environment restored',
  'life.trashedAt': 'Moved to trash',
  'life.trashEmpty': 'Trash is empty',
  'life.trashHelp':
    'Configuration, history and browser data are retained. Restore to reopen an environment; permanent deletion is not available in this stage.',
  'life.preflight': 'Launch preflight',
  'life.preflightSaved':
    'Checks the saved configuration. Save changes first; launching always runs these checks again.',
  'life.preflightNew':
    'Save the environment to inspect its preflight. Launching checks the kernel, proxy, credentials and data directory.',
  'life.preflightReady': 'Ready to launch',
  'life.preflightBlocked': 'Resolve these issues before launching',
  'life.preflightCheck': 'Check again',
  'life.revision': 'Configuration revision',
  'life.native': 'Native isolated environment',
  'life.nativeHelp':
    'Uses a local Chromium browser and a separate data directory. Verified engine-level fingerprint changes are not available.',
  'life.cap.unverified': 'Unverified',
  'life.cap.verified': 'Verified',
  'life.cap.unsupported': 'Unsupported',
  'life.cap.failed': 'Verification failed',
  'life.capHelp':
    'Declared capabilities are separate from version-specific observations. Unverified does not mean supported.',
  'life.sessions': 'Browser sessions',
  'life.operations': 'Operations',
  'life.endedAt': 'Ended',
  'life.phase': 'Phase',
  'life.result': 'Result',
  'life.startedAt': 'Started',
  'life.kind': 'Operation',
  'life.orphans': 'Unassociated data directories',
  'life.orphansHelp':
    'These directories have no matching environment record. They are listed for inspection and are not automatically removed or recovered.',
  'life.orphansEmpty': 'No unassociated directories found.',
  'life.op.start': 'Start',
  'life.op.stop': 'Stop',
  'life.op.recover': 'Recover runtime',
  'life.op.create': 'Create',
  'life.op.update': 'Update configuration',
  'life.op.trash': 'Move to trash',
  'life.op.restore': 'Restore',
  'life.op.install': 'Install kernel',
  'life.result.running': 'Running',
  'life.result.succeeded': 'Succeeded',
  'life.result.failed': 'Failed',
  'life.result.cancelled': 'Cancelled',
  'life.phase.queued': 'Queued',
  'life.phase.preflight': 'Preflight',
  'life.phase.launch': 'Launching browser',
  'life.phase.configure': 'Applying settings',
  'life.phase.completed': 'Completed',
  'life.phase.failed': 'Failed',
  'life.phase.interrupted': 'Client interrupted',
  'life.phase.ended': 'Ended',
  'life.phase.legacy': 'Legacy record',
  'life.phase.running': 'Running',
  'life.phase.starting': 'Starting',
  'life.phase.stopping': 'Stopping',
  'error.CONFIG_INVALID': 'The environment configuration is invalid. Review and save it again.',
  'error.ENVIRONMENT_TRASHED': 'Restore this environment from trash first.',
  'error.KERNEL_UNAVAILABLE':
    'No available kernel. Install Chrome, Edge or Chromium on this device.',
  'error.PROVIDER_UNVERIFIED':
    'This fingerprint provider has not been qualified for launch or installation.',
  'error.PLATFORM_MISMATCH':
    'This environment was created for a different platform or architecture.',
  'error.RUNTIME_BUSY': 'The browser still owns this environment. Stop it first.',
  'error.ENVIRONMENT_BUSY':
    'Stop the browser and complete recovery before editing or moving to trash.',
  'error.RECOVERY_REQUIRED': 'Previous runtime state requires recovery.',
  'error.RECOVERY_MANUAL_REQUIRED':
    'A previous process is still alive. Close that browser manually and retry. Saved PIDs alone are not used to terminate processes.',
  'error.RECOVERY_LOCK_UNREADABLE':
    'The runtime lock is unreadable. Inspect it after confirming the browser is closed.',
  'error.PROXY_MISSING': 'The selected proxy no longer exists. Choose another proxy.',
  'error.PROXY_UNREACHABLE':
    'Cannot connect to the proxy. Check its address and network; direct fallback is disabled.',
  'error.PROXY_IN_USE':
    'This proxy is referenced by active or trashed environments. Remove those references first.',
  'error.CREDENTIAL_UNAVAILABLE':
    'Proxy credentials cannot be decrypted. Save the password again or check system secure storage.',
  'error.CREDENTIAL_STORE_UNREADABLE':
    'The credential store cannot be read. The original file is preserved.',
  'error.DIRECTORY_UNWRITABLE':
    'The browser data directory is not writable. Check its permissions and existence.',
  'error.LOW_DISK': 'Insufficient disk space. Free up space and retry.',
  'error.NATIVE_MODE':
    'Native isolation mode does not claim verified engine-level fingerprint modifications.',
  'error.VERSION_CHANGED':
    'The local browser version changed. Launching may upgrade its profile format.',
  'error.LEGACY_SETTINGS_UNSUPPORTED':
    'The saved configuration contains settings unsupported by this kernel.',
  'error.CONFIG_CONFLICT':
    'Another operation changed this configuration. Preserve your input and reopen the latest revision before saving.',
  'error.OPERATION_IN_PROGRESS':
    'Another operation is running for this environment. Retry when it finishes.',
  'error.ALREADY_RUNNING': 'This environment is already starting or running.',
  'error.CANCELLED': 'Operation cancelled.',
  'error.START_FAILED': 'Browser launch failed. Review preflight and runtime history.',
  'error.CONTROL_TIMEOUT':
    'The browser control connection timed out. Check the kernel or recover the environment.',
  'error.STOP_TIMEOUT':
    'The browser did not stop. Its lock is retained; close it manually before recovery.',
  'error.SPAWN_FAILED': 'Cannot create the browser process. Check the kernel and permissions.',
  'error.NOT_FOUND': 'This record no longer exists. Reload the page.',
  'error.INVALID_INPUT': 'Invalid request. Review your input.',
  'error.COMMAND_FAILED':
    'The operation could not be completed. Check the environment state and retry.',
  'error.CLIENT_INTERRUPTED': 'The client exited before the operation completed.',
  'error.USER_STOPPED': 'Stopped by the user.',
  'error.BROWSER_CLOSED': 'Browser closed normally.',
  'error.PROCESS_CRASHED': 'The browser process exited unexpectedly.',
  'error.PROCESS_SIGNAL': 'The browser process was terminated by an external signal.',
} as const
