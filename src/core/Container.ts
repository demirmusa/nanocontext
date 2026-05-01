import * as path from 'path';
import { ConfigManager } from './config/ConfigManager';
import { SqliteStateStore } from './storage/SqliteStateStore';
import { HeaderStore } from './storage/HeaderStore';
import { LanceVectorStore } from './storage/LanceVectorStore';
import { LLMProviderFactory } from './llm/LLMProviderFactory';
import { EmbeddingProviderFactory } from './embedding/EmbeddingProviderFactory';
import { CachedEmbeddingProvider } from './embedding/CachedEmbeddingProvider';
import { createDefaultRegistry } from './parser';
import { StructurePipeline } from './pipeline/StructurePipeline';
import { InsightPipeline } from './pipeline/InsightPipeline';
import { SyncService } from './pipeline/SyncService';
import { SearchEngine } from './search/SearchEngine';
import { MemoryStore } from './memory/MemoryStore';
import { FileWatcher } from './watcher/FileWatcher';
import { CodeReadService } from './services/CodeReadService';
import { DependencyService } from './services/DependencyService';
import { IndexService } from './services/IndexService';
import { InspectionService } from './services/InspectionService';
import { FileDiscoveryService } from './services/FileDiscoveryService';
import { MemoryService } from './services/MemoryService';
import { ProjectDataService } from './services/ProjectDataService';
import { ProjectInitService } from './services/ProjectInitService';
import { SearchService } from './services/SearchService';
import { StatusService } from './services/StatusService';
import { WatchService } from './services/WatchService';
import { AgentSetupService } from './services/AgentSetupService';
import { ImpactService } from './services/ImpactService';
import { StaleService } from './services/StaleService';
import { GuardedEmbeddingProvider, GuardedLLMProvider } from './providers/ProviderGuard';
import { PrepareService } from './services/PrepareService';
import { Logger } from '../utils/Logger';
import { IConfigManager } from './interfaces/IConfigManager';
import { IStateStore } from './interfaces/IStateStore';
import { IHeaderStore } from './interfaces/IHeaderStore';
import { IVectorStore } from './interfaces/IVectorStore';
import { ILLMProvider } from './interfaces/ILLMProvider';
import { IEmbeddingProvider } from './interfaces/IEmbeddingProvider';
import { IParserRegistry } from './interfaces/IParser';
import { IStructurePipeline, IInsightPipeline, ISyncService } from './interfaces/IPipeline';
import { ISearchEngine } from './interfaces/ISearchEngine';
import { IMemoryStore } from './interfaces/IMemoryStore';
import { IFileWatcher } from './interfaces/IFileWatcher';
import { ILogger, LogLevel } from './interfaces/ILogger';

export class Container {
  private _configManager: IConfigManager | null = null;
  private _stateStore: IStateStore | null = null;
  private _headerStore: IHeaderStore | null = null;
  private _vectorStore: IVectorStore | null = null;
  private _llmProvider: ILLMProvider | null = null;
  private _embeddingProvider: IEmbeddingProvider | null = null;
  private _parserRegistry: IParserRegistry | null = null;
  private _structurePipeline: IStructurePipeline | null = null;
  private _insightPipeline: IInsightPipeline | null = null;
  private _syncService: ISyncService | null = null;
  private _searchEngine: ISearchEngine | null = null;
  private _memoryStore: IMemoryStore | null = null;
  private _fileWatcher: IFileWatcher | null = null;
  private _codeReadService: CodeReadService | null = null;
  private _dependencyService: DependencyService | null = null;
  private _indexService: IndexService | null = null;
  private _inspectionService: InspectionService | null = null;
  private _fileDiscoveryService: FileDiscoveryService | null = null;
  private _memoryService: MemoryService | null = null;
  private _projectDataService: ProjectDataService | null = null;
  private _projectInitService: ProjectInitService | null = null;
  private _searchService: SearchService | null = null;
  private _statusService: StatusService | null = null;
  private _watchService: WatchService | null = null;
  private _agentSetupService: AgentSetupService | null = null;
  private _impactService: ImpactService | null = null;
  private _staleService: StaleService | null = null;
  private _prepareService: PrepareService | null = null;
  private _logger: ILogger | null = null;
  private _defaultSearchLimit: number = 5;
  private _initialized = false;

  constructor(private projectRoot?: string) {}

