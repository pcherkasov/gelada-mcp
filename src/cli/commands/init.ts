import { Command } from 'commander';
import * as fs from 'fs';
import * as path from 'path';

export interface InitCommandOptions {
  force?: boolean;
}

const PRESETS: Record<string, string> = {
  typescript: `version: 1.0.0
description: "TypeScript/Node.js project policy"

allowedPaths:
  - "src/**"
  - "tests/**"
  - "package.json"
  - "tsconfig.json"

disallowedPaths:
  - "node_modules/**"
  - "dist/**"
  - ".git/**"
  - ".env"
  - ".env.*"

verification:
  commands:
    - "npm run typecheck"
    - "npm test"

modelProfile: "pro"
`,
  java: `version: 1.0.0
description: "Java/Maven project policy"

allowedPaths:
  - "src/main/**"
  - "src/test/**"
  - "pom.xml"

disallowedPaths:
  - "target/**"
  - ".git/**"
  - "*.jar"
  - "*.war"
  - "*.class"
  - ".idea/**"

verification:
  commands:
    - "mvn test"
    - "mvn checkstyle:check"

modelProfile: "pro"
`,
  python: `version: 1.0.0
description: "Python project policy"

allowedPaths:
  - "**/*.py"
  - "requirements.txt"
  - "pyproject.toml"
  - "tests/**"

disallowedPaths:
  - "venv/**"
  - ".venv/**"
  - "__pycache__/**"
  - "*.pyc"
  - ".git/**"
  - ".env"

verification:
  commands:
    - "pytest"
    - "flake8 ."

modelProfile: "pro"
`,
  go: `version: 1.0.0
description: "Go project policy"

allowedPaths:
  - "**/*.go"
  - "go.mod"
  - "go.sum"

disallowedPaths:
  - "vendor/**"
  - ".git/**"
  - "*.exe"
  - "*.out"
  - ".env"

verification:
  commands:
    - "go test ./..."
    - "go build -v ./..."
    - "go vet ./..."

modelProfile: "pro"
`
};

export function registerInitCommand(program: Command): void {
  program
    .command('init [preset]')
    .description('Initialize a default .gelada/policy.yaml for your project (presets: typescript, java, python, go)')
    .option('-f, --force', 'Overwrite existing policy file')
    .action((preset: string | undefined, options: InitCommandOptions) => {
      const targetDir = path.join(process.cwd(), '.gelada');
      const targetFile = path.join(targetDir, 'policy.yaml');

      if (fs.existsSync(targetFile) && !options.force) {
        console.error('Error: .gelada/policy.yaml already exists. Use --force to overwrite.');
        process.exit(1);
      }

      const selectedPreset = preset ? preset.toLowerCase() : 'typescript';
      const content = PRESETS[selectedPreset];

      if (!content) {
        console.error(`Error: Unknown preset '${selectedPreset}'. Available presets: ${Object.keys(PRESETS).join(', ')}`);
        process.exit(1);
      }

      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
      }

      fs.writeFileSync(targetFile, content, 'utf8');
      console.log(`Successfully generated .gelada/policy.yaml using the '${selectedPreset}' preset.`);
      console.log('You can now review and adjust the file to suit your project.');
    });
}
