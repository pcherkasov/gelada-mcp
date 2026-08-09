import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

export interface CommandVerificationResult {
  command: string;
  passed: boolean;
  output: string;
  durationMs: number;
}

export interface VerificationResult {
  passed: boolean;
  results: CommandVerificationResult[];
  totalDurationMs: number;
}

export interface VerificationOptions {
  allowShellChaining?: boolean;
  timeoutMs?: number;
  maxOutputBytes?: number;
}

export class VerificationEngine {
  public async verifyWorktree(
    worktreePath: string,
    commands: string[] = [],
    options: VerificationOptions = {},
  ): Promise<VerificationResult> {
    const startTime = Date.now();
    const sanitizedPath = worktreePath?.trim() || '.';
    const results: CommandVerificationResult[] = [];
    let allPassed = true;

    const allowShellChaining = options.allowShellChaining ?? false;
    const timeoutMs = options.timeoutMs ?? 60000;
    const maxOutputBytes = options.maxOutputBytes ?? 65536;

    for (const cmd of commands) {
      const cmdStartTime = Date.now();
      let passed = true;
      let output = '';

      // Validate shell chaining if restricted
      if (!allowShellChaining && /[;&|]/.test(cmd)) {
        passed = false;
        allPassed = false;
        output = `Execution blocked: Shell chaining operators (;&|) are restricted by verification policy. Command: "${cmd}"`;
        results.push({
          command: cmd,
          passed,
          output,
          durationMs: Date.now() - cmdStartTime,
        });
        continue;
      }

      try {
        const { stdout, stderr } = await execAsync(cmd, {
          cwd: sanitizedPath,
          timeout: timeoutMs,
          maxBuffer: 10 * 1024 * 1024,
        });
        output = `${stdout}\n${stderr}`.trim();
      } catch (err: any) {
        passed = false;
        allPassed = false;
        output = `${err.stdout || ''}\n${err.stderr || ''}\n${err.message || String(err)}`.trim();
      }

      if (output.length > maxOutputBytes) {
        output = output.slice(0, maxOutputBytes) + `\n... [Output truncated at ${maxOutputBytes} bytes]`;
      }

      results.push({
        command: cmd,
        passed,
        output,
        durationMs: Date.now() - cmdStartTime,
      });
    }

    return {
      passed: allPassed,
      results,
      totalDurationMs: Date.now() - startTime,
    };
  }
}
