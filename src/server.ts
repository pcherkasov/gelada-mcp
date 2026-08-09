import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';

import { packageVersion } from './utils/package-paths.js';
import { ContractValidator } from './components/contract-validator.js';
import { PolicyEngine } from './components/policy-engine.js';
import { RepositoryInspector } from './components/repository-inspector.js';
import { WorktreeManager } from './components/worktree-manager.js';
import { AntigravityDriver } from './components/worker-driver.js';
import { ProcessSupervisor } from './components/process-supervisor.js';
import { VerificationEngine } from './components/verification-engine.js';
import { ArtifactManager } from './components/artifact-manager.js';
import { TaskRegistry } from './components/task-registry.js';
import { ModelRouter } from './components/model-router.js';
import { registerAllTools } from './tools/index.js';
import { GELADA_SERVER_INSTRUCTIONS } from './server-instructions.js';
import { registerInstructionResources } from './resources/index.js';
import { registerAllPrompts } from './prompts/index.js';

export interface GeladaServerComponents {
  contractValidator: ContractValidator;
  policyEngine: PolicyEngine;
  repositoryInspector: RepositoryInspector;
  worktreeManager: WorktreeManager;
  workerDriver: AntigravityDriver;
  processSupervisor: ProcessSupervisor;
  verificationEngine: VerificationEngine;
  artifactManager: ArtifactManager;
  taskRegistry: TaskRegistry;
  modelRouter: ModelRouter;
  /**
   * Returns an ArtifactManager rooted at a specific repository. Absent when the
   * caller injected an explicit `artifactManager`, so tests keep full control.
   */
  artifactManagerFactory?: (repoPath: string) => ArtifactManager;
}

/**
 * Resolves which ArtifactManager to use for a task. Artifacts belong to the
 * repository the task targets, not to whatever directory the server happens to
 * have been started in.
 */
export function artifactsFor(
  components: GeladaServerComponents,
  repoPath?: string,
): ArtifactManager {
  if (!repoPath || !components.artifactManagerFactory) {
    return components.artifactManager;
  }
  return components.artifactManagerFactory(repoPath);
}

export class GeladaServer {
  private readonly mcpServer: McpServer;
  public readonly components: GeladaServerComponents;

  constructor(components?: Partial<GeladaServerComponents>) {
    this.mcpServer = new McpServer(
      {
        name: 'gelada-mcp',
        version: packageVersion(),
      },
      {
        // Surfaced in the initialize response and injected into the leader
        // agent's context by the client. Without it the agent sees seven tool
        // names and no reason to prefer any of them over editing files itself.
        instructions: GELADA_SERVER_INSTRUCTIONS,
      },
    );

    const processSupervisor = components?.processSupervisor ?? new ProcessSupervisor();
    const workerDriver =
      components?.workerDriver ?? new AntigravityDriver({ supervisor: processSupervisor });

    // Only install the repo-scoping factory when the caller did not supply an
    // ArtifactManager of its own; otherwise the injected instance would be
    // bypassed for every task that names a repository.
    const artifactCache = new Map<string, ArtifactManager>();
    const artifactManagerFactory =
      components?.artifactManagerFactory ??
      (components?.artifactManager
        ? undefined
        : (repoPath: string): ArtifactManager => {
            let existing = artifactCache.get(repoPath);
            if (!existing) {
              existing = new ArtifactManager({ repoRoot: repoPath });
              artifactCache.set(repoPath, existing);
            }
            return existing;
          });

    this.components = {
      contractValidator: components?.contractValidator ?? new ContractValidator(),
      policyEngine: components?.policyEngine ?? new PolicyEngine(),
      repositoryInspector: components?.repositoryInspector ?? new RepositoryInspector(),
      worktreeManager: components?.worktreeManager ?? new WorktreeManager(),
      workerDriver,
      processSupervisor,
      verificationEngine: components?.verificationEngine ?? new VerificationEngine(),
      artifactManager: components?.artifactManager ?? new ArtifactManager(),
      taskRegistry: components?.taskRegistry ?? new TaskRegistry(),
      modelRouter: components?.modelRouter ?? new ModelRouter(),
      artifactManagerFactory,
    };

    registerAllTools(this.mcpServer, this.components);
    registerInstructionResources(this.mcpServer);
    registerAllPrompts(this.mcpServer);
  }

  public getMcpServer(): McpServer {
    return this.mcpServer;
  }

  public async start(transport: Transport): Promise<void> {
    await this.mcpServer.connect(transport);
    console.error('Gelada MCP server connected and listening via stdio.');
  }

  public async close(): Promise<void> {
    await this.mcpServer.close();
  }
}

export function createGeladaServer(components?: Partial<GeladaServerComponents>): GeladaServer {
  return new GeladaServer(components);
}
