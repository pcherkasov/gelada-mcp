import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';

import { sanitizeEnvironment, AntigravityDriver } from '../dist/components/worker-driver.js';

describe('Milestone 10 Challenger 2 - Environment Variable Sanitization Empirical Stress Harness', () => {
  let tempDir;
  let originalEnv;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gelada-m10-challenger-'));
    originalEnv = { ...process.env };
  });

  afterEach(async () => {
    process.env = originalEnv;
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  describe('1. Explicit Task Environment Variables vs Host Secret Stripping', () => {
    it('retains explicit options.env vars while stripping host secret keys and pattern matches', () => {
      const parentEnv = {
        AWS_SECRET_ACCESS_KEY: 'host-aws-secret-key-12345',
        OPENAI_API_KEY: 'host-openai-key-abcde',
        MY_DATABASE_PASSWORD: 'host-db-password-super-secret',
        CUSTOM_SECRET_AUTH: 'host-auth-token-999',
        PATH: '/usr/bin:/bin',
        HOME: '/home/testuser',
        SAFE_HOST_VAR: 'safe-host-value',
      };

      const explicitEnv = {
        EXPLICIT_TASK_VAR: 'task-custom-val',
        TASK_CONFIG_PATH: '/app/config',
        AWS_REGION: 'us-east-1',
      };

      const result = sanitizeEnvironment(parentEnv, explicitEnv);

      // Host secrets must be stripped
      assert.equal(result.AWS_SECRET_ACCESS_KEY, undefined);
      assert.equal(result.OPENAI_API_KEY, undefined);
      assert.equal(result.MY_DATABASE_PASSWORD, undefined);
      assert.equal(result.CUSTOM_SECRET_AUTH, undefined);

      // Safe host vars and system vars retained
      assert.equal(result.SAFE_HOST_VAR, 'safe-host-value');
      assert.equal(result.PATH, '/usr/bin:/bin');
      assert.equal(result.HOME, '/home/testuser');

      // Explicit task vars retained
      assert.equal(result.EXPLICIT_TASK_VAR, 'task-custom-val');
      assert.equal(result.TASK_CONFIG_PATH, '/app/config');
      assert.equal(result.AWS_REGION, 'us-east-1');
    });

    it('retains explicit options.env even if key matches blocked key or pattern when user explicitly provides it in options.env', () => {
      const parentEnv = {
        AWS_SECRET_ACCESS_KEY: 'host-secret-aws-key',
        TASK_API_KEY: 'host-api-key',
      };

      const explicitEnv = {
        AWS_SECRET_ACCESS_KEY: 'task-provided-aws-key',
        TASK_API_KEY: 'task-provided-api-key',
      };

      const result = sanitizeEnvironment(parentEnv, explicitEnv);

      // Explicit task env overrides host and is retained
      assert.equal(result.AWS_SECRET_ACCESS_KEY, 'task-provided-aws-key');
      assert.equal(result.TASK_API_KEY, 'task-provided-api-key');
    });

    it('filters explicit options.env if key is explicitly listed in options.blockedEnvVars', () => {
      const parentEnv = {
        SAFE_HOST_VAR: 'safe-host-val',
      };

      const explicitEnv = {
        CUSTOM_BLOCKED_TASK_VAR: 'should-be-blocked',
        ALLOWED_TASK_VAR: 'should-be-allowed',
      };

      const result = sanitizeEnvironment(parentEnv, explicitEnv, {
        blockedEnvVars: ['CUSTOM_BLOCKED_TASK_VAR'],
      });

      assert.equal(result.CUSTOM_BLOCKED_TASK_VAR, undefined);
      assert.equal(result.ALLOWED_TASK_VAR, 'should-be-allowed');
    });
  });

  describe('2. Case Sensitivity & Pattern Matching Edge Cases', () => {
    it('strips secrets in host env regardless of key casing (lowercase, mixed case)', () => {
      const parentEnv = {
        aws_secret_access_key: 'lowercase-aws-secret',
        OpenAI_Api_Key: 'mixed-openai-key',
        my_custom_password: 'lowercase-custom-password',
        GitHub_Token: 'mixed-github-token',
        SAFE_LOWERCASE_VAR: 'safe-val',
      };

      const result = sanitizeEnvironment(parentEnv);

      assert.equal(result.aws_secret_access_key, undefined);
      assert.equal(result.OpenAI_Api_Key, undefined);
      assert.equal(result.my_custom_password, undefined);
      assert.equal(result.GitHub_Token, undefined);
      assert.equal(result.SAFE_LOWERCASE_VAR, 'safe-val');
    });

    it('preserves framework prefix keys (AGY_* and GELADA_*) even if they contain secret keywords', () => {
      const parentEnv = {
        AGY_SESSION_TOKEN: 'agy-token-123',
        GELADA_API_KEY: 'gelada-key-456',
        AGY_PRIVATE_KEY_PATH: '/keys/agy.pem',
        GELADA_AUTH_HEADER: 'Bearer 789',
        OTHER_SECRET_TOKEN: 'should-be-stripped',
      };

      const result = sanitizeEnvironment(parentEnv);

      assert.equal(result.AGY_SESSION_TOKEN, 'agy-token-123');
      assert.equal(result.GELADA_API_KEY, 'gelada-key-456');
      assert.equal(result.AGY_PRIVATE_KEY_PATH, '/keys/agy.pem');
      assert.equal(result.GELADA_AUTH_HEADER, 'Bearer 789');
      assert.equal(result.OTHER_SECRET_TOKEN, undefined);
    });
  });

  describe('3. Complex Keys, Empty Keys, and Special Characters', () => {
    it('handles empty string key, keys with spaces, quotes, newlines, and unicode', () => {
      const parentEnv = {
        '': 'empty-key-value',
        'KEY WITH SPACES': 'space-val',
        'KEY_WITH_"QUOTES"': 'quote-val',
        'KEY_WITH_\n_NEWLINE': 'newline-val',
        'UNICODE_KEY_🔥_R1': 'fire-val',
        'NUMERIC_123_KEY': 'numeric-val',
        'KEY_WITH_=EQUAL': 'equal-val',
        'SECRET_WITH_SPACES KEY': 'secret-space-val',
      };

      const result = sanitizeEnvironment(parentEnv);

      assert.equal(result[''], 'empty-key-value');
      assert.equal(result['KEY WITH SPACES'], 'space-val');
      assert.equal(result['KEY_WITH_"QUOTES"'], 'quote-val');
      assert.equal(result['KEY_WITH_\n_NEWLINE'], 'newline-val');
      assert.equal(result['UNICODE_KEY_🔥_R1'], 'fire-val');
      assert.equal(result['NUMERIC_123_KEY'], 'numeric-val');
      assert.equal(result['KEY_WITH_=EQUAL'], 'equal-val');
      // SECRET_WITH_SPACES KEY matches SECRET pattern -> stripped
      assert.equal(result['SECRET_WITH_SPACES KEY'], undefined);
    });

    it('ignores undefined parentEnv values and empty string values', () => {
      const parentEnv = {
        EMPTY_STRING_VAR: '',
        UNDEFINED_VAR: undefined,
        VALID_VAR: 'valid',
      };

      const result = sanitizeEnvironment(parentEnv);

      assert.equal(result.EMPTY_STRING_VAR, '');
      assert.equal('UNDEFINED_VAR' in result, false);
      assert.equal(result.VALID_VAR, 'valid');
    });
  });

  describe('4. OS-Specific Environment Variables & System Preservation', () => {
    it('preserves system variables across macOS, Linux, and Windows', () => {
      const parentEnv = {
        PATH: '/usr/bin:/bin',
        HOME: '/Users/test',
        USER: 'testuser',
        LOGNAME: 'testuser',
        SHELL: '/bin/zsh',
        TMPDIR: '/var/folders/tmp',
        TMP: '/tmp',
        TEMP: '/tmp',
        SYSTEMROOT: 'C:\\Windows',
        WINDIR: 'C:\\Windows',
        COMSPEC: 'C:\\Windows\\system32\\cmd.exe',
        PATHEXT: '.COM;.EXE;.BAT;.CMD',
        LANG: 'en_US.UTF-8',
        LC_ALL: 'en_US.UTF-8',
        LC_CTYPE: 'en_US.UTF-8',
        TERM: 'xterm-256color',
        COLORTERM: 'truecolor',
        NODE_ENV: 'production',
        SSH_AUTH_SOCK: '/tmp/ssh-agent.sock', // Sensitive pattern AUTH -> stripped
      };

      const result = sanitizeEnvironment(parentEnv);

      assert.equal(result.PATH, '/usr/bin:/bin');
      assert.equal(result.HOME, '/Users/test');
      assert.equal(result.USER, 'testuser');
      assert.equal(result.SYSTEMROOT, 'C:\\Windows');
      assert.equal(result.NODE_ENV, 'production');
      assert.equal(result.SSH_AUTH_SOCK, undefined); // Host SSH auth socket is stripped
    });

    it('respects preserveSystemVars: false', () => {
      const parentEnv = {
        PATH: '/usr/bin',
        CUSTOM_VAR: 'custom-val',
      };

      const result = sanitizeEnvironment(parentEnv, undefined, {
        preserveSystemVars: false,
        allowedEnvVars: ['CUSTOM_VAR'],
      });

      // Since preserveSystemVars is false and PATH is not in allowedEnvVars, PATH is stripped
      assert.equal(result.PATH, undefined);
      assert.equal(result.CUSTOM_VAR, 'custom-val');
    });
  });

  describe('5. Real Child Process Execution via AntigravityDriver', () => {
    it('spawns child worker with sanitized process.env and explicit options.env merged', async () => {
      const driver = new AntigravityDriver();
      const scriptPath = path.join(tempDir, 'env-check.js');

      // Write script that prints JSON process.env
      await fs.writeFile(scriptPath, 'console.log(JSON.stringify(process.env));');

      process.env.AWS_SECRET_ACCESS_KEY = 'real-host-aws-secret';
      process.env.OPENAI_API_KEY = 'real-host-openai-secret';
      process.env.MY_APP_PASSWORD = 'real-host-app-password';
      process.env.CHALLENGER_SAFE_VAR = 'real-host-safe-value';

      const handle = await driver.spawnWorker({
        taskId: 'challenger-task-real-spawn',
        command: process.execPath,
        args: [scriptPath],
        cwd: tempDir,
        env: {
          EXPLICIT_TASK_VAR: 'real-task-explicit-value',
          UNICODE_TASK_VAR: '🚀_Task_OK',
        },
      });

      const result = await handle.promise;
      assert.equal(result.status, 'completed');
      assert.equal(result.exitCode, 0);

      const childEnv = JSON.parse(result.stdout);

      // Verify host secrets are NOT in child env
      assert.equal(childEnv.AWS_SECRET_ACCESS_KEY, undefined);
      assert.equal(childEnv.OPENAI_API_KEY, undefined);
      assert.equal(childEnv.MY_APP_PASSWORD, undefined);

      // Verify safe host var is passed
      assert.equal(childEnv.CHALLENGER_SAFE_VAR, 'real-host-safe-value');

      // Verify explicit task env vars are in child env
      assert.equal(childEnv.EXPLICIT_TASK_VAR, 'real-task-explicit-value');
      assert.equal(childEnv.UNICODE_TASK_VAR, '🚀_Task_OK');

      // Verify system PATH is passed
      assert.ok(childEnv.PATH !== undefined);
    });
  });
});
