import path from 'node:path';
import fs from 'node:fs';
import { parse as parseYaml } from 'yaml';
import { getConfigDir, expandHome } from '../cli/utils/paths.js';

export interface PolicyDecision {
  allowed: boolean;
  reason?: string;
  code?: string;
}

export interface CommandPolicyContext {
  workingDir?: string;
  allowNetwork?: boolean;
  allowShellChaining?: boolean;
  allowedCommandPrefixes?: string[];
}

export interface PolicyLoadError {
  code: 'MALFORMED_YAML' | 'READ_ERROR' | 'INVALID_STRUCTURE';
  filePath: string;
  message: string;
  details?: string;
}

export interface RetentionPolicySchema {
  maxRuns?: number;
  maxTotalSize?: number | string;
  maxDiskSize?: number | string;
  maxAgeDays?: number;
  [key: string]: unknown;
}

export interface EffectiveRetentionPolicy {
  maxRuns?: number;
  maxTotalSize?: number | string;
  maxDiskSize?: number | string;
  maxDiskSizeBytes?: number;
  maxDiskSizeRaw?: number | string;
  maxAgeDays?: number;
}

export interface PolicySchema {
  allowedTaskTypes?: string[] | Set<string>;
  disallowedTaskTypes?: string[] | Set<string>;
  protectedPaths?: string[];
  alwaysProtectedPaths?: string[];
  allowedCommands?: string[] | Set<string>;
  allowedVerificationCommands?: string[];
  disallowedCommands?: string[] | Set<string>;
  maxFiles?: number;
  maxFilesChanged?: number;
  maxLines?: number;
  maxLinesChanged?: number;
  taskTimeout?: number;
  timeoutSeconds?: number;
  timeout?: number;
  maxRevisions?: number;
  maxRevisionCount?: number;
  defaultModelProfile?: string;
  allowNetwork?: boolean;
  allowShellChaining?: boolean;
  allowedActions?: string[] | Set<string>;
  retention?: RetentionPolicySchema;
  sandbox?: 'none' | 'docker' | string;
  sandboxImage?: string;
  [key: string]: unknown;
}

export interface EffectivePolicy {
  allowedActions: Set<string>;
  protectedPaths: string[];
  blockedExecutables: string[];
  blockedCommandPatterns: RegExp[];
  allowNetwork: boolean;
  allowShellChaining: boolean;
  allowedTaskTypes?: Set<string>;
  disallowedTaskTypes: Set<string>;
  allowedCommands?: Set<string>;
  disallowedCommands: Set<string>;
  maxFiles?: number;
  maxLines?: number;
  taskTimeout?: number;
  maxRevisions?: number;
  defaultModelProfile: string;
  retention?: EffectiveRetentionPolicy;
  sandbox: string;
  sandboxImage?: string;
}

export interface PolicyConfig {
  allowedActions: Set<string>;
  protectedPaths: string[];
  blockedExecutables: string[];
  blockedCommandPatterns: RegExp[];
  allowNetwork: boolean;
  allowShellChaining: boolean;
  allowedTaskTypes?: Set<string>;
  disallowedTaskTypes?: Set<string>;
  allowedCommands?: Set<string>;
  disallowedCommands?: Set<string>;
  maxFiles?: number;
  maxLines?: number;
  taskTimeout?: number;
  maxRevisions?: number;
  defaultModelProfile?: string;
  sandbox?: string;
  sandboxImage?: string;
}

export interface PolicyEngineOptions {
  repoPath?: string;
  globalConfigPath?: string;
  autoLoad?: boolean;
}

interface NormalizedRetentionSchema {
  maxRuns?: number;
  maxTotalSize?: number | string;
  maxDiskSize?: number | string;
  maxDiskSizeBytes?: number;
  maxAgeDays?: number;
}

interface NormalizedSchema {
  allowedTaskTypes?: string[];
  disallowedTaskTypes?: string[];
  protectedPaths?: string[];
  allowedCommands?: string[];
  disallowedCommands?: string[];
  blockedExecutables?: string[];
  maxFiles?: number;
  maxLines?: number;
  taskTimeout?: number;
  maxRevisions?: number;
  defaultModelProfile?: string;
  allowNetwork?: boolean;
  allowShellChaining?: boolean;
  allowedActions?: string[];
  retention?: NormalizedRetentionSchema;
  sandbox?: string;
  sandboxImage?: string;
}

export function parseYamlPolicyFile(filePath: string): { config?: PolicySchema; error?: PolicyLoadError } {
  if (!fs.existsSync(filePath)) {
    return {};
  }

  let content: string;
  try {
    content = fs.readFileSync(filePath, 'utf8');
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return {
      error: {
        code: 'READ_ERROR',
        filePath,
        message: `Failed to read policy file at '${filePath}': ${errorMsg}`,
        details: String(err),
      },
    };
  }

  try {
    const parsed = parseYaml(content);
    if (parsed === null || parsed === undefined) {
      return { config: {} };
    }
    if (typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {
        error: {
          code: 'INVALID_STRUCTURE',
          filePath,
          message: `Policy file at '${filePath}' must contain a top-level mapping/object.`,
        },
      };
    }
    return { config: parsed as PolicySchema };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return {
      error: {
        code: 'MALFORMED_YAML',
        filePath,
        message: `Failed to parse YAML policy file at '${filePath}': ${errorMsg}`,
        details: String(err),
      },
    };
  }
}

function extractArrayOrSet(val: unknown): string[] | undefined {
  if (Array.isArray(val)) {
    return val.filter((x): x is string => typeof x === 'string');
  }
  if (val instanceof Set) {
    return Array.from(val).filter((x): x is string => typeof x === 'string');
  }
  return undefined;
}

