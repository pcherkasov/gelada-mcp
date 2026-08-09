import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';

const rootDir = process.cwd();
const workflowPath = path.join(rootDir, '.github', 'workflows', 'release.yml');
const installScriptPath = path.join(rootDir, 'install.sh');

test('CI/CD Release Workflow File Validation', async (t) => {
  await t.test('release.yml exists and is valid YAML', () => {
    assert.ok(fs.existsSync(workflowPath), 'release.yml must exist');
    const content = fs.readFileSync(workflowPath, 'utf8');
    const workflow = YAML.parse(content);
    assert.ok(workflow, 'YAML content should parse cleanly');
  });

  await t.test('release.yml defines correct triggers', () => {
    const content = fs.readFileSync(workflowPath, 'utf8');
    const workflow = YAML.parse(content);

    assert.ok(workflow.on, 'on triggers must be defined');
    assert.ok(workflow.on.push, 'push trigger must be defined');
    assert.deepEqual(workflow.on.push.tags, ['v*'], 'push tags trigger must match v*');
    assert.ok('workflow_dispatch' in workflow.on, 'workflow_dispatch trigger must be defined');
  });

  await t.test('release.yml defines job 1: test', () => {
    const content = fs.readFileSync(workflowPath, 'utf8');
    const workflow = YAML.parse(content);

    assert.ok(workflow.jobs.test, 'job test must exist');
    assert.equal(workflow.jobs.test['runs-on'], 'ubuntu-latest', 'job test must run on ubuntu-latest');

    const steps = workflow.jobs.test.steps;
    const runCmds = steps.filter((s) => s.run).map((s) => s.run);
    assert.ok(runCmds.includes('npm ci'), 'test job must include npm ci');
    assert.ok(runCmds.includes('npm run build'), 'test job must include npm run build');
    assert.ok(runCmds.includes('npm test'), 'test job must include npm test');
  });

  await t.test('release.yml defines job 2: build-release-artifacts', () => {
    const content = fs.readFileSync(workflowPath, 'utf8');
    const workflow = YAML.parse(content);

    const job = workflow.jobs['build-release-artifacts'];
    assert.ok(job, 'job build-release-artifacts must exist');
    assert.equal(job['runs-on'], 'ubuntu-latest');
    assert.equal(job.needs, 'test', 'build-release-artifacts must depend on test');

    const stepsStr = JSON.stringify(job.steps);
    assert.ok(stepsStr.includes('npm ci'), 'must execute npm ci');
    assert.ok(stepsStr.includes('npm run build:binaries'), 'must execute npm run build:binaries');
    assert.ok(stepsStr.includes('gelada-${TAG}-darwin-x64.tar.gz'), 'must package darwin-x64 archive');
    assert.ok(stepsStr.includes('gelada-${TAG}-darwin-arm64.tar.gz'), 'must package darwin-arm64 archive');
    assert.ok(stepsStr.includes('gelada-${TAG}-linux-x64.tar.gz'), 'must package linux-x64 archive');
    assert.ok(stepsStr.includes('gelada-${TAG}-linux-arm64.tar.gz'), 'must package linux-arm64 archive');
    assert.ok(stepsStr.includes('gelada-${TAG}-win-x64.zip'), 'must package win-x64 archive');
    assert.ok(stepsStr.includes('checksums.txt'), 'must compute checksums.txt');
    // Asserted without the version pin on purpose: the guarantee is that the
    // archives leave the job as an artifact, not which major of the action does
    // it. Pinning here turns every routine action bump into a red suite.
    assert.ok(stepsStr.includes('actions/upload-artifact@'), 'must upload via upload-artifact');
  });

  await t.test('release.yml defines job 3: publish-release', () => {
    const content = fs.readFileSync(workflowPath, 'utf8');
    const workflow = YAML.parse(content);

    const job = workflow.jobs['publish-release'];
    assert.ok(job, 'job publish-release must exist');
    assert.equal(job['runs-on'], 'ubuntu-latest');
    assert.equal(job.needs, 'build-release-artifacts', 'publish-release must depend on build-release-artifacts');

    const stepsStr = JSON.stringify(job.steps);
    assert.ok(stepsStr.includes('softprops/action-gh-release@'), 'must use softprops/action-gh-release');
    assert.ok(stepsStr.includes('install.sh'), 'must attach install.sh');
  });

  await t.test('installer script install.sh exists in project root', () => {
    assert.ok(fs.existsSync(installScriptPath), 'install.sh must exist');
    const content = fs.readFileSync(installScriptPath, 'utf8');
    assert.ok(content.startsWith('#!/usr/bin/env bash'), 'install.sh must have bash shebang');
  });
});
