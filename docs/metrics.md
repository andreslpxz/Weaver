# Métricas

Weaver registra el uso de cada llamada a un LLM para que el usuario
pueda auditar costos y éxito de las tareas. Es la base de datos para el
futuro benchmark **WeaverBench**.

## 1. Vista Métricas

Icono 📊 en el sidebar o el ActivityBar del IDE.

### KPIs (parte superior)

| KPI         | Descripción                                            |
| ----------- | ------------------------------------------------------ |
| Llamadas    | Número total de llamadas a LLM en el rango.            |
| Costo total | Suma de USD estimados (ver precios abajo).             |
| Tokens      | Tokens totales (in + out) con desglose.                |
| % Éxito     | Llamadas con `success=true` / total.                   |

### Por proveedor

Tabla con:

- Proveedor (Google, OpenAI, Anthropic, …).
- Llamadas totales.
- Tokens (input / output).
- Costo USD.
- % Éxito (badge verde / amarillo / rojo).

### Uso diario

Bucket por día (últimos 30 días):

- Fecha (YYYY-MM-DD).
- Barra horizontal proporcional al costo.
- Costo USD.
- Número de llamadas.

### % Éxito por fuente

Tasa de éxito por origen:

- `chat` (interacción directa).
- `subagent:Web Researcher`, `subagent:Email Summarizer`, etc.
- `planner`, `critic`, `reflection` (componentes del bucle agéntico).
- `orchestrator` (orquestación de subagentes).

Cada fila muestra: barra de progreso, `success/total`, `%`.

## 2. Filtros de rango

- **7d** — últimos 7 días.
- **30d** — últimos 30 días (default).
- **90d** — últimos 90 días.
- **Todo** — todos los registros.

## 3. Precios usados

Estimaciones basadas en tarifas públicas de julio 2025 (USD por 1M
tokens):

| Modelo                  | Input  | Output |
| ----------------------- | ------ | ------ |
| gpt-4o                  | 2.5    | 10     |
| gpt-4o-mini             | 0.15   | 0.6    |
| claude-3-5-sonnet       | 3      | 15     |
| claude-3-5-haiku        | 0.8    | 4      |
| gemini-1.5-pro          | 1.25   | 5      |
| gemini-1.5-flash        | 0.075  | 0.3    |
| command-r-plus          | 2.5    | 10     |
| grok-2                  | 2      | 10     |
| mistral-large-latest    | 2      | 6      |
| deepseek-chat           | 0.14   | 0.28   |
| llama-3.1-70b-instruct  | 0.59   | 0.79   |
| Ollama (local)          | 0      | 0      |

Si un modelo no está en la tabla, se asume cost = 0 (mejor que
inventar). Para añadir más modelos, edita `PRICING` en
`src/lib/metrics.ts`.

## 4. Persistencia

- **Navegador**: `localStorage:weaver:usage_records` (cap 1000 registros
  — los más antiguos se descartan).
- **Tauri**: además de localStorage, se intenta persistir en SQLite
  (`~/.weaver/weaver.db`, tabla `weaver_usage`). Best-effort: si falla
  la creación de la tabla, sigue funcionando con localStorage.

## 5. Borrar registros

Botón **X** en la esquina superior derecha del header de Métricas.
Borra TODOS los registros (no se puede deshacer).

## 6. ¿Por qué importa?

- **Auditoría real**: saber cuánto cuesta cada tarea antes de delegar
  cosas más autónomas al agente.
- **Base para WeaverBench**: con esta data se puede armar un benchmark
  tipo "Weaver completó X tareas con Y% de éxito al costo Z".
- **Confianza**: si el usuario ve que las tareas cuestan $0.001 y se
  completan al 95%, confiará en delegar más. Si cuestan $5 y se
  completan al 30%, sabrá que hay que ajustar prompts/tools.

## 7. Limitaciones

- Los precios son **estimaciones**. No reflejan descuentos por volumen,
  caching (Anthropic prompt cache, OpenAI prompt caching), ni rate
  tiers. Considera los costos como **aproximación conservadora**.
- No hay desglose por **proyecto** todavía (sólo por proveedor). Los
  registros sí guardan `source`, pero no `projectId`.
- No hay alertas de presupuesto ("avísame si gasto más de $X al mes").
- No hay exportación a CSV/JSON para análisis externo.
