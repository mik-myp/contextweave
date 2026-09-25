export const lifecycleMessages = {
  'env.ipLocaleAuto': 'Follow exit IP (on each launch)',
  'env.ipLocaleTitle': 'Language and timezone from exit IP',
  'env.ipLocaleDescription':
    'Automatic mode queries IPWho.is through the selected direct or proxy route before each launch. You can also detect once and fill fixed values. The provider sees your exit IP, not environment names or proxy passwords. Language is a regional recommendation and can be overridden. Proxy failures never fall back to direct access; failed detection blocks automatic-mode launches.',
  'env.ipLocaleDetect': 'Detect current route',
  'env.ipLocaleDetecting': 'Detecting…',
  'env.ipLocaleFailed': 'Could not detect IP region',
  'env.ipLocaleProxy': 'Proxy exit result',
  'env.ipLocaleDirect': 'Direct exit result',
  'env.ipLocaleResultHint':
    'This is a regional recommendation for this request, not language identification. Check multilingual regions or rotating proxies manually. Save the environment after filling fixed values.',
  'env.ipLocaleApply': 'Fill fixed language and timezone',
  'error.IP_LOCALE_FAILED':
    'Could not detect the IP region through this route. Check the network or proxy and retry, or choose language/timezone manually. No direct or system fallback was used.',
  'error.IP_LOCALE_TIMEOUT': 'IP region detection timed out. Retry or use manual settings.',
  'error.IP_LOCALE_RATE_LIMITED':
    'The IP region provider rate-limited this request. Retry later or use manual settings.',
  'error.IP_LOCALE_INVALID_RESPONSE':
    'The provider did not return valid language/timezone data. Retry or set values manually.',
  'error.IP_LOCALE_BUSY':
    'IP region detection is already running. Wait for completion or cancel and retry.',

  'proxy.typeHelp':
    'HTTP proxies can carry HTTPS sites via CONNECT. HTTPS here means TLS to the proxy server itself; match the protocol supplied by your provider.',
  'error.UPDATE_SIGNATURE_INVALID':
    'The application signature could not be verified; automatic installation stopped.',
  'error.UPDATE_UNMOUNT_FAILED':
    'The installer image could not be safely detached. Check file usage and retry.',
  'error.APP_UPDATING': 'The app is preparing an update; try again later.',
  'error.UPDATE_DEVELOPMENT_MODE': 'Automatic installation is unavailable in development mode.',
  'error.UPDATE_PORTABLE_UNSUPPORTED':
    'Windows portable editions require the release download for updating.',
  'error.UPDATE_INSTALL_LOCATION':
    'This installation location is unsupported; use an installed Windows edition or a writable macOS app directory.',
  'error.UPDATE_INSTALL_PERMISSION':
    'The installation directory is not writable or lacks space. The current app was not replaced.',
  'error.UPDATE_INSTALL_INVALID':
    'The application identity, version or bundle structure is invalid; installation stopped.',
  'error.UPDATE_SIGNATURE_MISMATCH':
    'The update signing identity differs from the installed app; update rejected.',
  'error.UPDATE_QUIT_TIMEOUT': 'Timed out waiting for the old app to exit; it was not replaced.',
  'error.UPDATE_REPLACE_FAILED':
    'Replacement failed; the original app was retained or restored. Check installation permissions.',
  'error.UPDATE_ROLLBACK_FAILED':
    'Replacement and rollback could not complete. The old app is retained inside .contextweave-update-* next to the install; keep that backup and reinstall from the release page.',
  'error.UPDATE_RESTART_FAILED':
    'The update was placed in the install location but the OS could not launch it. Follow OS verification/permission prompts; the previous app backup is retained.',
  'proxy.httpOnly': 'HTTP reachable; HTTPS is not verified',
  'proxy.ipUnavailable': 'Exit IP lookup unavailable; connectivity was verified separately',
  'proxy.import.title': 'Import proxies',
  'proxy.import.description': 'One proxy per line. Supports HTTP, HTTPS and SOCKS5.',
  'proxy.import.defaultType': 'Default protocol',
  'proxy.import.lines': 'Proxy list',
  'proxy.import.help':
    'Use scheme://user:password@host:port or host:port:username:password. Up to 200 lines; percent-encode special characters such as @, # and % in URI credentials. Existing protocol/host/port/username combinations are skipped without replacing passwords.',
  'proxy.import.limit': 'Enter up to 200 lines and 65,536 characters.',
  'proxy.import.summary':
    'Created {created}, skipped {skipped}, failed {failed}. Failed lines are retained for correction and retry.',
  'proxy.import.line': 'Line {line}',
  'proxy.import.duplicate': 'Connection already exists; skipped',
  'proxy.import.invalid': 'Invalid protocol, host, port or credentials',
  'proxy.import.secureUnavailable': 'System secure storage is unavailable; password was not saved',
  'proxy.import.saveFailed': 'Save failed; retry the remaining lines',
  'proxy.import.submit': 'Import proxies',
  'proxy.cleanup.title': 'Credential cleanup is pending',
  'proxy.cleanup.description':
    '{count} credentials await safe cleanup. Committed proxy settings remain valid; credentials still in use will not be removed. Retry after fixing storage access, or on the next app launch.',
  'proxy.cleanup.temporary':
    'Some temporary files could not be removed. Check permissions and file locks in the app data directory.',
  'proxy.cleanup.retry': 'Retry cleanup',
  'proxy.cleanup.failed': 'Credential maintenance is unavailable. Check storage access and retry.',
  'error.UPDATE_RELEASE_INVALID':
    'Release information is invalid or is not a usable stable release. Try again later.',
  'error.UPDATE_CHECKSUM_UNAVAILABLE':
    'The installer has no trusted SHA-256 digest. Wait for the publisher to complete the release metadata.',
  'error.UPDATE_RATE_LIMITED': 'GitHub has limited this request. Check again later.',
  'error.UPDATE_CHECK_FAILED': 'Unable to check for updates. Check your connection and retry.',
  'error.UPDATE_TIMEOUT': 'The update request timed out. Check your connection and retry.',
  'error.UPDATE_FAILED':
    'The update operation failed. Check the connection, disk space and directory permissions, then retry.',
  'error.UPDATE_NOT_AVAILABLE': 'Check for updates first to find a compatible installer.',
  'error.UPDATE_NOT_READY':
    'The installer is not ready. Finish downloading and verification first.',
  'error.UPDATE_FILE_INVALID':
    'The downloaded installer is missing or modified. Download it again.',
  'error.UPDATE_ENVIRONMENTS_ACTIVE':
    'Stop running environments and complete recovery before opening the installer.',
  'error.UPDATE_OPEN_FAILED':
    'The system could not open the installer or release notes. Please retry.',

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
  'error.PROXY_CREDENTIAL_TARGET_CHANGED':
    'The proxy protocol, host, port, or username changed. Re-enter the password or explicitly clear the saved password before testing or saving.',
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
  'error.BROWSER_PREFERENCES_INVALID':
    'Browser preferences are damaged or have an unsupported structure. The original is preserved. Back up this environment, inspect or repair Default/Preferences, then retry. Sessions are not automatically reset.',
  'error.BROWSER_PREFERENCES_TOO_LARGE':
    'Browser Preferences exceeds the 16 MiB safe read limit. The original is preserved. Back up the environment and inspect unexpected growth before retrying.',
  'error.BROWSER_PROFILE_IO_FAILED':
    'Browser preferences could not be safely read or written. Check disk space, permissions, and file locks, then retry. Existing preferences are not cleared.',
  'error.BROWSER_PROFILE_UNSAFE':
    'The browser preferences directory or file is not a supported regular directory/file. Writing stopped. Back up the environment and inspect links or unusual files.',
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
  'kernel.remove': 'Delete kernel',
  'kernel.removed': 'Kernel deleted. Environment settings and browser data were preserved.',
  'kernel.removeTitle': 'Delete {name}?',
  'kernel.removeDescription':
    'Deletes downloaded kernel files only, not settings, tabs or website data. {count} environments (including trash) reference this kernel; download the same version again before starting them. Running environments or those needing recovery block deletion. Custom sources may require a new download URL.',
  'kernel.removalPending': 'Deletion incomplete · retry',
  'error.KERNEL_NOT_MANAGED':
    'Only kernels downloaded by this app can be deleted, not system browsers or external installations.',
  'error.KERNEL_PATH_UNSAFE':
    'Installation path validation failed. No files were deleted. Check for moved directories or symbolic links.',
  'error.KERNEL_REMOVE_FAILED':
    'Deletion is incomplete and this kernel is disabled. Close programs using its files, check directory permissions and retry deletion.',
  'error.KERNEL_REMOVAL_PENDING':
    'Retry the incomplete deletion in the kernel list before downloading this kernel again.',
  'life.op.remove-kernel': 'Delete kernel',
  'error.KERNEL_IN_USE':
    'This kernel is used by an environment that is starting, running, stopping or needs recovery. Stop and recover the affected environments before retrying deletion.',
  'kernel.pinnedVersion': 'Pinned by an environment',
} as const
