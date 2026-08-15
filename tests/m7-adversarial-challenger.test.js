import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { PACKAGE_VERSION } from './helpers/package-version.js';

const execFileAsync = promisify(execFile);
const GELADA_BIN = path.resolve(process.cwd(), 'bin/gelada.js');

describe('M7 Empirical Challenger CLI Framework & Subcommand Suite', () => {
  describe('1. CLI Basic Invocation & Error Handling', () => {
    it('1.1 Help output contains all core subcommands and usage info', async () => {
      const { stdout, stderr } = await execFileAsync(process.execPath, [GELADA_BIN, '--help']);
      assert.match(stdout, /Usage: gelada/);
      assert.match(stdout, /setup/);
      assert.match(stdout, /doctor/);
      assert.match(stdout, /config/);
      assert.match(stdout, /task/);
      assert.match(stdout, /mcp/);
      assert.equal(stderr, '');
    });

    it('1.2 Version flag outputs configured version string', async () => {
      const { stdout, stderr } = await execFileAsync(process.execPath, [GELADA_BIN, '--version']);
      assert.equal(stdout.trim(), PACKAGE_VERSION);
      assert.equal(stderr, '');
    });

    it('1.3 Unknown subcommand returns non-zero exit code and error output', async () => {
      await assert.rejects(
        execFileAsync(process.execPath, [GELADA_BIN, 'unknown-subcommand']),
        (err) => {
          assert.notEqual(err.code, 0, 'Exit code should be non-zero for unknown command');
          const output = (err.stderr || '') + (err.stdout || '');
          assert.match(output, /unknown command/i);
          return true;
        },
      );
    });

    it('1.4 Unknown option returns non-zero exit code and error output', async () => {
      await assert.rejects(
        execFileAsync(process.execPath, [GELADA_BIN, '--invalid-option']),
        (err) => {
          assert.notEqual(err.code, 0, 'Exit code should be non-zero for unknown option');
          const output = (err.stderr || '') + (err.stdout || '');
          assert.match(output, /unknown option/i);
          return true;
        },
      );
    });

    it('1.5 Unknown subcommand under command group returns non-zero exit code', async () => {
      await assert.rejects(
        execFileAsync(process.execPath, [GELADA_BIN, 'task', 'invalid-task-cmd']),
        (err) => {
          assert.notEqual(err.code, 0, 'Exit code should be non-zero');
          const output = (err.stderr || '') + (err.stdout || '');
          assert.match(output, /unknown command/i);
          return true;
        },
      );
    });
  });

  describe('2. Gelada Doctor Command', () => {
    it('2.1 Doctor text output includes system check checklist', async () => {
      const { stdout } = await execFileAsync(process.execPath, [GELADA_BIN, 'doctor']);
      assert.match(stdout, /=== Gelada Diagnostic Check ===/);
      assert.match(stdout, /Node\.js Version/);
      assert.match(stdout, /Git CLI/);
      assert.match(stdout, /Config Directory/);
      assert.match(stdout, /System Status:/);
    });

    it('2.2 Doctor --json format outputs valid diagnostic JSON report', async () => {
      const { stdout } = await execFileAsync(process.execPath, [GELADA_BIN, 'doctor', '--json']);
      const report = JSON.parse(stdout);
      assert.ok(report.timestamp, 'Report should include timestamp');
      assert.ok(['ok', 'warn', 'error'].includes(report.overallStatus), 'overallStatus valid');
      assert.equal(typeof report.nodeVersion, 'string');
      assert.equal(typeof report.platform, 'string');
      assert.ok(Array.isArray(report.checks), 'checks should be an array');
      assert.ok(report.checks.length >= 3, 'Should run multiple checks');

      const nodeCheck = report.checks.find((c) => c.category === 'node');
      assert.ok(nodeCheck, 'Should include Node.js check');
      assert.equal(nodeCheck.status, 'pass');
    });

    it('2.3 Doctor --verbose outputs detailed check metadata', async () => {
      const { stdout } = await execFileAsync(process.execPath, [
        GELADA_BIN,
        'doctor',
        '--verbose',
      ]);
      assert.match(stdout, /Details:/);
    });
  });

  describe('3. Gelada Setup Command', () => {
    let tmpSetupDir;

    before(() => {
      tmpSetupDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gelada-m7-setup-'));
    });

    after(() => {
      if (tmpSetupDir && fs.existsSync(tmpSetupDir)) {
        fs.rmSync(tmpSetupDir, { recursive: true, force: true });
      }
    });

    it('3.1 Setup initializes config directory and default config file', async () => {
      const targetConfigDir = path.join(tmpSetupDir, 'test-config-1');
      const { stdout } = await execFileAsync(
        process.execPath,
        [GELADA_BIN, 'setup', '--json'],
        {
          env: { ...process.env, GELADA_CONFIG_DIR: targetConfigDir },
        },
      );
      const res = JSON.parse(stdout);
      assert.equal(res.success, true);
      assert.equal(res.createdConfigFile, true);
      assert.ok(fs.existsSync(res.configFile), 'config.json should exist');

      const configContent = JSON.parse(fs.readFileSync(res.configFile, 'utf-8'));
      assert.equal(configContent.version, undefined, 'no schema version is written any more');
      assert.equal(configContent.worker.command, 'agy');
    });

    it('3.2 Re-running setup without --force does not overwrite existing config', async () => {
      const targetConfigDir = path.join(tmpSetupDir, 'test-config-1');
      const configFile = path.join(targetConfigDir, 'config.json');

      // Modify existing file
      const customConfig = JSON.parse(fs.readFileSync(configFile, 'utf-8'));
      customConfig.worker.command = 'custom-worker';
      fs.writeFileSync(configFile, JSON.stringify(customConfig, null, 2), 'utf-8');

      const { stdout } = await execFileAsync(
        process.execPath,
        [GELADA_BIN, 'setup', '--json'],
        {
          env: { ...process.env, GELADA_CONFIG_DIR: targetConfigDir },
        },
      );
      const res = JSON.parse(stdout);
      assert.equal(res.success, true);
      assert.equal(res.createdConfigFile, false, 'Should not overwrite existing file');

      const currentContent = JSON.parse(fs.readFileSync(configFile, 'utf-8'));
      assert.equal(currentContent.worker.command, 'custom-worker', 'Custom command preserved');
    });

    it('3.3 Setup with --force overwrites existing config file', async () => {
      const targetConfigDir = path.join(tmpSetupDir, 'test-config-1');
      const configFile = path.join(targetConfigDir, 'config.json');

      const { stdout } = await execFileAsync(
        process.execPath,
        [GELADA_BIN, 'setup', '--force', '--json'],
        {
          env: { ...process.env, GELADA_CONFIG_DIR: targetConfigDir },
        },
      );
      const res = JSON.parse(stdout);
      assert.equal(res.success, true);
      assert.equal(res.createdConfigFile, true, 'Should overwrite file with --force');

      const currentContent = JSON.parse(fs.readFileSync(configFile, 'utf-8'));
      assert.equal(currentContent.worker.command, 'agy', 'Reset to default agy worker');
    });
  });

  describe('4. Gelada Config Command Group', () => {
    let tmpConfigDir;

    before(async () => {
      tmpConfigDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gelada-m7-config-'));
      await execFileAsync(process.execPath, [GELADA_BIN, 'setup'], {
        env: { ...process.env, GELADA_CONFIG_DIR: tmpConfigDir },
      });
    });

    after(() => {
      if (tmpConfigDir && fs.existsSync(tmpConfigDir)) {
        fs.rmSync(tmpConfigDir, { recursive: true, force: true });
      }
    });

    it('4.1 Config list displays JSON formatted settings', async () => {
      const { stdout } = await execFileAsync(
        process.execPath,
        [GELADA_BIN, 'config', 'list', '--json'],
        {
          env: { ...process.env, GELADA_CONFIG_DIR: tmpConfigDir },
        },
      );
      const cfg = JSON.parse(stdout);
      // No `version`: the config carried a schema version that no code ever
      // read, so it promised a compatibility guarantee that did not exist.
      assert.equal(cfg.version, undefined);
      assert.equal(cfg.worker.command, 'agy');
      assert.equal(cfg.policy.mode, 'strict');
    });

    it('4.2 Config get resolves primitive and nested dot-notation keys', async () => {
      const { stdout: modeOut } = await execFileAsync(
        process.execPath,
        [GELADA_BIN, 'config', 'get', 'policy.mode'],
        {
          env: { ...process.env, GELADA_CONFIG_DIR: tmpConfigDir },
        },
      );
      assert.equal(modeOut.trim(), 'strict');

      const { stdout: timeoutOut } = await execFileAsync(
        process.execPath,
        [GELADA_BIN, 'config', 'get', 'worker.timeoutSeconds'],
        {
          env: { ...process.env, GELADA_CONFIG_DIR: tmpConfigDir },
        },
      );
      assert.equal(timeoutOut.trim(), '300');
    });

    it('4.3 Config get for non-existent key exits with error code', async () => {
      await assert.rejects(
        execFileAsync(process.execPath, [GELADA_BIN, 'config', 'get', 'non.existent.key'], {
          env: { ...process.env, GELADA_CONFIG_DIR: tmpConfigDir },
        }),
        (err) => {
          assert.notEqual(err.code, 0);
          assert.match(err.stderr || err.stdout, /Key 'non.existent.key' not found/);
          return true;
        },
      );
    });

    it('4.4 Config set modifies nested dot-notation properties with type coercion', async () => {
      // Set numeric value
      await execFileAsync(
        process.execPath,
        [GELADA_BIN, 'config', 'set', 'worker.timeoutSeconds', '600'],
        {
          env: { ...process.env, GELADA_CONFIG_DIR: tmpConfigDir },
        },
      );

      // Set boolean value
      await execFileAsync(
        process.execPath,
        [GELADA_BIN, 'config', 'set', 'logging.logToFile', 'false'],
        {
          env: { ...process.env, GELADA_CONFIG_DIR: tmpConfigDir },
        },
      );

      // Set string value in new nested path
      await execFileAsync(
        process.execPath,
        [GELADA_BIN, 'config', 'set', 'custom.nested.key', 'test-value'],
        {
          env: { ...process.env, GELADA_CONFIG_DIR: tmpConfigDir },
        },
      );

      const { stdout } = await execFileAsync(
        process.execPath,
        [GELADA_BIN, 'config', 'list', '--json'],
        {
          env: { ...process.env, GELADA_CONFIG_DIR: tmpConfigDir },
        },
      );
      const cfg = JSON.parse(stdout);
      assert.equal(cfg.worker.timeoutSeconds, 600);
      assert.equal(cfg.logging.logToFile, false);
      assert.equal(cfg.custom.nested.key, 'test-value');
    });

    it('4.5 Config path outputs absolute path to configuration file', async () => {
      const { stdout } = await execFileAsync(
        process.execPath,
        [GELADA_BIN, 'config', 'path'],
        {
          env: { ...process.env, GELADA_CONFIG_DIR: tmpConfigDir },
        },
      );
      assert.equal(stdout.trim(), path.join(tmpConfigDir, 'config.json'));
    });
  });

  describe('5. Gelada Task Command Group', () => {
    it('5.1 Task inspect returns structured task metadata', async () => {
      const { stdout } = await execFileAsync(process.execPath, [
        GELADA_BIN,
        'task',
        'inspect',
        'task-m7-001',
        '--json',
      ]);
      const res = JSON.parse(stdout);
      assert.equal(res.taskId, 'task-m7-001');
      assert.equal(res.mode, 'summary');
      assert.equal(res.status, 'COMPLETED');
      assert.ok(res.artifactPath);
    });

    it('5.2 Task patch applies revision note and file path', async () => {
      const { stdout } = await execFileAsync(process.execPath, [
        GELADA_BIN,
        'task',
        'patch',
        'task-m7-001',
        '-m',
        'Update logic',
        '--json',
      ]);
      const res = JSON.parse(stdout);
      assert.equal(res.taskId, 'task-m7-001');
      assert.equal(res.patchApplied, true);
      assert.equal(res.message, 'Update logic');
    });

    it('5.3 Task patch with invalid file path fails with non-zero code', async () => {
      await assert.rejects(
        execFileAsync(process.execPath, [
          GELADA_BIN,
          'task',
          'patch',
          'task-m7-001',
          '-f',
          '/non/existent/patch.file',
        ]),
        (err) => {
          assert.notEqual(err.code, 0);
          assert.match(err.stderr || err.stdout, /Patch file not found/);
          return true;
        },
      );
    });

    it('5.4 Task discard cancels task and cleans up worktree', async () => {
      const { stdout } = await execFileAsync(process.execPath, [
        GELADA_BIN,
        'task',
        'discard',
        'task-m7-001',
        '--force',
        '--json',
      ]);
      const res = JSON.parse(stdout);
      assert.equal(res.taskId, 'task-m7-001');
      assert.equal(res.status, 'CANCELLED');
      assert.equal(res.forced, true);
      assert.equal(res.worktreeCleaned, true);
    });
  });

  describe('6. Stdio Server Framing & Signal Shutdown (mcp serve)', () => {
    it('6.1 gelada mcp serve executes stdio JSON-RPC handshake and terminates cleanly on SIGINT', async () => {
      await new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [GELADA_BIN, 'mcp', 'serve'], {
          cwd: process.cwd(),
          stdio: ['pipe', 'pipe', 'pipe'],
        });

        let stderrData = '';
        let stdoutData = '';
        let handshakeComplete = false;

        child.stderr.on('data', (chunk) => {
          stderrData += chunk.toString();
        });

        child.stdout.on('data', (chunk) => {
          stdoutData += chunk.toString();
          try {
            const lines = stdoutData.split('\n').filter((l) => l.trim().length > 0);
            for (const line of lines) {
              const msg = JSON.parse(line);
              if (msg.id === 101 && msg.result) {
                assert.equal(msg.result.serverInfo.name, 'gelada-mcp');
                handshakeComplete = true;
                child.kill('SIGINT');
              }
            }
          } catch {
            // frame incomplete
          }
        });

        child.on('exit', (code) => {
          try {
            assert.ok(handshakeComplete, 'Handshake should be completed before exit');
            assert.equal(code, 0, `Process should exit with code 0 on SIGINT, got ${code}`);
            assert.ok(
              stderrData.includes('SIGINT') || stderrData.includes('connected'),
              'Stderr log should confirm signal handling / connection',
            );
            resolve();
          } catch (err) {
            reject(err);
          }
        });

        const initPayload =
          JSON.stringify({
            jsonrpc: '2.0',
            id: 101,
            method: 'initialize',
            params: {
              protocolVersion: '2024-11-05',
              capabilities: {},
              clientInfo: { name: 'm7-challenger', version: '1.0.0' },
            },
          }) + '\n';

        child.stdin.write(initPayload);
      });
    });
  });

  describe('7. Zero-Argument Default Execution (mcp serve fallback)', () => {
    it('7.1 Running binary with 0 args defaults seamlessly to mcp serve stdio server', async () => {
      await new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [GELADA_BIN], {
          cwd: process.cwd(),
          stdio: ['pipe', 'pipe', 'pipe'],
        });

        let stderrData = '';
        let stdoutData = '';
        let handshakeComplete = false;

        child.stderr.on('data', (chunk) => {
          stderrData += chunk.toString();
        });

        child.stdout.on('data', (chunk) => {
          stdoutData += chunk.toString();
          try {
            const lines = stdoutData.split('\n').filter((l) => l.trim().length > 0);
            for (const line of lines) {
              const msg = JSON.parse(line);
              if (msg.id === 202 && msg.result) {
                assert.equal(msg.result.serverInfo.name, 'gelada-mcp');
                handshakeComplete = true;
                child.kill('SIGINT');
              }
            }
          } catch {
            // frame incomplete
          }
        });

        child.on('exit', (code) => {
          try {
            assert.ok(handshakeComplete, 'Handshake should be completed before exit');
            assert.equal(code, 0, `Zero-arg execution should exit with code 0 on SIGINT, got ${code}`);
            assert.ok(
              stderrData.includes('Gelada MCP server connected'),
              'Stderr log should confirm fallback launch of Gelada MCP server',
            );
            resolve();
          } catch (err) {
            reject(err);
          }
        });

        const initPayload =
          JSON.stringify({
            jsonrpc: '2.0',
            id: 202,
            method: 'initialize',
            params: {
              protocolVersion: '2024-11-05',
              capabilities: {},
              clientInfo: { name: 'm7-zero-arg-challenger', version: '1.0.0' },
            },
          }) + '\n';

        child.stdin.write(initPayload);
      });
    });
  });
});