export function parseDiskSize(val: number | string | undefined | null): number | undefined {
  if (val === undefined || val === null) return undefined;

  if (typeof val === 'number') {
    if (!isNaN(val) && val >= 0 && Number.isFinite(val)) {
      return Math.floor(val);
    }
    return undefined;
  }

  if (typeof val !== 'string') return undefined;

  const trimmed = val.trim();
  if (trimmed === '') return undefined;

  const match = /^\s*(\d+(?:\.\d+)?)\s*([a-z]*)\s*$/i.exec(trimmed);
  if (!match) return undefined;

  const num = parseFloat(match[1]);
  if (isNaN(num) || num < 0 || !Number.isFinite(num)) return undefined;

  const unit = match[2].toLowerCase();
  let multiplier = 1;

  switch (unit) {
    case '':
    case 'b':
    case 'bytes':
      multiplier = 1;
      break;
    case 'k':
    case 'kb':
    case 'kib':
      multiplier = 1024;
      break;
    case 'm':
    case 'mb':
    case 'mib':
      multiplier = 1024 * 1024;
      break;
    case 'g':
    case 'gb':
    case 'gib':
      multiplier = 1024 * 1024 * 1024;
      break;
    case 't':
    case 'tb':
    case 'tib':
      multiplier = 1024 * 1024 * 1024 * 1024;
      break;
    default:
      return undefined;
  }

  return Math.floor(num * multiplier);
}

function normalizeRetention(rawRetention: unknown): NormalizedRetentionSchema | undefined {
  if (!rawRetention || typeof rawRetention !== 'object' || Array.isArray(rawRetention)) {
    return undefined;
  }

  const retObj = rawRetention as Record<string, unknown>;
  const normRet: NormalizedRetentionSchema = {};

  if (typeof retObj.maxRuns === 'number' && !isNaN(retObj.maxRuns) && retObj.maxRuns >= 0) {
    normRet.maxRuns = Math.floor(retObj.maxRuns);
  }

  if (typeof retObj.maxAgeDays === 'number' && !isNaN(retObj.maxAgeDays) && retObj.maxAgeDays >= 0) {
    normRet.maxAgeDays = retObj.maxAgeDays;
  }

  const rawDiskSize = retObj.maxTotalSize ?? retObj.maxDiskSize;
  if (typeof rawDiskSize === 'number' || typeof rawDiskSize === 'string') {
    const bytes = parseDiskSize(rawDiskSize);
    if (bytes !== undefined) {
      if (retObj.maxTotalSize !== undefined) {
        normRet.maxTotalSize = retObj.maxTotalSize as number | string;
      }
      if (retObj.maxDiskSize !== undefined) {
        normRet.maxDiskSize = retObj.maxDiskSize as number | string;
      }
      if (normRet.maxTotalSize === undefined && normRet.maxDiskSize === undefined) {
        normRet.maxTotalSize = rawDiskSize as number | string;
        normRet.maxDiskSize = rawDiskSize as number | string;
      }
      normRet.maxDiskSizeBytes = bytes;
    }
  }

  const hasAny =
    normRet.maxRuns !== undefined ||
    normRet.maxDiskSizeBytes !== undefined ||
    normRet.maxAgeDays !== undefined;

  return hasAny ? normRet : undefined;
}

function normalizePolicySchema(raw: PolicySchema | Partial<PolicyConfig>): NormalizedSchema {
  const norm: NormalizedSchema = {};

  const allowedTaskTypes = extractArrayOrSet(raw.allowedTaskTypes);
  if (allowedTaskTypes) {
    norm.allowedTaskTypes = allowedTaskTypes;
  }

  const disallowedTaskTypes = extractArrayOrSet(raw.disallowedTaskTypes);
  if (disallowedTaskTypes) {
    norm.disallowedTaskTypes = disallowedTaskTypes;
  }

  const rawProtected = extractArrayOrSet(raw.protectedPaths) || [];
  const rawAlwaysProtected = extractArrayOrSet((raw as PolicySchema).alwaysProtectedPaths) || [];
  const combinedProtected = [...rawProtected, ...rawAlwaysProtected].filter(
    (x): x is string => typeof x === 'string' && x.trim() !== '',
  );
  if (combinedProtected.length > 0) {
    norm.protectedPaths = combinedProtected;
  }

  const rawAllowedCmds = extractArrayOrSet((raw as PolicySchema).allowedCommands);
  const rawAllowedVerif = extractArrayOrSet((raw as PolicySchema).allowedVerificationCommands);
  if (rawAllowedCmds !== undefined || rawAllowedVerif !== undefined) {
    const combinedAllowedCmds = [
      ...(rawAllowedCmds || []),
      ...(rawAllowedVerif || []),
    ].filter((x): x is string => typeof x === 'string' && x.trim() !== '');
    norm.allowedCommands = combinedAllowedCmds;
  }

  const disallowedCommands = extractArrayOrSet((raw as PolicySchema).disallowedCommands);
  if (disallowedCommands) {
    norm.disallowedCommands = disallowedCommands;
  }

  const blockedExecutables = extractArrayOrSet((raw as PolicyConfig).blockedExecutables);
  if (blockedExecutables) {
    norm.blockedExecutables = blockedExecutables;
  }

  const mf = (raw as PolicySchema).maxFiles ?? (raw as PolicySchema).maxFilesChanged;
  if (typeof mf === 'number' && !isNaN(mf)) norm.maxFiles = mf;

  const ml = (raw as PolicySchema).maxLines ?? (raw as PolicySchema).maxLinesChanged;
  if (typeof ml === 'number' && !isNaN(ml)) norm.maxLines = ml;

  const tt =
    (raw as PolicySchema).taskTimeout ??
    (raw as PolicySchema).timeoutSeconds ??
    (raw as PolicySchema).timeout;
  if (typeof tt === 'number' && !isNaN(tt)) norm.taskTimeout = tt;

  const mr = (raw as PolicySchema).maxRevisions ?? (raw as PolicySchema).maxRevisionCount;
  if (typeof mr === 'number' && !isNaN(mr)) norm.maxRevisions = mr;

  if (typeof raw.defaultModelProfile === 'string' && raw.defaultModelProfile.trim() !== '') {
    norm.defaultModelProfile = raw.defaultModelProfile.trim();
  }

  if (typeof raw.allowNetwork === 'boolean') {
    norm.allowNetwork = raw.allowNetwork;
  }

  if (typeof raw.allowShellChaining === 'boolean') {
    norm.allowShellChaining = raw.allowShellChaining;
  }

  const allowedActions = extractArrayOrSet(raw.allowedActions);
  if (allowedActions) {
    norm.allowedActions = allowedActions;
  }

  if ((raw as PolicySchema).retention) {
    const normRet = normalizeRetention((raw as PolicySchema).retention);
    if (normRet) {
      norm.retention = normRet;
    }
  }

  if (typeof raw.sandbox === 'string' && raw.sandbox.trim() !== '') {
    norm.sandbox = raw.sandbox.trim();
  }

  if (typeof raw.sandboxImage === 'string' && raw.sandboxImage.trim() !== '') {
    norm.sandboxImage = raw.sandboxImage.trim();
  }

  return norm;
}

