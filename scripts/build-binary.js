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

async function build() {
  console.log('Ensuring dist and dist/binaries directories exist...');
  fs.mkdirSync(binariesDir, { recursive: true });

  console.log('Bundling bin/gelada.js with esbuild...');
  await esbuild.build({
    entryPoints: [path.join(rootDir, 'bin', 'gelada.js')],
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'cjs',
    outfile: bundlePath,
  });
  console.log(`Esbuild bundling complete: ${bundlePath}`);

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

build().catch((err) => {
  console.error('Build failed:', err);
  process.exit(1);
});
