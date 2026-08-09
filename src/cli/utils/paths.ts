import os from 'node:os';
import path from 'node:path';

export interface GeladaPaths {
  configDir: string;
  configFile: string;
  dataDir: string;
  logDir: string;
}

/**
 * Expands leading tilde (~) in file paths to the user's home directory.
 */
export function expandHome(filePath: string): string {
  if (!filePath) return filePath;
  if (filePath === '~') return os.homedir();
  if (filePath.startsWith('~/') || filePath.startsWith('~\\')) {
    return path.join(os.homedir(), filePath.slice(2));
  }
  return filePath;
}

/**
 * Resolves the configuration directory for Gelada MCP.
 */
export function getConfigDir(customDir?: string): string {
  if (customDir && customDir.trim() !== '') {
    return path.resolve(expandHome(customDir));
  }

  if (process.env.GELADA_CONFIG_DIR && process.env.GELADA_CONFIG_DIR.trim() !== '') {
    return path.resolve(expandHome(process.env.GELADA_CONFIG_DIR));
  }

  if (process.platform === 'win32' && process.env.APPDATA) {
    return path.resolve(process.env.APPDATA, 'gelada');
  }

  if (process.env.XDG_CONFIG_HOME && process.env.XDG_CONFIG_HOME.trim() !== '') {
    return path.resolve(expandHome(process.env.XDG_CONFIG_HOME), 'gelada');
  }

  const home = os.homedir() || process.cwd();
  return path.resolve(home, '.config', 'gelada');
}

/**
 * Resolves the absolute path to config.json.
 */
export function getConfigPath(customPath?: string): string {
  if (customPath && customPath.trim() !== '') {
    return path.resolve(expandHome(customPath));
  }

  if (process.env.GELADA_CONFIG_FILE && process.env.GELADA_CONFIG_FILE.trim() !== '') {
    return path.resolve(expandHome(process.env.GELADA_CONFIG_FILE));
  }

  return path.join(getConfigDir(), 'config.json');
}

/**
 * Resolves the data directory for internal databases/tasks.
 */
export function getDataDir(customDir?: string): string {
  if (customDir && customDir.trim() !== '') {
    return path.resolve(expandHome(customDir));
  }

  if (process.env.GELADA_DATA_DIR && process.env.GELADA_DATA_DIR.trim() !== '') {
    return path.resolve(expandHome(process.env.GELADA_DATA_DIR));
  }

  if (process.platform === 'win32' && process.env.LOCALAPPDATA) {
    return path.resolve(process.env.LOCALAPPDATA, 'gelada', 'data');
  }

  if (process.env.XDG_DATA_HOME && process.env.XDG_DATA_HOME.trim() !== '') {
    return path.resolve(expandHome(process.env.XDG_DATA_HOME), 'gelada');
  }

  return path.join(getConfigDir(), 'data');
}

/**
 * Resolves the log directory for process logs and diagnostics.
 */
export function getLogDir(customDir?: string): string {
  if (customDir && customDir.trim() !== '') {
    return path.resolve(expandHome(customDir));
  }

  if (process.env.GELADA_LOG_DIR && process.env.GELADA_LOG_DIR.trim() !== '') {
    return path.resolve(expandHome(process.env.GELADA_LOG_DIR));
  }

  if (process.platform === 'win32' && process.env.LOCALAPPDATA) {
    return path.resolve(process.env.LOCALAPPDATA, 'gelada', 'logs');
  }

  if (process.env.XDG_STATE_HOME && process.env.XDG_STATE_HOME.trim() !== '') {
    return path.resolve(expandHome(process.env.XDG_STATE_HOME), 'gelada', 'logs');
  }

  return path.join(getConfigDir(), 'logs');
}

/**
 * Resolves workspace artifact directory (.gelada inside project repository).
 */
export function getWorkspaceArtifactDir(workspacePath?: string): string {
  if (workspacePath && workspacePath.trim() !== '') {
    return path.resolve(expandHome(workspacePath), '.gelada');
  }
  return path.join(getDataDir(), 'artifacts');
}

/**
 * Convenience aggregator returning all paths in a single object.
 */
export function getAllPaths(customConfigDir?: string): GeladaPaths {
  const configDir = getConfigDir(customConfigDir);
  return {
    configDir,
    configFile: getConfigPath(customConfigDir ? path.join(configDir, 'config.json') : undefined),
    dataDir: getDataDir(),
    logDir: getLogDir(),
  };
}