function computeNumericMin(
  key: 'maxFiles' | 'maxLines' | 'taskTimeout' | 'maxRevisions',
  schemas: NormalizedSchema[],
): number | undefined {
  const nums: number[] = [];
  for (const s of schemas) {
    const val = s[key];
    if (typeof val === 'number' && !isNaN(val) && val >= 0) {
      nums.push(val);
    }
  }
  return nums.length > 0 ? Math.min(...nums) : undefined;
}

function computeSetIntersection(
  key: 'allowedTaskTypes' | 'allowedCommands',
  schemas: NormalizedSchema[],
): Set<string> | undefined {
  const definedLists: string[][] = [];
  for (const s of schemas) {
    const list = s[key];
    if (Array.isArray(list)) {
      definedLists.push(list);
    }
  }
  if (definedLists.length === 0) {
    return undefined;
  }

  let intersection = new Set(definedLists[0].map((item) => item.trim().toLowerCase()));

  for (let i = 1; i < definedLists.length; i++) {
    const nextSet = new Set(definedLists[i].map((item) => item.trim().toLowerCase()));
    const nextIntersect = new Set<string>();
    for (const item of intersection) {
      if (nextSet.has(item)) {
        nextIntersect.add(item);
      }
    }
    intersection = nextIntersect;
  }

  return intersection;
}

function computeSetUnion(
  key: 'disallowedTaskTypes' | 'disallowedCommands',
  base: string[],
  schemas: NormalizedSchema[],
): Set<string> {
  const union = new Set<string>(base.map((item) => item.trim().toLowerCase()));
  for (const s of schemas) {
    const list = s[key];
    if (Array.isArray(list)) {
      for (const item of list) {
        if (typeof item === 'string' && item.trim() !== '') {
          union.add(item.trim().toLowerCase());
        }
      }
    }
  }
  return union;
}

function computeArrayUnion(
  key: 'protectedPaths' | 'blockedExecutables',
  base: string[],
  schemas: NormalizedSchema[],
): string[] {
  const set = new Set<string>(base);
  for (const s of schemas) {
    const list = s[key];
    if (Array.isArray(list)) {
      for (const item of list) {
        if (typeof item === 'string' && item.trim() !== '') {
          set.add(item.trim());
        }
      }
    }
  }
  return Array.from(set);
}

function computeBooleanAnd(
  key: 'allowNetwork' | 'allowShellChaining',
  baseDefault: boolean,
  schemas: NormalizedSchema[],
): boolean {
  let hasExplicitTrue = false;
  let hasExplicitFalse = false;

  for (const s of schemas) {
    const val = s[key];
    if (val === true) {
      hasExplicitTrue = true;
    } else if (val === false) {
      hasExplicitFalse = true;
    }
  }

  if (hasExplicitFalse) {
    return false;
  }
  if (hasExplicitTrue) {
    return true;
  }
  return baseDefault;
}

export class PolicyEngine {
  private hardLimits: PolicyConfig;
  private globalConfig?: PolicySchema;
  private globalConfigPath?: string;
  private projectPolicy?: PolicySchema;
  private projectPolicyPath?: string;
  private requestConfig?: PolicySchema | Partial<PolicyConfig>;
  private loadErrors: PolicyLoadError[] = [];
  private effectivePolicy!: EffectivePolicy;

  constructor(
    customConfig?: Partial<PolicyConfig> | PolicySchema,
    options?: PolicyEngineOptions,
  ) {
    this.hardLimits = {
      allowedActions: new Set([
        'delegate_task',
        'revise_task',
        'inspect_task',
        'discard_task',
        'doctor',
      ]),
      protectedPaths: ['.git/hooks', '.git/config', '.git', '.env', '.env.local'],
      blockedExecutables: [
        'sudo',
        'su',
        'doas',
        'pkexec',
        'runas',
        'mkfs',
        'fdisk',
        'parted',
        'dd',
        'diskutil',
        'format',
        'shutdown',
        'reboot',
        'init',
        'halt',
        'poweroff',
        'useradd',
        'usermod',
        'userdel',
        'passwd',
        'shadow',
        'eval',
        'exec',
      ],
      blockedCommandPatterns: [
        /rm\s+(-[a-zA-R]*[rRfF][a-zA-R]*)\s+([/~.*]|\.\.)/i,
        /chmod\s+.*777/i,
        />\s*\/etc\//i,
        />\s*\/dev\//i,
        />\s*\/var\//i,
        /\|\s*(bash|sh|zsh|python|perl)/i,
        /\$\(.*\)/,
        /`.*`/,
      ],
      allowNetwork: false,
      allowShellChaining: false,
      defaultModelProfile: 'default',
      sandbox: 'none',
    };

    if (customConfig) {
      this.requestConfig = customConfig;
    }

    const autoLoad = options?.autoLoad !== false;

    if (options?.globalConfigPath) {
      this.loadGlobalConfig(options.globalConfigPath);
    } else if (autoLoad) {
      this.loadGlobalConfig();
    }

    if (options?.repoPath) {
      this.loadProjectPolicy(options.repoPath);
    } else if (autoLoad && fs.existsSync(path.join(process.cwd(), '.gelada'))) {
      this.loadProjectPolicy(process.cwd());
    }

    this.recomputeEffectivePolicy();
  }

