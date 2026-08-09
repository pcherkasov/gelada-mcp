import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ContractValidator } from '../dist/components/contract-validator.js';

describe('ContractValidator Unit Tests', () => {
  const validator = new ContractValidator();

  describe('1. validateContract', () => {
    it('should validate a minimal valid contract with required fields', () => {
      const res = validator.validateContract({
        taskId: 'task-101',
        description: 'Implement user login feature',
        targetDirectory: '/tmp/workspace/task-101',
      });
      assert.equal(res.valid, true);
      assert.equal(res.errors.length, 0);
    });

    it('should validate a fully populated valid contract with optional fields', () => {
      const res = validator.validateContract({
        taskId: 'task-102',
        description: 'Refactor database schema',
        targetDirectory: '/tmp/workspace/task-102',
        allowedTools: ['delegate_task', 'inspect_task'],
        maxDurationSeconds: 300,
      });
      assert.equal(res.valid, true);
      assert.equal(res.errors.length, 0);
    });

    it('should reject missing or empty taskId', () => {
      const res = validator.validateContract({
        taskId: '   ',
        description: 'Valid description',
        targetDirectory: '/tmp/workspace',
      });
      assert.equal(res.valid, false);
      assert.ok(res.errors.some((e) => e.includes('Task ID')));
    });

    it('should reject missing or empty description', () => {
      const res = validator.validateContract({
        taskId: 'task-103',
        description: '',
        targetDirectory: '/tmp/workspace',
      });
      assert.equal(res.valid, false);
      assert.ok(res.errors.some((e) => e.includes('Task description')));
    });

    it('should reject missing or empty targetDirectory', () => {
      const res = validator.validateContract({
        taskId: 'task-104',
        description: 'Valid description',
        targetDirectory: '   ',
      });
      assert.equal(res.valid, false);
      assert.ok(res.errors.some((e) => e.includes('Target directory')));
    });

    it('should reject non-positive or excessive maxDurationSeconds', () => {
      const resNeg = validator.validateContract({
        taskId: 'task-105',
        description: 'Valid description',
        targetDirectory: '/tmp/workspace',
        maxDurationSeconds: -50,
      });
      assert.equal(resNeg.valid, false);

      const resZero = validator.validateContract({
        taskId: 'task-105',
        description: 'Valid description',
        targetDirectory: '/tmp/workspace',
        maxDurationSeconds: 0,
      });
      assert.equal(resZero.valid, false);

      const resExcess = validator.validateContract({
        taskId: 'task-105',
        description: 'Valid description',
        targetDirectory: '/tmp/workspace',
        maxDurationSeconds: 100000,
      });
      assert.equal(resExcess.valid, false);
    });

    it('should handle null or non-object contract input safely without throwing', () => {
      const resNull = validator.validateContract(null);
      assert.equal(resNull.valid, false);
      assert.ok(resNull.errors.some((e) => e.includes('non-null object')));

      const resString = validator.validateContract('not-an-object');
      assert.equal(resString.valid, false);

      const resUndefined = validator.validateContract(undefined);
      assert.equal(resUndefined.valid, false);
    });
  });

  describe('2. validateDelegateTaskPayload', () => {
    it('should validate a minimal delegate task payload', () => {
      const res = validator.validateDelegateTaskPayload({
        objective: 'Write unit tests for authentication',
        taskType: 'unit-test',
      });
      assert.equal(res.valid, true);
      assert.equal(res.errors.length, 0);
    });

    it('should validate a full delegate task payload with optional fields', () => {
      const res = validator.validateDelegateTaskPayload({
        repoPath: './',
        taskType: 'feature',
        objective: 'Add multi-factor authentication support',
        context: 'OAuth 2.0 flow enabled',
        acceptanceCriteria: ['Pass test suite', 'Coverage > 90%'],
        allowedPaths: ['src/auth/'],
        disallowedPaths: ['.env'],
        verificationCommands: ['npm test'],
        modelProfile: 'high-accuracy',
        timeoutSeconds: 600,
      });
      assert.equal(res.valid, true);
      assert.equal(res.errors.length, 0);
    });

    it('should reject missing or empty objective', () => {
      const res = validator.validateDelegateTaskPayload({
        objective: '   ',
        taskType: 'unit-test',
      });
      assert.equal(res.valid, false);
      assert.ok(res.errors.some((e) => e.includes('Objective')));
    });

    it('should reject missing or empty taskType', () => {
      const res = validator.validateDelegateTaskPayload({
        objective: 'Valid objective',
        taskType: '',
      });
      assert.equal(res.valid, false);
      assert.ok(res.errors.some((e) => e.includes('taskType')));
    });

    it('should reject invalid repoPath (null byte or whitespace)', () => {
      const resNullByte = validator.validateDelegateTaskPayload({
        objective: 'Valid objective',
        taskType: 'unit-test',
        repoPath: '/tmp/repo\0bad',
      });
      assert.equal(resNullByte.valid, false);

      const resEmpty = validator.validateDelegateTaskPayload({
        objective: 'Valid objective',
        taskType: 'unit-test',
        repoPath: '   ',
      });
      assert.equal(resEmpty.valid, false);
    });

    it('should reject invalid array attributes in delegate task payload', () => {
      const res = validator.validateDelegateTaskPayload({
        objective: 'Valid objective',
        taskType: 'unit-test',
        allowedPaths: 'not-an-array',
      });
      assert.equal(res.valid, false);
      assert.ok(res.errors.some((e) => e.includes('allowedPaths must be an array')));
    });

    it('should handle null or non-object delegate payload safely', () => {
      const res = validator.validateDelegateTaskPayload(null);
      assert.equal(res.valid, false);
      assert.ok(res.errors.some((e) => e.includes('non-null object')));
    });
  });

  describe('3. validateReviseTaskPayload', () => {
    it('should validate a valid revise task payload', () => {
      const res = validator.validateReviseTaskPayload({
        taskId: 'task-201',
        revisionNotes: 'Fix failing boundary tests in auth controller',
        additionalCriteria: ['All edge cases covered'],
        additionalVerificationCommands: ['npm run test:auth'],
      });
      assert.equal(res.valid, true);
      assert.equal(res.errors.length, 0);
    });

    it('should reject missing taskId or revisionNotes', () => {
      const res1 = validator.validateReviseTaskPayload({
        taskId: '',
        revisionNotes: 'Some notes',
      });
      assert.equal(res1.valid, false);

      const res2 = validator.validateReviseTaskPayload({
        taskId: 'task-202',
        revisionNotes: '   ',
      });
      assert.equal(res2.valid, false);
    });

    it('should handle null or non-object revise task payload', () => {
      const res = validator.validateReviseTaskPayload(null);
      assert.equal(res.valid, false);
      assert.ok(res.errors.some((e) => e.includes('non-null object')));
    });
  });

  describe('4. Helper Methods', () => {
    it('validatePaths should validate valid string arrays and flag invalid items', () => {
      assert.equal(validator.validatePaths(['src/a.ts', 'src/b.ts']).valid, true);
      assert.equal(validator.validatePaths('not-an-array', 'customField').valid, false);
      assert.equal(validator.validatePaths(['src/a.ts', '  ']).valid, false);
      assert.equal(validator.validatePaths(['src/a.ts\0']).valid, false);
    });

    it('validateTimeout should check range and finite numbers', () => {
      assert.equal(validator.validateTimeout(300).valid, true);
      assert.equal(validator.validateTimeout(86400).valid, true);
      assert.equal(validator.validateTimeout(0).valid, false);
      assert.equal(validator.validateTimeout(-10).valid, false);
      assert.equal(validator.validateTimeout(86401).valid, false);
      assert.equal(validator.validateTimeout(NaN).valid, false);
      assert.equal(validator.validateTimeout('300').valid, false);
    });

    it('validateTaskType should enforce non-empty string taskType', () => {
      assert.equal(validator.validateTaskType('unit-test').valid, true);
      assert.equal(validator.validateTaskType('').valid, false);
      assert.equal(validator.validateTaskType(123).valid, false);
    });
  });
});
