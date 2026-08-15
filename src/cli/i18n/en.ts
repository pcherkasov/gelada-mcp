/**
 * English message catalogue, and the source of truth for the key set.
 *
 * Only the CLI's own output belongs here. Everything an LLM reads — tool
 * descriptions, the server instructions, the guidance under docs/instructions,
 * the worker prompt scaffolding — stays in English wherever it is written:
 * those are tuned prompts, and a second copy drifting from the first is not a
 * cosmetic difference but a silent change in how delegation behaves.
 */
export const en = {
  // gelada --help and the command list
  'cli.description':
    'Local open-source MCP server delegating routine coding tasks to local worker agents',
  'cli.cmd.setup':
    'Scaffold Gelada MCP configuration directory, data paths, and default config file',
  'cli.cmd.doctor': 'Check that Gelada, Git and the worker CLI are ready to run tasks',
  'cli.cmd.config': 'Inspect, read, or set Gelada MCP configuration settings',
  'cli.cmd.task': 'Inspect, patch, or discard delegated tasks',
  'cli.cmd.taskInspect': 'Inspect metadata, status, diffs, or logs of a delegated task',
  'cli.cmd.taskPatch': 'Apply a revision or patch file to an active task',
  'cli.cmd.taskDiscard': 'Cancel a running task, terminate supervisors, and discard worktree changes',
  'cli.cmd.mcp': 'Manage and launch Gelada MCP server instance',
  'cli.cmd.mcpServe': 'Start Gelada MCP server using stdio transport',
  'cli.cmd.cleanup': 'Clean up obsolete task artifact bundles based on retention policies',
  'cli.cmd.models': 'List the worker models available for delegation',
  'cli.cmd.update': 'Check for a newer release and optionally install it',
  'cli.cmd.init': 'Write a starter .gelada/policy.yaml into the current repository',
  'cli.cmd.smoke': 'Delegate a throwaway task end to end and report whether it worked',
  'cli.cmd.debugBundle': 'Collect an environment snapshot for a bug report',

  // Shared option help
  'opt.json': 'Output as JSON',
  'opt.verbose': 'Include per-check details',

  // gelada (no arguments)
  'cli.bareInvocation':
    'gelada: starting the MCP server from a bare invocation. Configure the client with args ["mcp", "serve"] instead.',

  // doctor
  'doctor.title': '=== Gelada Diagnostic Check ===',
  'doctor.node.name': 'Node.js Version',
  'doctor.node.ok': 'Node.js {version}',
  'doctor.node.tooOld': 'Node.js {version} is below the required v{required}',
  'doctor.node.platform': 'Platform: {platform} {release} ({arch})',
  'doctor.node.fix': 'Install Node.js v{required} or newer.',
  'doctor.git.name': 'Git CLI',
  'doctor.git.missing': 'git was not found in PATH',
  'doctor.git.detail': 'Required for isolated worktrees (git worktree).',
  'doctor.git.fix': 'Install Git 2.30 or newer; Gelada isolates every task in a git worktree.',
  'doctor.config.name': 'Config Directory',
  'doctor.config.missing': 'Not created yet: {path}',
  'doctor.config.unwritable': 'Not readable/writable: {path}',
  'doctor.config.dirs': 'Config directory: {config}',
  'doctor.config.dataDir': 'Data directory:   {data}',
  'doctor.config.logDir': 'Log directory:    {log}',
  'doctor.config.fixSetup': 'Run "gelada setup" to scaffold configuration.',
  'doctor.config.fixPermissions': 'Fix permissions on {path}.',
  'doctor.registration.name': 'MCP Client Registration',
  'doctor.registration.unreadable': 'Could not read client configurations: {error}',
  'doctor.registration.none': 'No detected MCP client has Gelada registered',
  'doctor.registration.noneDetail':
    'Clients configured by hand, or ones Gelada does not detect, are not visible here.',
  'doctor.registration.noneFix':
    'Run "gelada setup" to register Gelada with the clients on this machine.',
  'doctor.registration.allBroken':
    'Registered launch command no longer exists ({count} client(s))',
  'doctor.registration.someBroken':
    '{broken} of {total} registrations point at a command that no longer exists',
  'doctor.registration.brokenDetail': '{client}: {command} — not found ({path})',
  'doctor.registration.brokenFix':
    'Run "gelada setup" to re-register with the current interpreter path.',
  'doctor.registration.okOne': '1 client registration resolves',
  'doctor.registration.okMany': '{count} client registrations resolve',
  'doctor.worker.name': 'Worker CLI',
  'doctor.worker.missing': '{command} was not found or failed to run',
  'doctor.worker.resolvedFrom': 'Resolved from {source}.',
  'doctor.worker.fix':
    'Install the Antigravity CLI and make sure it is in PATH, or point AGY_COMMAND at it.',
  'doctor.auth.name': 'Worker Authentication',
  'doctor.auth.ok': '{count} models available',
  'doctor.auth.unknown': 'Could not read the model list from the worker CLI',
  'doctor.auth.fix': 'Run "{command}" once in a terminal and sign in, then re-run "gelada doctor".',
  'doctor.details': '       Details:',
  'doctor.status': 'System Status: {status}',
  'doctor.statusHint': 'Run "gelada setup" to fix configuration, or address the items above.',
  'doctor.footer': 'Gelada {version} · {runtime} {nodeVersion}',
  'doctor.opt.noWorker': 'Skip worker CLI checks',
  'doctor.opt.strict': 'Exit non-zero if any check does not pass',

  // update
  'update.title': '=== Gelada Update Status ===',
  'update.current': 'Current version: v{version}',
  'update.latest': 'Latest version:  v{version}',
  'update.status': 'Status:          {status}',
  'update.upToDate': 'Up to date',
  'update.available': 'Update available',
  'update.checkFailed': 'Could not check for updates: {error}',
  'update.currentOnly': 'Current version: v{version}',
  'update.howTo': 'Run `gelada update --install` to upgrade, or do it yourself with:',
  'update.releaseNotes': 'Release notes: {url}',
  'update.starting': 'Updating from v{from} to v{to}...',
  'update.viaNpm': 'npm installation detected. Running npm install -g gelada-mcp@latest...',
  'update.npmDone': 'Update completed via npm.',
  'update.installing': 'Installing v{version} into {dir}...',
  'update.done': 'Update completed. {path} is now v{version}.',
  'update.failed': 'Update failed: {error}',
  'update.opt.install': 'Install the latest update if available',

  // setup
  'setup.permissions.heading': 'Worker permissions',
  'setup.permissions.body':
    'The Antigravity CLI cannot ask for tool approval when it runs headlessly,\n' +
    'and it ignores its own allow-rules in that mode. Gelada therefore starts it\n' +
    'with permission prompts disabled — without that, the worker cannot write a\n' +
    'single file.\n\n' +
    'What limits it instead: the worker only ever sees a disposable git worktree,\n' +
    'its environment is stripped of credentials, and terminal commands are\n' +
    'sandboxed. Your working tree is never exposed.\n\n' +
    'You can switch this off per project with workerAutoApprove: false in\n' +
    '.gelada/policy.yaml — delegation then stops working. See SECURITY.md §4.',
  'setup.permissions.nonInteractive': 'Proceeding with worker permissions enabled (non-interactive).',
  'setup.permissions.prompt': 'Continue with worker permissions enabled? [Y/n] ',
  'setup.uninstalled': '🗑️ Gelada MCP Client Uninstallation Completed',
  'setup.completed': '✅ Gelada MCP Environment Setup Completed',
  'setup.configDir': '   Config Directory: {path}',
  'setup.dataDir': '   Data Directory:   {path}',
  'setup.logDir': '   Log Directory:    {path}',
  'setup.clientUpdates': '   Client Updates:',
  'setup.notReady': '\nSetup finished, but delegation is not ready yet:',
  'setup.checkFailed': '   [fail] {name}: {message}',
  'setup.checkFix': '          → {remediation}',
  'setup.fixThenSmoke': '\nFix the above, then run "gelada smoke" to confirm.',
  'setup.skippedSmoke': '\nSkipped the delegation check. Run "gelada smoke" when you want it.',
  'setup.verifying': '\nVerifying delegation end to end...',
  'setup.opt.client': 'Target specific client configuration (claude, codex, antigravity, or all)',
  'setup.opt.uninstall': 'Remove Gelada from detected MCP client configurations',
  'setup.opt.yes': 'Assume yes for prompts (non-interactive)',
  'setup.opt.noSmoke': 'Skip the end-to-end delegation check',

  // language setting
  'config.language.invalid':
    'Unsupported language "{value}". Supported: {supported}. Gelada falls back to English.',
} as const;

export type MessageKey = keyof typeof en;
