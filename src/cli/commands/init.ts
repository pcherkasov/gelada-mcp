import { Command } from 'commander';
import * as fs from 'fs';
import * as path from 'path';

export interface InitCommandOptions {
  force?: boolean;
  agentGuide?: boolean;
}

/**
 * Project policy presets.
 *
 * Only fields the policy engine actually reads appear here — an earlier version
 * emitted `allowedPaths`, `verification.commands` and `modelProfile`, none of
 * which are policy-level keys, so the file looked configured while doing
 * nothing. Path boundaries and verification commands belong to a task contract;
 * policy sets the limits a task may not exceed.
 */
const PRESETS: Record<string, string> = {
  typescript: `version: "1.0"
# TypeScript / Node.js project

defaultModelProfile: BALANCED     # FAST | BALANCED | DEEP
maxFiles: 20                      # files one task may change
maxLines: 1000                    # total line edits per task
taskTimeout: 600                  # seconds
maxRevisions: 5

protectedPaths:
  - "package.json"
  - "package-lock.json"
  - "tsconfig.json"
  - ".env*"

allowedCommands:
  - "npm test"
  - "npm run build"
  - "npm run typecheck"
  - "npx tsc --noEmit"

disallowedCommands:
  - "rm -rf"
  - "curl"
  - "wget"

allowNetwork: false
allowShellChaining: false

# Worker permissions — see SECURITY.md before changing these.
workerAutoApprove: true
workerSandbox: true

retention:
  maxRuns: 20
  maxAgeDays: 14
  maxTotalSize: "500MB"
`,
  java: `version: "1.0"
# Java / Maven project

defaultModelProfile: BALANCED
maxFiles: 20
maxLines: 1000
taskTimeout: 900
maxRevisions: 5

protectedPaths:
  - "pom.xml"
  - "build.gradle"
  - "src/main/resources/application*.yml"
  - ".env*"

allowedCommands:
  - "mvn test"
  - "mvn -q compile"
  - "mvn checkstyle:check"
  - "gradle test"

disallowedCommands:
  - "rm -rf"
  - "curl"
  - "wget"

allowNetwork: false
allowShellChaining: false

workerAutoApprove: true
workerSandbox: true

retention:
  maxRuns: 20
  maxAgeDays: 14
  maxTotalSize: "500MB"
`,
  python: `version: "1.0"
# Python project

defaultModelProfile: BALANCED
maxFiles: 20
maxLines: 1000
taskTimeout: 600
maxRevisions: 5

protectedPaths:
  - "pyproject.toml"
  - "requirements.txt"
  - "setup.py"
  - ".env*"

allowedCommands:
  - "pytest"
  - "python -m pytest"
  - "ruff check ."
  - "mypy ."

disallowedCommands:
  - "rm -rf"
  - "curl"
  - "wget"

allowNetwork: false
allowShellChaining: false

workerAutoApprove: true
workerSandbox: true

retention:
  maxRuns: 20
  maxAgeDays: 14
  maxTotalSize: "500MB"
`,
  go: `version: "1.0"
# Go project

defaultModelProfile: BALANCED
maxFiles: 20
maxLines: 1000
taskTimeout: 600
maxRevisions: 5

protectedPaths:
  - "go.mod"
  - "go.sum"
  - ".env*"

allowedCommands:
  - "go test ./..."
  - "go build ./..."
  - "go vet ./..."

disallowedCommands:
  - "rm -rf"
  - "curl"
  - "wget"

allowNetwork: false
allowShellChaining: false

workerAutoApprove: true
workerSandbox: true

retention:
  maxRuns: 20
  maxAgeDays: 14
  maxTotalSize: "500MB"
`,
};

export const AGENT_GUIDE_START = '<!-- gelada:delegation-policy:start -->';
export const AGENT_GUIDE_END = '<!-- gelada:delegation-policy:end -->';

/**
 * Short delegation policy written into the repository's agent guide.
 *
 * The MCP server already ships instructions, but they only reach agents whose
 * client injects them. A block in CLAUDE.md / AGENTS.md reaches the rest, and
 * survives the agent's own context trimming because the file is re-read.
 */
