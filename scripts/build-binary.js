import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import esbuild from 'esbuild';
import { exec as pkgExec } from '@yao-pkg/pkg';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const bundleDir = path.join(rootDir, 'dist');
const binariesDir = path.join(rootDir, 'dist', 'binaries');
const bundlePath = path.join(bundleDir, 'bundle.cjs');

export async function bundle() {
  fs.mkdirSync(bundleDir, { recursive: true });

  console.log('Bundling bin/gelada.js with esbuild...');
  await esbuild.build({
    entryPoints: [path.join(rootDir, 'bin', 'gelada.js')],
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'cjs',
    outfile: bundlePath,
    // The sources are ESM and locate package files via import.meta.url. The
    // bundle is CommonJS, where that does not exist, so give it the equivalent
    // rather than letting esbuild emit a broken reference.
    define: {
      'import.meta.url': '__gelada_module_url',
    },
    banner: {
      js: "const __gelada_module_url = require('node:url').pathToFileURL(__filename).href;",
    },
  });
  console.log(`Esbuild bundling complete: ${bundlePath}`);
  return bundlePath;
}

async function build() {
  fs.mkdirSync(binariesDir, { recursive: true });
  await bundle();

  const targets = [
    { spec: 'node20-macos-x64', output: path.join(binariesDir, 'gelada-darwin-x64') },
    { spec: 'node20-macos-arm64', output: path.join(binariesDir, 'gelada-darwin-arm64') },
    { spec: 'node20-linux-x64', output: path.join(binariesDir, 'gelada-linux-x64') },
    { spec: 'node20-linux-arm64', output: path.join(binariesDir, 'gelada-linux-arm64') },
    { spec: 'node20-win-x64', output: path.join(binariesDir, 'gelada-win-x64.exe') },
  ];

  for (const target of targets) {
    console.log(`Building binary for target ${target.spec} -> ${path.basename(target.output)}...`);
    await pkgExec([bundlePath, '--target', target.spec, '--output', target.output]);
  }

  console.log('All standalone binaries created successfully in dist/binaries/:');
  const files = fs.readdirSync(binariesDir);
  for (const file of files) {
    const stat = fs.statSync(path.join(binariesDir, file));
    console.log(` - ${file} (${stat.size} bytes)`);
  }
}

// Only build the binaries when run as a script; importing this module for
// `bundle()` alone must not spend two minutes packaging executables.
const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename);

if (invokedDirectly) {
  build().catch((err) => {
    console.error('Build failed:', err);
    process.exit(1);
  });
}