  public get config(): EffectivePolicy {
    return this.effectivePolicy;
  }

  public getEffectivePolicy(): EffectivePolicy {
    return this.effectivePolicy;
  }

  public getLoadErrors(): PolicyLoadError[] {
    return [...this.loadErrors];
  }

  public configurePolicy(customConfig: Partial<PolicyConfig> | PolicySchema): void {
    if (!this.requestConfig) {
      this.requestConfig = customConfig;
    } else {
      this.requestConfig = {
        ...this.requestConfig,
        ...customConfig,
      };
    }
    this.recomputeEffectivePolicy();
  }

  public loadGlobalConfig(customPath?: string): { config?: PolicySchema; error?: PolicyLoadError } {
    let probeFiles: string[] = [];
    if (customPath && customPath.trim() !== '') {
      const resolved = path.resolve(expandHome(customPath));
      let isDir = false;
      try {
        isDir = fs.statSync(resolved).isDirectory();
      } catch {
        isDir = false;
      }
      if (isDir) {
        probeFiles = [
          path.join(resolved, 'config.yaml'),
          path.join(resolved, 'config.yml'),
          path.join(resolved, 'config.json'),
        ];
      } else {
        probeFiles = [resolved];
      }
    } else {
      const configDir = getConfigDir();
      probeFiles = [
        path.join(configDir, 'config.yaml'),
        path.join(configDir, 'config.yml'),
        path.join(configDir, 'config.json'),
      ];
    }

    for (const file of probeFiles) {
      if (fs.existsSync(file)) {
        const res = parseYamlPolicyFile(file);
        if (res.error) {
          this.loadErrors.push(res.error);
          return { error: res.error };
        }
        this.globalConfig = res.config;
        this.globalConfigPath = file;
        this.recomputeEffectivePolicy();
        return { config: res.config };
      }
    }

    this.globalConfig = undefined;
    this.globalConfigPath = undefined;
    this.recomputeEffectivePolicy();
    return {};
  }

  public loadProjectPolicy(repoPath: string): { config?: PolicySchema; error?: PolicyLoadError } {
    if (!repoPath || typeof repoPath !== 'string' || repoPath.trim() === '') {
      return {};
    }
    const absRepo = path.resolve(expandHome(repoPath));
    const probeFiles = [
      path.join(absRepo, '.gelada', 'policy.yaml'),
      path.join(absRepo, '.gelada', 'policy.yml'),
      path.join(absRepo, '.gelada', 'policy.json'),
    ];

    for (const file of probeFiles) {
      if (fs.existsSync(file)) {
        const res = parseYamlPolicyFile(file);
        if (res.error) {
          this.loadErrors.push(res.error);
          return { error: res.error };
        }
        this.projectPolicy = res.config;
        this.projectPolicyPath = file;
        this.recomputeEffectivePolicy();
        return { config: res.config };
      }
    }

    this.projectPolicy = undefined;
    this.projectPolicyPath = undefined;
    this.recomputeEffectivePolicy();
    return {};
  }

  public loadPolicies(
    repoPath?: string,
    globalConfigPath?: string,
  ): { globalError?: PolicyLoadError; projectError?: PolicyLoadError } {
    const resGlobal = this.loadGlobalConfig(globalConfigPath);
    const resProject = repoPath ? this.loadProjectPolicy(repoPath) : {};
    return {
      globalError: resGlobal.error,
      projectError: resProject.error,
    };
  }

