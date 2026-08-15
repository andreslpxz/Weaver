# Weaver — Worklog

---
Task ID: rlm-1
Agent: main (Super Z)
Task: Actualizar agente principal de Weaver al paradigma RLM (Recursive Language Model).

Work Log:
- Inspeccioné el código actual del agente en `src/agent/`: executor.ts (ReAct loop con AT-SPI tools), subagent.ts (subagent registry + runSubagent con presupuesto), orchestrator.ts (selección por keyword + budget split), reflection.ts (skill auto-aprendida), memory.ts (episodios + facts), loop.ts (planner→executor→critic→reflection).

Implementación RLM en `src/agent/rlm/`:

RLM-1 + RLM-5 (ContextStore + tools):
- `contextStore.ts`: clase ContextStore con set/get/list/delete/clear, snapshot/restore, toPromptSummary (sin contenido), forkCleanContextStore (hijo no hereda basura), historial.
- `contextTools.ts`: 9 tools OpenAI-compatible (ctx_*, file_view_lines/structure/symbols, spawn_child_agent) + dispatchContextTool.

RLM-2 + RLM-4 (spawnChildAgent recursivo con limits):
- `spawnChildAgent.ts`: función recursiva spawnChildAgent con RecursionContext, límites (maxDepth 3, maxTotalChildren 50, maxConcurrentChildren 5, maxTotalTimeMs 10min), estados de salida (succeeded/failed/stuck/timeout/budget_exceeded/depth_exceeded/total_limit_exceeded/cancelled).
- createRootRecursionContext para crear contexto raíz.
- registerSpawnChildAgentHook registra hook global en window.__weaverRlmSpawnHook que intercepta llamadas spawn_child_agent desde cualquier subagente (permite recursión real sin modificar runSubagent).
- Auto-selección por keyword match cuando no se especifica subagentName.
- formatRecursionTree para reporting.

RLM-3 (/refine command):
- `refine.ts`: refine() analiza trazas y propone cambios al scaffolding (5 action types: prompt_refine, skill_create, skill_update, subagent_create, tool_allowlist_update).
- Cap de 3 acciones por refinamiento.
- Snapshot pre-refinamiento (subagentes, skills, traceSteps) para revert.
- evaluateRefine() compara métricas antes/después (tokens, steps, tiempo) y decide shouldRevert automáticamente.
- revertToSnapshot() restaura subagentes.
- runRefineCommand() para invocar /refine desde el chat.

RLM-6 (executor RLM):
- `executor.ts`: executeWithRlm() versión RLM-aware del executor.
- System prompt que enseña Context-as-Variable: ctx_list al inicio, file_view_* en vez de file_read, ctx_set para guardar, spawn_child_agent para delegar.
- Integra tools AT-SPI/automation legacy + tools de contexto.
- Registra/cleanup del hook global automáticamente.

Tests (66 nuevos en 4 archivos):
- contextStore.test.ts (17 tests): set/get/overwrite, list without content, delete, clear, totalSize, snapshot/restore, toPromptSummary, history, forkCleanContextStore, summarizeTraceForPrompt.
- contextTools.test.ts (20 tests): ctx CRUD, file_view_lines/structure/symbols, spawn_child_agent (con/sin provider).
- spawnChildAgent.test.ts (14 tests): createRootRecursionContext, spawn exitoso, auto-selección, depth_exceeded, total_limit_exceeded, cancelled, timeout, onSpawn, budget override, hook registration.
- refine.test.ts (15 tests): refine devuelve acciones, aplica con autoApply, snapshot, cap 3, LLM inválido, evaluateRefine (neutral/improved/regressed), revertToSnapshot, runRefineCommand, todos los action types.

Verificación final:
- `tsc --noEmit` → 0 errores.
- `vitest run` → 173/173 tests pasando (107 workflows + 66 RLM).
- `vite build` → success en 28.89s.

Stage Summary:
- 5 módulos RLM en `src/agent/rlm/` (~1,400 LOC TS).
- 9 tools nuevas (ctx_*, file_view_*, spawn_child_agent).
- 5 tipos de refine actions.
- 66 tests nuevos, 173 total.
- NO se modificó código existente del agente (executor.ts, orchestrator.ts, subagent.ts, loop.ts intactos). RLM es opt-in vía executeWithRlm().
- El hook global window.__weaverRlmSpawnHook es opt-in: sólo se activa con registerSpawnChildAgentHook().
- Próximos pasos: cablear executeWithRlm en agent/loop.ts como alternativa al executor legacy, exponer /refine en la UI del chat.
