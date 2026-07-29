# Subagentes

Weaver permite crear **subagentes especializados** que el agente
orquestador puede invocar para tareas complejas. Cada subagente es una
unidad de ejecución aislada, con su propio set de tools, su propio
presupuesto y su propio criterio de éxito.

## 1. ¿Qué es un subagente?

Un subagente **NO** es "el executor con otro system prompt". Es una
unidad con:

- **Tools restringidas**: no le das `shell_exec` a un subagente que solo
  lee bandejas de correo. La restricción es por nombre, no por categoría.
- **Presupuesto propio**: `maxSteps`, `maxTokens`, `maxTimeMs`.
- **Criterio de éxito verificable**: `verificationPrompt` que el
  orquestador usa para validar el resultado.
- **Modelo asignado** (opcional): un subagente puede usar un modelo
  más barato/rápido que el orquestador.

## 2. Contrato de entrada/salida

El orquestador y los subagentes se comunican con un esquema JSON fijo:

### Input (SubagentInvocation)

```json
{
  "objective": "string — qué debe lograr el subagente",
  "context": "string — contexto mínimo necesario, no todo el historial",
  "budget": {
    "maxSteps": 6,
    "maxTokens": 6000,
    "maxTimeMs": 60000
  }
}
```

### Output (SubagentResult)

```json
{
  "subagentId": "default-web-researcher",
  "subagentName": "Web Researcher",
  "status": "succeeded | failed | stuck | timeout | budget_exceeded",
  "result": "string — resultado estructurado",
  "evidence": [
    {
      "kind": "http_response | file_path | log | snapshot | output",
      "label": "string",
      "content": "string",
      "ts": 1738000000000
    }
  ],
  "trace": [...],
  "usage": {
    "inputTokens": 1234,
    "outputTokens": 567,
    "steps": 4,
    "elapsedMs": 12345
  }
}
```

Sin este contrato, el orquestador no puede verificar si el subagente
realmente cumplió. El campo `evidence` es crítico: URLs, rutas,
snapshots — todo lo que permita auditar el resultado.

## 3. Catálogo de subagentes

Vista **Subagentes** (icono 🤖 en el sidebar o el ActivityBar del IDE).

### Predefinidos

Weaver incluye 3 subagentes predefinidos:

| ID                      | Nombre             | Tools                            | Caso de uso                              |
| ----------------------- | ------------------ | -------------------------------- | ---------------------------------------- |
| `default-web-researcher` | Web Researcher     | `web_search`, `web_fetch`        | Investigar en internet con fuentes.      |
| `default-file-reader`   | File Reader        | `file_read`, `file_list`         | Extraer info de archivos (sólo lectura). |
| `default-email-summarizer` | Email Summarizer | `shell_exec` (restringido)       | Resumir bandejas (sólo lectura).         |

### Crear subagentes propios

Pulsa **Nuevo** en la vista Subagentes y rellena:

- **Nombre** y **descripción** (el orquestador usa la descripción para
  decidir cuándo invocarlo).
- **System prompt**: instrucciones específicas + formato de salida
  (`RESULT:` / `EVIDENCE:` / `STUCK:`).
- **Prompt de verificación**: el orquestador lo evalúa contra el
  resultado para validar éxito real.
- **Tools permitidas**: checkboxes. **Marca sólo las mínimas
  necesarias** — esto es lo que aporta seguridad real.
- **Presupuesto**: pasos / tokens / tiempo máximos por invocación.
- **Proveedor y modelo** (opcional): por defecto hereda el del
  orquestador; útil para usar modelos baratos en tareas rutinarias.
- **Skill asociada** (opcional): nombre de una skill existente que
  este subagente envuelve.

## 4. Orquestación

El orquestador (`src/agent/orchestrator.ts`):

1. **Selecciona candidatos** por keyword match en nombre/descripción vs
   el objetivo recibido.
2. **Reparte presupuesto** entre los intentos (60% del total por
   intento, hasta 3 intentos si `allowRetry`).
3. **Invoca** cada candidato con el contrato de entrada.
4. **Reintenta** con el siguiente candidato si el anterior falló.
5. **Escala a plan alternativo** si hay `timeout` o `budget_exceeded`
   (sólo si `allowEscalation`).
6. **Construye un árbol de ejecución** trazable: cada nodo tiene
   `subagentId`, `invocation`, `result`, `evidence`, `usage`.

El árbol se serializa con `formatExecutionTree()` para mostrar en el
chat o en logs.

## 5. Trazabilidad y depuración

Cada invocación queda registrada en `ExecutionNode` con:

```text
└─ Web Researcher [succeeded] 4 pasos · 1800 tokens · 12345ms
   evidence:
   • [http_response] web_search tavily api
   • [http_response] web_fetch https://tavily.com/docs
```

Sin este árbol, depurar por qué una orquestación falló sería imposible.

## 6. Conexión con skills

Un subagente puede envolver una skill existente (`skillName`). En el
futuro, el subagente podría invocar la skill como una tool más — hoy la
integración es referencial. La visión a largo plazo: **un subagente es
básicamente "una skill con su propio loop de ejecución"**, no solo
instrucciones.

## 7. Seguridad y limitaciones

- Las tools se filtran por nombre en runtime: si un subagente no tiene
  `shell_exec` en `allowedTools`, la llamada se rechaza aunque el LLM la
  emita.
- El presupuesto se controla con `AbortController`-like checks en cada
  paso (tokens acumulados, tiempo transcurrido).
- Los subagentes se persisten en `localStorage:weaver:subagents`. En
  modo Tauri se pueden sincronizar con SQLite vía `setFact('subagent:<id>', JSON)`.

## 8. Próximos pasos

- Sub-subagentes: un subagente podría invocar otros subagentes (campo
  `children` ya está en el tipo `ExecutionNode`).
- Auto-selección: el orquestador usa un LLM para elegir el subagente
  más adecuado en lugar de keyword match.
- Verificación automática: el `verificationPrompt` se evalúa con un LLM
  pequeño contra el `result` para validar éxito.
- Skills como tools: envolver skills existentes como tools invocables
  por subagentes.