  private recomputeEffectivePolicy(): void {
    const t1 = this.hardLimits;
    const t2 = this.globalConfig ? normalizePolicySchema(this.globalConfig) : undefined;
    const t3 = this.projectPolicy ? normalizePolicySchema(this.projectPolicy) : undefined;
    const t4 = this.requestConfig ? normalizePolicySchema(this.requestConfig) : undefined;

    const activeSchemas = [t2, t3, t4].filter((s): s is NormalizedSchema => s !== undefined);

    const maxFiles = computeNumericMin('maxFiles', activeSchemas);
    const maxLines = computeNumericMin('maxLines', activeSchemas);
    const taskTimeout = computeNumericMin('taskTimeout', activeSchemas);
    const maxRevisions = computeNumericMin('maxRevisions', activeSchemas);

    const allowedTaskTypes = computeSetIntersection('allowedTaskTypes', activeSchemas);
    const allowedCommands = computeSetIntersection('allowedCommands', activeSchemas);

    const disallowedTaskTypes = computeSetUnion('disallowedTaskTypes', [], activeSchemas);
    const protectedPaths = computeArrayUnion('protectedPaths', t1.protectedPaths, activeSchemas);
    const blockedExecutables = computeArrayUnion(
      'blockedExecutables',
      t1.blockedExecutables,
      activeSchemas,
    );
    const disallowedCommandsSet = computeSetUnion('disallowedCommands', [], activeSchemas);

    for (const cmd of disallowedCommandsSet) {
      if (!blockedExecutables.includes(cmd)) {
        blockedExecutables.push(cmd);
      }
    }

    const allowNetwork = computeBooleanAnd('allowNetwork', t1.allowNetwork, activeSchemas);
    const allowShellChaining = computeBooleanAnd('allowShellChaining', t1.allowShellChaining, activeSchemas);

    let allowedActions = new Set(
      Array.from(t1.allowedActions).map((a) => a.trim().toLowerCase())
    );

    for (const schema of activeSchemas) {
      if (Array.isArray(schema.allowedActions)) {
        const tierSet = new Set(
          schema.allowedActions.map((a) => a.trim().toLowerCase())
        );
        const intersected = new Set<string>();
        for (const action of allowedActions) {
          if (tierSet.has(action)) {
            intersected.add(action);
          }
        }
        allowedActions = intersected;
      }
    }

    let defaultModelProfile = t1.defaultModelProfile || 'default';
    if (t2?.defaultModelProfile) defaultModelProfile = t2.defaultModelProfile;
    if (t3?.defaultModelProfile) defaultModelProfile = t3.defaultModelProfile;
    if (t4?.defaultModelProfile) defaultModelProfile = t4.defaultModelProfile;

    let sandbox = t1.sandbox || 'none';
    if (t2?.sandbox) sandbox = t2.sandbox;
    if (t3?.sandbox) sandbox = t3.sandbox;
    if (t4?.sandbox) sandbox = t4.sandbox;

    let sandboxImage;
    if (t2?.sandboxImage) sandboxImage = t2.sandboxImage;
    if (t3?.sandboxImage) sandboxImage = t3.sandboxImage;
    if (t4?.sandboxImage) sandboxImage = t4.sandboxImage;

    let retentionRuns: number | undefined;
    let retentionTotalSizeRaw: number | string | undefined;
    let retentionDiskSizeRaw: number | string | undefined;
    let retentionDiskSizeBytes: number | undefined;
    let retentionAgeDays: number | undefined;

    for (const schema of activeSchemas) {
      if (schema.retention) {
        if (schema.retention.maxRuns !== undefined) {
          retentionRuns = schema.retention.maxRuns;
        }
        const diskSizeVal = schema.retention.maxTotalSize ?? schema.retention.maxDiskSize;
        if (diskSizeVal !== undefined) {
          retentionTotalSizeRaw = schema.retention.maxTotalSize ?? diskSizeVal;
          retentionDiskSizeRaw = schema.retention.maxDiskSize ?? diskSizeVal;
          retentionDiskSizeBytes = schema.retention.maxDiskSizeBytes;
        }
        if (schema.retention.maxAgeDays !== undefined) {
          retentionAgeDays = schema.retention.maxAgeDays;
        }
      }
    }

    const hasRetention =
      retentionRuns !== undefined ||
      retentionDiskSizeBytes !== undefined ||
      retentionAgeDays !== undefined;

    const retention: EffectiveRetentionPolicy | undefined = hasRetention
      ? {
          maxRuns: retentionRuns,
          maxTotalSize: retentionTotalSizeRaw ?? retentionDiskSizeRaw,
          maxDiskSize: retentionDiskSizeRaw ?? retentionTotalSizeRaw,
          maxDiskSizeRaw: retentionDiskSizeRaw ?? retentionTotalSizeRaw,
          maxDiskSizeBytes: retentionDiskSizeBytes,
          maxAgeDays: retentionAgeDays,
        }
      : undefined;

    this.effectivePolicy = {
      allowedActions,
      protectedPaths,
      blockedExecutables,
      blockedCommandPatterns: t1.blockedCommandPatterns,
      allowNetwork,
      allowShellChaining,
      allowedTaskTypes,
      disallowedTaskTypes,
      allowedCommands,
      disallowedCommands: disallowedCommandsSet,
      maxFiles,
      maxLines,
      taskTimeout,
      maxRevisions,
      defaultModelProfile,
      retention,
      sandbox,
      sandboxImage,
    };
  }

  public evaluateAction(action: string, context?: Record<string, unknown>): PolicyDecision {
    if (!action || typeof action !== 'string' || action.trim() === '') {
      return {
        allowed: false,
        reason: 'Invalid action name provided.',
        code: 'INVALID_ACTION',
      };
    }

    if (context && context.restricted === true) {
      return {
        allowed: false,
        reason: `Action '${action}' rejected due to restricted context flag.`,
        code: 'RESTRICTED_CONTEXT',
      };
    }

    const normalizedAction = action.trim().toLowerCase();
    if (!this.effectivePolicy.allowedActions.has(normalizedAction)) {
      return {
        allowed: false,
        reason: `Action '${action}' is not in the set of allowed actions.`,
        code: 'ACTION_NOT_ALLOWED',
      };
    }

    return {
      allowed: true,
      reason: `Action '${action}' permitted by policy engine.`,
    };
  }

  public validateTaskType(taskType: string): PolicyDecision {
    if (!taskType || typeof taskType !== 'string' || taskType.trim() === '') {
      return {
        allowed: false,
        reason: 'Task type must be a non-empty string.',
        code: 'INVALID_TASK_TYPE',
      };
    }

    const norm = taskType.trim().toLowerCase();

    if (this.effectivePolicy.disallowedTaskTypes.has(norm)) {
      return {
        allowed: false,
        reason: `Task type '${taskType}' is disallowed by policy.`,
        code: 'DISALLOWED_TASK_TYPE',
      };
    }

    if (this.effectivePolicy.allowedTaskTypes !== undefined) {
      if (!this.effectivePolicy.allowedTaskTypes.has(norm)) {
        return {
          allowed: false,
          reason: `Task type '${taskType}' is not in the allowed task types whitelist.`,
          code: 'TASK_TYPE_NOT_ALLOWED',
        };
      }
    }

    return { allowed: true };
  }