export const AGENT_GUIDE_BLOCK = `${AGENT_GUIDE_START}
## Delegating routine work (Gelada MCP)

This project has the \`gelada\` MCP server available. It runs a cheaper local
worker agent inside a throwaway git worktree, so bulk output never enters your
context and nothing it writes can touch the working tree.

**Delegate** repetitive, precisely specifiable work whose result a command can
check: unit tests for existing behaviour, DTOs and schemas, mappers, docstrings,
mechanical refactors, localization. Rule of thumb — if the output would run past
roughly 1000 tokens, delegating wins.

**Do it yourself** for small edits, files already in context, anything needing
judgement, and anything you cannot write acceptance criteria for. Delegating a
small task costs more than doing it.

**How:** \`delegate_task\` (set \`repoPath\`, \`allowedPaths\`, and
\`verificationCommands\`) returns immediately with a \`taskId\`. Poll
\`inspect_task\` every ~5s until its \`granularStatus\` is terminal, read the patch
with \`mode: "diff"\`, review it, and apply what you accept. Use \`revise_task\`
when it is close but wrong, and \`discard_task\` when finished.

Always read the diff. A passing verification means the tests passed, not that
the change is right.
${AGENT_GUIDE_END}`;

export interface AgentGuideResult {
  file: string;
  action: 'created' | 'updated' | 'unchanged';
}

/**
 * Writes the delegation block into a repository agent guide, replacing a
 * previous block rather than appending a second copy.
 */
export function writeAgentGuide(repoRoot: string, fileName: string): AgentGuideResult {
  const target = path.join(repoRoot, fileName);

  if (!fs.existsSync(target)) {
    fs.writeFileSync(target, `${AGENT_GUIDE_BLOCK}\n`, 'utf8');
    return { file: fileName, action: 'created' };
  }

  const existing = fs.readFileSync(target, 'utf8');
  const startIdx = existing.indexOf(AGENT_GUIDE_START);
  const endIdx = existing.indexOf(AGENT_GUIDE_END);

  if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
    const before = existing.slice(0, startIdx);
    const after = existing.slice(endIdx + AGENT_GUIDE_END.length);
    const next = `${before}${AGENT_GUIDE_BLOCK}${after}`;
    if (next === existing) {
      return { file: fileName, action: 'unchanged' };
    }
    fs.writeFileSync(target, next, 'utf8');
    return { file: fileName, action: 'updated' };
  }

  const separator = existing.endsWith('\n') ? '\n' : '\n\n';
  fs.writeFileSync(target, `${existing}${separator}${AGENT_GUIDE_BLOCK}\n`, 'utf8');
  return { file: fileName, action: 'updated' };
}

export function registerInitCommand(program: Command): void {
  program
    .command('init [preset]')
    .description(
      'Initialize .gelada/policy.yaml and a delegation guide for your coding agent ' +
        '(presets: typescript, java, python, go)',
    )
    .option('-f, --force', 'Overwrite an existing policy file')
    .option('--no-agent-guide', 'Do not touch CLAUDE.md / AGENTS.md')
    .action((preset: string | undefined, options: InitCommandOptions) => {
      const repoRoot = process.cwd();
      const targetDir = path.join(repoRoot, '.gelada');
      const targetFile = path.join(targetDir, 'policy.yaml');

      if (fs.existsSync(targetFile) && !options.force) {
        console.error('Error: .gelada/policy.yaml already exists. Use --force to overwrite.');
        process.exit(1);
      }

      const selectedPreset = preset ? preset.toLowerCase() : 'typescript';
      const content = PRESETS[selectedPreset];

      if (!content) {
        console.error(
          `Error: Unknown preset '${selectedPreset}'. Available presets: ${Object.keys(PRESETS).join(', ')}`,
        );
        process.exit(1);
      }

      fs.mkdirSync(targetDir, { recursive: true });
      fs.writeFileSync(targetFile, content, 'utf8');
      console.log(`Wrote .gelada/policy.yaml using the '${selectedPreset}' preset.`);

      if (options.agentGuide !== false) {
        // Update guides that already exist; otherwise create the one that
        // matches the agent most likely in use, defaulting to AGENTS.md.
        const candidates = ['CLAUDE.md', 'AGENTS.md'].filter((f) =>
          fs.existsSync(path.join(repoRoot, f)),
        );
        const targets = candidates.length > 0 ? candidates : ['AGENTS.md'];

        for (const file of targets) {
          const result = writeAgentGuide(repoRoot, file);
          console.log(`${result.action === 'created' ? 'Created' : 'Updated'} ${result.file} with the delegation guide.`);
        }
      }

      console.log('\nReview both files, then run "gelada doctor" to confirm the worker is ready.');
    });
}
