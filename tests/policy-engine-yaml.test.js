import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { PolicyEngine, parseYamlPolicyFile } from '../dist/components/policy-engine.js';

describe('PolicyEngine YAML Policy Loading & Priority Merging Suite', () => {
  let tempDir;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gelada-policy-yaml-test-'));
  });

  afterEach(() => {
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('1. Repository Policy Loading (.gelada/policy.yaml)', () => {
    it('should load valid .gelada/policy.yaml from target repository directory', () => {
      const geladaDir = path.join(tempDir, '.gelada');
      fs.mkdirSync(geladaDir, { recursive: true });
      const policyYaml = `
allowedTaskTypes:
  - unit-test
  - refactor
maxFiles: 15
maxLines: 400
taskTimeout: 120
maxRevisions: 5
defaultModelProfile: fast-coder
allowNetwork: true
`;
      fs.writeFileSync(path.join(geladaDir, 'policy.yaml'), policyYaml, 'utf8');

      const engine = new PolicyEngine(undefined, { repoPath: tempDir, autoLoad: false });
      const policy = engine.getEffectivePolicy();

      assert.equal(policy.maxFiles, 15);
      assert.equal(policy.maxLines, 400);
      assert.equal(policy.taskTimeout, 120);
      assert.equal(policy.maxRevisions, 5);
      assert.equal(policy.defaultModelProfile, 'fast-coder');
      assert.equal(policy.allowNetwork, true);
      assert.ok(policy.allowedTaskTypes?.has('unit-test'));
      assert.ok(policy.allowedTaskTypes?.has('refactor'));
      assert.equal(engine.getLoadErrors().length, 0);
    });

    it('should fall back to .gelada/policy.yml or .gelada/policy.json if policy.yaml is absent', () => {
      const geladaDir = path.join(tempDir, '.gelada');
      fs.mkdirSync(geladaDir, { recursive: true });
      const policyYml = `
maxFiles: 25
maxLines: 800
`;
      fs.writeFileSync(path.join(geladaDir, 'policy.yml'), policyYml, 'utf8');

      const engine = new PolicyEngine(undefined, { repoPath: tempDir, autoLoad: false });
      const policy = engine.getEffectivePolicy();

      assert.equal(policy.maxFiles, 25);
      assert.equal(policy.maxLines, 800);
    });
  });

  describe('2. Global Configuration Loading (config.yaml)', () => {
    it('should load valid config.yaml from global user config directory', () => {
      const globalConfigDir = path.join(tempDir, 'global-config');
      fs.mkdirSync(globalConfigDir, { recursive: true });
      const globalYaml = `
maxFiles: 50
maxLines: 1000
allowNetwork: false
defaultModelProfile: global-profile
disallowedTaskTypes:
  - security-audit
`;
      fs.writeFileSync(path.join(globalConfigDir, 'config.yaml'), globalYaml, 'utf8');

      const engine = new PolicyEngine(undefined, { globalConfigPath: globalConfigDir, autoLoad: false });
      const policy = engine.getEffectivePolicy();

      assert.equal(policy.maxFiles, 50);
      assert.equal(policy.maxLines, 1000);
      assert.equal(policy.allowNetwork, false);
      assert.equal(policy.defaultModelProfile, 'global-profile');
      assert.ok(policy.disallowedTaskTypes.has('security-audit'));
      assert.equal(engine.getLoadErrors().length, 0);
    });
  });

  describe('3. Missing Policy Files (Quiet Fallback)', () => {
    it('should quietly fall back to hardcoded defaults when no config/policy files exist', () => {
      const engine = new PolicyEngine(undefined, {
        repoPath: path.join(tempDir, 'non-existent-repo'),
        globalConfigPath: path.join(tempDir, 'non-existent-global'),
        autoLoad: false,
      });

      const policy = engine.getEffectivePolicy();
      assert.equal(policy.maxFiles, undefined);
      assert.equal(policy.maxLines, undefined);
      assert.equal(policy.allowNetwork, false);
      assert.equal(policy.allowShellChaining, false);
      assert.equal(policy.defaultModelProfile, 'default');
      assert.ok(policy.protectedPaths.includes('.git'));
      assert.equal(engine.getLoadErrors().length, 0);
    });
  });

  describe('4. Malformed YAML File Handling (Structured Error Handling)', () => {
    it('should return a structured PolicyLoadError for malformed YAML syntax without crashing', () => {
      const geladaDir = path.join(tempDir, '.gelada');
      fs.mkdirSync(geladaDir, { recursive: true });
      const malformedYaml = `
allowedTaskTypes: [unit-test,
maxFiles: 10
  invalid_indentation: [foo: bar
`;
      const policyPath = path.join(geladaDir, 'policy.yaml');
      fs.writeFileSync(policyPath, malformedYaml, 'utf8');

      const parseRes = parseYamlPolicyFile(policyPath);
      assert.ok(parseRes.error);
      assert.equal(parseRes.error.code, 'MALFORMED_YAML');
      assert.equal(parseRes.error.filePath, policyPath);
      assert.ok(parseRes.error.message.includes('Failed to parse YAML'));

      const engine = new PolicyEngine(undefined, { repoPath: tempDir, autoLoad: false });
      const errors = engine.getLoadErrors();
      assert.equal(errors.length, 1);
      assert.equal(errors[0].code, 'MALFORMED_YAML');
      assert.equal(errors[0].filePath, policyPath);

      // Verify engine falls back safely to default limits and does not crash
      const policy = engine.getEffectivePolicy();
      assert.ok(policy.protectedPaths.includes('.git'));
    });

    it('should return INVALID_STRUCTURE error for non-object top-level YAML content', () => {
      const filePath = path.join(tempDir, 'scalar.yaml');
      fs.writeFileSync(filePath, '"Just a string content"', 'utf8');

      const parseRes = parseYamlPolicyFile(filePath);
      assert.ok(parseRes.error);
      assert.equal(parseRes.error.code, 'INVALID_STRUCTURE');
      assert.ok(parseRes.error.message.includes('must contain a top-level mapping/object'));
    });
  });

  describe('5. Priority Merging & Permission Narrowing Engine', () => {
    it('should cap numeric limits via Math.min across active priority tiers (Global caps Project)', () => {
      const globalConfigDir = path.join(tempDir, 'global');
      fs.mkdirSync(globalConfigDir, { recursive: true });
      fs.writeFileSync(
        path.join(globalConfigDir, 'config.yaml'),
        `maxFiles: 30\nmaxLines: 500\ntaskTimeout: 300`,
        'utf8',
      );

      const repoDir = path.join(tempDir, 'repo');
      const geladaDir = path.join(repoDir, '.gelada');
      fs.mkdirSync(geladaDir, { recursive: true });
      // Project policy attempts to expand maxFiles to 100, but narrow maxLines to 200
      fs.writeFileSync(
        path.join(geladaDir, 'policy.yaml'),
        `maxFiles: 100\nmaxLines: 200\ntaskTimeout: 600`,
        'utf8',
      );

      const engine = new PolicyEngine(undefined, {
        globalConfigPath: globalConfigDir,
        repoPath: repoDir,
        autoLoad: false,
      });

      const policy = engine.getEffectivePolicy();
      // maxFiles is capped at 30 (Global limit overrides higher Project attempt)
      assert.equal(policy.maxFiles, 30);
      // maxLines is narrowed to 200 (Project lower limit restricts Global 500)
      assert.equal(policy.maxLines, 200);
      // taskTimeout is capped at 300 (Global limit overrides higher Project 600)
      assert.equal(policy.taskTimeout, 300);
    });

    it('should compute Set Intersection for task type whitelists across active tiers', () => {
      const globalConfigDir = path.join(tempDir, 'global');
      fs.mkdirSync(globalConfigDir, { recursive: true });
      fs.writeFileSync(
        path.join(globalConfigDir, 'config.yaml'),
        `allowedTaskTypes:\n  - unit-test\n  - refactor\n  - bugfix`,
        'utf8',
      );

      const repoDir = path.join(tempDir, 'repo');
      const geladaDir = path.join(repoDir, '.gelada');
      fs.mkdirSync(geladaDir, { recursive: true });
      // Project attempts to allow unit-test and documentation
      fs.writeFileSync(
        path.join(geladaDir, 'policy.yaml'),
        `allowedTaskTypes:\n  - unit-test\n  - documentation`,
        'utf8',
      );

      const engine = new PolicyEngine(undefined, {
        globalConfigPath: globalConfigDir,
        repoPath: repoDir,
        autoLoad: false,
      });

      const policy = engine.getEffectivePolicy();
      // Intersection of ['unit-test', 'refactor', 'bugfix'] and ['unit-test', 'documentation'] is ['unit-test']
      assert.ok(policy.allowedTaskTypes);
      assert.equal(policy.allowedTaskTypes.size, 1);
      assert.ok(policy.allowedTaskTypes.has('unit-test'));
      assert.equal(policy.allowedTaskTypes.has('documentation'), false);
      assert.equal(policy.allowedTaskTypes.has('refactor'), false);
    });

    it('should compute Set Union for blacklists (disallowedTaskTypes, protectedPaths, blockedExecutables)', () => {
      const globalConfigDir = path.join(tempDir, 'global');
      fs.mkdirSync(globalConfigDir, { recursive: true });
      fs.writeFileSync(
        path.join(globalConfigDir, 'config.yaml'),
        `disallowedTaskTypes:\n  - security-audit\ndisallowedCommands:\n  - npm\nprotectedPaths:\n  - config/secrets.yaml`,
        'utf8',
      );

      const repoDir = path.join(tempDir, 'repo');
      const geladaDir = path.join(repoDir, '.gelada');
      fs.mkdirSync(geladaDir, { recursive: true });
      fs.writeFileSync(
        path.join(geladaDir, 'policy.yaml'),
        `disallowedTaskTypes:\n  - db-migration\ndisallowedCommands:\n  - yarn\nalwaysProtectedPaths:\n  - build/private`,
        'utf8',
      );

      const engine = new PolicyEngine(undefined, {
        globalConfigPath: globalConfigDir,
        repoPath: repoDir,
        autoLoad: false,
      });

      const policy = engine.getEffectivePolicy();

      // Disallowed task types contains both security-audit and db-migration
      assert.ok(policy.disallowedTaskTypes.has('security-audit'));
      assert.ok(policy.disallowedTaskTypes.has('db-migration'));

      // Blocked executables contains hardcoded sudo, global npm, and project yarn
      assert.ok(policy.blockedExecutables.includes('sudo'));
      assert.ok(policy.blockedExecutables.includes('npm'));
      assert.ok(policy.blockedExecutables.includes('yarn'));

      // Protected paths contains hardcoded .git, global secrets, and project private
      assert.ok(policy.protectedPaths.includes('.git'));
      assert.ok(policy.protectedPaths.includes('config/secrets.yaml'));
      assert.ok(policy.protectedPaths.includes('build/private'));
    });

    it('should enforce Logical AND for boolean permissions (allowNetwork, allowShellChaining)', () => {
      const globalConfigDir = path.join(tempDir, 'global');
      fs.mkdirSync(globalConfigDir, { recursive: true });
      // Global config restricts allowNetwork to false
      fs.writeFileSync(path.join(globalConfigDir, 'config.yaml'), `allowNetwork: false`, 'utf8');

      const repoDir = path.join(tempDir, 'repo');
      const geladaDir = path.join(repoDir, '.gelada');
      fs.mkdirSync(geladaDir, { recursive: true });
      // Project policy attempts to expand allowNetwork to true
      fs.writeFileSync(path.join(geladaDir, 'policy.yaml'), `allowNetwork: true`, 'utf8');

      const engine = new PolicyEngine(undefined, {
        globalConfigPath: globalConfigDir,
        repoPath: repoDir,
        autoLoad: false,
      });

      const policy = engine.getEffectivePolicy();
      // Project policy cannot override Global config false -> effective remains false
      assert.equal(policy.allowNetwork, false);
    });

    it('should allow enabling boolean permissions when all active tiers permit it', () => {
      const globalConfigDir = path.join(tempDir, 'global');
      fs.mkdirSync(globalConfigDir, { recursive: true });
      fs.writeFileSync(path.join(globalConfigDir, 'config.yaml'), `allowNetwork: true`, 'utf8');

      const repoDir = path.join(tempDir, 'repo');
      const geladaDir = path.join(repoDir, '.gelada');
      fs.mkdirSync(geladaDir, { recursive: true });
      fs.writeFileSync(path.join(geladaDir, 'policy.yaml'), `allowNetwork: true`, 'utf8');

      const engine = new PolicyEngine(undefined, {
        globalConfigPath: globalConfigDir,
        repoPath: repoDir,
        autoLoad: false,
      });

      assert.equal(engine.getEffectivePolicy().allowNetwork, true);
    });
  });

  describe('6. Task Type Validation (validateTaskType)', () => {
    it('should validate task types against effective whitelist and blacklist', () => {
      const engine = new PolicyEngine({
        allowedTaskTypes: ['unit-test', 'refactor'],
        disallowedTaskTypes: ['refactor', 'deploy'],
      });

      // Whitelisted & not blacklisted -> allowed
      const testCheck = engine.validateTaskType('unit-test');
      assert.equal(testCheck.allowed, true);

      // In blacklist -> DISALLOWED_TASK_TYPE
      const refactorCheck = engine.validateTaskType('refactor');
      assert.equal(refactorCheck.allowed, false);
      assert.equal(refactorCheck.code, 'DISALLOWED_TASK_TYPE');

      // Not in whitelist -> TASK_TYPE_NOT_ALLOWED
      const docsCheck = engine.validateTaskType('documentation');
      assert.equal(docsCheck.allowed, false);
      assert.equal(docsCheck.code, 'TASK_TYPE_NOT_ALLOWED');

      // Invalid input -> INVALID_TASK_TYPE
      const emptyCheck = engine.validateTaskType('');
      assert.equal(emptyCheck.allowed, false);
      assert.equal(emptyCheck.code, 'INVALID_TASK_TYPE');
    });
  });

  describe('7. Diff Limits Validation (validateDiffLimits)', () => {
    it('should enforce maxFiles and maxLines limits cleanly', () => {
      const engine = new PolicyEngine({
        maxFiles: 5,
        maxLines: 100,
      });

      // Within limits -> allowed
      const validCheck = engine.validateDiffLimits(3, 50);
      assert.equal(validCheck.allowed, true);

      // Exceeding maxFiles -> MAX_FILES_EXCEEDED
      const filesExceeded = engine.validateDiffLimits(6, 50);
      assert.equal(filesExceeded.allowed, false);
      assert.equal(filesExceeded.code, 'MAX_FILES_EXCEEDED');

      // Exceeding maxLines -> MAX_LINES_EXCEEDED
      const linesExceeded = engine.validateDiffLimits(3, 150);
      assert.equal(linesExceeded.allowed, false);
      assert.equal(linesExceeded.code, 'MAX_LINES_EXCEEDED');

      // Invalid arguments -> INVALID_LIMIT
      const invalidArg = engine.validateDiffLimits(-1, 50);
      assert.equal(invalidArg.allowed, false);
      assert.equal(invalidArg.code, 'INVALID_LIMIT');
    });
  });

  describe('8. Task Timeout & Revision Count Validation', () => {
    it('should validate task timeout and max revisions limits', () => {
      const engine = new PolicyEngine({
        taskTimeout: 300,
        maxRevisions: 3,
      });

      assert.equal(engine.validateTaskTimeout(200).allowed, true);
      assert.equal(engine.validateTaskTimeout(400).code, 'TIMEOUT_EXCEEDED');

      assert.equal(engine.validateRevisionCount(2).allowed, true);
      assert.equal(engine.validateRevisionCount(4).code, 'MAX_REVISIONS_EXCEEDED');
    });
  });

  describe('9. Forward Compatibility (Unknown Fields)', () => {
    it('should ignore unknown fields in YAML policy files without crashing or erroring', () => {
      const geladaDir = path.join(tempDir, '.gelada');
      fs.mkdirSync(geladaDir, { recursive: true });
      const futureYaml = `
maxFiles: 10
isolationLevel: container
futureFeatureFlag: true
nestedUnknownSection:
  foo: bar
`;
      fs.writeFileSync(path.join(geladaDir, 'policy.yaml'), futureYaml, 'utf8');

      const engine = new PolicyEngine(undefined, { repoPath: tempDir, autoLoad: false });
      const policy = engine.getEffectivePolicy();

      assert.equal(policy.maxFiles, 10);
      assert.equal(engine.getLoadErrors().length, 0);
    });
  });

  describe('10. Severely Malformed YAML & Syntax Errors', () => {
    it('should catch YAML syntax errors, unclosed quotes, and bad flow structures without crashing', () => {
      const cases = [
        { name: 'unclosed list', content: 'allowedTaskTypes: [unit-test, refactor\nmaxFiles: 10' },
        { name: 'unclosed flow mapping', content: 'config: { key: value, unclosed: true' },
        { name: 'unclosed quote string', content: 'defaultModelProfile: "unclosed string profile' },
        { name: 'deep unclosed structure', content: 'foo: [bar: {baz' },
        { name: 'unclosed nested sequence', content: 'allowedTaskTypes: [[[unit-test' },
      ];

      for (const tc of cases) {
        const filePath = path.join(tempDir, `malformed-${Date.now()}-${Math.random().toString(36).substring(2)}.yaml`);
        fs.writeFileSync(filePath, tc.content, 'utf8');

        let res;
        assert.doesNotThrow(() => {
          res = parseYamlPolicyFile(filePath);
        }, `parseYamlPolicyFile should not throw for ${tc.name}`);

        assert.ok(res.error, `Should produce error for ${tc.name}`);
        assert.equal(res.error.code, 'MALFORMED_YAML', `Error code should be MALFORMED_YAML for ${tc.name}`);
        assert.equal(res.error.filePath, filePath);
        assert.ok(typeof res.error.message === 'string' && res.error.message.length > 0);
      }
    });

    it('should handle recursive anchor aliases / cyclic reference YAML cleanly', () => {
      const cyclicYaml = `
anchor: &ref
  foo: *ref
`;
      const filePath = path.join(tempDir, 'cyclic.yaml');
      fs.writeFileSync(filePath, cyclicYaml, 'utf8');

      let res;
      assert.doesNotThrow(() => {
        res = parseYamlPolicyFile(filePath);
      });
      if (res.error) {
        assert.equal(res.error.code, 'MALFORMED_YAML');
      } else {
        assert.ok(res.config);
      }
    });
  });

  describe('11. Non-Object Roots in YAML Files', () => {
    it('should return INVALID_STRUCTURE error for arrays, strings, numbers, booleans, dates', () => {
      const nonObjectCases = [
        { name: 'array root', content: '- item1\n- item2\n- item3' },
        { name: 'inline array root', content: '[1, 2, 3, 4]' },
        { name: 'string root', content: '"Just a plain string root"' },
        { name: 'unquoted string root', content: 'hello world' },
        { name: 'number root', content: '42.5' },
        { name: 'boolean true root', content: 'true' },
        { name: 'boolean false root', content: 'false' },
        { name: 'ISO timestamp root', content: '2026-07-26T01:02:12Z' },
        { name: 'raw binary buffer', buffer: Buffer.from([0x80, 0xff, 0xfe, 0xfd, 0x00, 0x01, 0x02, 0x03]) },
      ];

      for (const tc of nonObjectCases) {
        const filePath = path.join(tempDir, `non-object-${Date.now()}-${Math.random().toString(36).substring(2)}.yaml`);
        if (tc.buffer) {
          fs.writeFileSync(filePath, tc.buffer);
        } else {
          fs.writeFileSync(filePath, tc.content, 'utf8');
        }

        let res;
        assert.doesNotThrow(() => {
          res = parseYamlPolicyFile(filePath);
        }, `parseYamlPolicyFile should not throw for ${tc.name}`);

        assert.ok(res.error, `Should produce error for ${tc.name}`);
        assert.equal(res.error.code, 'INVALID_STRUCTURE', `Error code should be INVALID_STRUCTURE for ${tc.name}`);
        assert.equal(res.error.filePath, filePath);
        assert.ok(res.error.message.includes('must contain a top-level mapping/object'));
      }
    });

    it('should return empty config {} without error for empty files, null, or comments-only files', () => {
      const emptyCases = [
        { name: '0-byte empty file', content: '' },
        { name: 'whitespace only', content: '   \n\t  \n' },
        { name: 'comments only', content: '# This is a policy file\n# All settings defaulted\n' },
        { name: 'explicit null', content: 'null' },
        { name: 'tilde null', content: '~' },
      ];

      for (const tc of emptyCases) {
        const filePath = path.join(tempDir, `empty-${Date.now()}-${Math.random().toString(36).substring(2)}.yaml`);
        fs.writeFileSync(filePath, tc.content, 'utf8');

        let res;
        assert.doesNotThrow(() => {
          res = parseYamlPolicyFile(filePath);
        }, `parseYamlPolicyFile should not throw for ${tc.name}`);

        assert.equal(res.error, undefined, `No error should occur for ${tc.name}`);
        assert.deepEqual(res.config, {}, `Config should be empty object for ${tc.name}`);
      }
    });
  });

  describe('12. Unknown Schema Fields and Deeply Nested Properties', () => {
    it('should cleanly ignore top-level unknown scalar, array, and object properties', () => {
      const unknownYaml = `
maxFiles: 12
unknownScalar: "some value"
unknownNumber: 999
unknownArray:
  - a
  - b
unknownObject:
  nestedField: true
  deeply:
    nested:
      array: [1, 2, 3]
`;
      const geladaDir = path.join(tempDir, '.gelada');
      fs.mkdirSync(geladaDir, { recursive: true });
      const policyPath = path.join(geladaDir, 'policy.yaml');
      fs.writeFileSync(policyPath, unknownYaml, 'utf8');

      const engine = new PolicyEngine(undefined, { repoPath: tempDir, autoLoad: false });
      const policy = engine.getEffectivePolicy();

      assert.equal(policy.maxFiles, 12);
      assert.equal(engine.getLoadErrors().length, 0);
    });

    it('should handle schema field type mismatches gracefully without crashing', () => {
      const invalidTypesYaml = `
maxFiles: "invalid_string_number"
maxLines: true
taskTimeout: [100, 200]
allowNetwork: "yes_string"
allowedTaskTypes: "string_instead_of_array"
protectedPaths: { key: "value" }
`;
      const geladaDir = path.join(tempDir, '.gelada');
      fs.mkdirSync(geladaDir, { recursive: true });
      fs.writeFileSync(path.join(geladaDir, 'policy.yaml'), invalidTypesYaml, 'utf8');

      const engine = new PolicyEngine(undefined, { repoPath: tempDir, autoLoad: false });
      const policy = engine.getEffectivePolicy();

      assert.equal(policy.maxFiles, undefined);
      assert.equal(policy.maxLines, undefined);
      assert.equal(policy.taskTimeout, undefined);
      assert.equal(policy.allowNetwork, false);
      assert.equal(policy.allowedTaskTypes, undefined);
      assert.equal(engine.getLoadErrors().length, 0);
    });

    it('should filter out non-string items from array/set fields like allowedTaskTypes and protectedPaths', () => {
      const mixedArrayYaml = `
allowedTaskTypes:
  - unit-test
  - 123
  - true
  - null
  - refactor
protectedPaths:
  - config/secrets.yaml
  - 456
  - false
`;
      const geladaDir = path.join(tempDir, '.gelada');
      fs.mkdirSync(geladaDir, { recursive: true });
      fs.writeFileSync(path.join(geladaDir, 'policy.yaml'), mixedArrayYaml, 'utf8');

      const engine = new PolicyEngine(undefined, { repoPath: tempDir, autoLoad: false });
      const policy = engine.getEffectivePolicy();

      assert.ok(policy.allowedTaskTypes?.has('unit-test'));
      assert.ok(policy.allowedTaskTypes?.has('refactor'));
      assert.equal(policy.allowedTaskTypes?.size, 2);
      assert.ok(policy.protectedPaths.includes('config/secrets.yaml'));
      assert.equal(engine.getLoadErrors().length, 0);
    });
  });

  describe('13. Field Alias Variations and Precedence Rules', () => {
    it('should support maxFilesChanged as alias for maxFiles, preferring maxFiles when both present', () => {
      const aliasOnlyYaml = `maxFilesChanged: 18`;

      const geladaDir1 = path.join(tempDir, 'repo1', '.gelada');
      fs.mkdirSync(geladaDir1, { recursive: true });
      fs.writeFileSync(path.join(geladaDir1, 'policy.yaml'), aliasOnlyYaml, 'utf8');

      const engine1 = new PolicyEngine(undefined, { repoPath: path.join(tempDir, 'repo1'), autoLoad: false });
      assert.equal(engine1.getEffectivePolicy().maxFiles, 18);

      const bothYaml = `maxFiles: 7\nmaxFilesChanged: 42`;
      const geladaDir2 = path.join(tempDir, 'repo2', '.gelada');
      fs.mkdirSync(geladaDir2, { recursive: true });
      fs.writeFileSync(path.join(geladaDir2, 'policy.yaml'), bothYaml, 'utf8');

      const engine2 = new PolicyEngine(undefined, { repoPath: path.join(tempDir, 'repo2'), autoLoad: false });
      assert.equal(engine2.getEffectivePolicy().maxFiles, 7);
    });

    it('should support maxLinesChanged as alias for maxLines, preferring maxLines when both present', () => {
      const aliasOnlyYaml = `maxLinesChanged: 350`;
      const geladaDir1 = path.join(tempDir, 'repo-line1', '.gelada');
      fs.mkdirSync(geladaDir1, { recursive: true });
      fs.writeFileSync(path.join(geladaDir1, 'policy.yaml'), aliasOnlyYaml, 'utf8');

      const engine1 = new PolicyEngine(undefined, { repoPath: path.join(tempDir, 'repo-line1'), autoLoad: false });
      assert.equal(engine1.getEffectivePolicy().maxLines, 350);

      const bothYaml = `maxLines: 150\nmaxLinesChanged: 999`;
      const geladaDir2 = path.join(tempDir, 'repo-line2', '.gelada');
      fs.mkdirSync(geladaDir2, { recursive: true });
      fs.writeFileSync(path.join(geladaDir2, 'policy.yaml'), bothYaml, 'utf8');

      const engine2 = new PolicyEngine(undefined, { repoPath: path.join(tempDir, 'repo-line2'), autoLoad: false });
      assert.equal(engine2.getEffectivePolicy().maxLines, 150);
    });

    it('should support taskTimeout vs timeoutSeconds vs timeout precedence chain', () => {
      const repo1 = path.join(tempDir, 't1');
      fs.mkdirSync(path.join(repo1, '.gelada'), { recursive: true });
      fs.writeFileSync(path.join(repo1, '.gelada', 'policy.yaml'), `timeout: 60`, 'utf8');
      assert.equal(new PolicyEngine(undefined, { repoPath: repo1, autoLoad: false }).getEffectivePolicy().taskTimeout, 60);

      const repo2 = path.join(tempDir, 't2');
      fs.mkdirSync(path.join(repo2, '.gelada'), { recursive: true });
      fs.writeFileSync(path.join(repo2, '.gelada', 'policy.yaml'), `timeoutSeconds: 120\ntimeout: 60`, 'utf8');
      assert.equal(new PolicyEngine(undefined, { repoPath: repo2, autoLoad: false }).getEffectivePolicy().taskTimeout, 120);

      const repo3 = path.join(tempDir, 't3');
      fs.mkdirSync(path.join(repo3, '.gelada'), { recursive: true });
      fs.writeFileSync(path.join(repo3, '.gelada', 'policy.yaml'), `taskTimeout: 240\ntimeoutSeconds: 120\ntimeout: 60`, 'utf8');
      assert.equal(new PolicyEngine(undefined, { repoPath: repo3, autoLoad: false }).getEffectivePolicy().taskTimeout, 240);
    });

    it('should support maxRevisionCount as alias for maxRevisions', () => {
      const repo1 = path.join(tempDir, 'rev1');
      fs.mkdirSync(path.join(repo1, '.gelada'), { recursive: true });
      fs.writeFileSync(path.join(repo1, '.gelada', 'policy.yaml'), `maxRevisionCount: 8`, 'utf8');
      assert.equal(new PolicyEngine(undefined, { repoPath: repo1, autoLoad: false }).getEffectivePolicy().maxRevisions, 8);

      const repo2 = path.join(tempDir, 'rev2');
      fs.mkdirSync(path.join(repo2, '.gelada'), { recursive: true });
      fs.writeFileSync(path.join(repo2, '.gelada', 'policy.yaml'), `maxRevisions: 3\nmaxRevisionCount: 8`, 'utf8');
      assert.equal(new PolicyEngine(undefined, { repoPath: repo2, autoLoad: false }).getEffectivePolicy().maxRevisions, 3);
    });

    it('should combine allowedCommands and allowedVerificationCommands', () => {
      const repo = path.join(tempDir, 'cmds');
      fs.mkdirSync(path.join(repo, '.gelada'), { recursive: true });
      fs.writeFileSync(
        path.join(repo, '.gelada', 'policy.yaml'),
        `allowedCommands:\n  - npm test\nallowedVerificationCommands:\n  - cargo test`,
        'utf8',
      );
      const engine = new PolicyEngine(undefined, { repoPath: repo, autoLoad: false });
      const allowedCmds = engine.getEffectivePolicy().allowedCommands;
      assert.ok(allowedCmds);
      assert.ok(allowedCmds.has('npm test'));
      assert.ok(allowedCmds.has('cargo test'));
    });

    it('should combine protectedPaths and alwaysProtectedPaths', () => {
      const repo = path.join(tempDir, 'prot');
      fs.mkdirSync(path.join(repo, '.gelada'), { recursive: true });
      fs.writeFileSync(
        path.join(repo, '.gelada', 'policy.yaml'),
        `protectedPaths:\n  - secrets.json\nalwaysProtectedPaths:\n  - private.key`,
        'utf8',
      );
      const engine = new PolicyEngine(undefined, { repoPath: repo, autoLoad: false });
      const protectedPaths = engine.getEffectivePolicy().protectedPaths;
      assert.ok(protectedPaths.includes('secrets.json'));
      assert.ok(protectedPaths.includes('private.key'));
    });
  });

  describe('14. Missing Files, Directories, and Path Resolution Edge Cases', () => {
    it('should return READ_ERROR when attempting to parse a directory path as a file', () => {
      const dirPath = path.join(tempDir, 'directory-target');
      fs.mkdirSync(dirPath, { recursive: true });

      let res;
      assert.doesNotThrow(() => {
        res = parseYamlPolicyFile(dirPath);
      });
      assert.ok(res.error);
      assert.equal(res.error.code, 'READ_ERROR');
      assert.equal(res.error.filePath, dirPath);
      assert.ok(res.error.message.includes('Failed to read policy file'));
    });

    it('should return empty result when file does not exist', () => {
      const nonExistentPath = path.join(tempDir, 'does-not-exist.yaml');
      const res = parseYamlPolicyFile(nonExistentPath);
      assert.deepEqual(res, {});
    });

    it('should handle non-existent directories gracefully in loadGlobalConfig and loadProjectPolicy', () => {
      const engine = new PolicyEngine();
      const resGlobal = engine.loadGlobalConfig(path.join(tempDir, 'nonexistent-dir'));
      assert.deepEqual(resGlobal, {});

      const resProject = engine.loadProjectPolicy(path.join(tempDir, 'nonexistent-repo'));
      assert.deepEqual(resProject, {});

      assert.equal(engine.getLoadErrors().length, 0);
    });

    it('should handle home directory expansion (~/...) in custom config paths', () => {
      const engine = new PolicyEngine();
      assert.doesNotThrow(() => {
        engine.loadGlobalConfig('~/nonexistent-gelada-config-dir-12345');
      });
    });
  });

  describe('15. Comprehensive Exception Safety & Fault Tolerance Guarantee', () => {
    it('should NEVER throw an unhandled exception for any load/parse invocation across all error types', () => {
      const engine = new PolicyEngine(undefined, { autoLoad: false });

      const malformedFile = path.join(tempDir, 'err1.yaml');
      fs.writeFileSync(malformedFile, 'foo: [bar: {baz', 'utf8');

      const dirFile = path.join(tempDir, 'err2.dir');
      fs.mkdirSync(dirFile);

      const scalarFile = path.join(tempDir, 'err3.yaml');
      fs.writeFileSync(scalarFile, '123456', 'utf8');

      assert.doesNotThrow(() => {
        // Direct parseYamlPolicyFile on directory produces READ_ERROR
        const dirRes = parseYamlPolicyFile(dirFile);
        assert.equal(dirRes.error?.code, 'READ_ERROR');

        // Engine loading malformed & scalar files records MALFORMED_YAML and INVALID_STRUCTURE
        engine.loadGlobalConfig(malformedFile);
        engine.loadGlobalConfig(scalarFile);
      });

      const errors = engine.getLoadErrors();
      assert.equal(errors.length, 2);
      assert.equal(errors[0].code, 'MALFORMED_YAML');
      assert.equal(errors[1].code, 'INVALID_STRUCTURE');
    });
  });

  describe('16. Priority Narrowing & Security Fix Verification', () => {
    it('should reject all task types and commands when whitelist intersection yields empty set Set([])', () => {
      const globalDir = path.join(tempDir, 'yaml-disjoint-global');
      fs.mkdirSync(globalDir, { recursive: true });
      fs.writeFileSync(path.join(globalDir, 'config.yaml'), 'allowedTaskTypes:\n  - unit-test\nallowedCommands:\n  - npm test', 'utf8');

      const repoDir = path.join(tempDir, 'yaml-disjoint-repo');
      const geladaDir = path.join(repoDir, '.gelada');
      fs.mkdirSync(geladaDir, { recursive: true });
      fs.writeFileSync(path.join(geladaDir, 'policy.yaml'), 'allowedTaskTypes:\n  - refactor\nallowedCommands:\n  - cargo test', 'utf8');

      const engine = new PolicyEngine(undefined, { globalConfigPath: globalDir, repoPath: repoDir, autoLoad: false });
      assert.equal(engine.validateTaskType('unit-test').allowed, false);
      assert.equal(engine.validateTaskType('refactor').allowed, false);
      assert.equal(engine.validateVerificationCommand('npm test').allowed, false);
      assert.equal(engine.validateVerificationCommand('cargo test').allowed, false);
    });

    it('should narrow allowedTaskTypes to empty set when policy specifies explicit empty array allowedTaskTypes: []', () => {
      const globalDir = path.join(tempDir, 'yaml-empty-global');
      fs.mkdirSync(globalDir, { recursive: true });
      fs.writeFileSync(path.join(globalDir, 'config.yaml'), 'allowedTaskTypes:\n  - unit-test', 'utf8');

      const repoDir = path.join(tempDir, 'yaml-empty-repo');
      const geladaDir = path.join(repoDir, '.gelada');
      fs.mkdirSync(geladaDir, { recursive: true });
      fs.writeFileSync(path.join(geladaDir, 'policy.yaml'), 'allowedTaskTypes: []', 'utf8');

      const engine = new PolicyEngine(undefined, { globalConfigPath: globalDir, repoPath: repoDir, autoLoad: false });
      assert.equal(engine.validateTaskType('unit-test').allowed, false);
      assert.equal(engine.getEffectivePolicy().allowedTaskTypes?.size, 0);
    });

    it('should narrow allowedActions via Set Intersection and prevent requestConfig from granting unpermitted actions', () => {
      const engine = new PolicyEngine({ allowedActions: ['unregistered_action', 'delegate_task'] }, { autoLoad: false });
      assert.equal(engine.evaluateAction('unregistered_action').allowed, false);
      assert.equal(engine.evaluateAction('delegate_task').allowed, true);
    });

    it('should match multi-word disallowedCommands loaded from YAML', () => {
      const globalDir = path.join(tempDir, 'yaml-multi-disallowed-global');
      fs.mkdirSync(globalDir, { recursive: true });
      fs.writeFileSync(path.join(globalDir, 'config.yaml'), 'disallowedCommands:\n  - npm publish\n  - git push --force', 'utf8');

      const engine = new PolicyEngine(undefined, { globalConfigPath: globalDir, autoLoad: false });
      assert.equal(engine.validateVerificationCommand('npm publish --access public').allowed, false);
      assert.equal(engine.validateVerificationCommand('git push --force origin main').allowed, false);
      assert.equal(engine.validateVerificationCommand('npm test').allowed, true);
    });
  });
});