  public validateDiffLimits(changedFilesCount: number, changedLinesCount: number): PolicyDecision {
    if (typeof changedFilesCount !== 'number' || isNaN(changedFilesCount) || changedFilesCount < 0) {
      return {
        allowed: false,
        reason: 'changedFilesCount must be a non-negative number.',
        code: 'INVALID_LIMIT',
      };
    }

    if (typeof changedLinesCount !== 'number' || isNaN(changedLinesCount) || changedLinesCount < 0) {
      return {
        allowed: false,
        reason: 'changedLinesCount must be a non-negative number.',
        code: 'INVALID_LIMIT',
      };
    }

    if (
      this.effectivePolicy.maxFiles !== undefined &&
      changedFilesCount > this.effectivePolicy.maxFiles
    ) {
      return {
        allowed: false,
        reason: `Changed files count (${changedFilesCount}) exceeds maximum allowed limit (${this.effectivePolicy.maxFiles}).`,
        code: 'MAX_FILES_EXCEEDED',
      };
    }

    if (
      this.effectivePolicy.maxLines !== undefined &&
      changedLinesCount > this.effectivePolicy.maxLines
    ) {
      return {
        allowed: false,
        reason: `Changed lines count (${changedLinesCount}) exceeds maximum allowed limit (${this.effectivePolicy.maxLines}).`,
        code: 'MAX_LINES_EXCEEDED',
      };
    }

    return { allowed: true };
  }

  public validateTaskTimeout(timeoutSeconds: number): PolicyDecision {
    if (typeof timeoutSeconds !== 'number' || isNaN(timeoutSeconds) || timeoutSeconds < 0) {
      return {
        allowed: false,
        reason: 'timeoutSeconds must be a non-negative number.',
        code: 'INVALID_TIMEOUT',
      };
    }

    if (
      this.effectivePolicy.taskTimeout !== undefined &&
      timeoutSeconds > this.effectivePolicy.taskTimeout
    ) {
      return {
        allowed: false,
        reason: `Task timeout (${timeoutSeconds}s) exceeds maximum allowed limit (${this.effectivePolicy.taskTimeout}s).`,
        code: 'TIMEOUT_EXCEEDED',
      };
    }

    return { allowed: true };
  }

  public validateRevisionCount(revisionCount: number): PolicyDecision {
    if (typeof revisionCount !== 'number' || isNaN(revisionCount) || revisionCount < 0) {
      return {
        allowed: false,
        reason: 'revisionCount must be a non-negative number.',
        code: 'INVALID_REVISION_COUNT',
      };
    }

    if (
      this.effectivePolicy.maxRevisions !== undefined &&
      revisionCount > this.effectivePolicy.maxRevisions
    ) {
      return {
        allowed: false,
        reason: `Revision count (${revisionCount}) exceeds maximum allowed limit (${this.effectivePolicy.maxRevisions}).`,
        code: 'MAX_REVISIONS_EXCEEDED',
      };
    }

    return { allowed: true };
  }

  public isPathAllowed(filePath: string, workingDir?: string): boolean {
    const decision = this.validatePathAccess(filePath, workingDir);
    return decision.allowed;
  }

  public validatePathAccess(filePath: string, workingDir?: string): PolicyDecision {
    if (
      !filePath ||
      typeof filePath !== 'string' ||
      filePath.trim() === '' ||
      filePath.includes('\0')
    ) {
      return {
        allowed: false,
        reason: 'Path must be a non-empty string without null bytes.',
        code: 'INVALID_PATH',
      };
    }

    const rootAbs = path.resolve(workingDir || process.cwd());
    const rootAbsWithSep = rootAbs.endsWith(path.sep) ? rootAbs : rootAbs + path.sep;
    const targetAbs = path.resolve(rootAbs, filePath);

    // 1. Path traversal / boundary check
    const rel = path.relative(rootAbs, targetAbs);
    if (filePath.includes('..') || rel.startsWith('..') || path.isAbsolute(rel)) {
      return {
        allowed: false,
        reason: `Path '${filePath}' escapes or attempts traversal outside workspace directory.`,
        code: 'PATH_TRAVERSAL',
      };
    }

    if (targetAbs !== rootAbs && !targetAbs.startsWith(rootAbsWithSep)) {
      return {
        allowed: false,
        reason: `Path '${filePath}' violates root boundary.`,
        code: 'PATH_BOUNDARY_VIOLATION',
      };
    }

    // 2. Protected paths check
    const relSegments = rel.split(path.sep);
    for (const protectedPattern of this.effectivePolicy.protectedPaths) {
      const normPattern = protectedPattern.replace(/[/\\]+/g, path.sep);
      if (
        rel === normPattern ||
        rel.startsWith(normPattern + path.sep) ||
        rel.includes(path.sep + normPattern + path.sep) ||
        rel.endsWith(path.sep + normPattern)
      ) {
        return {
          allowed: false,
          reason: `Access to protected path '${protectedPattern}' is forbidden.`,
          code: 'PROTECTED_PATH',
        };
      }

      for (const segment of relSegments) {
        if (
          segment === normPattern ||
          (normPattern === '.env' && (segment === '.env' || segment.startsWith('.env.')))
        ) {
          return {
            allowed: false,
            reason: `Access to protected path '${protectedPattern}' is forbidden.`,
            code: 'PROTECTED_PATH',
          };
        }
      }
    }

    // 3. Symlink inspection across all path segments
    try {
      let rootReal = rootAbs;
      try {
        rootReal = fs.realpathSync(rootAbs);
      } catch {
        // Fall back to rootAbs
      }
      const realRootWithSep = rootReal.endsWith(path.sep) ? rootReal : rootReal + path.sep;

      const segments = rel ? rel.split(path.sep) : [];
      let current = rootAbs;

      for (const seg of segments) {
        current = path.join(current, seg);
        let stat: fs.Stats;
        try {
          stat = fs.lstatSync(current);
        } catch {
          break;
        }

        if (stat.isSymbolicLink()) {
          let resolvedTarget = current;
          let depth = 0;
          while (depth < 10) {
            try {
              const st = fs.lstatSync(resolvedTarget);
              if (st.isSymbolicLink()) {
                const rawLink = fs.readlinkSync(resolvedTarget);
                resolvedTarget = path.resolve(path.dirname(resolvedTarget), rawLink);
                depth++;
              } else {
                break;
              }
            } catch {
              break;
            }
          }

          try {
            if (fs.existsSync(resolvedTarget)) {
              resolvedTarget = fs.realpathSync(resolvedTarget);
            }
          } catch {
            // Keep resolvedTarget from readlinkSync loop
          }

          const relToRoot = path.relative(rootReal, resolvedTarget);
          if (
            (resolvedTarget !== rootReal && !resolvedTarget.startsWith(realRootWithSep)) ||
            relToRoot.startsWith('..') ||
            path.isAbsolute(relToRoot)
          ) {
            return {
              allowed: false,
              reason: `Path '${filePath}' resolves via symlink to '${resolvedTarget}' outside workspace.`,
              code: 'SYMLINK_ESCAPE',
            };
          }
        } else {
          try {
            const realCurr = fs.realpathSync(current);
            const relToRoot = path.relative(rootReal, realCurr);
            if (
              (realCurr !== rootReal && !realCurr.startsWith(realRootWithSep)) ||
              relToRoot.startsWith('..') ||
              path.isAbsolute(relToRoot)
            ) {
              return {
                allowed: false,
                reason: `Path '${filePath}' resolves via symlink to '${realCurr}' outside workspace.`,
                code: 'SYMLINK_ESCAPE',
              };
            }
          } catch {
            // Ignore if realpath fails
          }
        }
      }
    } catch {
      // Defensive fallback
    }

    return { allowed: true };
  }

