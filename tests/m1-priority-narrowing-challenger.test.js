import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { PolicyEngine } from '../dist/components/policy-engine.js';

describe('M1 Empirical Stress Test: Policy Engine Priority Merging & Narrowing', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gelada-m1-stress-'));
  });

  afterEach(() => {
    if (tmpDir && fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  describe('1. Numeric Limits Narrowing Invariant (maxFiles, maxLines, taskTimeout, maxRevisions)', () => {
    it('1.1 Lower priority tiers CANNOT expand numeric limits set by higher priority tiers', () => {
      const globalConfigDir = path.join(tmpDir, 'global-config');
      fs.mkdirSync(globalConfigDir, { recursive: true });
      fs.writeFileSync(
        path.join(globalConfigDir, 'config.yaml'),
        `
maxFiles: 10
maxLines: 200
taskTimeout: 60
maxRevisions: 2
`,
        'utf8',
      );

      const repoDir = path.join(tmpDir, 'repo');
      const geladaDir = path.join(repoDir, '.gelada');
      fs.mkdirSync(geladaDir, { recursive: true });

      // Project policy attempts massive expansion across all numeric limits
      fs.writeFileSync(
        path.join(geladaDir, 'policy.yaml'),
        `
maxFiles: 1000
maxLines: 50000
taskTimeout: 3600
maxRevisions: 50
`,
        'utf8',
      );

      const engine = new PolicyEngine(
        // Task/Request config also attempts expansion
        {
          maxFiles: 500,
          maxLines: 10000,
          taskTimeout: 1800,
          maxRevisions: 25,
        },
        {
          globalConfigPath: globalConfigDir,
          repoPath: repoDir,
          autoLoad: false,
        },
      );

      const policy = engine.getEffectivePolicy();

      // Lower priority tiers must NOT expand limits set by global config
      assert.equal(policy.maxFiles, 10, 'maxFiles must remain capped at Global limit (10)');
      assert.equal(policy.maxLines, 200, 'maxLines must remain capped at Global limit (200)');
      assert.equal(policy.taskTimeout, 60, 'taskTimeout must remain capped at Global limit (60)');
      assert.equal(policy.maxRevisions, 2, 'maxRevisions must remain capped at Global limit (2)');

      // Validate diff & timeout methods enforce higher-tier caps
      assert.equal(engine.validateDiffLimits(11, 100).allowed, false, '11 files exceeds maxFiles 10');
      assert.equal(engine.validateDiffLimits(5, 250).allowed, false, '250 lines exceeds maxLines 200');
      assert.equal(engine.validateTaskTimeout(120).allowed, false, '120s timeout exceeds max 60s');
      assert.equal(engine.validateRevisionCount(3).allowed, false, '3 revisions exceeds max 2');
    });

    it('1.2 Lower priority tiers CAN restrict/narrow numeric limits further', () => {
      const globalConfigDir = path.join(tmpDir, 'global-config');
      fs.mkdirSync(globalConfigDir, { recursive: true });
      fs.writeFileSync(
        path.join(globalConfigDir, 'config.yaml'),
        `
maxFiles: 50
maxLines: 1000
taskTimeout: 300
maxRevisions: 10
`,
        'utf8',
      );

      const repoDir = path.join(tmpDir, 'repo');
      const geladaDir = path.join(repoDir, '.gelada');
      fs.mkdirSync(geladaDir, { recursive: true });

      // Project policy restricts maxFiles and maxLines
      fs.writeFileSync(
        path.join(geladaDir, 'policy.yaml'),
        `
maxFiles: 5
maxLines: 100
`,
        'utf8',
      );

      const engine = new PolicyEngine(
        // Task/Request config restricts taskTimeout and maxRevisions
        {
          taskTimeout: 45,
          maxRevisions: 1,
        },
        {
          globalConfigPath: globalConfigDir,
          repoPath: repoDir,
          autoLoad: false,
        },
      );

      const policy = engine.getEffectivePolicy();

      assert.equal(policy.maxFiles, 5, 'Project policy narrowed maxFiles to 5');
      assert.equal(policy.maxLines, 100, 'Project policy narrowed maxLines to 100');
      assert.equal(policy.taskTimeout, 45, 'Task config narrowed taskTimeout to 45');
      assert.equal(policy.maxRevisions, 1, 'Task config narrowed maxRevisions to 1');
    });

    it('1.3 Field aliases (maxFilesChanged, maxLinesChanged, timeoutSeconds) respect min-capping', () => {
      const globalConfigDir = path.join(tmpDir, 'global-config');
      fs.mkdirSync(globalConfigDir, { recursive: true });
      fs.writeFileSync(
        path.join(globalConfigDir, 'config.yaml'),
        `
maxFilesChanged: 8
maxLinesChanged: 150
timeoutSeconds: 90
maxRevisionCount: 3
`,
        'utf8',
      );

      const repoDir = path.join(tmpDir, 'repo');
      const geladaDir = path.join(repoDir, '.gelada');
      fs.mkdirSync(geladaDir, { recursive: true });

      // Project policy attempts expansion using standard field names
      fs.writeFileSync(
        path.join(geladaDir, 'policy.yaml'),
        `
maxFiles: 50
maxLines: 2000
taskTimeout: 600
maxRevisions: 20
`,
        'utf8',
      );

      const engine = new PolicyEngine(undefined, {
        globalConfigPath: globalConfigDir,
        repoPath: repoDir,
        autoLoad: false,
      });

      const policy = engine.getEffectivePolicy();
      assert.equal(policy.maxFiles, 8);
      assert.equal(policy.maxLines, 150);
      assert.equal(policy.taskTimeout, 90);
      assert.equal(policy.maxRevisions, 3);
    });
  });

  describe('2. Whitelist Set Intersection Invariant (allowedTaskTypes, allowedCommands)', () => {
    it('2.1 Lower priority tier CANNOT add task types outside Global whitelist', () => {
      const globalConfigDir = path.join(tmpDir, 'global-config');
      fs.mkdirSync(globalConfigDir, { recursive: true });
      fs.writeFileSync(
        path.join(globalConfigDir, 'config.yaml'),
        `
allowedTaskTypes:
  - unit-test
  - refactor
`,
        'utf8',
      );

      const repoDir = path.join(tmpDir, 'repo');
      const geladaDir = path.join(repoDir, '.gelada');
      fs.mkdirSync(geladaDir, { recursive: true });

      // Project attempts to allow 'security-audit' and 'deploy'
      fs.writeFileSync(
        path.join(geladaDir, 'policy.yaml'),
        `
allowedTaskTypes:
  - unit-test
  - security-audit
  - deploy
`,
        'utf8',
      );

      const engine = new PolicyEngine(undefined, {
        globalConfigPath: globalConfigDir,
        repoPath: repoDir,
        autoLoad: false,
      });

      const policy = engine.getEffectivePolicy();
      assert.ok(policy.allowedTaskTypes);
      assert.equal(policy.allowedTaskTypes.size, 1);
      assert.ok(policy.allowedTaskTypes.has('unit-test'));
      assert.equal(policy.allowedTaskTypes.has('security-audit'), false);
      assert.equal(policy.allowedTaskTypes.has('deploy'), false);

      assert.equal(engine.validateTaskType('unit-test').allowed, true);
      assert.equal(engine.validateTaskType('security-audit').allowed, false);
      assert.equal(engine.validateTaskType('deploy').allowed, false);
    });

    it('2.2 Lower priority tier CAN narrow whitelist to a subset of Global whitelist', () => {
      const globalConfigDir = path.join(tmpDir, 'global-config');
      fs.mkdirSync(globalConfigDir, { recursive: true });
      fs.writeFileSync(
        path.join(globalConfigDir, 'config.yaml'),
        `
allowedTaskTypes:
  - unit-test
  - refactor
  - bugfix
`,
        'utf8',
      );

      const repoDir = path.join(tmpDir, 'repo');
      const geladaDir = path.join(repoDir, '.gelada');
      fs.mkdirSync(geladaDir, { recursive: true });

      // Project narrows allowed types to only 'refactor'
      fs.writeFileSync(
        path.join(geladaDir, 'policy.yaml'),
        `
allowedTaskTypes:
  - refactor
`,
        'utf8',
      );

      const engine = new PolicyEngine(undefined, {
        globalConfigPath: globalConfigDir,
        repoPath: repoDir,
        autoLoad: false,
      });

      const policy = engine.getEffectivePolicy();
      assert.equal(policy.allowedTaskTypes?.size, 1);
      assert.ok(policy.allowedTaskTypes?.has('refactor'));
      assert.equal(engine.validateTaskType('unit-test').allowed, false);
      assert.equal(engine.validateTaskType('bugfix').allowed, false);
    });

    it('2.3 Lower priority tier CANNOT expand allowedCommands outside Global whitelist', () => {
      const globalConfigDir = path.join(tmpDir, 'global-config');
      fs.mkdirSync(globalConfigDir, { recursive: true });
      fs.writeFileSync(
        path.join(globalConfigDir, 'config.yaml'),
        `
allowedCommands:
  - npm test
  - npx vitest
`,
        'utf8',
      );

      const repoDir = path.join(tmpDir, 'repo');
      const geladaDir = path.join(repoDir, '.gelada');
      fs.mkdirSync(geladaDir, { recursive: true });

      // Project attempts to add 'cargo test' and 'rm -rf /'
      fs.writeFileSync(
        path.join(geladaDir, 'policy.yaml'),
        `
allowedCommands:
  - npm test
  - cargo test
  - rm -rf /
`,
        'utf8',
      );

      const engine = new PolicyEngine(undefined, {
        globalConfigPath: globalConfigDir,
        repoPath: repoDir,
        autoLoad: false,
      });

      const policy = engine.getEffectivePolicy();
      assert.ok(policy.allowedCommands);
      assert.equal(policy.allowedCommands.size, 1);
      assert.ok(policy.allowedCommands.has('npm test'));
      assert.equal(policy.allowedCommands.has('cargo test'), false);

      assert.equal(engine.validateVerificationCommand('npm test').allowed, true);
      assert.equal(engine.validateVerificationCommand('cargo test').allowed, false);
    });

    it('2.4 REMEDIATED: Empty array whitelist [] in lower tier narrows allowedTaskTypes to empty set', () => {
      const globalConfigDir = path.join(tmpDir, 'global-config');
      fs.mkdirSync(globalConfigDir, { recursive: true });
      fs.writeFileSync(
        path.join(globalConfigDir, 'config.yaml'),
        `
allowedTaskTypes:
  - unit-test
  - refactor
`,
        'utf8',
      );

      const repoDir = path.join(tmpDir, 'repo');
      const geladaDir = path.join(repoDir, '.gelada');
      fs.mkdirSync(geladaDir, { recursive: true });

      // Project specifies empty array allowedTaskTypes: [] intending to disallow all task types
      fs.writeFileSync(
        path.join(geladaDir, 'policy.yaml'),
        `
allowedTaskTypes: []
`,
        'utf8',
      );

      const engine = new PolicyEngine(undefined, {
        globalConfigPath: globalConfigDir,
        repoPath: repoDir,
        autoLoad: false,
      });

      const policy = engine.getEffectivePolicy();
      assert.ok(policy.allowedTaskTypes);
      assert.equal(policy.allowedTaskTypes.size, 0);
      assert.equal(policy.allowedTaskTypes.has('unit-test'), false);
      assert.equal(engine.validateTaskType('unit-test').allowed, false);
      assert.equal(engine.validateTaskType('unit-test').code, 'TASK_TYPE_NOT_ALLOWED');
    });
  });

  describe('3. Boolean Permissions Logical AND Invariant (allowNetwork, allowShellChaining)', () => {
    it('3.1 Project policy CANNOT enable allowNetwork when Global config sets allowNetwork: false', () => {
      const globalConfigDir = path.join(tmpDir, 'global-config');
      fs.mkdirSync(globalConfigDir, { recursive: true });
      fs.writeFileSync(
        path.join(globalConfigDir, 'config.yaml'),
        `
allowNetwork: false
allowShellChaining: false
`,
        'utf8',
      );

      const repoDir = path.join(tmpDir, 'repo');
      const geladaDir = path.join(repoDir, '.gelada');
      fs.mkdirSync(geladaDir, { recursive: true });

      // Project policy attempts to enable both network and shell chaining
      fs.writeFileSync(
        path.join(geladaDir, 'policy.yaml'),
        `
allowNetwork: true
allowShellChaining: true
`,
        'utf8',
      );

      const engine = new PolicyEngine(undefined, {
        globalConfigPath: globalConfigDir,
        repoPath: repoDir,
        autoLoad: false,
      });

      const policy = engine.getEffectivePolicy();
      assert.equal(policy.allowNetwork, false, 'allowNetwork must remain false');
      assert.equal(policy.allowShellChaining, false, 'allowShellChaining must remain false');

      const netRes = engine.validateVerificationCommand('curl -s http://example.com');
      assert.equal(netRes.allowed, false);
      assert.equal(netRes.code, 'NETWORK_RESTRICTED');

      const chainRes = engine.validateVerificationCommand('npm test && npm run build');
      assert.equal(chainRes.allowed, false);
      assert.equal(chainRes.code, 'SHELL_CHAINING_RESTRICTED');
    });

    it('3.2 Task config CANNOT enable allowNetwork when Project policy sets allowNetwork: false', () => {
      const globalConfigDir = path.join(tmpDir, 'global-config');
      fs.mkdirSync(globalConfigDir, { recursive: true });
      fs.writeFileSync(
        path.join(globalConfigDir, 'config.yaml'),
        `
allowNetwork: true
`,
        'utf8',
      );

      const repoDir = path.join(tmpDir, 'repo');
      const geladaDir = path.join(repoDir, '.gelada');
      fs.mkdirSync(geladaDir, { recursive: true });

      // Project policy restricts allowNetwork to false
      fs.writeFileSync(
        path.join(geladaDir, 'policy.yaml'),
        `
allowNetwork: false
`,
        'utf8',
      );

      // Task config tries to re-enable allowNetwork to true
      const engine = new PolicyEngine(
        { allowNetwork: true },
        {
          globalConfigPath: globalConfigDir,
          repoPath: repoDir,
          autoLoad: false,
        },
      );

      const policy = engine.getEffectivePolicy();
      assert.equal(policy.allowNetwork, false, 'Task config cannot override Project policy false');
    });

    it('3.3 Boolean permissions default to false (Gelada Hard Limits) when omitted', () => {
      const engine = new PolicyEngine(undefined, { autoLoad: false });
      const policy = engine.getEffectivePolicy();
      assert.equal(policy.allowNetwork, false);
      assert.equal(policy.allowShellChaining, false);
    });
  });

  describe('4. Blacklist Accumulation Invariant (disallowedTaskTypes, protectedPaths, blockedExecutables)', () => {
    it('4.1 Blacklists from all priority tiers accumulate monotonically via Set/Array Union', () => {
      const globalConfigDir = path.join(tmpDir, 'global-config');
      fs.mkdirSync(globalConfigDir, { recursive: true });
      fs.writeFileSync(
        path.join(globalConfigDir, 'config.yaml'),
        `
disallowedTaskTypes:
  - security-audit
disallowedCommands:
  - npm
protectedPaths:
  - config/secrets.yaml
`,
        'utf8',
      );

      const repoDir = path.join(tmpDir, 'repo');
      const geladaDir = path.join(repoDir, '.gelada');
      fs.mkdirSync(geladaDir, { recursive: true });

      fs.writeFileSync(
        path.join(geladaDir, 'policy.yaml'),
        `
disallowedTaskTypes:
  - db-migration
disallowedCommands:
  - yarn
protectedPaths:
  - build/private
`,
        'utf8',
      );

      const engine = new PolicyEngine(
        {
          disallowedTaskTypes: ['arbitrary-exec'],
          disallowedCommands: ['pnpm'],
          protectedPaths: ['temp/keys'],
        },
        {
          globalConfigPath: globalConfigDir,
          repoPath: repoDir,
          autoLoad: false,
        },
      );

      const policy = engine.getEffectivePolicy();

      // Hard limits protectedPaths (.git, .env) plus global, project, task
      assert.ok(policy.protectedPaths.includes('.git'));
      assert.ok(policy.protectedPaths.includes('config/secrets.yaml'));
      assert.ok(policy.protectedPaths.includes('build/private'));
      assert.ok(policy.protectedPaths.includes('temp/keys'));

      // Hard limits blockedExecutables (sudo, su, dd...) plus global, project, task disallowed commands
      assert.ok(policy.blockedExecutables.includes('sudo'));
      assert.ok(policy.blockedExecutables.includes('npm'));
      assert.ok(policy.blockedExecutables.includes('yarn'));
      assert.ok(policy.blockedExecutables.includes('pnpm'));

      // Disallowed task types union
      assert.ok(policy.disallowedTaskTypes.has('security-audit'));
      assert.ok(policy.disallowedTaskTypes.has('db-migration'));
      assert.ok(policy.disallowedTaskTypes.has('arbitrary-exec'));

      // Validate engine enforcement
      assert.equal(engine.validateTaskType('security-audit').allowed, false);
      assert.equal(engine.validateTaskType('db-migration').allowed, false);
      assert.equal(engine.validateTaskType('arbitrary-exec').allowed, false);
      assert.equal(engine.validateVerificationCommand('npm test').allowed, false);
      assert.equal(engine.validateVerificationCommand('yarn build').allowed, false);
      assert.equal(engine.validateVerificationCommand('pnpm install').allowed, false);
    });

    it('4.2 Lower priority tiers CANNOT remove items from higher priority blacklists', () => {
      const globalConfigDir = path.join(tmpDir, 'global-config');
      fs.mkdirSync(globalConfigDir, { recursive: true });
      fs.writeFileSync(
        path.join(globalConfigDir, 'config.yaml'),
        `
disallowedTaskTypes:
  - restricted-task
protectedPaths:
  - secrets.json
`,
        'utf8',
      );

      const repoDir = path.join(tmpDir, 'repo');
      const geladaDir = path.join(repoDir, '.gelada');
      fs.mkdirSync(geladaDir, { recursive: true });

      // Project policy attempts to specify empty disallowedTaskTypes / protectedPaths
      fs.writeFileSync(
        path.join(geladaDir, 'policy.yaml'),
        `
disallowedTaskTypes: []
protectedPaths: []
`,
        'utf8',
      );

      const engine = new PolicyEngine(undefined, {
        globalConfigPath: globalConfigDir,
        repoPath: repoDir,
        autoLoad: false,
      });

      const policy = engine.getEffectivePolicy();
      assert.ok(policy.disallowedTaskTypes.has('restricted-task'));
      assert.ok(policy.protectedPaths.includes('secrets.json'));
      assert.ok(policy.protectedPaths.includes('.git'));
    });
  });

  describe('5. Probe: allowedActions Precedence Behavior', () => {
    it('5.1 REMEDIATED: Task/Request config cannot grant actions outside Gelada Hard Limits', () => {
      const engine = new PolicyEngine(
        {
          allowedActions: ['custom_action', 'delegate_task'],
        },
        { autoLoad: false },
      );

      // custom_action is not in Gelada Hard Limits, so it MUST be rejected
      const res = engine.evaluateAction('custom_action');
      assert.equal(res.allowed, false, 'custom_action outside Hard Limits must be rejected');
      assert.equal(res.code, 'ACTION_NOT_ALLOWED');

      // delegate_task is in both Hard Limits and requestConfig, so it is permitted
      const delegateRes = engine.evaluateAction('delegate_task');
      assert.equal(delegateRes.allowed, true, 'delegate_task in Hard Limits and requestConfig is allowed');

      // doctor was narrowed out by requestConfig, so it is rejected
      const doctorRes = engine.evaluateAction('doctor');
      assert.equal(doctorRes.allowed, false, 'doctor was narrowed out by requestConfig');
      assert.equal(doctorRes.code, 'ACTION_NOT_ALLOWED');
    });
  });

  describe('6. Bug Fixes & Narrowing Security Regression Tests', () => {
    it('6.1 Empty Set Whitelist Intersection rejects all task types and commands', () => {
      const globalConfigDir = path.join(tmpDir, 'global-config-disjoint');
      fs.mkdirSync(globalConfigDir, { recursive: true });
      fs.writeFileSync(
        path.join(globalConfigDir, 'config.yaml'),
        `
allowedTaskTypes:
  - unit-test
allowedCommands:
  - npm test
`,
        'utf8',
      );

      const repoDir = path.join(tmpDir, 'repo-disjoint');
      const geladaDir = path.join(repoDir, '.gelada');
      fs.mkdirSync(geladaDir, { recursive: true });
      fs.writeFileSync(
        path.join(geladaDir, 'policy.yaml'),
        `
allowedTaskTypes:
  - refactor
allowedCommands:
  - cargo test
`,
        'utf8',
      );

      const engine = new PolicyEngine(undefined, {
        globalConfigPath: globalConfigDir,
        repoPath: repoDir,
        autoLoad: false,
      });

      // Disjoint whitelists intersect to empty Set(0)
      assert.equal(engine.validateTaskType('unit-test').allowed, false);
      assert.equal(engine.validateTaskType('refactor').allowed, false);
      assert.equal(engine.validateTaskType('deploy').allowed, false);

      assert.equal(engine.validateVerificationCommand('npm test').allowed, false);
      assert.equal(engine.validateVerificationCommand('cargo test').allowed, false);
      assert.equal(engine.validateVerificationCommand('python -c "import os; os.system(\'whoami\')"').allowed, false);
    });

    it('6.2 Multi-word disallowedCommands match exact, prefix, token basenames, and regex patterns', () => {
      const engine = new PolicyEngine(
        {
          disallowedCommands: [
            'npm publish',
            'git push --force',
            '/^python\\s+evil\\.py$/i',
          ],
        },
        { autoLoad: false },
      );

      // Exact multi-word match
      const r1 = engine.validateVerificationCommand('npm publish');
      assert.equal(r1.allowed, false);
      assert.equal(r1.code, 'DISALLOWED_COMMAND');

      // Prefix match with extra flags
      const r2 = engine.validateVerificationCommand('npm publish --access public');
      assert.equal(r2.allowed, false);
      assert.equal(r2.code, 'DISALLOWED_COMMAND');

      // Qualified binary path match with prefix
      const r3 = engine.validateVerificationCommand('/usr/local/bin/npm publish --access public');
      assert.equal(r3.allowed, false);
      assert.equal(r3.code, 'DISALLOWED_COMMAND');

      // Multi-word with flags
      const r4 = engine.validateVerificationCommand('/usr/bin/git push --force origin main');
      assert.equal(r4.allowed, false);
      assert.equal(r4.code, 'DISALLOWED_COMMAND');

      // Regex pattern match
      const r5 = engine.validateVerificationCommand('python evil.py');
      assert.equal(r5.allowed, false);
      assert.equal(r5.code, 'DISALLOWED_COMMAND');

      // Allowed command
      const r6 = engine.validateVerificationCommand('npm test');
      assert.equal(r6.allowed, true);
    });

    it('6.3 Empty array [] whitelists for allowedCommands correctly produce empty Set and block all commands', () => {
      const globalConfigDir = path.join(tmpDir, 'global-config-cmds');
      fs.mkdirSync(globalConfigDir, { recursive: true });
      fs.writeFileSync(
        path.join(globalConfigDir, 'config.yaml'),
        `
allowedCommands:
  - npm test
`,
        'utf8',
      );

      const repoDir = path.join(tmpDir, 'repo-cmds');
      const geladaDir = path.join(repoDir, '.gelada');
      fs.mkdirSync(geladaDir, { recursive: true });
      fs.writeFileSync(
        path.join(geladaDir, 'policy.yaml'),
        `
allowedCommands: []
`,
        'utf8',
      );

      const engine = new PolicyEngine(undefined, {
        globalConfigPath: globalConfigDir,
        repoPath: repoDir,
        autoLoad: false,
      });

      const policy = engine.getEffectivePolicy();
      assert.ok(policy.allowedCommands);
      assert.equal(policy.allowedCommands.size, 0);

      const r = engine.validateVerificationCommand('npm test');
      assert.equal(r.allowed, false);
      assert.equal(r.code, 'COMMAND_NOT_ALLOWED');
    });

    it('6.4 Empty allowedActions [] narrows allowed actions to zero', () => {
      const engine = new PolicyEngine(
        {
          allowedActions: [],
        },
        { autoLoad: false },
      );

      const r = engine.evaluateAction('delegate_task');
      assert.equal(r.allowed, false);
      assert.equal(r.code, 'ACTION_NOT_ALLOWED');
    });

    it('6.5 Disjoint allowedActions across tiers results in empty Set([]) blocking all actions', () => {
      const globalConfigDir = path.join(tmpDir, 'global-config-actions-disjoint');
      fs.mkdirSync(globalConfigDir, { recursive: true });
      fs.writeFileSync(
        path.join(globalConfigDir, 'config.yaml'),
        `
allowedActions:
  - delegate_task
`,
        'utf8',
      );

      const repoDir = path.join(tmpDir, 'repo-actions-disjoint');
      const geladaDir = path.join(repoDir, '.gelada');
      fs.mkdirSync(geladaDir, { recursive: true });
      fs.writeFileSync(
        path.join(geladaDir, 'policy.yaml'),
        `
allowedActions:
  - revise_task
`,
        'utf8',
      );

      const engine = new PolicyEngine(undefined, {
        globalConfigPath: globalConfigDir,
        repoPath: repoDir,
        autoLoad: false,
      });

      const policy = engine.getEffectivePolicy();
      assert.equal(policy.allowedActions.size, 0, 'Disjoint allowedActions must intersect to empty Set(0)');
      assert.equal(engine.evaluateAction('delegate_task').allowed, false);
      assert.equal(engine.evaluateAction('revise_task').allowed, false);
      assert.equal(engine.evaluateAction('doctor').allowed, false);
    });

    it('6.6 Lower tiers attempting to introduce unauthorized actions outside Hard Limits are stripped', () => {
      const globalConfigDir = path.join(tmpDir, 'global-config-hard-limit');
      fs.mkdirSync(globalConfigDir, { recursive: true });
      fs.writeFileSync(
        path.join(globalConfigDir, 'config.yaml'),
        `
allowedActions:
  - delegate_task
  - doctor
  - dangerous_global_action
`,
        'utf8',
      );

      const repoDir = path.join(tmpDir, 'repo-hard-limit');
      const geladaDir = path.join(repoDir, '.gelada');
      fs.mkdirSync(geladaDir, { recursive: true });
      fs.writeFileSync(
        path.join(geladaDir, 'policy.yaml'),
        `
allowedActions:
  - delegate_task
  - dangerous_project_action
`,
        'utf8',
      );

      const engine = new PolicyEngine(
        {
          allowedActions: ['delegate_task', 'dangerous_request_action'],
        },
        {
          globalConfigPath: globalConfigDir,
          repoPath: repoDir,
          autoLoad: false,
        },
      );

      const policy = engine.getEffectivePolicy();
      // Hard limits: delegate_task, revise_task, inspect_task, discard_task, doctor
      // Global: delegate_task, doctor, dangerous_global_action -> intersect = delegate_task, doctor
      // Project: delegate_task, dangerous_project_action -> intersect = delegate_task
      // Request: delegate_task, dangerous_request_action -> intersect = delegate_task
      assert.equal(policy.allowedActions.size, 1);
      assert.ok(policy.allowedActions.has('delegate_task'));
      assert.equal(policy.allowedActions.has('dangerous_global_action'), false);
      assert.equal(policy.allowedActions.has('dangerous_project_action'), false);
      assert.equal(policy.allowedActions.has('dangerous_request_action'), false);
    });

    it('6.7 Multi-word disallowed commands with path prefix, flags, and quotes are blocked', () => {
      const engine = new PolicyEngine(
        {
          disallowedCommands: [
            'git push --force',
            'npm publish',
          ],
        },
        { autoLoad: false },
      );

      // Path prefix + flags
      const res1 = engine.validateVerificationCommand('/usr/bin/git push --force origin main');
      assert.equal(res1.allowed, false);
      assert.equal(res1.code, 'DISALLOWED_COMMAND');

      // Relative path + flags
      const res2 = engine.validateVerificationCommand('./bin/npm publish --tag next');
      assert.equal(res2.allowed, false);
      assert.equal(res2.code, 'DISALLOWED_COMMAND');

      // Allowed variant
      const res3 = engine.validateVerificationCommand('git push origin main');
      assert.equal(res3.allowed, true);
    });
  });
});