  get logger(): ILogger {
    if (!this._logger) {
      const logDir = this.projectRoot
        ? path.join(this.projectRoot, '.nanocontext', 'logs')
        : undefined;
      this._logger = new Logger(LogLevel.INFO, logDir);
    }
    return this._logger;
  }

  get configManager(): IConfigManager {
    if (!this._configManager) {
      this._configManager = new ConfigManager(this.projectRoot);
      // Update projectRoot from config manager
      if (!this.projectRoot) {
        this.projectRoot = this._configManager.getProjectRoot();
      }
    }
    return this._configManager;
  }

  get stateStore(): IStateStore {
    if (!this._stateStore) {
      this._stateStore = new SqliteStateStore(this.configManager.getProjectRoot());
    }
    return this._stateStore;
  }

  get headerStore(): IHeaderStore {
    if (!this._headerStore) {
      this._headerStore = new HeaderStore(this.configManager.getProjectRoot());
    }
    return this._headerStore;
  }

  get vectorStore(): IVectorStore {
    if (!this._vectorStore) {
      this._vectorStore = new LanceVectorStore(this.configManager.getProjectRoot());
    }
    return this._vectorStore;
  }

  get parserRegistry(): IParserRegistry {
    if (!this._parserRegistry) {
      this._parserRegistry = createDefaultRegistry();
    }
    return this._parserRegistry;
  }

  get llmProvider(): ILLMProvider | null {
    return this._llmProvider;
  }

  get embeddingProvider(): IEmbeddingProvider | null {
    return this._embeddingProvider;
  }

  get structurePipeline(): IStructurePipeline {
    if (!this._structurePipeline) {
      this._structurePipeline = new StructurePipeline(
        this.parserRegistry,
        this.headerStore,
        this.stateStore,
        this.vectorStore,
        this._embeddingProvider,
        this._llmProvider,
        this.configManager,
        this.logger,
      );
    }
    return this._structurePipeline;
  }

  get insightPipeline(): IInsightPipeline {
    if (!this._insightPipeline) {
      this._insightPipeline = new InsightPipeline(
        this._llmProvider,
        this.headerStore,
        this.stateStore,
        this.configManager,
        this.logger,
      );
    }
    return this._insightPipeline;
  }

  get syncService(): ISyncService {
    if (!this._syncService) {
      this._syncService = new SyncService(
        this.structurePipeline,
        this.headerStore,
        this.stateStore,
        this.vectorStore,
        this.configManager,
        this.logger,
        this._embeddingProvider,
      );
    }
    return this._syncService;
  }

  get searchEngine(): ISearchEngine {
    if (!this._searchEngine) {
      const defaultLimit = this._defaultSearchLimit ?? 3;
      this._searchEngine = new SearchEngine(
        this.vectorStore,
        this._embeddingProvider,
        this.headerStore,
        this.memoryStore,
        this.stateStore,
        this.logger,
        defaultLimit,
      );
    }
    return this._searchEngine;
  }

  get memoryStore(): IMemoryStore {
    if (!this._memoryStore) {
      this._memoryStore = new MemoryStore(
        this.configManager.getProjectRoot(),
        this.vectorStore,
        this._embeddingProvider,
      );
    }
    return this._memoryStore;
  }

  get fileWatcher(): IFileWatcher {
    if (!this._fileWatcher) {
      this._fileWatcher = new FileWatcher(this.configManager, this.logger, this.parserRegistry);
    }
    return this._fileWatcher;
  }

  get codeReadService(): CodeReadService {
    if (!this._codeReadService) {
      this._codeReadService = new CodeReadService(this.configManager, this.headerStore, this.stateStore, this.memoryStore);
    }
    return this._codeReadService;
  }

  get dependencyService(): DependencyService {
    if (!this._dependencyService) {
      this._dependencyService = new DependencyService(this.configManager, this.headerStore, this.stateStore, this.codeReadService);
    }
    return this._dependencyService;
  }

  get memoryService(): MemoryService {
    if (!this._memoryService) {
      this._memoryService = new MemoryService(this.memoryStore, this.configManager, this.codeReadService);
    }
    return this._memoryService;
  }

  get inspectionService(): InspectionService {
    if (!this._inspectionService) {
      this._inspectionService = new InspectionService(this.configManager, this.headerStore);
    }
    return this._inspectionService;
  }

  get fileDiscoveryService(): FileDiscoveryService {
    if (!this._fileDiscoveryService) {
      this._fileDiscoveryService = new FileDiscoveryService(this.stateStore);
    }
    return this._fileDiscoveryService;
  }

