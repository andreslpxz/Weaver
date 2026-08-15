# Weaver Workflows — Plan Maestro de Ingeniería

> Documento de auditoría, diagnóstico y roadmap para convertir el subsistema
> de workflows de Weaver en un motor de automatización AI-native de nivel
> producción, comparable (y en varios aspectos superior) a n8n.
>
> Este documento **no** es un clon de la arquitectura de n8n: toma los
> conceptos correctos (Execution / ExecutionContext / ExecutionItem /
> NodeRegistry / ExpressionEngine) y los reinterpreta aprovechando el
> diferenciador real de Weaver: un agente de IA con capacidad de construir,
> ejecutar, depurar y reparar workflows, sobre un runtime Tauri (Rust + React)
> que ya tiene 22 providers LLM, MCP runtime, sandbox de código y SQLite.

---

## Tabla de contenidos

1. [Auditoría del repositorio](#1-auditoría-del-repositorio)
2. [Diagnóstico: qué funciona, qué está parcial, qué falta](#2-diagnóstico)
3. [Comparativa conceptual con n8n](#3-comparativa-conceptual-con-n8n)
4. [Arquitectura target](#4-arquitectura-target)
5. [Plan por fases](#5-plan-por-fases)
6. [Estado: lo que ya llevo y lo que falta](#6-estado-lo-que-ya-llevo-y-lo-que-falta)
7. [Decisiones arquitectónicas abiertas](#7-decisiones-arquitectónicas-abiertas)
8. [Riesgos y mitigaciones](#8-riesgos-y-mitigaciones)
9. [Definition of Done](#9-definition-of-done)

---

## 1. Auditoría del repositorio

### 1.1 Inspección realizada

| Área | Archivos / Módulos inspeccionados |
|------|-----------------------------------|
| Estructura repo | `LS` recursivo de `/`, `src/`, `src-tauri/`, `.github/`, `tests/` |
| Stack | `package.json`, `tsconfig.json`, `vite.config.ts`, `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json` |
| Workflows actual | `src/workflows/types.ts`, `engine.ts`, `tools.ts`, `store.ts`, `nodeDefs.tsx` |
| Workflows UI | `src/views/WorkflowsView.tsx`, `src/views/WorkflowEditorView.tsx` |
| Agente IA | `src/agent/{loop,planner,executor,critic,reflection,memory,subagent,orchestrator,vision,types}.ts` |
| Tools agente | `src/lib/tools.ts` (1596 LOC, 20+ tools), `src/lib/scheduler.ts` |
| Backend Rust | `src-tauri/src/lib.rs`, `db/mod.rs`, `mcp.rs`, `tools/mod.rs`, `keyring/`, `commands.rs`, `commands_crossplatform.rs` |
| Providers | `src/providers/{registry,index,store,types}.ts` + 6 adapters |
| MCP | `src/mcp/{client,presets}.ts`, `src-tauri/src/mcp.rs` (409 LOC, runtime real) |
| Persistencia | `src-tauri/src/db/mod.rs` (1029 LOC, 7 tablas SQLite, ~52 comandos) |
| CI/CD | `.github/workflows/{build-linux,build-windows,build-macos,main}.yml` |
| Tests | `tests/windows/{apps.rs,smoke_test.ps1}` — sólo Windows, marcados `#[ignore]` |
| Docs | `README.md`, `PLAN.md`, `ARCHITECTURE.md`, `PROGRESS.md` (676 LOC, 14 sesiones), `worklog.md` |

### 1.2 Stack confirmado

| Capa | Tecnología |
|------|-----------|
| Frontend | React 18 + TypeScript 5.6 + Vite 5 + Tailwind 3.4 + Zustand 5 + @xyflow/react 12 (React Flow) |
| Backend | Rust 1.77+ + Tauri v2 + Tokio + zbus 4 (D-Bus) + rusqlite 0.32 |
| LLM | 22 providers en 6 familias de adapters (OpenAI-compat, Anthropic, Gemini, Ollama, VertexAI, Bedrock) |
| Editor visual | React Flow v12 (con minimap, controls, background) |
| Sandbox código | Subprocess Python/Node/Bash con timeout (sin aislamiento kernel todavía) |
| MCP runtime | Implementación real en Rust (JSON-RPC sobre stdio) |
| Persistencia | SQLite para memoria/proyectos/conversaciones/skills/me_* · localStorage para workflows/schedules |
| Keyring | OS-native (libsecret / Keychain / Credential Manager) |

### 1.3 Lo que ya existe y funciona en el subsistema Workflows

**5 archivos, ~750 LOC en `src/workflows/`:**

```
src/workflows/
├── types.ts        147 LOC  — Workflow, WorkflowNode, WorkflowEdge, 8 tipos de nodo
├── engine.ts       237 LOC  — BFS execution, visited Set, {{campo}} interp
├── tools.ts        192 LOC  — 6 agent tools (list/add/update/remove/connect/disconnect)
├── store.ts         97 LOC  — localStorage CRUD + evento custom
└── nodeDefs.tsx    142 LOC  — React Flow node renderer con status ring
```

**Adicional:** `src/views/WorkflowEditorView.tsx` (555 LOC) — editor completo + chat lateral.

**Funciona hoy:**
- ✅ Editor visual React Flow con drag-and-drop, minimap, controls, fit-view
- ✅ 8 tipos de nodo: `webhook`, `schedule`, `code`, `if`, `delay`, `set`, `chat_message`, `http_request`
- ✅ Ejecución del grafo (BFS con `visited = Set<NodeId>` y `MAX_STEPS=200`)
- ✅ Interpolación simple de `{{campo}}` por regex
- ✅ IF con dos salidas (sourceHandle `true` / `false`)
- ✅ Code Node usa `sandbox_run` real (Python/Node/Bash subprocess con timeout)
- ✅ HTTP Request Node funcional (fetch desde el frontend — sujeto a CORS)
- ✅ Persistencia en localStorage + autoguardado en cada mutación
- ✅ Chat lateral con LLM + 6 tools que modifican el grafo en vivo
- ✅ Run log con per-node status (ok/error) y output truncado a 500 chars
- ✅ Status ring visual en cada nodo durante la ejecución

### 1.4 Lo que NO existe o está simulado

| Característica | Estado | Evidencia |
|----------------|--------|-----------|
| Webhook HTTP server | **Simulado** | Comentario en `types.ts:28`: *"sólo informativo en v1, no hay servidor HTTP real embebido"*. No hay `axum`/`warp`/`hyper` en `Cargo.toml`. |
| Schedule trigger real | **Simulado** | `ScheduleNodeConfig` es metadata. El `scheduler.ts` lee una CLAVE SEPARADA `weaver:schedules` (no workflows). Los nodos schedule dentro de workflows nunca disparan. |
| Execution / ExecutionContext / ExecutionItem | **Ausente** | El engine opera con `ExecContext = Record<string, unknown>` único que se va fusionando. No hay multiple items. |
| Node Registry | **Ausente** | Dispatch es un `switch (node.type)` gigante en `engine.ts`. |
| Expression engine | **Ausente** | Regex `\{\{\s*([\w.]+)\s*\}\}` que hace lookup plano. No soporta `$json`, `$node[...]`, `$items("...")`, `$execution`, `$workflow`, `$env`, `$vars`, `$now`, ni operaciones. |
| Credentials system | **Ausente** | No hay entidad `Credential`, no hay cifrado, no hay `credentialId` en nodos. |
| Validator | **Ausente** | No hay detección de nodos desconectados, ciclos, credenciales faltantes, etc. |
| Execution history persistente | **Ausente** | `lastRun` es el único run que se guarda, en localStorage. |
| Retries / timeouts / cancellation | **Ausente** | Una sola ejecución por nodo, sin backoff. |
| Parallel branches | **Ausente** | BFS visita nodo por nodo; una vez visitado, no se re-entra desde otra rama. |
| Merge node | **Ausente** | Solo IF branch (true/false). |
| Loops | **Ausente** | Ningún nodo de loop. |
| Subworkflows | **Ausente** | No hay nodo `execute_workflow`. |
| Node versioning | **Ausente** | Tipos son un union plano sin `version`. |
| Workflow versioning | **Ausente** | Un solo draft por workflow. |
| Import / export JSON | **Ausente** | Workflows sólo viven en localStorage. |
| AI planner (NL → workflow) | **Ausente** | El chat sólo tiene tools de edición manual; no planifica un flujo completo desde lenguaje natural. |
| AI self-repair | **Ausente** | Sin observación de ejecución, sin diagnóstico, sin reparación automática. |
| Tests | **Ausente** | `package.json` no tiene `vitest` ni `jest`. `tests/` sólo contiene smoke tests de Windows AT-SPI. |
| Webhook runtime en Rust | **Ausente** | No hay HTTP server en backend. |
| Worker / queue | **Ausente** | Todo se ejecuta en el frontend, en el event loop del WebView. |

### 1.5 Deuda técnica detectada

1. **localStorage es la fuente de verdad para workflows** — la app ya tiene SQLite (`src-tauri/src/db/mod.rs` con 7 tablas) pero no lo usa para workflows. Esto significa: workflows no se sincronizan entre dispositivos, no son consultables con SQL, no soportan transactions, y están limitados por la cuota de localStorage (~5-10 MB).

2. **El engine corre en el frontend** — un workflow que tarde 30s en un HTTP request bloquea la UI. Un workflow con 1000 items causa renders de React innecesarios. Webhooks y schedules no pueden dispararse cuando la app está cerrada.

3. **El `switch (node.type)` en `engine.ts`** — agregar un nodo nuevo requiere modificar el engine. No hay forma de registrar nodos externos (p.ej. desde un plugin o desde un MCP server).

4. **`visited = Set<NodeId>` como mecanismo de control de ejecución** — esto impide:
   - Convergencia (un Merge node nunca podría recibir items de dos ramas)
   - Loops explícitos
   - Re-ejecución de un nodo con datos diferentes
   - Subworkflow call/return

5. **`chat_message` node es informativo** — comentario en `engine.ts:228`: *"el 'envío' es informativo — queda en el log de ejecución del workflow"*. No hay canal de mensajería conectado (Discord, Slack, etc.).

6. **HTTP Request usa `fetch()` del navegador** — sujeto a CORS, sin SSRF protection, sin retries, sin credential injection, sin timeout configurable.

7. **`MAX_STEPS = 200` como único circuit breaker** — no hay protección contra explosión de items (un loop que duplique items en cada iteración alcanza 1M en 20 pasos).

8. **Sin separación entre definición y ejecución** — `WorkflowNode` mezcla posición de canvas, configuración, tipo y label. No hay `NodeDefinition` (la clase) vs `NodeInstance` (lo que está en el canvas).

9. **AI agent tools son planas** — `workflow_add_node`, `workflow_connect_nodes`, etc. operan sobre el grafo pero no validan, no planifican, no observan, no reparan.

10. **El MCP runtime (Rust) no está expuesto al workflow engine** — los servidores MCP sólo se usan como tools del agente de escritorio. No hay nodo `mcp_tool_call` en workflows.

---

## 2. Diagnóstico

### 2.1 Matriz A/B/C/D/E

**A — Funciona y se queda:**
- Editor visual React Flow
- 8 tipos de nodo básicos (interfaz)
- Concepto de chat lateral con LLM que edita el grafo
- Sandbox de código (subprocess con timeout)
- SQLite infrastructure existente
- MCP runtime en Rust
- 22 LLM providers

**B — Parcialmente implementado (hay que completar):**
- Engine de ejecución (existe pero con modelo equivocado)
- AI agent tools (existen 6 pero faltan validator/planner/repairer/observer)
- Schedule node (existe como metadata pero no dispara)
- Code Node (sandbox básico, sin aislamiento kernel)
- HTTP Request Node (funciona pero sin features)
- Persistencia (localStorage funciona pero no es la capa correcta)

**C — Simulado (hay que implementar de verdad):**
- Webhook Node (no hay HTTP server)
- Schedule trigger en workflows (no está cableado al scheduler)
- Chat Message Node (sólo log, no envía nada)

**D — Roto / inutilizable:**
- Nada está literalmente roto en el sentido de "lanza excepción al cargar". Pero la combinación "Webhook + Schedule" como triggers + el engine basado en `visited` significa que **ningún workflow de producción podría correr de forma real** hoy. El sistema es una demostración visual, no un runtime.

**E — Falta totalmente:**
- Execution / ExecutionContext / ExecutionItem / NodeExecution / ExecutionState
- Node Registry + NodeDefinition con `execute()`
- Expression engine (parser + evaluator + safe runtime)
- Credentials system (entidad + cifrado + reference by credentialId)
- Validator estructurado
- Execution history persistente (tabla SQLite + API)
- Retries / backoff / timeouts / cancellation
- Parallel branches + Merge + Loop + Split + Filter + Sort + Limit + Aggregate
- Subworkflows (Execute Workflow node)
- Node versioning (`http.request@1`, `http.request@2`)
- Workflow versioning (Draft / Published / Version history / Rollback)
- Import / Export JSON
- AI Planner (NL → workflow)
- AI Self-Repair
- Webhook HTTP server en Rust (axum / hyper)
- Worker / queue / scheduler en Rust (para que los triggers disparen con la app cerrada)
- Tests (vitest)
- Observability (structured logs, metrics)
- Node picker con categorías y buscador
- Configuration panel por nodo
- Execution debugger UI (ver input/output por nodo, reintentar, ejecutar desde nodo)
- Undo / redo
- Copy / paste / multi-select / duplicate
- Connection validation
- Keyboard shortcuts

### 2.2 Cuellos de botella

1. **Frontend-centric execution** — el event loop del WebView es el cuello de botella. Workflows con muchos items o muchos HTTP requests lentos congelan la UI.
2. **localStorage I/O síncrono** — cada mutación del grafo serializa todo el array de workflows. Con 50 workflows de 50 nodos cada uno, esto es costoso.
3. **Sin worker thread** — todo el engine corre en el hilo principal de React.

### 2.3 Problemas de seguridad

1. **Code Node sin aislamiento kernel** — el sandbox actual es un subprocess con cwd temporal pero sin bubblewrap/gVisor/seccomp. Un script malicioso puede leer `~/.weaver/`, las variables de entorno, etc. (parcialmente mitigado: el sandbox limpia env vars excepto PATH).
2. **HTTP Request sin SSRF protection** — un workflow puede hacer fetch a `http://localhost:9090/admin` o a `http://169.254.169.254/` (AWS metadata).
3. **Sin rate limiting en webhook** — cuando exista el webhook server, no habrá throttling por defecto.
4. **Sin payload limits** — no hay máximo tamaño de body en webhook.
5. **Credentials inexistentes** — los API keys de nodos HTTP van en el JSON del workflow, en localStorage, en texto plano.
6. **Expression engine inexistente** — cuando se implemente, hay riesgo de code injection si se evalúa JS arbitrario.

### 2.4 Incompatibilidades con workflows complejos

El engine actual NO puede ejecutar:

- **Convergencia**: `A → B → D` y `A → C → D` (D visitaría dos veces, el segundo se ignora).
- **Loop**: cualquier nodo que necesite iterar sobre una colección de items.
- **Multiple items**: HTTP Request devuelve una respuesta; no puede devolver "100 items" que el siguiente nodo procese uno por uno.
- **Parallel**: dos branches independientes no se ejecutan en paralelo real.
- **Subworkflow**: no existe el concepto.
- **Resume / Wait**: no hay forma de pausar y resumir.

---

## 3. Comparativa conceptual con n8n

> **Principio rector:** aprender de la arquitectura conceptual de n8n, **NO clonar** su código ni su diseño exacto. Weaver debe ser mejor en su nicho (AI-native) y no intentar replicar feature-por-feature un producto de 8 años de desarrollo.

### 3.1 Lo que SÍ tomar de n8n (conceptos, no código)

| Concepto n8n | Aplicación en Weaver |
|--------------|---------------------|
| `WorkflowExecute` separado de la definición del workflow | `ExecutionEngine` clase TS, independiente del `Workflow` type |
| `IExecutionResponse` con `data` (runs por nodo) | Tabla `executions` + `node_executions` en SQLite |
| `INodeExecutionData[]` (múltiples items por nodo) | `ExecutionItem[]` con `json`, `binary`, `metadata`, `pairedItem` |
| `NodeTypes` registry con `execute()` por tipo | `NodeDefinition` interface + `NodeRegistry` map |
| `ICredentialType` + `ICredentialUserDecrypted` (cifrado AES) | `Credential` entity con `encryptedData` (AES-256-GCM en Rust) |
| `IExpressionResolveData` con `$json`, `$node`, `$items`, `$now`, `$execution` | Expression engine con parser propio (no `eval`) |
| `IRun` con `runData` por nodo | `NodeExecution` con `data`, `error`, `executionTime` |
| `WorkflowDataMode` (multiplexed items) | Soporte nativo de arrays de items en `ExecutionContext.inputItems` |
| `continueOnFail`, `retryOnFail`, `maxTries`, `waitAmount` | Config por nodo + error branch |
| `Execute Workflow` node | `execute_workflow` node que llama al engine recursivamente |
| Active / Passive workflows + webhook server | `axum` server en Rust + tabla `active_workflow_triggers` |
| Workflow versioning (draft / published) | `WorkflowVersion` entity + `publishedVersionId` |
| Node versioning (`httpRequestV3`) | `NodeDefinition.version: number` + lookup por `type@version` |

### 3.2 Lo que NO se debe tomar de n8n

| Anti-patrón n8n | Razón para evitarlo en Weaver |
|-----------------|------------------------------|
| Monolito NodeJS gigante | Weaver ya es Tauri; aprovechar Rust para el runtime crítico (webhook server, scheduler, sandbox) |
| Expresiones con `vm2`/`vm` (sandbox JS roto) | Weaver debe usar un parser+evaluator propio (AST-based), no un sandbox JS |
| UI monolítica en Vue | Weaver ya tiene React Flow + Tailwind; mantener |
| `n8n-workflow` package con miles de LOC | Weaver puede empezar con un núcleo mínimo (~2000 LOC) y crecer orgánicamente |
| Sin AI agent nativo | Este es el diferenciador de Weaver; invertir fuerte aquí |
| Sin MCP | Weaver ya tiene MCP runtime; exponerlo como nodo |

### 3.3 Diferenciadores que Weaver debe explotar

1. **AI Agent como ciudadano de primera clase** — no es un add-on, es el constructor de workflows.
2. **MCP runtime ya existe** — cualquier servidor MCP puede ser un nodo automáticamente.
3. **22 LLM providers** — el AI Agent puede usar el modelo más barato para planificar y el más capaz para reparar.
4. **Sandbox de código** — el Code Node puede ejecutar Python/Node/Bash real (mejor que la limitada `Function` node de n8n).
5. **AT-SPI / desktop automation** — Weaver puede tener un nodo `desktop_action` que opere apps nativas (imposible en n8n).
6. **Tauri** — distribución como app de escritorio real, no requiere servidor externo.

---

## 4. Arquitectura target

### 4.1 Diagrama conceptual

```
┌──────────────────────────────────────────────────────────────────────┐
│                         WEAVER WORKFLOW ENGINE                       │
│                                                                      │
│  ┌──────────────┐    ┌──────────────┐    ┌───────────────────────┐   │
│  │  Workflow    │    │  Node        │    │  Expression Engine    │   │
│  │  Definition  │    │  Registry    │    │  (parser + evaluator) │   │
│  │  (JSON)      │    │  (type@ver)  │    │  $json, $node, $items │   │
│  └──────┬───────┘    └──────┬───────┘    └───────────┬───────────┘   │
│         │                   │                        │               │
│         ▼                   ▼                        ▼               │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │                    VALIDATOR                                 │   │
│  │  ciclos · desconexiones · credenciales · expressions · tipos │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                              │                                       │
│                              ▼                                       │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │                 EXECUTION ENGINE                              │   │
│  │  Execution → ExecutionContext → ExecutionItem[] → NodeRunner  │   │
│  │  Scheduler → ExecutionQueue → Worker (pool)                   │   │
│  └──────┬───────────────────────────────────────────────────────┘   │
│         │                                                            │
│         ▼                                                            │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌────────────┐  │
│  │  Trigger    │  │  Trigger    │  │  Trigger    │  │  Trigger   │  │
│  │  Webhook    │  │  Schedule   │  │  Manual     │  │  Event     │  │
│  │  (Rust axum)│  │  (Rust tokio)│ │  (UI)       │  │  (MCP)     │  │
│  └─────────────┘  └─────────────┘  └─────────────┘  └────────────┘  │
│                                                                      │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │             PERSISTENCE + OBSERVABILITY                       │   │
│  │  SQLite: workflows, workflow_versions, executions,            │   │
│  │          node_executions, credentials (encrypted),            │   │
│  │          webhook_logs, execution_metrics                      │   │
│  │  Structured logs (tracing) + metrics (prometheus-ready)       │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                      │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │              AI AGENT LAYER                                   │   │
│  │  Planner (NL → workflow) · Observer (watch execution) ·       │   │
│  │  Diagnostician (error → cause) · Repairer (fix → retry) ·     │   │
│  │  Executor tools (add/update/remove/validate/run)              │   │
│  └──────────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────────┘
```

### 4.2 Capas y responsabilidades

| Capa | Responsabilidad | Lenguaje | Ubicación |
|------|----------------|----------|-----------|
| **Workflow Definition** | Modelo de datos del workflow (JSON-serializable) | TypeScript | `src/workflows/types.ts` (refactor) |
| **Node Registry** | Registro de `NodeDefinition` por `type@version`, con `execute()` | TypeScript | `src/workflows/nodes/registry.ts` (nuevo) |
| **Expression Engine** | Parser + evaluator AST-based para `{{ ... }}` | TypeScript | `src/workflows/expressions/` (nuevo) |
| **Validator** | Validación estructural del workflow | TypeScript | `src/workflows/validator.ts` (nuevo) |
| **Execution Engine** | `Execution`, `ExecutionContext`, `ExecutionItem`, scheduler, queue | TypeScript (worker thread) | `src/workflows/engine/v2/` (nuevo) |
| **Webhook Server** | HTTP server real, dispatch de triggers | Rust (axum) | `src-tauri/src/webhooks/` (nuevo) |
| **Scheduler** | Cron + interval triggers, dispara aunque UI esté cerrada | Rust (tokio) | `src-tauri/src/scheduler/` (nuevo) |
| **Persistence** | SQLite tables + migrations + queries | Rust + TS wrapper | `src-tauri/src/db/mod.rs` (extender) |
| **Credentials** | AES-256-GCM encrypt/decrypt, CRUD | Rust | `src-tauri/src/credentials/` (nuevo) |
| **AI Agent Layer** | Planner, Observer, Diagnostician, Repairer | TypeScript | `src/workflows/agent/` (nuevo) |
| **UI Editor** | React Flow + config panel + debugger + node picker | TypeScript/React | `src/views/WorkflowEditorView.tsx` (refactor) |

### 4.3 Modelo de ejecución (types clave)

```typescript
// Execution
interface Execution {
  id: string;
  workflowId: string;
  workflowVersionId?: string;
  status: 'queued' | 'running' | 'waiting' | 'success' | 'failed' | 'cancelled' | 'timeout';
  mode: 'manual' | 'trigger' | 'webhook' | 'schedule' | 'subworkflow';
  startedAt: number;
  finishedAt?: number;
  input: ExecutionItem[];
  output: ExecutionItem[];
  error?: StructuredError;
  nodeExecutions: NodeExecution[];
  metadata: Record<string, unknown>;
}

// ExecutionItem (unidad de dato que fluye entre nodos)
interface ExecutionItem {
  json: unknown;             // payload principal
  binary?: BinaryData;       // archivos adjuntos
  metadata?: Record<string, unknown>;
  pairedItem?: { nodeId: string; itemIndex: number }[]; // trazabilidad
  source?: string;
}

// ExecutionContext (estado por invocación de nodo)
interface ExecutionContext {
  execution: Execution;
  currentNode: WorkflowNode;
  inputItems: ExecutionItem[];
  outputItems: ExecutionItem[];
  variables: Record<string, unknown>;
  credentials: ResolvedCredentials; // ya descifradas, solo las que el nodo pidió
  environment: Record<string, string>;
  helpers: ExpressionHelpers; // $now, $today, $randomInt, etc.
}

// NodeExecution (resultado de correr un nodo una vez)
interface NodeExecution {
  id: string;
  executionId: string;
  nodeId: string;
  nodeType: string;
  nodeVersion: number;
  status: 'success' | 'error' | 'skipped' | 'waiting';
  startedAt: number;
  finishedAt?: number;
  durationMs?: number;
  inputItems: ExecutionItem[];
  outputItems: ExecutionItem[];
  error?: StructuredError;
  attempts: number;
  retryOf?: string; // id del NodeExecution anterior si fue retry
}
```

### 4.4 Flujo de ejecución

```
Trigger fires (webhook / schedule / manual / event)
  │
  ▼
ExecutionEngine.start(workflowId, input)
  │
  ├─ Carga workflow definition (de SQLite, no localStorage)
  ├─ Crea Execution (status: 'queued')
  ├─ Valida con Validator (si invalid → status: 'failed', return)
  ├─ Encola Execution
  │
  ▼
Scheduler.pickNext()
  │
  ├─ Resuelve triggers del workflow (findTriggerNodes)
  ├─ Para cada trigger: crea ExecutionItem inicial con el input
  ├─ Scheduler.enqueue({ executionId, nodeId: triggerId, items: [input] })
  │
  ▼
Worker.runNext()  (pool de N workers, configurable)
  │
  ├─ Lookup NodeDefinition en NodeRegistry por `${type}@${version}`
  ├─ Construye ExecutionContext con inputItems + credentials resolved
  ├─ Llama NodeDefinition.execute(ctx) → ExecutionItem[]
  │   ├─ Si error: aplicar retry policy (backoff, maxAttempts)
  │   ├─ Si continueOnFail=false y error: workflow falla
  │   ├─ Si timeout: marcar error, retry si procede
  │   └─ Si success: persiste NodeExecution en SQLite
  ├─ Para cada item de output: evalúa edges salientes
  ├─ Para cada edge: aplica expression filter (si hay) y encola items al target
  └─ Repite hasta queue vacía o cancellation
  │
  ▼
ExecutionEngine.finish(executionId)
  │
  ├─ Calcula status final
  ├─ Persiste execution + todos los NodeExecutions
  └─ Emite evento 'execution:finished' (UI se actualiza, AI observer lo ve)
```

### 4.5 Grafo de ejecución soportado

El engine debe soportar correctamente:

- **DAGs puros** (lineal, branching, converge)
- **Branching con IF/Switch** (múltiples salidas)
- **Convergencia con Merge** (espera N entradas, las combina)
- **Parallel execution** (nodos independientes corren en paralelo en el worker pool)
- **Loops explícitos** (Loop node con `maxIterations`, `condition`)
- **Iteration sobre items** (un nodo recibe 100 items, los procesa uno por uno o en batch)
- **Retries con backoff exponencial**
- **Timeouts por nodo**
- **Cancellation** (AbortController propagado a todos los workers)
- **Wait / Resume** (nodo que suspende la ejecución hasta un evento externo)
- **Error branches** (nodo con output `error` que se activa cuando el nodo falla)
- **Subworkflows** (nodo `execute_workflow` que llama recursivamente al engine)

**Protección contra:**
- Ciclos accidentales (detección en validación + runtime check con `visited` por path, no global)
- Loops infinitos (max iterations configurable, default 1000)
- Explosión de items (cap por nodo, default 10_000 items output)
- Ejecución duplicada (idempotency keys en webhook)
- Deadlocks (timeout en Wait nodes)
- Starvation (fair scheduling entre executions)
- Runaway workflows (max execution duration, default 30 min)

---

## 5. Plan por fases

> Cada fase es **atómica**: deja el sistema en un estado funcional y testeado.
> Entre fases: `tsc --noEmit` ✓, `npm test` ✓, `npm run build` ✓.
> No se avanza a la siguiente fase hasta que la anterior pasa los tres.

### FASE 1 — Auditoría + arquitectura ✅ (este documento)

**Entregable:** Este documento (`WEAVER_WORKFLOWS_PLAN.md`).

**Tiempo estimado:** 1 sesión.

**Estado:** Completo. Próximo paso: FASE 2.

---

### FASE 2 — Migración de persistencia a SQLite

**Objetivo:** Mover workflows de localStorage a SQLite. Mantener localStorage como cache/write-ahead, no como fuente de verdad.

**Tareas:**
1. Migraciones SQLite: tablas `workflows`, `workflow_versions`, `workflow_chat_messages`.
2. Comandos Tauri: `workflows_list`, `workflows_get`, `workflows_create`, `workflows_save`, `workflows_delete`, `workflows_rename`, `workflows_set_enabled`, `workflows_append_chat`, `workflows_replace_chat`.
3. Wrapper TS `src/workflows/store.ts` que use invoke() con fallback a localStorage en modo navegador.
4. Script de migración one-shot: leer `localStorage:weaver:workflows`, escribir a SQLite, marcar flag `migrated=true`.
5. Tests: crear/listar/borrar workflow, migración idempotente.

**Archivos nuevos:**
- `src-tauri/src/db/workflows.rs`
- `src-tauri/src/db/migrations/002_workflows.sql`

**Archivos modificados:**
- `src-tauri/src/db/mod.rs` (registro de tablas)
- `src-tauri/src/lib.rs` (registro de comandos)
- `src/workflows/store.ts` (cambio de implementación, misma API pública)

**Tiempo estimado:** 1-2 sesiones.

---

### FASE 3 — Refactor de tipos: separar Definition de Execution

**Objetivo:** Establecer los tipos que usarán todas las fases siguientes.

**Tareas:**
1. `src/workflows/types.ts` → dividir en:
   - `definition.ts`: `Workflow`, `WorkflowNode`, `WorkflowEdge`, `WorkflowVersion`
   - `execution.ts`: `Execution`, `ExecutionContext`, `ExecutionItem`, `NodeExecution`, `ExecutionState`
   - `node_definition.ts`: `NodeDefinition` interface, `NodeParameter`, `NodeCredentialRequest`
   - `credentials.ts`: `Credential`, `CredentialType`
   - `errors.ts`: `StructuredError`, `ValidationError`, `ExecutionError`
2. Migración del código existente al nuevo esquema de tipos (sin cambiar comportamiento).
3. `tsc --noEmit` ✓.

**Archivos nuevos:**
- `src/workflows/types/definition.ts`
- `src/workflows/types/execution.ts`
- `src/workflows/types/node_definition.ts`
- `src/workflows/types/credentials.ts`
- `src/workflows/types/errors.ts`

**Archivos modificados:**
- `src/workflows/types.ts` → `src/workflows/types/index.ts` (re-export)
- `src/workflows/engine.ts` (imports)
- `src/workflows/tools.ts` (imports)
- `src/workflows/store.ts` (imports)
- `src/workflows/nodeDefs.tsx` (imports)
- `src/views/WorkflowEditorView.tsx` (imports)

**Tiempo estimado:** 1 sesión.

---

### FASE 4 — Node Registry + NodeDefinition interface

**Objetivo:** Desacoplar el engine de los tipos de nodo específicos.

**Tareas:**
1. `src/workflows/nodes/registry.ts`: `Map<string, NodeDefinition>` indexado por `${type}@${version}`.
2. `src/workflows/nodes/definitions/`: una carpeta por nodo, cada una con `definition.ts` que exporte `NodeDefinition`.
3. Migrar los 8 nodos existentes al nuevo formato:
   - `webhook`, `schedule`, `code`, `if`, `delay`, `set`, `chat_message`, `http_request`
4. API de registro: `registerNodeDefinition(def)`, `getNodeDefinition(type, version)`, `listNodeDefinitions()`.
5. Auto-discovery: import dinámico de todos los `definition.ts` en `nodes/definitions/`.
6. Tests: registry lookup, versioning, fallback a última versión.

**Archivos nuevos:**
- `src/workflows/nodes/registry.ts`
- `src/workflows/nodes/types.ts`
- `src/workflows/nodes/definitions/webhook.ts`
- `src/workflows/nodes/definitions/schedule.ts`
- `src/workflows/nodes/definitions/code.ts`
- `src/workflows/nodes/definitions/if.ts`
- `src/workflows/nodes/definitions/delay.ts`
- `src/workflows/nodes/definitions/set.ts`
- `src/workflows/nodes/definitions/chat_message.ts`
- `src/workflows/nodes/definitions/http_request.ts`
- `src/workflows/nodes/definitions/index.ts` (auto-discovery)

**Archivos modificados:**
- `src/workflows/engine.ts` → refactorizar `execNode` a `NodeDefinition.execute(ctx)`

**Tiempo estimado:** 2 sesiones.

---

### FASE 5 — Expression Engine

**Objetivo:** Reemplazar el regex `\{\{\s*([\w.]+)\s*\}\}` por un engine real.

**Tareas:**
1. Lexer + parser (PEG.js o hand-written recursive descent) para:
   - `{{$json}}`, `{{$json.field}}`, `{{$json.user.email}}`
   - `{{$input}}`, `{{$item}}`, `{{$node["HTTP Request"].json}}`
   - `{{$items("HTTP Request")}}`
   - `{{$execution.id}}`, `{{$execution.status}}`
   - `{{$workflow.id}}`, `{{$workflow.name}}`
   - `{{$env.API_URL}}`
   - `{{$vars.foo}}`
   - `{{$now}}`, `{{$today}}`, `{{$timedelta("1d")}}`
   - Operaciones: `{{ $json.price * 1.16 }}`, `{{ $json.email.toLowerCase() }}`, `{{ $json.items.length }}`
   - Ternarios: `{{ $json.vip ? "premium" : "standard" }}`
2. Evaluator AST-based (NO `eval`, NO `vm2`).
3. Safe runtime con allowlist de métodos: `.toLowerCase`, `.toUpperCase`, `.trim`, `.length`, `.includes`, `.slice`, `.map`, `.filter`, `.reduce`, etc.
4. Errores estructurados: línea, columna, mensaje, sugerencia.
5. Límites: max expression depth (10), max string length (1 MB), timeout (100ms).
6. Tests: property access, arithmetic, functions, node refs, execution refs, invalid expressions, security (prototype pollution, code injection attempts).

**Archivos nuevos:**
- `src/workflows/expressions/lexer.ts`
- `src/workflows/expressions/parser.ts`
- `src/workflows/expressions/ast.ts`
- `src/workflows/expressions/evaluator.ts`
- `src/workflows/expressions/runtime.ts` (helpers + allowlist)
- `src/workflows/expressions/index.ts`
- `src/workflows/expressions/__tests__/expression.test.ts`

**Tiempo estimado:** 2-3 sesiones.

---

### FASE 6 — Validator estructurado

**Objetivo:** Detectar workflows inválidos antes de ejecutarlos.

**Tareas:**
1. `src/workflows/validator.ts`: función `validateWorkflow(wf): ValidationResult`.
2. Reglas:
   - Al menos un trigger node (webhook/schedule/manual/event)
   - No hay nodos desconectados (cada nodo no-trigger tiene al menos un edge entrante)
   - No hay ciclos (DFS con color marking)
   - Referencias a nodos válidas (edges apuntan a nodos existentes)
   - Credentials referenced exist (cuando FASE 8 esté lista)
   - Expressions válidas (parse sin error)
   - IF node tiene exactamente 2 salidas (true/false)
   - Merge node tiene ≥ 2 entradas
   - Loop node tiene `maxIterations` configurado
   - No hay duplicate node IDs
3. Resultado estructurado: `{ valid: boolean, errors: ValidationError[], warnings: ValidationWarning[] }`.
4. Cada error: `{ nodeId, code, message, severity, path? }`.
5. Tests: valid graph, disconnected node, invalid connection, missing credentials, invalid expression, invalid node, cycle detection, loop without condition.

**Archivos nuevos:**
- `src/workflows/validator.ts`
- `src/workflows/validator/rules.ts`
- `src/workflows/validator/__tests__/validator.test.ts`

**Tiempo estimado:** 1-2 sesiones.

---

### FASE 7 — Execution Engine v2 (frontend, worker thread)

**Objetivo:** Reemplazar el engine actual basado en `visited = Set` por uno basado en `Execution / ExecutionContext / ExecutionItem`.

**Tareas:**
1. `src/workflows/engine/v2/engine.ts`: `ExecutionEngine` clase.
2. `src/workflows/engine/v2/scheduler.ts`: cola de NodeExecution pendientes, fair scheduling.
3. `src/workflows/engine/v2/worker.ts`: Web Worker que procesa items del scheduler.
4. `src/workflows/engine/v2/context.ts`: `ExecutionContext` builder.
5. Soporte para:
   - Multiple items por nodo
   - Branching (IF/Switch con sourceHandle)
   - Convergencia (Merge node que acumula items de múltiples entradas)
   - Parallel branches (nodos independientes en cola simultáneamente)
   - Iteration (un nodo con 100 items los procesa todos en una sola llamada, o en batch configurable)
   - Retries con backoff exponencial
   - Timeouts por nodo
   - Cancellation (AbortController)
   - Wait/Resume (placeholder, implementación completa en FASE 10)
6. Protecciones: max steps (10000), max items per node (10000), max execution duration (30 min), max retries (5).
7. Mantener API backward-compatible: `runWorkflow(wf, opts)` sigue funcionando pero internamente usa v2.
8. Tests: linear, branching, merge, multiple items, parallel, retry, timeout, cancellation, failed node, loops (cuando FASE 11 esté lista).

**Archivos nuevos:**
- `src/workflows/engine/v2/engine.ts`
- `src/workflows/engine/v2/scheduler.ts`
- `src/workflows/engine/v2/worker.ts`
- `src/workflows/engine/v2/context.ts`
- `src/workflows/engine/v2/state.ts`
- `src/workflows/engine/v2/types.ts`
- `src/workflows/engine/v2/__tests__/engine.test.ts`

**Archivos modificados:**
- `src/workflows/engine.ts` → delega a v2

**Tiempo estimado:** 3-4 sesiones (fase más larga).

---

### FASE 8 — Credentials system

**Objetivo:** Almacenamiento seguro de credenciales referenciadas por nodos.

**Tareas:**
1. **Rust side:**
   - `src-tauri/src/credentials/mod.rs`: módulo con AES-256-GCM encrypt/decrypt.
   - Master key derivada de una passphrase del usuario (PBKDF2 o Argon2) o generada aleatoriamente y guardada en OS keyring (preferido).
   - Comandos: `credentials_list`, `credentials_create`, `credentials_update`, `credentials_delete`, `credentials_get_decrypted` (este último sólo accesible desde el engine, no desde el frontend directamente).
2. **SQLite:** tabla `credentials` con `id, name, type, encrypted_data, created_at, updated_at`.
3. **TS side:**
   - `src/workflows/credentials/store.ts`: wrapper invoke().
   - `src/workflows/credentials/types.ts`: `Credential`, `CredentialType` (httpBasicAuth, httpHeaderAuth, oAuth2Api, discordApi, etc.).
4. **NodeDefinition extension:** `credentials?: CredentialRequest[]` en cada NodeDefinition. El engine las resuelve antes de llamar `execute()`.
5. **UI:** panel de credentials en Settings, no en el workflow.
6. **Security:**
   - NUNCA enviar credenciales al frontend (sólo metadatos: name, type).
   - NUNCA loggear credenciales.
   - NUNCA incluir credenciales en AI agent context.
   - NUNCA incluir credenciales en workflow export.
7. Tests: encrypt/decrypt round-trip, credential resolution en node, no-leak en logs.

**Archivos nuevos:**
- `src-tauri/src/credentials/mod.rs`
- `src-tauri/src/db/migrations/003_credentials.sql`
- `src/workflows/credentials/store.ts`
- `src/workflows/credentials/types.ts`
- `src/views/CredentialsView.tsx`

**Tiempo estimado:** 2 sesiones.

---

### FASE 9 — Webhook runtime (Rust axum server)

**Objetivo:** Webhook node funcional de verdad.

**Tareas:**
1. **Rust side:**
   - Añadir `axum = "0.7"` y `tower-http` (cors, limit) a `Cargo.toml`.
   - `src-tauri/src/webhooks/server.rs`: axum server que escucha en `127.0.0.1:PORT` (configurable, default 7878).
   - Rutas: `POST /webhook/{workflowId}/{path}` y `GET /webhook/{workflowId}/{path}`.
   - Tabla `active_workflow_triggers` en SQLite (workflowId, triggerNodeId, path, method, auth).
   - Al iniciar la app: cargar triggers activos y registrar rutas.
   - Al recibir request: validar workflow existe + activo, crear Execution, dispatch al engine.
   - Modos de respuesta: `sync` (espera ejecución, devuelve output) o `async` (devuelve 202 inmediatamente, ejecución en background).
   - Payload size limit (default 10 MB).
   - Rate limiting por IP (token bucket, default 60 req/min).
   - Auth opcional: header token, basic auth.
2. **Frontend side:**
   - Webhook node config: `path`, `method`, `responseMode`, `authCredentialId?`.
   - UI indicator: "Webhook URL: http://localhost:7878/webhook/{workflowId}/{path}".
3. Tests: request recibido, payload parseado, execution creada, sync vs async, auth required, rate limit.

**Archivos nuevos:**
- `src-tauri/src/webhooks/mod.rs`
- `src-tauri/src/webhooks/server.rs`
- `src-tauri/src/webhooks/handlers.rs`
- `src-tauri/src/webhooks/auth.rs`
- `src-tauri/src/db/migrations/004_webhooks.sql`

**Archivos modificados:**
- `src-tauri/Cargo.toml` (axum, tower-http)
- `src-tauri/src/lib.rs` (iniciar webhook server en setup)
- `src/workflows/nodes/definitions/webhook.ts` (config extendida)

**Tiempo estimado:** 2-3 sesiones.

---

### FASE 10 — Schedule runtime (Rust tokio cron)

**Objetivo:** Schedule node funcional de verdad, incluso con la app abierta (más adelante con un daemon Rust, incluso cerrada).

**Tareas:**
1. **Rust side:**
   - `src-tauri/src/scheduler/mod.rs`: scheduler con tokio::time.
   - Tabla `active_workflow_triggers` (reutilizada de webhooks) con `cron_expr`, `timezone`.
   - Cron parser (crate `cron`).
   - Al iniciar: cargar schedules activos, registrar timers tokio.
   - Al disparar: crear Execution, dispatch al engine.
2. **Frontend:**
   - Schedule node config: `cronExpr` (estándar 5 campos) + `timezone`.
   - UI: muestra próxima ejecución estimada.
3. **Unificación:** eliminar `weaver:schedules` (schedules sueltos del agente) o migrarlos a workflow schedules.
4. Tests: cron parsing, próxima ejecución, firing real.

**Archivos nuevos:**
- `src-tauri/src/scheduler/mod.rs`
- `src-tauri/src/scheduler/cron.rs`

**Archivos modificados:**
- `src-tauri/Cargo.toml` (cron crate)
- `src/workflows/nodes/definitions/schedule.ts`
- `src/lib/scheduler.ts` (deprecate o migrar)

**Tiempo estimado:** 1-2 sesiones.

---

### FASE 11 — Retries / timeouts / cancellation / error branches

**Objetivo:** Manejo robusto de fallos.

**Tareas:**
1. **NodeDefinition extension:** `retry?: { maxAttempts: number, backoff: 'fixed' | 'exponential', delayMs: number }`, `timeout?: number`, `continueOnFail?: boolean`.
2. **Error branch:** nodos con output handle `error` que se activa cuando el nodo falla tras agotar retries.
3. **Cancellation:** AbortController propagado a todos los workers activos.
4. **Timeout:** `Promise.race` con timeout configurable por nodo (default 30s, max 5min).
5. **Workflow-level:** max execution duration (default 30 min).
6. **UI:** indicador visual de retries, botón "Cancelar ejecución" en debugger.
7. Tests: retry con éxito en 2do intento, retry agotado, timeout disparado, cancellation, error branch activada, continueOnFail.

**Archivos modificados:**
- `src/workflows/engine/v2/engine.ts`
- `src/workflows/engine/v2/worker.ts`
- `src/workflows/types/node_definition.ts`
- `src/workflows/nodes/definitions/*.ts` (metadata de retry/timeout)
- `src/views/WorkflowEditorView.tsx` (UI de cancel)

**Tiempo estimado:** 1-2 sesiones.

---

### FASE 12 — Loops / branches / merge / split / filter / sort / limit / aggregate

**Objetivo:** Nodos de control de flujo avanzados.

**Tareas:**
1. Nuevos nodos:
   - `loop`: itera sobre `inputItems`, ejecuta el subgrafo conectado para cada item, acumula output.
   - `split`: divide un array en items individuales.
   - `filter`: aplica expression, descarta items que no cumplen.
   - `sort`: ordena items por expression.
   - `limit`: toma los primeros N items.
   - `aggregate`: combina N items en un array.
   - `merge`: espera N entradas, las combina en orden o por pairedItem.
   - `switch`: IF con N salidas (case-based).
2. Cada nodo con su `NodeDefinition`, `NodeParameter`, validación, tests.
3. Protecciones: max iterations (1000), max items per node (10000).
4. Tests: cada nodo individualmente + composición (loop + filter + aggregate).

**Archivos nuevos:**
- `src/workflows/nodes/definitions/loop.ts`
- `src/workflows/nodes/definitions/split.ts`
- `src/workflows/nodes/definitions/filter.ts`
- `src/workflows/nodes/definitions/sort.ts`
- `src/workflows/nodes/definitions/limit.ts`
- `src/workflows/nodes/definitions/aggregate.ts`
- `src/workflows/nodes/definitions/merge.ts`
- `src/workflows/nodes/definitions/switch.ts`

**Tiempo estimado:** 2-3 sesiones.

---

### FASE 13 — Subworkflows

**Objetivo:** Workflow A llama a Workflow B y recibe output.

**Tareas:**
1. Nuevo nodo `execute_workflow` con config: `workflowId` o `workflowName`, `inputMapping`, `waitForResult`.
2. Engine: cuando encuentra este nodo, llama recursivamente a `ExecutionEngine.start(targetWorkflowId, input)`.
3. Espera resultado (o fire-and-forget si `waitForResult=false`).
4. Lleva trazabilidad: `parentExecutionId`, `subexecutionId`.
5. Prevención de loops infinitos: max depth (3), max total subworkflows (50).
6. Tests: subworkflow simple, subworkflow con error, deep nesting (depth limit), parallel subworkflow calls.

**Archivos nuevos:**
- `src/workflows/nodes/definitions/execute_workflow.ts`

**Archivos modificados:**
- `src/workflows/engine/v2/engine.ts` (recursión controlada)

**Tiempo estimado:** 1 sesión.

---

### FASE 14 — Execution persistence + history API

**Objetivo:** Cada ejecución persistida, consultable, re-anizable.

**Tareas:**
1. **SQLite:**
   - `executions` table: `id, workflow_id, status, mode, started_at, finished_at, input_json, output_json, error_json, metadata_json`.
   - `node_executions` table: `id, execution_id, node_id, node_type, node_version, status, started_at, finished_at, duration_ms, input_json, output_json, error_json, attempts, retry_of`.
2. **Comandos Tauri:** `executions_list(workflowId?, limit?)`, `executions_get(id)`, `executions_cancel(id)`, `executions_retry(id, fromNodeId?)`.
3. **Frontend wrapper:** `src/workflows/executions/store.ts`.
4. **UI:** lista de ejecuciones en el editor, click para abrir debugger.
5. Tests: persistencia, consulta, retry desde nodo.

**Archivos nuevos:**
- `src-tauri/src/db/executions.rs`
- `src-tauri/src/db/migrations/005_executions.sql`
- `src/workflows/executions/store.ts`

**Tiempo estimado:** 2 sesiones.

---

### FASE 15 — Execution Debugger UI

**Objetivo:** Visibilidad total sobre ejecuciones.

**Tareas:**
1. Panel lateral en el editor: lista de ejecuciones recientes.
2. Click en ejecución: abre vista de grafo con cada nodo coloreado por status (ok/error/skipped/running/waiting).
3. Click en nodo: panel con tabs (Input / Output / Error / Logs / Duration / Attempts).
4. Botones: "Reintentar", "Ejecutar desde este nodo", "Cancelar ejecución" (si está running).
5. Streaming: si la ejecución está corriendo, actualización en tiempo real vía evento `execution:node_finished`.
6. Indicador visual de retries en cada nodo (badge con número).
7. Filtros: por status, por rango de tiempo.
8. Export: descargar execution JSON para debugging offline.

**Archivos nuevos:**
- `src/views/WorkflowDebuggerView.tsx`
- `src/components/workflow/ExecutionList.tsx`
- `src/components/workflow/NodeExecutionInspector.tsx`
- `src/components/workflow/ExecutionTimeline.tsx`

**Archivos modificados:**
- `src/views/WorkflowEditorView.tsx` (integración del debugger)

**Tiempo estimado:** 2-3 sesiones.

---

### FASE 16 — AI Workflow Tools (v2)

**Objetivo:** Tools estructuradas para que el agente construya/edite/ejecute workflows sin editar JSON crudo.

**Tareas:**
1. Ampliar el set actual (6 tools) con:
   - `workflow_validate`: corre el validator, devuelve errores estructurados.
   - `workflow_execute`: dispara una ejecución y devuelve el executionId.
   - `workflow_get_execution`: consulta estado de una ejecución.
   - `workflow_retry`: reintenta una ejecución desde un nodo.
   - `workflow_get_node_options`: lista tipos de nodo disponibles + sus parameters schema.
   - `workflow_get_credential_options`: lista credential types disponibles.
   - `workflow_export`: devuelve el JSON exportable.
   - `workflow_import`: carga un JSON exportable.
2. System prompt mejorado: explica semántica de cada tool, cuándo usar cuál, ejemplos.
3. Integración con Node Registry: las tools reflejan los nodos disponibles dinámicamente.
4. Tests: cada tool individualmente + integración con LLM.

**Archivos modificados:**
- `src/workflows/tools.ts` (ampliar)
- `src/views/WorkflowEditorView.tsx` (system prompt)

**Tiempo estimado:** 1-2 sesiones.

---

### FASE 17 — AI Workflow Planner (NL → workflow)

**Objetivo:** Usuario describe en lenguaje natural, agente construye el workflow completo.

**Tareas:**
1. `src/workflows/agent/planner.ts`: función `planWorkflow(userRequest, context): Promise<WorkflowPlan>`.
2. WorkflowPlan: `{ nodes: PlannedNode[], edges: PlannedEdge[], assumptions: string[], questionsForUser: string[] }`.
3. Prompt que:
   - Conoce el catálogo de nodos disponibles (del Node Registry).
   - Conoce las credentials disponibles.
   - Genera grafo en formato estructurado (no JSON crudo).
   - Lista supuestos que hizo.
   - Lista preguntas si falta info.
4. Después de planificar, ejecuta las tools de edición (FASE 16) para materializar el grafo en el canvas.
5. Si hay preguntas, las hace al usuario antes de materializar.
6. Si hay assumptions, las muestra para confirmación.
7. Validación automática antes de mostrar el resultado.
8. Tests: caso "Cuando llegue un pedido por webhook, consulta el cliente, si es VIP manda Discord, si no guarda el pedido".

**Archivos nuevos:**
- `src/workflows/agent/planner.ts`
- `src/workflows/agent/types.ts`
- `src/workflows/agent/__tests__/planner.test.ts`

**Tiempo estimado:** 2 sesiones.

---

### FASE 18 — AI Self-Repair

**Objetivo:** Si una ejecución falla, el agente diagnostica y repara.

**Tareas:**
1. `src/workflows/agent/diagnostician.ts`: analiza un `Execution` fallido, identifica el nodo problemático y la causa raíz.
2. `src/workflows/agent/repairer.ts`: propone una modificación al workflow que debería resolver el problema.
3. Flujo:
   ```
   Execution falla
     ↓
   Diagnostician analiza NodeExecution con error
     ↓
   Genera hipótesis (campo faltante, expression inválida, credencial incorrecta, URL malformada, etc.)
     ↓
   Repairer propone fix (editar config del nodo, añadir nodo Set anterior, etc.)
     ↓
   Validator valida el fix
     ↓
   Aplica el fix
     ↓
   Re-ejecuta
     ↓
   Si success: reporta qué pasó
   Si fail: loop (max 3 intentos)
   ```
4. Explicación al usuario: qué falló, por qué, qué modificó, por qué debería resolverlo, resultado del retry.
5. Tests: error de campo faltante → repair con Set node, error de expression → repair con expression corregida, error de URL → repair con URL corregida.

**Archivos nuevos:**
- `src/workflows/agent/diagnostician.ts`
- `src/workflows/agent/repairer.ts`
- `src/workflows/agent/__tests__/repair.test.ts`

**Tiempo estimado:** 2-3 sesiones.

---

### FASE 19 — UI / Editor mejoras

**Objetivo:** Experiencia profesional.

**Tareas:**
1. Node picker con buscador + categorías (Triggers / Logic / Data / Network / Flow / AI).
2. Configuration panel por nodo (sidebar derecho cuando hay nodo seleccionado).
3. Connection validation (no conectar output string a input number).
4. Keyboard shortcuts: Delete (borrar selección), Cmd+D (duplicate), Cmd+C/V (copy/paste), Cmd+Z/Y (undo/redo), Cmd+A (select all), Space+drag (pan).
5. Undo/redo stack (50 niveles).
6. Copy/paste de nodos (incluso entre workflows).
7. Multi-select + drag group.
8. Duplicate node.
9. Test node: ejecuta un solo nodo con input de prueba.
10. Test workflow: ejecuta el workflow completo desde un trigger manual.
11. Execution status overlay: badge en cada nodo con duración, attempts, status.
12. Error indicators: nodo rojo con tooltip de error.

**Archivos nuevos:**
- `src/components/workflow/NodePicker.tsx`
- `src/components/workflow/ConfigPanel.tsx`
- `src/components/workflow/NodeTester.tsx`
- `src/workflows/editor/history.ts` (undo/redo)

**Archivos modificados:**
- `src/views/WorkflowEditorView.tsx` (integración masiva)

**Tiempo estimado:** 3 sesiones.

---

### FASE 20 — Node versioning + Workflow versioning

**Objetivo:** Estabilidad de workflows en producción.

**Tareas:**
1. **Node versioning:**
   - `NodeDefinition.version: number`.
   - Registry indexado por `${type}@${version}`.
   - En el workflow JSON, cada nodo guarda `type` + `version`.
   - Al cargar: lookup exacto por versión; si no existe, fallback a última versión con warning.
   - Migraciones entre versiones: `NodeDefinition.migrate?(oldConfig, oldVersion, newVersion)`.
2. **Workflow versioning:**
   - `WorkflowVersion` entity: `id, workflow_id, version_number, snapshot_json, created_at, label`.
   - Draft vs Published: el workflow editado es el draft; al "Publish" se crea una nueva version.
   - Ejecuciones de webhook/schedule usan la última Published, no el draft.
   - Rollback: copy una version anterior al draft actual.
   - UI: lista de versions, diff entre versions, publish button.
3. Tests: migración de versión, ejecución con version publicada mientras se edita draft.

**Archivos nuevos:**
- `src-tauri/src/db/migrations/006_workflow_versions.sql`
- `src/workflows/versions/store.ts`
- `src/views/WorkflowVersionsView.tsx`

**Tiempo estimado:** 2 sesiones.

---

### FASE 21 — Import / Export

**Objetivo:** Portabilidad.

**Tareas:**
1. Formato JSON estable: `{ format: 'weaver-workflow', version: 1, workflow: {...}, nodeVersions: {...} }`.
2. NO incluye: secrets, credentials data, tokens.
3. SÍ incluye: estructura del grafo, configuraciones (con `credentialId` referenciado pero no el dato), settings, metadata.
4. Export: descarga archivo `.weaver.json`.
5. Import: carga archivo, valida formato, valida que los credentialIds referenciados existen (si no, pregunta al usuario qué credencial mapear).
6. Duplicate: clona un workflow dentro del mismo workspace.
7. Clone: crea copia sin executions ni chat.
8. Tests: export → import round-trip, formato inválido, credentials faltantes.

**Archivos nuevos:**
- `src/workflows/io/export.ts`
- `src/workflows/io/import.ts`
- `src/workflows/io/format.ts`

**Tiempo estimado:** 1 sesión.

---

### FASE 22 — Observability

**Objetivo:** Visibilidad operacional.

**Tareas:**
1. Structured logs (Rust `tracing` ya está configurado): añadir spans para cada execution y cada node execution.
2. Frontend logs: `src/lib/workflow-logger.ts` con niveles (debug/info/warn/error) y structured fields.
3. Métricas:
   - Execution count por workflow (24h / 7d / 30d).
   - Error rate por workflow.
   - Duration p50/p95/p99 por workflow.
   - Retry count por nodo.
   - Items procesados por nodo.
4. UI: panel de métricas en el editor (similar al MetricsView existente para LLM providers).
5. Cap de logs: rotación, max 10MB por execution.
6. Tests: captura de métricas, no-leak de secrets en logs.

**Archivos nuevos:**
- `src/lib/workflow-logger.ts`
- `src/workflows/metrics/store.ts`
- `src/components/workflow/WorkflowMetrics.tsx`

**Tiempo estimado:** 1-2 sesiones.

---

### FASE 23 — Security hardening

**Objetivo:** Cerrar vectores de ataque.

**Tareas:**
1. **SSRF protection en HTTP Request node:**
   - Block por defecto: `127.0.0.0/8`, `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `169.254.0.0/16` (AWS metadata), `::1/128`, `fc00::/7`.
   - Configurable: allowlist de dominios.
   - DNS rebinding protection: resolver IP y validar antes de conectar.
2. **Code Node sandbox:**
   - Fase 2 de aislamiento: `bubblewrap` en Linux (ya sugerido en el código actual), Job Object en Windows, sandbox-exec en macOS.
   - Sin network por defecto (configurable).
   - Sin filesystem write fuera del tmp dir.
   - CPU/memory limits.
3. **Command injection:** revisar todos los `shell_exec` del agente y del sandbox; usar `Command::arg()` en Rust, no string interpolation.
4. **Prototype pollution:** en el expression engine, validar que no se accede a `__proto__`, `constructor`, `prototype`.
5. **Expression injection:** el evaluator no debe ejecutar JS, sólo el AST.
6. **Webhook abuse:** rate limiting (ya en FASE 9), payload size limit (ya en FASE 9), auth opcional (ya en FASE 9).
7. **Unauthorized workflow execution:** webhook sin auth = público; con auth token = sólo quien tenga el token.
8. **Secrets audit:** grep por `console.log`, `tracing::info`, etc. para asegurar que ningún credential se loguea.
9. Tests: SSRF blocked, code node sin network, expression sin prototype access, webhook rate limited.

**Archivos nuevos:**
- `src/workflows/security/ssrf.ts`
- `src/workflows/security/sandbox-policy.ts`

**Archivos modificados:**
- `src/workflows/nodes/definitions/http_request.ts`
- `src/workflows/nodes/definitions/code.ts`
- `src/workflows/expressions/evaluator.ts`

**Tiempo estimado:** 2 sesiones.

---

### FASE 24 — Performance

**Objetivo:** Workflows grandes y muchos concurrentes.

**Tareas:**
1. **Worker pool:** pool configurable de Web Workers (default 4) para paralelismo real.
2. **Item batching:** nodos que reciben 1000 items los procesan en batches de 100 (configurable).
3. **Streaming de items:** entre nodos, pasar items por referencia (PostMessage) en lugar de copiar.
4. **Cap de memoria:** si una execution supera 500 MB, marcar como `failed` con error `memory_limit_exceeded`.
5. **SQLite WAL mode:** para writes concurrentes.
6. **Índices:** en `executions(workflow_id, started_at)`, `node_executions(execution_id, node_id)`.
7. **React optimizations:**
   - `React.memo` en nodos.
   - `useMemo` en transformations de grafo.
   - Virtualización de la lista de executions.
8. **Lazy loading:** NodeDefinitions cargados dinámicamente por import().
9. Tests: workflow con 10k items, 50 workflows concurrentes, execution con 100 nodos.

**Archivos modificados:**
- `src/workflows/engine/v2/worker.ts` (pool)
- `src/workflows/engine/v2/scheduler.ts` (batching)
- `src-tauri/src/db/mod.rs` (WAL + indices)
- `src/workflows/nodes/definitions/index.ts` (lazy load)

**Tiempo estimado:** 2 sesiones.

---

### FASE 25 — Testing completo

**Objetivo:** Cobertura > 80% en módulos críticos.

**Tareas:**
1. Setup vitest + jsdom + @testing-library/react.
2. Tests unitarios por módulo (engine, expressions, validator, nodes, credentials).
3. Tests de integración end-to-end: crear workflow → ejecutar → ver resultado.
4. Tests de regresión: workflows del usuario real (con su permiso) como fixtures.
5. CI: añadir step `npm test` en `.github/workflows/build-linux.yml`.
6. Coverage report: `vitest --coverage`.

**Archivos nuevos:**
- `vitest.config.ts`
- `src/workflows/**/__tests__/*.test.ts`
- `tests/fixtures/workflows/*.weaver.json`

**Archivos modificados:**
- `package.json` (vitest, jsdom, @testing-library/react)
- `.github/workflows/build-linux.yml` (step de test)

**Tiempo estimado:** 2-3 sesiones.

---

### FASE 26 — AI integrations (LLM / AI Agent / Tool / Memory / Structured Output nodes)

**Objetivo:** Nodos AI-native.

**Tareas:**
1. Nuevos nodos:
   - `llm`: llama a un provider+modelo con un prompt, devuelve output.
   - `ai_agent`: ejecuta el bucle agéntico de Weaver (`agent/loop.ts`) como un nodo.
   - `tool`: expone una tool del agente como nodo.
   - `memory`: lee/escribe facts de la memoria episódica.
   - `structured_output`: usa function calling para devolver JSON estructurado.
2. Cada nodo reutiliza la infraestructura existente de `providers/` y `agent/`.
3. Tests: cada nodo con mock provider.

**Archivos nuevos:**
- `src/workflows/nodes/definitions/llm.ts`
- `src/workflows/nodes/definitions/ai_agent.ts`
- `src/workflows/nodes/definitions/tool.ts`
- `src/workflows/nodes/definitions/memory.ts`
- `src/workflows/nodes/definitions/structured_output.ts`

**Tiempo estimado:** 2 sesiones.

---

### FASE 27 — MCP as node type

**Objetivo:** Cualquier servidor MCP se convierte automáticamente en nodos disponibles.

**Tareas:**
1. Al configurar un servidor MCP (ya existe UI en Settings), registrar sus tools como NodeDefinitions dinámicas.
2. Un nodo por tool MCP: `mcp__<serverId>__<toolName>`.
3. En `execute()`, llamar al comando Tauri `mcp_call_tool`.
4. Auto-generar NodeDefinition desde el `input_schema` del MCP.
5. Tests: mock MCP server, tool call real.

**Archivos nuevos:**
- `src/workflows/nodes/mcp/loader.ts`
- `src/workflows/nodes/mcp/dynamic-definition.ts`

**Tiempo estimado:** 1-2 sesiones.

---

### FASE 28 — Migration + compatibilidad

**Objetivo:** No romper workflows existentes.

**Tareas:**
1. Script de migración automática al cargar un workflow viejo:
   - Si no tiene `version` field, asumir `1`.
   - Migrar `type` strings a `type@version`.
   - Migrar `config` de cada nodo al formato nuevo.
2. Compatibility layer: si un workflow usa `http_request@1` y sólo existe `http_request@2`, llamar `migrate()`.
3. Tests: cargar workflows viejos del localStorage, verificar que migran y ejecutan correctamente.

**Archivos nuevos:**
- `src/workflows/migrations/v0-to-v1.ts`

**Tiempo estimado:** 1 sesión.

---

## 6. Estado: lo que ya llevo y lo que falta

### 6.1 Resumen ejecutivo

| Dimensión | Estado | Notas |
|-----------|--------|-------|
| Auditoría | ✅ Hecha | Este documento |
| Editor visual | ✅ Funcional | React Flow + 8 nodos + chat lateral |
| Engine | ⚠️ Demostrativo | BFS + visited Set; no soporta merge, parallel, loops |
| Persistencia | ⚠️ localStorage | SQLite existe pero no se usa para workflows |
| AI agent tools | ⚠️ Básico | 6 tools de edición, sin planner/repairer |
| Webhooks | ❌ Simulado | No hay HTTP server |
| Schedules | ❌ Desconectado | scheduler.ts no lee workflows |
| Credentials | ❌ Inexistente | — |
| Expressions | ❌ Regex básico | — |
| Validator | ❌ Inexistente | — |
| Execution history | ❌ Inexistente | — |
| Tests | ❌ Cero | — |
| Webhook runtime (Rust) | ❌ Inexistente | — |

### 6.2 Checklist por fase

| Fase | Descripción | Estado | Sesiones est. |
|------|-------------|--------|---------------|
| 1 | Auditoría + arquitectura | ✅ Hecha | 1 |
| 2 | Migración a SQLite | ⏳ Pendiente | 1-2 |
| 3 | Refactor tipos | ⏳ Pendiente | 1 |
| 4 | Node Registry | ⏳ Pendiente | 2 |
| 5 | Expression Engine | ⏳ Pendiente | 2-3 |
| 6 | Validator | ⏳ Pendiente | 1-2 |
| 7 | Execution Engine v2 | ⏳ Pendiente | 3-4 |
| 8 | Credentials | ⏳ Pendiente | 2 |
| 9 | Webhook runtime | ⏳ Pendiente | 2-3 |
| 10 | Schedule runtime | ⏳ Pendiente | 1-2 |
| 11 | Retries/timeouts/cancel | ⏳ Pendiente | 1-2 |
| 12 | Loops/merge/filter/sort | ⏳ Pendiente | 2-3 |
| 13 | Subworkflows | ⏳ Pendiente | 1 |
| 14 | Execution persistence | ⏳ Pendiente | 2 |
| 15 | Debugger UI | ⏳ Pendiente | 2-3 |
| 16 | AI Workflow Tools v2 | ⏳ Pendiente | 1-2 |
| 17 | AI Planner | ⏳ Pendiente | 2 |
| 18 | AI Self-Repair | ⏳ Pendiente | 2-3 |
| 19 | UI / Editor mejoras | ⏳ Pendiente | 3 |
| 20 | Node + Workflow versioning | ⏳ Pendiente | 2 |
| 21 | Import / Export | ⏳ Pendiente | 1 |
| 22 | Observability | ⏳ Pendiente | 1-2 |
| 23 | Security hardening | ⏳ Pendiente | 2 |
| 24 | Performance | ⏳ Pendiente | 2 |
| 25 | Testing completo | ⏳ Pendiente | 2-3 |
| 26 | AI nodes | ⏳ Pendiente | 2 |
| 27 | MCP as node | ⏳ Pendiente | 1-2 |
| 28 | Migration + compat | ⏳ Pendiente | 1 |

**Total estimado:** 38-50 sesiones de trabajo.

### 6.3 Orden recomendado de ejecución

```
FASE 1 (auditoría) ✅
   ↓
FASE 2 (SQLite) → FASE 3 (tipos) → FASE 4 (Node Registry)
   ↓
FASE 5 (Expressions) → FASE 6 (Validator) [paralelizables]
   ↓
FASE 7 (Engine v2) ←—— depende de 4, 5, 6
   ↓
FASE 8 (Credentials) → FASE 9 (Webhook) + FASE 10 (Schedule) [paralelas]
   ↓
FASE 11 (Retries) → FASE 12 (Loops/merge) → FASE 13 (Subworkflows)
   ↓
FASE 14 (Persistence) → FASE 15 (Debugger UI)
   ↓
FASE 16 (AI Tools v2) → FASE 17 (Planner) → FASE 18 (Self-Repair) ←—— diferenciador
   ↓
FASE 19 (UI) + FASE 20 (Versioning) + FASE 21 (IO) [paralelizables]
   ↓
FASE 22 (Observability) + FASE 23 (Security) + FASE 24 (Performance) [paralelizables]
   ↓
FASE 25 (Tests) ←—— continuo, pero al final coverage completo
   ↓
FASE 26 (AI nodes) + FASE 27 (MCP nodes) ←—— diferenciador
   ↓
FASE 28 (Migration)
```

### 6.4 Criterio de éxito del MVP de producción

Weaver está listo para producción cuando puede ejecutar este workflow:

```
Webhook (POST /webhook/order)
   ↓
HTTP Request (GET /api/customers/{{$json.customerId}})
   ↓
Transform (Code Node: extrae fields)
   ↓
IF (customer.tier == "vip")
   ├── true  → Discord (HTTP Request con credential discord_webhook)
   └── false → Database (HTTP Request con credential db_api)
   ↓
Merge
   ↓
Response (200 OK con orderId)
```

Con:
- ✅ Webhook server real (Rust axum) escuchando
- ✅ Múltiples items en cada nodo
- ✅ Expressions (`{{$json.customerId}}`, `{{$node["HTTP Request"].json.tier}}`)
- ✅ Credentials (discord_webhook, db_api) cifradas en SQLite
- ✅ Retries en HTTP Request (3 intentos, backoff exponencial)
- ✅ Timeout por nodo (30s)
- ✅ Execution history persistida
- ✅ Debugger UI con input/output por nodo
- ✅ Logs estructurados
- ✅ Manejo de errores (error branch en IF)
- ✅ Paralelismo (las dos ramas del IF corren en paralelo)
- ✅ AI agent puede construir este workflow desde "Cuando llegue un pedido por webhook, consulta el cliente, si es VIP manda Discord, si no guarda el pedido"
- ✅ AI agent puede reparar el workflow si falla

---

## 7. Decisiones arquitectónicas abiertas

Estas son decisiones que **sí o sí** requieren input del usuario antes de avanzar (siguiendo la regla de autonomía del prompt):

### 7.1 ¿Dónde vive el webhook server?

**Opción A:** Dentro del proceso Tauri (Rust). Arranca con la app, muere con la app.
- Pros: simple, no hay IPC entre procesos.
- Cons: webhooks no funcionan con la app cerrada.

**Opción B:** Daemon Rust separado que corre como systemd service / launchd job.
- Pros: webhooks funcionan 24/7.
- Cons: más complejo de instalar, requiere permisos de sistema.

**Recomendación:** Empezar con A, planear B para más adelante.

### 7.2 ¿Cifrado de credentials con master key del usuario o autogenerada?

**Opción A:** Master key autogenerada, guardada en OS keyring.
- Pros: zero-friction para el usuario.
- Cons: si el keyring se corrompe, se pierden todas las credentials.

**Opción B:** Passphrase del usuario, derivada con PBKDF2/Argon2.
- Pros: backup/restore portátil.
- Cons: UX de tener que ingresar passphrase al iniciar.

**Recomendación:** A, con opción de exportar/importar credentials cifradas con passphrase B para backup.

### 7.3 ¿Web Workers para el engine o todo en main thread?

**Opción A:** Web Workers (pool de 4).
- Pros: no bloquea UI, paralelismo real.
- Cons: serialización de items entre threads, complejidad.

**Opción B:** Main thread con chunks (yield al event loop cada N items).
- Pros: simple.
- Cons: puede bloquear UI en workflows grandes.

**Recomendación:** A, con fallback a B si los Workers no están disponibles.

### 7.4 ¿Expression engine con sintaxis n8n (`{{$json}}`) o JSX-like (`{json.field}`)?

**Opción A:** Sintaxis n8n `{{ ... }}`.
- Pros: familiar para usuarios de n8n.
- Cons: redoble de llaves confunde con JSON.

**Opción B:** Sintaxis `${ ... }` (template literal).
- Pros: familiar para devs JS.
- Cons: no es estándar en automation.

**Recomendación:** A (mantener `{{ ... }}`) por consistencia con el ecosistema de automation.

### 7.5 ¿Publicar workflows como inmutables o permitir hot-edits?

**Opción A:** Draft → Publish. Webhooks/schedules usan la versión publicada.
- Pros: estabilidad en producción.
- Cons: UX más lenta (hay que publicar para que los cambios surtan efecto).

**Opción B:** Hot-edits. Cualquier cambio aplica inmediatamente a webhooks/schedules.
- Pros: UX rápida.
- Cons: romper un workflow en producción es fácil.

**Recomendación:** A, con auto-publish opcional (toggle "auto-publish on save" para usuarios que prefieran B).

---

## 8. Riesgos y mitigaciones

| Riesgo | Probabilidad | Impacto | Mitigación |
|--------|-------------|---------|-----------|
| Scope creep: intentar replicar feature-por-feature n8n | Alta | Alto | Mantener foco en AI-native; cortar features que no aporten al diferenciador |
| Webhook server consume recursos incluso sin workflows | Media | Medio | Sólo arrancar si hay triggers activos; sleep si idle 30 min |
| Code Node sandbox escape | Baja | Crítico | Bubblewrap/seccomp en Linux, Job Object en Windows, sandbox-exec en macOS |
| Expression engine漏洞 (prototype pollution, code injection) | Media | Alto | AST-based evaluator, allowlist de métodos, sin `eval` ni `vm` |
| Workflows muy grandes bloquean UI | Media | Medio | Web Workers, batching, virtualización |
| Migración localStorage → SQLite pierde datos | Baja | Crítico | Backup automático antes de migrar, migración idempotente, tests de migración |
| Credentials leaked en logs | Media | Crítico | Audit grep, redactor en tracing, tests de no-leak |
| Cambios de schema rompen workflows existentes | Media | Alto | Versioning, migrations, compatibility layer |
| AI agent construye workflows inválidos | Media | Medio | Validator siempre corre antes de materializar |
| AI self-repair loop infinito | Baja | Medio | Max 3 intentos, fallback a "reportar al usuario" |

---

## 9. Definition of Done

Una fase se considera **terminada** cuando:

- [ ] Todas las tareas de la fase están implementadas.
- [ ] `tsc --noEmit` pasa sin errores.
- [ ] `npm test` pasa (o si no hay tests aún, al menos un test nuevo para la fase).
- [ ] `npm run build` pasa.
- [ ] No hay TODOs en el código nuevo (comentarios `// TODO` prohibidos).
- [ ] No hay mocks donde podría haber implementación real.
- [ ] No hay secrets en logs, frontend, exports o AI context.
- [ ] La integración con el flujo existente está probada.
- [ ] No se rompen funcionalidades existentes.
- [ ] Documentación de la fase añadida a `PROGRESS.md`.
- [ ] Commit atómico con mensaje descriptivo.

**No se avanza a la siguiente fase hasta que todos los checkboxes estén ✓.**

---

## Apéndice A — Archivos del repo Weaver relevantes para workflows

### A.1 Archivos a crear (nuevos)

```
src/workflows/
├── types/
│   ├── definition.ts
│   ├── execution.ts
│   ├── node_definition.ts
│   ├── credentials.ts
│   └── errors.ts
├── nodes/
│   ├── registry.ts
│   ├── types.ts
│   ├── definitions/
│   │   ├── webhook.ts
│   │   ├── schedule.ts
│   │   ├── code.ts
│   │   ├── if.ts
│   │   ├── delay.ts
│   │   ├── set.ts
│   │   ├── chat_message.ts
│   │   ├── http_request.ts
│   │   ├── loop.ts
│   │   ├── split.ts
│   │   ├── filter.ts
│   │   ├── sort.ts
│   │   ├── limit.ts
│   │   ├── aggregate.ts
│   │   ├── merge.ts
│   │   ├── switch.ts
│   │   ├── execute_workflow.ts
│   │   ├── llm.ts
│   │   ├── ai_agent.ts
│   │   ├── tool.ts
│   │   ├── memory.ts
│   │   ├── structured_output.ts
│   │   └── index.ts
│   └── mcp/
│       ├── loader.ts
│       └── dynamic-definition.ts
├── expressions/
│   ├── lexer.ts
│   ├── parser.ts
│   ├── ast.ts
│   ├── evaluator.ts
│   ├── runtime.ts
│   └── index.ts
├── engine/
│   └── v2/
│       ├── engine.ts
│       ├── scheduler.ts
│       ├── worker.ts
│       ├── context.ts
│       ├── state.ts
│       └── types.ts
├── validator.ts
├── validator/
│   └── rules.ts
├── credentials/
│   ├── store.ts
│   └── types.ts
├── executions/
│   └── store.ts
├── versions/
│   └── store.ts
├── agent/
│   ├── planner.ts
│   ├── diagnostician.ts
│   ├── repairer.ts
│   └── types.ts
├── io/
│   ├── export.ts
│   ├── import.ts
│   └── format.ts
├── security/
│   ├── ssrf.ts
│   └── sandbox-policy.ts
├── migrations/
│   └── v0-to-v1.ts
└── metrics/
    └── store.ts

src/views/
├── WorkflowDebuggerView.tsx
├── WorkflowVersionsView.tsx
└── CredentialsView.tsx

src/components/workflow/
├── NodePicker.tsx
├── ConfigPanel.tsx
├── NodeTester.tsx
├── ExecutionList.tsx
├── NodeExecutionInspector.tsx
├── ExecutionTimeline.tsx
└── WorkflowMetrics.tsx

src-tauri/src/
├── webhooks/
│   ├── mod.rs
│   ├── server.rs
│   ├── handlers.rs
│   └── auth.rs
├── scheduler/
│   ├── mod.rs
│   └── cron.rs
├── credentials/
│   └── mod.rs
└── db/
    ├── workflows.rs
    ├── executions.rs
    └── migrations/
        ├── 002_workflows.sql
        ├── 003_credentials.sql
        ├── 004_webhooks.sql
        ├── 005_executions.sql
        └── 006_workflow_versions.sql
```

### A.2 Archivos a modificar (existentes)

```
src/workflows/
├── types.ts              → re-export de types/
├── engine.ts             → delega a engine/v2
├── tools.ts              → ampliar con tools v2
├── store.ts              → cambia a SQLite-backed
└── nodeDefs.tsx          → usa Node Registry para metadatos

src/views/
├── WorkflowEditorView.tsx → integración masiva
└── WorkflowsView.tsx      → menores

src/lib/
└── scheduler.ts          → deprecate o migrar

src-tauri/
├── Cargo.toml            → añadir axum, tower-http, cron
├── src/lib.rs            → registrar webhooks + scheduler + credentials
└── src/db/mod.rs         → extender con nuevas tablas

package.json              → añadir vitest, jsdom, @testing-library/react
.github/workflows/build-linux.yml → añadir step de test
```

---

## Apéndice B — Notas sobre la auditoría

- **No se asumió nada.** Todos los hallazgos están basados en lectura directa del código.
- **No se modificó código del repo** durante esta auditoría.
- **El repositorio clonado** está en `/home/z/my-project/weaver-audit/Weaver/` para referencia durante las siguientes fases.
- **Este documento** se guarda también en `/home/z/my-project/download/WEAVER_WORKFLOWS_PLAN.md` y debe vivir en el repo como `WEAVER_WORKFLOWS_PLAN.md` junto a `PLAN.md` y `ARCHITECTURE.md`.

---

**Fin del documento. Próximo paso: comenzar FASE 2 (Migración a SQLite).**