  public validateAllowedPaths(allowedPaths?: string[], workingDir?: string): PolicyDecision {
    if (!allowedPaths || !Array.isArray(allowedPaths)) {
      return { allowed: true };
    }
    const rootDir = workingDir || process.cwd();
    for (const aPath of allowedPaths) {
      const check = this.validatePathAccess(aPath, rootDir);
      if (!check.allowed) {
        return {
          allowed: false,
          reason: `allowedPath '${aPath}' is invalid: ${check.reason}`,
          code: check.code,
        };
      }
    }
    return { allowed: true };
  }

  public validateDisallowedPaths(disallowedPaths?: string[], _workingDir?: string): PolicyDecision {
    if (!disallowedPaths || !Array.isArray(disallowedPaths)) {
      return { allowed: true };
    }
    for (const dPath of disallowedPaths) {
      if (typeof dPath !== 'string' || dPath.trim() === '' || dPath.includes('\0')) {
        return {
          allowed: false,
          reason: 'disallowedPath must be a valid non-empty string.',
          code: 'INVALID_PATH',
        };
      }
    }
    return { allowed: true };
  }

  public validatePathScope(
    allowedPaths?: string[],
    disallowedPaths?: string[],
    workingDir?: string,
  ): PolicyDecision {
    const disCheck = this.validateDisallowedPaths(disallowedPaths, workingDir);
    if (!disCheck.allowed) return disCheck;

    const allowCheck = this.validateAllowedPaths(allowedPaths, workingDir);
    if (!allowCheck.allowed) return allowCheck;

    return { allowed: true };
  }

  public validateVerificationCommand(
    command: string,
    context?: CommandPolicyContext,
  ): PolicyDecision {
    if (
      !command ||
      typeof command !== 'string' ||
      command.trim() === '' ||
      command.includes('\0')
    ) {
      return {
        allowed: false,
        reason: 'Command must be a non-empty string without null bytes.',
        code: 'INVALID_COMMAND',
      };
    }

    const trimmed = command.trim();

    // 1. Shell Chaining & Injection Check
    const allowChaining = context?.allowShellChaining ?? this.effectivePolicy.allowShellChaining;
    if (!allowChaining) {
      if (/[\r\n;&|]/.test(trimmed)) {
        return {
          allowed: false,
          reason:
            'Command chaining, piping, backgrounding, or multiline operators (;, &&, ||, &, |, \\n, \\r) are disabled by policy.',
          code: 'SHELL_CHAINING_RESTRICTED',
        };
      }
    }

    // 2. Command Tokenization & Token Analysis
    const unquotedTokens = tokenizeCommand(trimmed);

    const tokensToCheck: string[] = [];
    for (const tok of unquotedTokens) {
      tokensToCheck.push(tok);
      if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(tok)) {
        const val = tok.substring(tok.indexOf('=') + 1);
        if (val) {
          tokensToCheck.push(val);
        }
      }
    }

    // 3. Allowed Commands Whitelist Check if defined
    if (this.effectivePolicy.allowedCommands !== undefined) {
      let isAllowedCmd = false;
      const cmdLower = trimmed.toLowerCase();
      for (const allowedCmd of this.effectivePolicy.allowedCommands) {
        const allowedLower = allowedCmd.trim().toLowerCase();
        if (
          cmdLower === allowedLower ||
          cmdLower.startsWith(allowedLower + ' ') ||
          tokensToCheck.some((tok) => tok.toLowerCase() === allowedLower)
        ) {
          isAllowedCmd = true;
          break;
        }
      }
      if (!isAllowedCmd) {
        return {
          allowed: false,
          reason: `Command '${trimmed}' is not permitted by allowed commands whitelist.`,
          code: 'COMMAND_NOT_ALLOWED',
        };
      }
    }

