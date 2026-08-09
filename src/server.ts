import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';

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
}

export class GeladaServer {
  private readonly mcpServer: McpServer;
  public readonly components: GeladaServerComponents;

  constructor(components?: Partial<GeladaServerComponents>) {
    this.mcpServer = new McpServer({
      name: 'gelada-mcp',
      version: '0.1.0',
    });

    const processSupervisor = components?.processSupervisor ?? new ProcessSupervisor();
    const workerDriver =
      components?.workerDriver ?? new AntigravityDriver({ supervisor: processSupervisor });

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
    };

    registerAllTools(this.mcpServer, this.components);
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