  get statusService(): StatusService {
    if (!this._statusService) {
      this._statusService = new StatusService(this.stateStore, this.vectorStore, this.configManager);
    }
    return this._statusService;
  }

  get searchService(): SearchService {
    if (!this._searchService) {
      this._searchService = new SearchService(
        this.searchEngine,
        this.configManager,
        this._llmProvider,
        this.logger,
        this.memoryStore,
      );
    }
    return this._searchService;
  }

  get projectDataService(): ProjectDataService {
    if (!this._projectDataService) {
      this._projectDataService = new ProjectDataService(
        this.configManager,
        this.stateStore,
        this.vectorStore,
        this._embeddingProvider,
      );
    }
    return this._projectDataService;
  }

  get projectInitService(): ProjectInitService {
    if (!this._projectInitService) {
      this._projectInitService = new ProjectInitService();
    }
    return this._projectInitService;
  }

  get indexService(): IndexService {
    if (!this._indexService) {
      this._indexService = new IndexService(
        this.configManager,
        this.stateStore,
        this.structurePipeline,
        this.syncService,
        this.vectorStore,
        this._embeddingProvider,
      );
    }
    return this._indexService;
  }

  get watchService(): WatchService {
    if (!this._watchService) {
      this._watchService = new WatchService(this.configManager, this.fileWatcher, this.syncService);
    }
    return this._watchService;
  }

  get agentSetupService(): AgentSetupService {
    if (!this._agentSetupService) {
      this._agentSetupService = new AgentSetupService();
    }
    return this._agentSetupService;
  }

  get impactService(): ImpactService {
    if (!this._impactService) {
      this._impactService = new ImpactService(
        this.configManager,
        this.headerStore,
        this.stateStore,
        this.memoryStore,
        this.codeReadService,
        this.dependencyService,
      );
    }
    return this._impactService;
  }

  get staleService(): StaleService {
    if (!this._staleService) {
      this._staleService = new StaleService(
        this.configManager,
        this.headerStore,
        this.stateStore,
        this.vectorStore,
      );
    }
    return this._staleService;
  }

  get prepareService(): PrepareService {
    if (!this._prepareService) {
      this._prepareService = new PrepareService(
        this.searchService,
        this.staleService,
        this.impactService,
        this.memoryStore,
      );
    }
    return this._prepareService;
  }

  async initialize(): Promise<void> {
    if (this._initialized) return;

    // Initialize state store
    await this.stateStore.initialize();

    // Load configs
    const userConfig = await this.configManager.loadUserConfig();
    const projectConfig = await this.configManager.loadProjectConfig();
    this._defaultSearchLimit = projectConfig.search.defaultLimit;

    // Create LLM provider
    if (userConfig.llm.provider !== 'none') {
      try {
        const llmFactory = new LLMProviderFactory();
        this._llmProvider = new GuardedLLMProvider(llmFactory.create(userConfig.llm));
      } catch (err) {
        this.logger.warn('LLM provider not configured:', err);
      }
    }

    // Create embedding provider
    if (userConfig.embedding.provider !== 'none') {
      try {
        const embeddingFactory = new EmbeddingProviderFactory();
        const guardedProvider = new GuardedEmbeddingProvider(embeddingFactory.create(userConfig.embedding));
        this._embeddingProvider = new CachedEmbeddingProvider(
          guardedProvider,
          this.configManager.getProjectRoot(),
          userConfig.embedding.model,
        );

        // Initialize vector store with provider dimensions
        await this.vectorStore.initialize(this._embeddingProvider.dimensions);
      } catch (err) {
        this.logger.warn('Embedding provider not configured:', err);
        // Initialize vector store with default dimensions
        await this.vectorStore.initialize(768);
      }
    } else {
      await this.vectorStore.initialize(768);
    }

    // Reset lazily-created dependents so they pick up the new providers
    this._structurePipeline = null;
    this._insightPipeline = null;
    this._syncService = null;
    this._searchEngine = null;
    this._memoryStore = null;
    this._indexService = null;
    this._memoryService = null;
    this._projectDataService = null;
    this._searchService = null;
    this._statusService = null;
    this._watchService = null;
    this._impactService = null;
    this._staleService = null;
    this._prepareService = null;

    this._initialized = true;
  }

  async dispose(): Promise<void> {
    if (this._fileWatcher?.isWatching) {
      await this._fileWatcher.stop();
    }
    this._memoryStore?.close();
    this._stateStore?.close();
    this._initialized = false;
  }
}
