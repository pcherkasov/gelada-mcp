import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';

import { sanitizeEnvironment, AntigravityDriver } from '../dist/components/worker-driver.js';

describe('Milestone 10 Challenger 1 — Environment Variable Sanitization Empirical Stress Harness', () => {
  let tempDir;
  let originalEnv;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gelada-m10-ch1-'));
    originalEnv = { ...process.env };
  });

  afterEach(async () => {
    process.env = originalEnv;
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  describe('1. Stripping Sensitive Host Keys & Case Variations', () => {
    it('strips all standard sensitive cloud & AI vendor keys by default', () => {
      const parentEnv = {
        AWS_SECRET_ACCESS_KEY: 'aws-secret-123',
        AWS_ACCESS_KEY_ID: 'aws-key-id-123',
        AWS_SESSION_TOKEN: 'aws-session-token-123',
        AWS_PROFILE: 'default-profile',
        ANTHROPIC_API_KEY: 'sk-ant-123',
        OPENAI_API_KEY: 'sk-openai-123',
        GEMINI_API_KEY: 'gemini-key-123',
        GOOGLE_API_KEY: 'google-key-123',
        GITHUB_TOKEN: 'ghp_123',
        GH_TOKEN: 'gho_123',
        GITHUB_CLIENT_SECRET: 'gh-secret-123',
        GITLAB_TOKEN: 'gl-token-123',
        GITLAB_PRIVATE_TOKEN: 'gl-priv-123',
        NPM_TOKEN: 'npm-token-123',
        NPM_AUTH_TOKEN: 'npm-auth-123',
        PYPI_TOKEN: 'pypi-token-123',
        SLACK_BOT_TOKEN: 'xoxb-123',
        SLACK_TOKEN: 'xoxp-123',
        AZURE_CLIENT_SECRET: 'az-secret-123',
        AZURE_OPENAI_API_KEY: 'az-openai-123',
        AZURE_SUBSCRIPTION_ID: 'az-sub-123',
        GOOGLE_APPLICATION_CREDENTIALS: '/path/to/creds.json',
        HEROKU_API_KEY: 'heroku-123',
        NETLIFY_AUTH_TOKEN: 'netlify-123',
        VERCEL_TOKEN: 'vercel-123',
        DATADOG_API_KEY: 'dd-123',
        STRIPE_SECRET_KEY: 'sk_live_123',
        MISTRAL_API_KEY: 'mistral-123',
        COHERE_API_KEY: 'cohere-123',
        REPLICATE_API_TOKEN: 'r8_123',
        SAFE_APP_ENV: 'production',
      };

      const sanitized = sanitizeEnvironment(parentEnv);

      // Verify all 30 default blocked secret keys are completely stripped
      assert.equal(sanitized.AWS_SECRET_ACCESS_KEY, undefined);
      assert.equal(sanitized.AWS_ACCESS_KEY_ID, undefined);
      assert.equal(sanitized.AWS_SESSION_TOKEN, undefined);
      assert.equal(sanitized.AWS_PROFILE, undefined);
      assert.equal(sanitized.ANTHROPIC_API_KEY, undefined);
      assert.equal(sanitized.OPENAI_API_KEY, undefined);
      assert.equal(sanitized.GEMINI_API_KEY, undefined);
      assert.equal(sanitized.GOOGLE_API_KEY, undefined);
      assert.equal(sanitized.GITHUB_TOKEN, undefined);
      assert.equal(sanitized.GH_TOKEN, undefined);
      assert.equal(sanitized.GITHUB_CLIENT_SECRET, undefined);
      assert.equal(sanitized.GITLAB_TOKEN, undefined);
      assert.equal(sanitized.GITLAB_PRIVATE_TOKEN, undefined);
      assert.equal(sanitized.NPM_TOKEN, undefined);
      assert.equal(sanitized.NPM_AUTH_TOKEN, undefined);
      assert.equal(sanitized.PYPI_TOKEN, undefined);
      assert.equal(sanitized.SLACK_BOT_TOKEN, undefined);
      assert.equal(sanitized.SLACK_TOKEN, undefined);
      assert.equal(sanitized.AZURE_CLIENT_SECRET, undefined);
      assert.equal(sanitized.AZURE_OPENAI_API_KEY, undefined);
      assert.equal(sanitized.AZURE_SUBSCRIPTION_ID, undefined);
      assert.equal(sanitized.GOOGLE_APPLICATION_CREDENTIALS, undefined);
      assert.equal(sanitized.HEROKU_API_KEY, undefined);
      assert.equal(sanitized.NETLIFY_AUTH_TOKEN, undefined);
      assert.equal(sanitized.VERCEL_TOKEN, undefined);
      assert.equal(sanitized.DATADOG_API_KEY, undefined);
      assert.equal(sanitized.STRIPE_SECRET_KEY, undefined);
      assert.equal(sanitized.MISTRAL_API_KEY, undefined);
      assert.equal(sanitized.COHERE_API_KEY, undefined);
      assert.equal(sanitized.REPLICATE_API_TOKEN, undefined);

      // Non-sensitive variable remains
      assert.equal(sanitized.SAFE_APP_ENV, 'production');
    });

    it('strips keys matching default patterns (SECRET, PASSWORD, TOKEN, AUTH, CREDENTIAL, etc.) with mixed case', () => {
      const parentEnv = {
        aws_secret_access_key: 'lowercase-aws',
        OpenAI_Api_Key: 'mixed-openai',
        anthropic_api_key: 'lowercase-anthropic',
        DB_PASSWORD: 'db-pass-123',
        my_custom_passcode: 'pass-456',
        USER_AUTH_HEADER: 'Bearer token',
        RSA_PRIVATE_KEY: '-----BEGIN RSA PRIVATE KEY-----',
        SSL_PASSPHRASE: 'ssl-pass',
        CREDENTIALS_FILE: '/creds.txt',
        SAFE_LOG_LEVEL: 'info',
      };

      const sanitized = sanitizeEnvironment(parentEnv);

      assert.equal(sanitized.aws_secret_access_key, undefined);
      assert.equal(sanitized.OpenAI_Api_Key, undefined);
      assert.equal(sanitized.anthropic_api_key, undefined);
      assert.equal(sanitized.DB_PASSWORD, undefined);
      assert.equal(sanitized.my_custom_passcode, undefined);
      assert.equal(sanitized.USER_AUTH_HEADER, undefined);
      assert.equal(sanitized.RSA_PRIVATE_KEY, undefined);
      assert.equal(sanitized.SSL_PASSPHRASE, undefined);
      assert.equal(sanitized.CREDENTIALS_FILE, undefined);

      assert.equal(sanitized.SAFE_LOG_LEVEL, 'info');
    });
  });

  describe('2. Custom Allowlist, Blocklist, and Regex Patterns', () => {
    it('applies custom blockedEnvVars (case-insensitive)', () => {
      const parentEnv = {
        CUSTOM_INTERNAL_VAR: 'internal-data',
        custom_other_var: 'other-data',
        SAFE_VAR: 'safe',
      };

      const sanitized = sanitizeEnvironment(parentEnv, undefined, {
        blockedEnvVars: ['custom_internal_var', 'CUSTOM_OTHER_VAR'],
      });

      assert.equal(sanitized.CUSTOM_INTERNAL_VAR, undefined);
      assert.equal(sanitized.custom_other_var, undefined);
      assert.equal(sanitized.SAFE_VAR, 'safe');
    });

    it('applies custom allowedEnvVars allowlist mode, preserving system and Gelada framework keys', () => {
      const parentEnv = {
        FEATURE_ALPHA: 'enabled',
        FEATURE_BETA: 'disabled',
        UNALLOWED_VAR: 'blocked-by-allowlist',
        PATH: '/usr/local/bin:/usr/bin',
        HOME: '/Users/test',
        AGY_WORKSPACE_DIR: '/tmp/workspace',
        GELADA_WORKER_ID: 'worker-99',
      };

      const sanitized = sanitizeEnvironment(parentEnv, undefined, {
        allowedEnvVars: ['FEATURE_ALPHA'],
      });

      assert.equal(sanitized.FEATURE_ALPHA, 'enabled');
      assert.equal(sanitized.FEATURE_BETA, undefined);
      assert.equal(sanitized.UNALLOWED_VAR, undefined);

      // System & Framework keys preserved
      assert.equal(sanitized.PATH, '/usr/local/bin:/usr/bin');
      assert.equal(sanitized.HOME, '/Users/test');
      assert.equal(sanitized.AGY_WORKSPACE_DIR, '/tmp/workspace');
      assert.equal(sanitized.GELADA_WORKER_ID, 'worker-99');
    });

    it('applies custom blockedPatterns (RegExp and string patterns)', () => {
      const parentEnv = {
        MY_INTERNAL_DB_URL: 'postgres://localhost/db',
        API_ENDPOINT_V1: 'https://api.example.com',
        SAFE_SETTING: 'true',
      };

      const sanitized = sanitizeEnvironment(parentEnv, undefined, {
        blockedPatterns: ['INTERNAL_DB', /ENDPOINT/i],
      });

      assert.equal(sanitized.MY_INTERNAL_DB_URL, undefined);
      assert.equal(sanitized.API_ENDPOINT_V1, undefined);
      assert.equal(sanitized.SAFE_SETTING, 'true');
    });
  });

  describe('3. System Variables Preservation & Bypass Flag', () => {
    it('preserves essential system variables (PATH, HOME, USER, SHELL, TMPDIR, etc.) by default', () => {
      const parentEnv = {
        PATH: '/usr/bin:/bin',
        HOME: '/Users/gelada',
        USER: 'gelada-worker',
        LOGNAME: 'gelada-worker',
        SHELL: '/bin/bash',
        TMPDIR: '/tmp',
        LANG: 'en_US.UTF-8',
        NODE_ENV: 'test',
        AWS_SECRET_ACCESS_KEY: 'secret',
      };

      const sanitized = sanitizeEnvironment(parentEnv);

      assert.equal(sanitized.PATH, '/usr/bin:/bin');
      assert.equal(sanitized.HOME, '/Users/gelada');
      assert.equal(sanitized.USER, 'gelada-worker');
      assert.equal(sanitized.LOGNAME, 'gelada-worker');
      assert.equal(sanitized.SHELL, '/bin/bash');
      assert.equal(sanitized.TMPDIR, '/tmp');
      assert.equal(sanitized.LANG, 'en_US.UTF-8');
      assert.equal(sanitized.NODE_ENV, 'test');
      assert.equal(sanitized.AWS_SECRET_ACCESS_KEY, undefined);
    });

    it('bypasses sanitization completely when sanitizeEnv is false', () => {
      const parentEnv = {
        AWS_SECRET_ACCESS_KEY: 'raw-aws-secret',
        OPENAI_API_KEY: 'raw-openai-key',
        MY_PASSWORD: 'raw-password',
      };

      const explicitEnv = {
        EXPLICIT_VAR: 'explicit-value',
      };

      const sanitized = sanitizeEnvironment(parentEnv, explicitEnv, { sanitizeEnv: false });

      assert.equal(sanitized.AWS_SECRET_ACCESS_KEY, 'raw-aws-secret');
      assert.equal(sanitized.OPENAI_API_KEY, 'raw-openai-key');
      assert.equal(sanitized.MY_PASSWORD, 'raw-password');
      assert.equal(sanitized.EXPLICIT_VAR, 'explicit-value');
    });
  });

  describe('4. Empirical Child Process Spawning Verification via AntigravityDriver', () => {
    it('verifies live spawned process receives sanitized environment without sensitive host keys', async () => {
      const driver = new AntigravityDriver();

      process.env.AWS_SECRET_ACCESS_KEY = 'ch1-host-aws-secret-888';
      process.env.OPENAI_API_KEY = 'ch1-host-openai-key-999';
      process.env.my_custom_password = 'ch1-host-password-777';
      process.env.SAFE_CHALLENGER_KEY = 'ch1-safe-value-123';

      const scriptPath = path.join(tempDir, 'print-env.js');
      await fs.writeFile(scriptPath, 'console.log(JSON.stringify(process.env));');

      const handle = await driver.spawnWorker({
        taskId: 'ch1-empirical-spawn',
        command: process.execPath,
        args: [scriptPath],
        cwd: tempDir,
        env: {
          EXPLICIT_TASK_VAR: 'ch1-task-explicit-data',
        },
      });

      const result = await handle.promise;
      assert.equal(result.status, 'completed');
      assert.equal(result.exitCode, 0);

      const childEnv = JSON.parse(result.stdout);

      // Verify host secrets stripped in actual spawned child process
      assert.equal(childEnv.AWS_SECRET_ACCESS_KEY, undefined);
      assert.equal(childEnv.OPENAI_API_KEY, undefined);
      assert.equal(childEnv.my_custom_password, undefined);

      // Verify safe variables and system PATH passed to child process
      assert.equal(childEnv.SAFE_CHALLENGER_KEY, 'ch1-safe-value-123');
      assert.equal(childEnv.EXPLICIT_TASK_VAR, 'ch1-task-explicit-data');
      assert.ok(childEnv.PATH !== undefined);
    });
  });
});
