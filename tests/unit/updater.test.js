import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  Updater,
  UpdateCheckError,
  RELEASE_REPO,
  isUpToDate,
  detectInstallKind,
} from '../../dist/cli/utils/updater.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

describe('Updater', () => {
  describe('the repository it asks about', () => {
    it('is the one this package is published from', () => {
      // The previous value named a repository that does not exist. Every check
      // 404'd, and the 404 was reported as "up to date" — so the constant has to
      // be pinned to the manifest rather than trusted to stay right.
      const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf-8'));
      const slug = pkg.repository.url.replace(/^git\+/, '').replace(/\.git$/, '').split('github.com/')[1];

      assert.equal(RELEASE_REPO, slug);
    });
  });

  describe('isUpToDate', () => {
    it('sees a newer release', () => {
      assert.equal(isUpToDate('0.1.3', '0.1.5'), false);
      assert.equal(isUpToDate('0.1.5', '0.2.0'), false);
      assert.equal(isUpToDate('0.9.9', '1.0.0'), false);
    });

    it('sees an equal or older release', () => {
      assert.equal(isUpToDate('0.1.5', '0.1.5'), true);
      assert.equal(isUpToDate('0.2.0', '0.1.5'), true);
      assert.equal(isUpToDate('1.0.0', '0.9.9'), true);
    });

    it('tolerates a leading v on either side', () => {
      assert.equal(isUpToDate('v0.1.3', '0.1.5'), false);
      assert.equal(isUpToDate('0.1.5', 'v0.1.5'), true);
    });

    it('compares versions of unequal depth', () => {
      assert.equal(isUpToDate('0.1', '0.1.1'), false);
      assert.equal(isUpToDate('0.1.1', '0.1'), true);
    });

    it('places a prerelease behind the release it precedes', () => {
      // The old comparison ran Number() over every dot-separated part, so
      // "0-rc1" became NaN, every comparison fell through, and any prerelease
      // answered "up to date".
      assert.equal(isUpToDate('0.2.0-rc1', '0.2.0'), false);
      assert.equal(isUpToDate('0.2.0', '0.2.0-rc1'), true);
      assert.equal(isUpToDate('0.1.5', '0.2.0-rc1'), false);
    });
  });

  describe('detectInstallKind', () => {
    afterEach(() => {
      delete process.pkg;
    });

    it('reports npm when this is not a packaged binary', () => {
      assert.equal(detectInstallKind(), 'npm');
    });

    it('reports standalone when process.pkg is present', () => {
      // argv[1] used to decide this by searching for "node_modules", which got
      // it wrong from a checkout and threw when argv[1] was unset.
      process.pkg = { entrypoint: '/snapshot/gelada/bin/gelada.js' };
      assert.equal(detectInstallKind(), 'standalone');
    });
  });

  describe('checkForUpdates', () => {
    let originalFetch;

    beforeEach(() => {
      originalFetch = globalThis.fetch;
    });

    afterEach(() => {
      globalThis.fetch = originalFetch;
    });

    it('reports the latest release', async () => {
      globalThis.fetch = async () => ({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({
          tag_name: 'v0.1.5',
          html_url: 'https://github.com/pcherkasov/gelada-mcp/releases/tag/v0.1.5',
        }),
      });

      const info = await new Updater('0.1.3').checkForUpdates();
      assert.equal(info.currentVersion, '0.1.3');
      assert.equal(info.latestVersion, '0.1.5');
      assert.equal(info.upToDate, false);
    });

    it('throws on a 404 instead of calling it up to date', async () => {
      // This is the exact shape of the original bug: the repository slug was
      // wrong, GitHub answered 404, and the caller was told it was current.
      globalThis.fetch = async () => ({ ok: false, status: 404, statusText: 'Not Found' });

      await assert.rejects(() => new Updater('0.1.3').checkForUpdates(), (err) => {
        assert.ok(err instanceof UpdateCheckError);
        assert.match(err.message, /404/);
        return true;
      });
    });

    it('throws when the network is unreachable', async () => {
      globalThis.fetch = async () => {
        throw new Error('getaddrinfo ENOTFOUND api.github.com');
      };

      await assert.rejects(() => new Updater('0.1.3').checkForUpdates(), (err) => {
        assert.ok(err instanceof UpdateCheckError);
        assert.match(err.message, /ENOTFOUND/);
        return true;
      });
    });

    it('throws when the release carries no tag', async () => {
      globalThis.fetch = async () => ({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({}),
      });

      await assert.rejects(
        () => new Updater('0.1.3').checkForUpdates(),
        (err) => err instanceof UpdateCheckError,
      );
    });
  });

  describe('manualInstructions', () => {
    afterEach(() => {
      delete process.pkg;
    });

    const info = {
      currentVersion: '0.1.3',
      latestVersion: '0.1.5',
      upToDate: false,
      releaseUrl: 'https://github.com/pcherkasov/gelada-mcp/releases/tag/v0.1.5',
    };

    it('tells an npm install to use npm', () => {
      assert.match(new Updater('0.1.3').manualInstructions(info), /npm install -g gelada-mcp@latest/);
    });

    it('tells a standalone install to use the installer', () => {
      process.pkg = {};
      const text = new Updater('0.1.3').manualInstructions(info);

      if (process.platform === 'win32') {
        assert.match(text, /win-x64\.zip/);
      } else {
        assert.match(text, /install\.sh/);
      }
    });
  });

  describe('installUpdate', () => {
    it('does nothing when already current', async () => {
      // No fetch stub and no network: reaching either would fail the test.
      await new Updater('0.1.5').installUpdate({
        currentVersion: '0.1.5',
        latestVersion: '0.1.5',
        upToDate: true,
        releaseUrl: 'https://example.invalid',
      });
    });
  });
});

describe('install.sh', () => {
  const installer = fs.readFileSync(path.join(repoRoot, 'install.sh'), 'utf-8');

  it('verifies the archive against the published checksums', () => {
    // The old updater looked for a per-asset .sha256 that has never existed, so
    // it skipped verification on every run. Releases ship one checksums.txt.
    assert.match(installer, /checksums\.txt/);
    assert.match(installer, /checksum mismatch/);
  });

  it('lands the binary by rename rather than writing over the destination', () => {
    // An interrupted copy onto the target leaves a gelada that exists and does
    // not run; `gelada update` also replaces the binary it is running from.
    assert.match(installer, /mv -f "\$STAGED" "\$\{INSTALL_DIR\}\/gelada"/);
    assert.ok(
      !/^\s*cp "\$BINARY_PATH" "\$\{INSTALL_DIR\}\/gelada"/m.test(installer),
      'install.sh must not copy straight onto the installed path',
    );
  });

  it('extracts the archive before installing anything from it', () => {
    const extractAt = installer.indexOf('tar -xzf');
    const installAt = installer.indexOf('Installing binary to');
    assert.ok(extractAt > 0 && installAt > extractAt, 'extraction must precede installation');
  });
});
