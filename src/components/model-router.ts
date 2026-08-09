import {
  AbstractModelProfile,
  LoadCatalogOptions,
  WorkerModel,
  WorkerModelCatalog,
  getProfileDefinition,
  isKnownModelId,
  loadWorkerModelCatalog,
  selectModelForProfile,
} from './model-catalog.js';

export { AbstractModelProfile };

export interface ModelResolution {
  /** What the caller asked for. */
  requested: string;
  /** Concrete model id to hand to the worker CLI. */
  model: string;
  /** Whether `requested` was an abstract profile or an explicit model id. */
  kind: 'profile' | 'explicit';
  /** Where the model catalog came from. */
  catalogSource: WorkerModelCatalog['source'];
  warning?: string;
}

export class ModelRouterError extends Error {
  public readonly code = 'UNKNOWN_MODEL';
  public readonly availableModels: string[];

  constructor(message: string, availableModels: string[]) {
    super(message);
    this.name = 'ModelRouterError';
    this.availableModels = availableModels;
  }
}

const DEFAULT_PROFILE = 'DEFAULT';

/**
 * Translates an abstract model profile (FAST / BALANCED / DEEP / DEFAULT) into a
 * model id the worker CLI actually accepts.
 *
 * Resolution never invents an identifier: it selects from the catalog the CLI
 * reports. Passing a model the CLI does not know is rejected up front rather
 * than being discovered as a worker crash mid-task.
 */
export class ModelRouter {
  private readonly catalogOptions: LoadCatalogOptions;

  constructor(catalogOptions: LoadCatalogOptions = {}) {
    this.catalogOptions = catalogOptions;
  }

  public async getCatalog(refresh = false): Promise<WorkerModelCatalog> {
    return loadWorkerModelCatalog({ ...this.catalogOptions, refresh });
  }

  public async resolve(profile?: string): Promise<ModelResolution> {
    const requested = (profile || DEFAULT_PROFILE).trim() || DEFAULT_PROFILE;
    const catalog = await this.getCatalog();

    // 1. Abstract profile.
    if (getProfileDefinition(requested)) {
      const model = selectModelForProfile(requested, catalog.models);
      if (!model) {
        throw new ModelRouterError(
          `No worker model available for profile "${requested}". The worker CLI reported no usable models.`,
          catalog.models.map((m) => m.id),
        );
      }
      return {
        requested,
        model,
        kind: 'profile',
        catalogSource: catalog.source,
        warning: catalog.warning,
      };
    }

    // 2. Explicit model id the CLI knows about.
    if (isKnownModelId(requested, catalog.models)) {
      const match = catalog.models.find((m) => m.id.toLowerCase() === requested.toLowerCase());
      return {
        requested,
        model: match?.id ?? requested,
        kind: 'explicit',
        catalogSource: catalog.source,
        warning: catalog.warning,
      };
    }

    // 3. Unknown. Reject when the catalog is trustworthy; pass through otherwise
    //    so an offline worker CLI cannot block an explicitly requested model.
    if (catalog.source === 'cli') {
      throw new ModelRouterError(
        `Unknown model profile or model id "${requested}". ` +
          `Use one of the profiles FAST, BALANCED, DEEP, DEFAULT, ` +
          `or one of the models reported by the worker CLI: ${catalog.models
            .map((m) => m.id)
            .join(', ')}.`,
        catalog.models.map((m) => m.id),
      );
    }

    return {
      requested,
      model: requested,
      kind: 'explicit',
      catalogSource: catalog.source,
      warning:
        catalog.warning ??
        `Could not verify model "${requested}" against the worker CLI catalog; passing it through as-is.`,
    };
  }

  /** Convenience wrapper returning just the model id. */
  public async resolveAgyModel(profile?: string): Promise<string> {
    return (await this.resolve(profile)).model;
  }

  public async listModels(refresh = false): Promise<WorkerModel[]> {
    return (await this.getCatalog(refresh)).models;
  }
}
