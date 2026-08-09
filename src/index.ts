import { runCli } from './cli/index.js';

export { runCli };

runCli().catch((error) => {
  console.error('Fatal error running Gelada CLI:', error);
  process.exit(1);
});
