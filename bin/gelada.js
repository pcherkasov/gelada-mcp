#!/usr/bin/env node
import { runCli } from '../dist/cli/index.js';

runCli().catch((err) => {
  console.error('Fatal CLI execution error:', err);
  process.exit(1);
});
