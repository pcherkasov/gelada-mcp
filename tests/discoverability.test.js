import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

import { GELADA_SERVER_INSTRUCTIONS } from '../dist/server-instructions.js';
import {
  INSTRUCTION_RESOURCES,
  readInstruction,
} from '../dist/resources/index.js';
import {
  AGENT_GUIDE_BLOCK,
  AGENT_GUIDE_START,
  AGENT_GUIDE_END,
  writeAgentGuide,
} from '../dist/cli/commands/init.js';

/**
 * A capable server that no agent chooses is not useful. These tests cover the
 * surfaces that tell a leader agent when to reach for delegation at all —
 * historically the reason this server sat connected and unused.
 */
describe('Agent-facing discoverability', () => {
  let transport;
  let client;

  before(async () => {
    transport = new StdioClientTransport({
      command: process.execPath,
      args: ['./bin/gelada.js'],
      cwd: process.cwd(),
      stderr: 'pipe',
    });
    client = new Client({ name: 'discoverability-client', version: '1.0.0' }, { capabilities: {} });
    await client.connect(transport);
  });

  after(async () => {
    if (client) await client.close();
  });

  describe('server instructions', () => {
    it('are delivered in the initialize response', () => {
      const instructions = client.getInstructions();
      assert.ok(instructions, 'the client must receive server instructions');
      assert.equal(instructions, GELADA_SERVER_INSTRUCTIONS);
    });

    it('state when to delegate, when not to, and how to wait', () => {
      const text = GELADA_SERVER_INSTRUCTIONS;
      assert.match(text, /Delegate when/i);
      assert.match(text, /Do NOT delegate when/i);
      assert.match(text, /inspect_task/);
      assert.match(text, /revise_task/);
      assert.match(text, /running/);
    });

    it('stay small enough to charge to every session', () => {
      assert.ok(
        GELADA_SERVER_INSTRUCTIONS.length < 6000,
        `instructions are ${GELADA_SERVER_INSTRUCTIONS.length} chars; keep them compact`,
      );
    });
  });

  describe('tool metadata', () => {
    it('gives every tool a title, a substantial description and annotations', async () => {
      const { tools } = await client.listTools();
      assert.equal(tools.length, 7);

      for (const tool of tools) {
        assert.ok(tool.title, `${tool.name} needs a title`);
        assert.ok(tool.annotations, `${tool.name} needs annotations`);
        assert.ok(
          tool.description && tool.description.length > 60,
          `${tool.name} description is too thin to compete for an agent's attention`,
        );
      }
    });

    it('explains the trade-off on delegate_task rather than restating its name', async () => {
      const { tools } = await client.listTools();
      const delegate = tools.find((t) => t.name === 'delegate_task');

      // The description has to answer "why this instead of editing the file myself".
      assert.match(delegate.description, /NOT WORTH IT FOR/i);
      assert.match(delegate.description, /context/i);
      assert.match(delegate.description, /inspect_task/);
      assert.equal(delegate.annotations.readOnlyHint, false);
    });

    it('marks read-only tools as read-only and discard_task as destructive', async () => {
      const { tools } = await client.listTools();
      const byName = Object.fromEntries(tools.map((t) => [t.name, t]));

      assert.equal(byName.inspect_task.annotations.readOnlyHint, true);
      assert.equal(byName.doctor.annotations.readOnlyHint, true);
      assert.equal(byName.list_workers.annotations.readOnlyHint, true);
      assert.equal(byName.discard_task.annotations.destructiveHint, true);
    });
  });

  describe('resources', () => {
    it('exposes the leader-agent guidance', async () => {
      const { resources } = await client.listResources();
      const names = resources.map((r) => r.name).sort();
      assert.deepEqual(names, INSTRUCTION_RESOURCES.map((r) => r.slug).sort());
    });

    it('serves real content, not a placeholder', async () => {
      const res = await client.readResource({ uri: 'gelada://instructions/delegation-criteria' });
      const text = res.contents[0].text;
      assert.ok(text.length > 500, 'guidance should be the actual document');
      assert.match(text, /delegat/i);
    });

    it('resolves the docs directory relative to the package, not the cwd', () => {
      for (const entry of INSTRUCTION_RESOURCES) {
        assert.ok(readInstruction(entry.slug), `${entry.slug} must be readable`);
      }
    });
  });

  describe('prompts', () => {
    it('offers ready-made delegation contracts', async () => {
      const { prompts } = await client.listPrompts();
      const names = prompts.map((p) => p.name).sort();
      assert.deepEqual(names, [
        'delegate_docstrings',
        'delegate_mechanical_refactor',
        'delegate_unit_tests',
        'review_delegated_patch',
      ]);
    });

    it('produces a contract that names the tool and its key fields', async () => {
      const res = await client.getPrompt({
        name: 'delegate_unit_tests',
        arguments: { target: 'src/services/billing.ts', testCommand: 'npm test' },
      });
      const text = res.messages[0].content.text;
      assert.match(text, /delegate_task/);
      assert.match(text, /src\/services\/billing\.ts/);
      assert.match(text, /verificationCommands/);
      assert.match(text, /npm test/);
    });
  });
});

describe('Repository agent guide', () => {
  let repoDir;

  before(async () => {
    repoDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gelada-guide-'));
  });

  after(async () => {
    if (repoDir) await fs.rm(repoDir, { recursive: true, force: true }).catch(() => {});
  });

  it('creates the guide when the file does not exist', async () => {
    const result = writeAgentGuide(repoDir, 'AGENTS.md');
    assert.equal(result.action, 'created');
    const text = await fs.readFile(path.join(repoDir, 'AGENTS.md'), 'utf8');
    assert.match(text, /Delegating routine work/);
    assert.match(text, /delegate_task/);
  });

  it('preserves existing content when appending', async () => {
    const file = path.join(repoDir, 'CLAUDE.md');
    await fs.writeFile(file, '# House rules\n\nAlways run the linter.\n');
    writeAgentGuide(repoDir, 'CLAUDE.md');
    const text = await fs.readFile(file, 'utf8');
    assert.match(text, /Always run the linter\./);
    assert.match(text, /Delegating routine work/);
  });

  it('replaces its own block instead of appending a second copy', async () => {
    writeAgentGuide(repoDir, 'CLAUDE.md');
    writeAgentGuide(repoDir, 'CLAUDE.md');
    const text = await fs.readFile(path.join(repoDir, 'CLAUDE.md'), 'utf8');
    assert.equal(text.split(AGENT_GUIDE_START).length - 1, 1);
    assert.equal(text.split(AGENT_GUIDE_END).length - 1, 1);
    assert.match(text, /Always run the linter\./);
  });

  it('reports unchanged when the block is already current', async () => {
    const fresh = path.join(repoDir, 'FRESH.md');
    await fs.writeFile(fresh, `${AGENT_GUIDE_BLOCK}\n`);
    assert.equal(writeAgentGuide(repoDir, 'FRESH.md').action, 'unchanged');
  });
});
