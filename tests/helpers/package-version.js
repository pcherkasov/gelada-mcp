import { readFileSync } from 'node:fs';

/**
 * The version the build under test actually reports.
 *
 * Read from package.json rather than written as a literal: releases are cut by
 * merging a version bump, so a hard-coded version would make the release gate
 * fail on every release — the one moment the suite has to be green.
 */
export const PACKAGE_VERSION = JSON.parse(
  readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
).version;