    // 3b. Disallowed Commands Check (Multi-token, prefix, regex, or exact match)
    if (this.effectivePolicy.disallowedCommands && this.effectivePolicy.disallowedCommands.size > 0) {
      const cmdLower = trimmed.toLowerCase();
      const cmdNormalized = cmdLower.replace(/\s+/g, ' ');

      const tokenBasenames = unquotedTokens.map((tok) =>
        path.basename(tok.replace(/\\/g, '/')).toLowerCase()
      );
      const reconstitutedBaseCmd = tokenBasenames.join(' ');

      for (const disallowed of this.effectivePolicy.disallowedCommands) {
        const normDisallowed = disallowed.trim().toLowerCase();
        if (!normDisallowed) continue;

        let isRegex = false;
        let reg: RegExp | null = null;
        if (normDisallowed.startsWith('/') && normDisallowed.lastIndexOf('/') > 0) {
          const lastSlash = normDisallowed.lastIndexOf('/');
          const pattern = normDisallowed.slice(1, lastSlash);
          const flags = normDisallowed.slice(lastSlash + 1);
          try {
            reg = new RegExp(pattern, flags);
            isRegex = true;
          } catch {
            isRegex = false;
          }
        }

        if (isRegex && reg) {
          if (reg.test(trimmed) || reg.test(reconstitutedBaseCmd)) {
            return {
              allowed: false,
              reason: `Command '${trimmed}' matches disallowed command pattern '${disallowed}'.`,
              code: 'DISALLOWED_COMMAND',
            };
          }
          continue;
        }

        const disallowedNormalized = normDisallowed.replace(/\s+/g, ' ');

        if (
          cmdNormalized === disallowedNormalized ||
          cmdNormalized.startsWith(disallowedNormalized + ' ')
        ) {
          return {
            allowed: false,
            reason: `Command '${trimmed}' matches disallowed command '${disallowed}'.`,
            code: 'DISALLOWED_COMMAND',
          };
        }

        if (
          reconstitutedBaseCmd === disallowedNormalized ||
          reconstitutedBaseCmd.startsWith(disallowedNormalized + ' ')
        ) {
          return {
            allowed: false,
            reason: `Command '${trimmed}' matches disallowed command '${disallowed}'.`,
            code: 'DISALLOWED_COMMAND',
          };
        }

        if (!disallowedNormalized.includes(' ')) {
          if (
            tokensToCheck.some((tok) => {
              const tokNorm = path.basename(tok.replace(/\\/g, '/')).toLowerCase();
              return tokNorm === disallowedNormalized || tok.toLowerCase() === disallowedNormalized;
            })
          ) {
            return {
              allowed: false,
              reason: `Command '${trimmed}' contains disallowed command '${disallowed}'.`,
              code: 'DISALLOWED_COMMAND',
            };
          }
        }
      }
    }

    // 4. Executable Blocklist Check across all tokens
    for (const tok of tokensToCheck) {
      const trimmedTok = tok.trim();
      if (!trimmedTok) continue;
      const binaryPart = trimmedTok.split(/\s+/)[0];
      const normTok = binaryPart.replace(/\\/g, '/');
      const base = path.basename(normTok).toLowerCase();

      for (const blockedExe of this.effectivePolicy.blockedExecutables) {
        const lowerBlocked = blockedExe.toLowerCase();
        if (base === lowerBlocked || base.startsWith(lowerBlocked + '.')) {
          return {
            allowed: false,
            reason: `Forbidden command executable '${base}'.`,
            code: 'FORBIDDEN_EXECUTABLE',
          };
        }
      }
    }

    // 5. Network Restriction Check across all tokens
    const allowNet = context?.allowNetwork ?? this.effectivePolicy.allowNetwork;
    if (!allowNet) {
      const netTools = [
        'curl',
        'wget',
        'nc',
        'netcat',
        'ncat',
        'socat',
        'telnet',
        'ssh',
        'scp',
        'rsync',
        'ping',
        'dig',
        'ftp',
      ];
      for (const tok of tokensToCheck) {
        const trimmedTok = tok.trim();
        if (!trimmedTok) continue;
        const binaryPart = trimmedTok.split(/\s+/)[0];
        const normTok = binaryPart.replace(/\\/g, '/');
        const base = path.basename(normTok).toLowerCase();

        for (const netTool of netTools) {
          if (base === netTool || base.startsWith(netTool + '.')) {
            return {
              allowed: false,
              reason: `Network utility '${base}' is disabled by policy.`,
              code: 'NETWORK_RESTRICTED',
            };
          }
        }
      }
    }

    // 6. Destructive Regex Patterns
    for (const pattern of this.effectivePolicy.blockedCommandPatterns) {
      if (pattern.test(trimmed)) {
        return {
          allowed: false,
          reason: `Command contains prohibited pattern '${pattern.source}'.`,
          code: 'DESTRUCTIVE_PATTERN',
        };
      }
    }

    return { allowed: true };
  }

  public validateVerificationCommands(
    commands?: string[],
    context?: CommandPolicyContext,
  ): PolicyDecision {
    if (!commands || !Array.isArray(commands)) {
      return { allowed: true };
    }

    for (const cmd of commands) {
      const decision = this.validateVerificationCommand(cmd, context);
      if (!decision.allowed) {
        return decision;
      }
    }

    return { allowed: true };
  }
}

function tokenizeCommand(cmd: string): string[] {
  const tokens: string[] = [];
  let currentToken = '';
  let inSingle = false;
  let inDouble = false;
  let escaped = false;

  for (let i = 0; i < cmd.length; i++) {
    const char = cmd[i];
    if (escaped) {
      currentToken += char;
      escaped = false;
      continue;
    }

    if (char === '\\' && !inSingle) {
      escaped = true;
      continue;
    }

    if (char === "'" && !inDouble) {
      inSingle = !inSingle;
      continue;
    }

    if (char === '"' && !inSingle) {
      inDouble = !inDouble;
      continue;
    }

    if (/\s/.test(char) && !inSingle && !inDouble) {
      if (currentToken.length > 0) {
        tokens.push(currentToken);
        currentToken = '';
      }
      continue;
    }

    currentToken += char;
  }

  if (currentToken.length > 0) {
    tokens.push(currentToken);
  }

  return tokens;
}
