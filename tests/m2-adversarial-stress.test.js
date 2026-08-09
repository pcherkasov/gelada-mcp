import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { PolicyEngine } from '../dist/components/policy-engine.js';
import { WorktreeManager } from '../dist/components/worktree-manager.js';
import { ContractValidator } from '../dist/components/contract-validator.js';
import { ArtifactManager } from '../dist/components/artifact-manager.js';
import { RepositoryInspector } from '../dist/components/repository-inspector.js';

console.log('=== STARTING M2 ADVERSARIAL STRESS & FAILURE MODE TESTS ===');

let findings = [];

function recordFinding(severity, component, issue, scenario, empiricalResult) {
  const finding = { severity, component, issue, scenario, empiricalResult };
  findings.push(finding);
  console.log(`[FINDING - ${severity}] ${component}: ${issue}`);
}

// 1. Stress Test: PolicyEngine Absolute Path Traversal
try {
  const policy = new PolicyEngine();
  const isAllowed = policy.isPathAllowed('/etc/passwd');
  if (isAllowed) {
    recordFinding(
      'MEDIUM',
      'PolicyEngine',
      'Absolute path outside workspace is allowed by isPathAllowed',
      'isPathAllowed("/etc/passwd")',
      `Returned true instead of false. PolicyEngine only checks !filePath.includes("..") but does not enforce root scope restriction.`,
    );
  }
} catch (err) {
  console.error(err);
}

// 2. Stress Test: WorktreeManager Non-String or Null taskSlug
try {
  const manager = new WorktreeManager();
  let threw = false;
  try {
    // @ts-ignore
    await manager.createWorktree(null);
  } catch (err) {
    threw = true;
    recordFinding(
      'LOW',
      'WorktreeManager',
      'createWorktree throws unhandled TypeError when passed null/non-string taskSlug',
      'createWorktree(null)',
      `Threw TypeError: ${err.message}`,
    );
  }
  assert.ok(threw);
} catch (err) {
  console.error(err);
}

// 3. Stress Test: ContractValidator Null/Undefined Contract
try {
  const validator = new ContractValidator();
  let threw = false;
  try {
    // @ts-ignore
    validator.validateContract(null);
  } catch (err) {
    threw = true;
    recordFinding(
      'LOW',
      'ContractValidator',
      'validateContract throws TypeError if contract argument is null/undefined',
      'validateContract(null)',
      `Threw TypeError: ${err.message}`,
    );
  }
  assert.ok(threw);
} catch (err) {
  console.error(err);
}

// 4. Stress Test: Stdio Server Resilience to Malformed JSON on Stdin
async function testMalformedStdin() {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['./bin/gelada.js'], {
      cwd: process.cwd(),
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stderrData = '';
    let exited = false;

    child.stderr.on('data', (chunk) => {
      stderrData += chunk.toString();
    });

    child.on('exit', (code) => {
      exited = true;
    });

    // Write malformed JSON string and junk bytes
    child.stdin.write('NOT_JSON_DATA_12345\n');
    child.stdin.write('{"jsonrpc": "2.0", "method": "invalid_json_missing_brace"\n');

    setTimeout(() => {
      if (exited) {
        recordFinding(
          'HIGH',
          'StdioServerTransport',
          'Server crashed upon receiving malformed JSON on stdin',
          'Writing invalid JSON bytes to stdin',
          `Server process exited prematurely.`,
        );
      } else {
        console.log('[PASS] Stdio server survived malformed stdin without crashing.');
        child.kill();
      }
      resolve();
    }, 1500);
  });
}

await testMalformedStdin();

console.log(`\n=== STRESS TEST COMPLETED. TOTAL FINDINGS: ${findings.length} ===`);
console.log(JSON.stringify(findings, null, 2));
