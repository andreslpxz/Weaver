/**
 * RLM (Recursive Language Model) module.
 *
 * Implementa el paradigma RLM en Weaver:
 *   1. Context-as-Variable: el agente opera sobre fragmentos, no contenido completo.
 *   2. Recursive Subagents: spawnChildAgent() para delegar con ventana limpia.
 *   3. /refine: auto-refinamiento de scaffolding con snapshots revertibles.
 *   4. Orchestrator con recursion depth limit y termination signals.
 *
 * Ver:
 *   - contextStore.ts — almacenamiento de fragmentos por sesión.
 *   - contextTools.ts — tools ctx_set/get/list/delete/clear + file_view_*.
 *   - spawnChildAgent.ts — recursión controlada con límites.
 *   - refine.ts — auto-refinamiento con snapshots.
 */

export {
  ContextStore,
  createContextStore,
  forkCleanContextStore,
  summarizeTraceForPrompt,
  type ContextFragment,
  type ContextStoreSnapshot,
} from './contextStore';

export {
  buildContextTools,
  dispatchContextTool,
  type ToolExecResult as ContextToolExecResult,
} from './contextTools';

export {
  spawnChildAgent,
  createRootRecursionContext,
  registerSpawnChildAgentHook,
  hasSpawnChildAgentHook,
  formatRecursionTree,
  DEFAULT_RLM_LIMITS,
  type RlmLimits,
  type RecursionContext,
  type SpawnInfo,
  type SpawnResult,
  type RootRecursionContextOptions,
} from './spawnChildAgent';

export {
  refine,
  evaluateRefine,
  revertToSnapshot,
  runRefineCommand,
  type RefineAction,
  type RefineActionType,
  type RefineResult,
  type RefineSnapshot,
  type RefineEvaluation,
  type RefineCommandResult,
} from './refine';

export {
  executeWithRlm,
  type RlmExecutorResult,
  type RlmExecutorOpts,
} from './executor';

export {
  parseSlashCommand,
  validateCommand,
  getHelpMessage,
  type ParsedCommand,
} from './slashCommands';
