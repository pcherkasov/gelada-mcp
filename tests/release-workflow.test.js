import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';

const rootDir = process.cwd();
const workflowPath = path.join(rootDir, '.github', 'workflows', 'ci.yml');
const installScriptPath = path.join(rootDir, 'install.sh');

const readWorkflow = () => YAML.parse(fs.readFileSync(workflowPath, 'utf8'));

/**
 * The pipeline is a single workflow on purpose. Two workflows listening to
 * overlapping events is how the same job ends up running three times for one
 * change, and Actions minutes are metered. These tests pin both halves of that
 * bargain: each event tests the code exactly once, and a merge to main is what
 * ships a release.
 */
test('CI/CD pipeline definition', async (t) => {
  await t.test('there is exactly one workflow, and it parses', () => {
    const workflowDir = path.join(rootDir, '.github', 'workflows');
    const files = fs.readdirSync(workflowDir).filter((f) => /\.ya?ml$/.test(f));
    assert.deepEqual(files, ['ci.yml'], 'a second workflow re-introduces duplicate runs');
    assert.ok(readWorkflow(), 'ci.yml must parse cleanly');
  });

  await t.test('no event triggers the test job twice', () => {
    const workflow = readWorkflow();

    assert.ok(workflow.on.pull_request !== undefined, 'pull requests must be verified');
    assert.ok('workflow_dispatch' in workflow.on, 'manual dispatch must stay available');

    // The dedup guarantee. Pushes are restricted to main, so a pull request
    // branch is built by the pull_request event alone rather than by both.
    assert.deepEqual(
      workflow.on.push.branches,
      ['main'],
      'push must be limited to main, or every branch push duplicates the pull request run',
    );
    assert.equal(workflow.on.push.tags, undefined, 'tags must not trigger: releases come from merges to main');
  });

  await t.test('a pull request run is superseded, a main run is not', () => {
    const workflow = readWorkflow();
    assert.ok(workflow.concurrency, 'concurrency must be configured');
    assert.match(
      String(workflow.concurrency['cancel-in-progress']),
      /pull_request/,
      'cancelling must be conditional: a release on main must never be cancelled midway',
    );
  });

  await t.test('the test job builds and tests across supported Node versions', () => {
    const job = readWorkflow().jobs.test;
    assert.ok(job, 'job test must exist');
    assert.equal(job['runs-on'], 'ubuntu-latest');
    assert.deepEqual(job.strategy.matrix.node, ['18', '20', '22']);

    const runCmds = job.steps.filter((s) => s.run).map((s) => s.run);
    assert.ok(runCmds.includes('npm ci'), 'test job must include npm ci');
    assert.ok(runCmds.includes('npm run build'), 'test job must include npm run build');
    assert.ok(runCmds.includes('npm test'), 'test job must include npm test');
  });

  await t.test('the release gate only opens for a version that is not yet tagged', () => {
    const job = readWorkflow().jobs['release-gate'];
    assert.ok(job, 'job release-gate must exist');
    assert.equal(job.needs, 'test', 'nothing releases before the suite is green');
    assert.match(job.if, /github\.event_name == 'push'/, 'the gate must not run for pull requests');
    assert.match(job.if, /refs\/heads\/main/, 'the gate must be limited to main');

    const stepsStr = JSON.stringify(job.steps);
    assert.match(stepsStr, /require\('\.\/package\.json'\)\.version/, 'the gate must read the version from package.json');
    assert.match(stepsStr, /refs\/tags\/v\$\{VERSION\}/, 'the gate must decide by whether that version is already tagged');
  });

  await t.test('the release job publishes to npm and ships every binary target', () => {
    const job = readWorkflow().jobs.release;
    assert.ok(job, 'job release must exist');
    assert.equal(job.needs, 'release-gate');
    assert.match(job.if, /publish == 'true'/, 'release must be gated on the version check');

    assert.equal(job.permissions['contents'], 'write', 'creating the tag and release needs contents: write');
    assert.equal(
      job.permissions['id-token'],
      'write',
      'npm trusted publishing authenticates with an OIDC token, which needs id-token: write',
    );

    const stepsStr = JSON.stringify(job.steps);
    assert.match(stepsStr, /npm publish --provenance --access public/, 'must publish to npm with provenance');
    assert.ok(!/NPM_TOKEN|NODE_AUTH_TOKEN/.test(stepsStr), 'publishing must use OIDC, not a long-lived token');

    // `test` has already proved this exact commit green on three Node versions
    // before this job starts. A fourth run would cost minutes and prove nothing.
    assert.ok(
      !/"npm test"/.test(stepsStr),
      'the release job must not re-run the suite that gated it',
    );

    assert.ok(stepsStr.includes('npm run build:binaries'), 'must build the standalone binaries');
    for (const target of ['darwin-x64', 'darwin-arm64', 'linux-x64', 'linux-arm64']) {
      assert.ok(stepsStr.includes(`gelada-\${TAG}-${target}.tar.gz`), `must package the ${target} archive`);
    }
    assert.ok(stepsStr.includes('gelada-${TAG}-win-x64.zip'), 'must package the win-x64 archive');
    assert.ok(stepsStr.includes('checksums.txt'), 'must compute checksums.txt');

    // Asserted without the version pin on purpose: the guarantee is that a
    // release is created, not which major of the action does it. Pinning here
    // turns every routine action bump into a red suite.
    assert.ok(stepsStr.includes('softprops/action-gh-release@'), 'must create the GitHub release');
    assert.ok(stepsStr.includes('install.sh'), 'must attach install.sh');
  });

  await t.test('installer script install.sh exists in project root', () => {
    assert.ok(fs.existsSync(installScriptPath), 'install.sh must exist');
  });
});
