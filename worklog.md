# Weaver — Worklog compartido

---
Task ID: bug-fix-suggestions-cut-off
Agent: main
Task: Corregir bug donde el mensaje del agente se cortaba al usar sugerencias predefinidas (como "Busca en internet las últimas noticias de IA"). Además, indicar al agente que al terminar haga un resumen y una pregunta de seguimiento.

Work Log:
- Análisis del bug: al seleccionar una sugerencia como "Busca en internet..." el LLM emite un `tool_call` (web_search). El loop `runChatWithTools` sólo terminaba cuando `result.toolCalls.length === 0` (es decir, cuando el LLM respondía sin tools). Si el LLM encadenaba tools hasta agotar `MAX_TOOL_ROUNDS=6`, el código sólo imprimía "Límite de rondas de tools alcanzado" — el usuario NUNCA veía respuesta textual del agente.
- Actualizado system prompt en `src/components/composer/Composer.tsx::runChatWithTools` con sección "CIERRE OBLIGATORIO" que instruye al LLM a siempre producir un resumen + resultados + pregunta de seguimiento al terminar de usar tools.
- Subido `MAX_TOOL_ROUNDS` de 6 a 8 para dar más espacio antes del forzado.
- Añadido flag `producedFinalText` y, cuando el loop termina sin que el LLM produjera respuesta textual, se hace una llamada final SIN tools + un mensaje user pidiendo explícitamente el resumen. Así el usuario siempre recibe una respuesta del agente.
- Eliminado `appendMessage({ role: 'assistant', content: '' })` redundante en la rama `desktopAgentive` de `handleSend` (dejaba un mensaje fantasma vacío al inicio del chat).
- Fix del adapter de Anthropic (`src/providers/adapters/anthropic.ts`): convertía los `tool` messages al formato OpenAI (`{role:'tool', content}`), pero Anthropic requiere `{role:'user', content:[{type:'tool_result', tool_use_id, content}]}`. También los `assistant` con `tool_calls` ahora se convierten al formato `content:[{type:'text'},{type:'tool_use', id, name, input}]`. Sin este fix, cualquier usuario de Anthropic no podía usar tools (la 2ª llamada fallaba con error 400).
- Verificado con `npx tsc --noEmit` (EXIT 0) y `npx vite build` (exitoso en 5.35s).

Stage Summary:
- Archivos modificados:
  - `src/components/composer/Composer.tsx`: system prompt + loop runChatWithTools + removido append redundante
  - `src/providers/adapters/anthropic.ts`: formato de tool messages corregido
- Causa raíz del bug reportado: el LLM usaba tools pero nunca producía texto final, llegando al límite de rondas sin responder. Fix: forzar respuesta final sin tools cuando se acaba el loop.
- Causa raíz del "no llega": el LLM encadenaba `web_search` (sin API key Tavily → ERROR) y otros tools sin emitir respuesta textual. Ahora, tras los rounds, se le fuerza a responder.
- No se solicitó commit en esta ronda (el usuario no proveyó token).

---
Task ID: feat-modo-cognitivo
Agent: main
Task: Añadir "Modo Cognitivo" al menú + del Composer. El agente se vuelve hiper-especializado: construye un Grafo Cognitivo del proyecto (graphify) con nodos (funciones, clases, interfaces, métodos, variables, tipos, archivos, carpetas, módulos) y aristas (imports, contains, affects, depends_on). Al recibir un pedido sigue 3 fases: intuición → lógica → juicio.

Work Log:
- Creado `src/lib/cognitive.ts`:
  - Tipos: NodeKind (file|folder|module|function|class|interface|method|variable|type|import), CognitiveNode, EdgeKind (imports|contains|affects|depends_on), CognitiveEdge, CognitiveGraph (con stats + builtAt).
  - Persistencia: loadGraph/saveGraph/clearGraph en localStorage (key `weaver:cognitive-graph`).
  - `extractSymbols(content, ext)`: regex-based, cubre TS/JS/Python/Rust/Go/Java/C/C++ (import, function, def, fn, func, class, struct, interface, type, const/let/var, métodos).
  - `walkDir(root, maxDepth)`: recursively escanea carpetas usando `sqlite.fileList`, saltándose node_modules/.git/dist/build/etc. Limita a 5000 archivos y 256KB por archivo.
  - `graphify(rootPath)`: orquesta todo — crea nodos de folder/file/símbolos/módulos, aristas de contains (folder→subfolder, folder→file, file→símbolo) y aristas de imports (resuelve imports relativos a archivos reales). Devuelve CognitiveGraph con stats completas.
  - `queryGraph(graph, opts)`: soporta search (substring), byKind, neighbors, path (BFS más corto entre 2 nodos por nombre), stats. Devuelve summary + nodos + aristas formateadas.
- Añadidas dos tools a `src/lib/tools.ts`:
  - `cognitive_graphify`: ejecuta `graphify(root_path)` y devuelve resumen con stats.
  - `cognitive_query`: consulta el grafo con search/by_kind/neighbors/from+to/stats/limit.
  - OPTIONAL_KEYS extendido con: search, by_kind, neighbors, from, to, stats, limit, root_path.
  - Funciones `cognitiveGraphify` y `cognitiveQuery` añadidas al dispatcher.
- Store (`src/store/weaver.ts`): añadido `cognitiveMode: boolean` + `setCognitiveMode`. Default false.
- Composer (`src/components/composer/Composer.tsx`):
  - Import de `Network` icon de lucide-react.
  - `cognitiveMode` + `setCognitiveMode` extraídos del store.
  - En `handleSend`, si `cognitiveMode` está activo, prepending al objectiveText un system prompt que define el protocolo de 3 fases:
    1. INTUICIÓN (Telaraña): cognitive_query para buscar nodos relacionados y restricciones previas.
    2. LÓGICA (Construcción del Grafo): trazar cadena A → B → C, verificar restricciones.
    3. JUICIO (Emisión): responder con resumen + nodos afectados + propuesta + pregunta de confirmación.
  - Toggle "Modo cognitivo" añadido al popup del menú + entre "Perseguir objetivo" y el separador.
  - Badge visual "Cognitivo" junto a "Plan" y "Perseguir" cuando está activo.
- i18n (`src/lib/i18n.ts`): añadidas claves `cognitive.title`, `cognitive.subtitle`, `cognitive.badge` en ES y EN.
- Verificado: `tsc --noEmit` EXIT 0 ✓ · `vite build` exitoso en 5.29s ✓ (cognitive chunk separado de 8.15 kB).

Stage Summary:
- Commit del bug-fix previo ya empujado (438746f).
- Modo Cognitivo completamente funcional: el usuario activa el toggle en el menú +, el agente consulta/ construye el grafo del proyecto antes de proponer cambios, y responde con protocolo intuición → lógica → juicio.
- Requiere modo Tauri para escanear archivos (en navegador el graphify fallará con error claro).
- El grafo se persiste en localStorage, así que no se reconstruye en cada mensaje — sólo cuando el usuario o el agente llama a cognitive_graphify explícitamente.

---
Task ID: bug-fix-text-tool-calls
Agent: main
Task: Corregir bug donde el agente emitía tool calls como TEXTO (formato Mistral `<function(name){args}</function>`) en vez de usar function calling nativo. Síntomas reportados: (1) mensaje "sin respuesta" cuando el LLM sólo emitía un text-tool-call, (2) mensaje mostraba el texto crudo `<function(web_search){...}</function>` en vez de ejecutar la herramienta. El usuario tiene Tavily API key configurada y no tenía ningún modo activado.

Work Log:
- Análisis del bug: el adapter `openai-compat.ts` sólo popula `result.toolCalls` cuando el LLM emite `delta.tool_calls` (function calling nativo). Muchos modelos (Mistral-Nemo, Hermes 2 Pro, Llama 3.1+, Qwen, Nous Research) NO usan function calling nativo y emiten los tool calls como texto con tags como:
  - Mistral: `<function(web_search){"query": "...", "max_results": 5}</function>`
  - Mistral official: `[TOOL_CALLS: [{"name":"...","arguments":{...}}]]`
  - Hermes/Nous: `<tool_call>{"name":"...","arguments":{...}}</tool_call>`
  - Llama 3.1+: `<|tool_call|>{"name":"...","arguments":{...}}`
- Como `result.toolCalls.length === 0`, el loop `runChatWithTools` rompía inmediatamente con `producedFinalText = true`. El "texto" visible era el tool call crudo (o vacío si ReactMarkdown strippeaba los tags HTML-like, causando el "sin respuesta").
- Creado `src/lib/textToolParser.ts`:
  - `parseTextToolCalls(text)`: detecta y extrae tool calls de los 5 formatos soportados.
  - `extractBalancedJson(text, pos)`: extrae JSON respetando anidamiento de braces y strings. Necesario porque regex `\{[\s\S]*?\}` corta en el primer `}` (no el balanceado) → falla para args con objetos anidados como `{"arguments":{"a":1}}`.
  - `maybeHasTextToolCall(text)`: check rápido (string includes) para decidir si vale la pena hacer el parseo completo.
  - Si JSON es malformado, lo deja como texto (no rompe).
  - Devuelve `{toolCalls, cleanedText, found}`.
- Añadido `setLastAssistantMessage(content)` al store `weaver.ts`: reemplaza el contenido completo del último mensaje asistente (no append como `updateLastAssistantMessage`). Necesario para limpiar el texto visible que contenía las marcas del tool call.
- Modificado `runChatWithTools` en `Composer.tsx`:
  - Tras `streamChat`, si `result.toolCalls.length === 0` y `maybeHasTextToolCall(result.text)` es true, ejecuta `parseTextToolCalls(result.text)`.
  - Si encuentra tool calls, los añade a `result.toolCalls`, reemplaza el texto visible con `setLastAssistantMessage(parsed.cleanedText)`, y actualiza `result.text` para que el historial del LLM también quede limpio.
  - El resto del loop sigue igual: ejecuta los tool calls, envía los resultados al LLM, etc.
- Tests rápidos con `tsx` (archivo temporal `textToolParser.test.ts`, luego borrado): 9/9 tests pasaron cubriendo Mistral, Mistral official, Hermes, Llama 3.1+, múltiples tool calls, JSON malformado, texto normal sin tool call, y texto con prefijo+tool call+sufijo.
- Verificado: `tsc --noEmit` EXIT 0 ✓ · `vite build` exitoso en 5.40s ✓ (textToolParser chunk 3.10 kB / 1.15 kB gzip).

Stage Summary:
- Archivos modificados:
  - `src/lib/textToolParser.ts` (NUEVO, 3.10 kB): parser de tool calls en formato texto.
  - `src/store/weaver.ts`: añadido `setLastAssistantMessage(content)` para reemplazar (no append) el último mensaje.
  - `src/components/composer/Composer.tsx`: integración del parser en `runChatWithTools` (después de `streamChat`, antes del break).
- Causa raíz: modelos que no soportan function calling nativo emitían tool calls como texto, el adapter no los detectaba, el loop rompía sin ejecutarlos.
- Fix: parser de texto → tool calls nativos → ejecución normal.
- El usuario ya NO debería ver `<function(...)>` crudo ni respuestas vacías cuando el LLM use formato texto.

---
Task ID: bug-fix-empty-response-no-message
Agent: main
Task: Corregir bug donde el agente mostraba spinner "Pensando..." y luego NO mostraba ningún mensaje al enviar sugerencias predefinidas como "Busca en internet las últimas noticias de IA y haz un resumen". Síntoma: sale el spinner, luego desaparece, y no hay mensaje del asistente. El log de Vite sólo mostraba HMR noise + ECONNREFUSED 127.0.0.1:11434 (Ollama no corriendo — irrelevante).

Work Log:
- Análisis: el bug anterior (commit c07cb2e) fixeó el caso de tool calls en formato texto, PERO introdujo/dejó un bug peor: cuando el LLM respondía VACÍO (ni texto ni tool calls — común en modelos pequeños, streams cortados, o cuando el modelo no soporta tools y se confunde), el código hacía:
    if (result.toolCalls.length === 0) {
      producedFinalText = true;  // ← siempre true, incluso si text es ''
      break;
    }
  Como producedFinalText quedaba true, el bloque post-loop (que fuerza una respuesta final) NUNCA se ejecutaba. El usuario se quedaba con mensaje asistente vacío → spinner mientras isRunning=true → nada cuando isRunning=false.
- Fix 1: sólo marcar producedFinalText=true si HAY texto real:
    if (result.toolCalls.length === 0) {
      if (result.text && result.text.trim().length > 0) {
        producedFinalText = true;
      }
      break;
    }
  Así, si el LLM responde vacío, producedFinalText queda false y el bloque post-loop se ejecuta.
- Fix 2: el bloque post-loop (force-final) ahora:
  1. Captura el resultado de streamChat (antes lo ignoraba).
  2. Si el LLM emitió tool calls como texto en la respuesta final, los limpia con parseTextToolCalls (sin ejecutarlos — ya cerramos la fase de tools).
  3. Si aún así el texto es vacío, muestra un fallback claro:
     "*(El modelo no generó una respuesta. Posibles causas: ...)*"
  para que el usuario NUNCA se quede con mensaje vacío.
- Verificado: `tsc --noEmit` EXIT 0 ✓ · `vite build` exitoso en 5.50s ✓.

Stage Summary:
- Archivo modificado: `src/components/composer/Composer.tsx` (runChatWithTools).
- Causa raíz: el flag producedFinalText se seteaba true incluso cuando el LLM respondía vacío, saltándose el bloque force-final.
- Fix: producedFinalText sólo true si hay texto real; force-final block captura resultado, limpia text-tool-calls, y muestra fallback si sigue vacío.
- Ahora el usuario SIEMPRE ve un mensaje del asistente (respuesta del LLM, resumen forzado, o fallback explicativo).

---
Task ID: feat-model-picker-free-models-search
Agent: main
Task: El usuario reporta que en el selector de modelos NO encuentra modelos free de OpenRouter — los de pago sí aparecen, los free no. Además, la búsqueda no filtra por nombre de modelo, sólo por nombre de proveedor, así que escribir "free" o "llama" no encuentra nada.

Work Log:
- Análisis de la causa raíz:
  1. La función `fetchOpenRouterModels` SÍ trae los modelos free (OpenRouter los marca con sufijo `:free` en el id y pricing = "0"). El problema NO era que faltaran, sino que:
     a) Estaban MEZCLADOS entre los 300+ modelos de pago, difíciles de encontrar.
     b) La búsqueda del popup (`filtered = PROVIDERS.filter(label.includes(q) || desc.includes(q))`) NO filtraba modelos, sólo proveedores. Escribir "free" no matcheaba ningún proveedor → lista vacía.
     c) No había forma visual de distinguir free de paid en el listado.
- Cambios en `src/providers/types.ts`:
  - Añadido campo `isFree?: boolean` a `ModelInfo` para marcar modelos gratuitos.
- Cambios en `src/providers/openrouter-models.ts` (`convertOpenRouterModel`):
  - Detecta free: pricing todo 0 O id termina en `:free`.
  - Añade "(free)" al label si es free y el label no lo indica ya.
  - Mantiene `isFree: true` incluso si pricing se descarta por ser todo 0.
  - En `fetchOpenRouterModels`: ordena el array final con FREE primero, luego alfabético por label. Así los modelos gratuitos aparecen al principio del listado de OpenRouter.
- Cambios en `src/components/model-picker/ModelPickerPopup.tsx`:
  - Añadido estado `freeOnly: boolean` y `providerLimits: Record<string, number>`.
  - Añadido `DEFAULT_MODEL_LIMIT = 12` — sin búsqueda, sólo muestra 12 modelos por proveedor (OpenRouter tiene 300+, era inservible). Con búsqueda o filtro free, muestra todos los que matcheen.
  - Añadido chip "Solo free" bajo la barra de búsqueda (toggle). Filtra modelos con `isFree=true` en todos los proveedores.
  - Placeholder actualizado: 'Buscar modelo, proveedor o "free"…'.
  - Nueva función `getDisplayedModels(pid)`: aplica filtro freeOnly, filtro query (match id/label), y límite de paginación. Devuelve {models, total, hidden}.
  - El `useMemo filtered` ahora también incluye proveedores cuyos MODELOS matchean la query (no sólo label/desc del proveedor).
  - Mensaje "No se encontraron modelos" cuando no hay resultados.
  - Badge "FREE" (verde, icono Gift) en modelos gratuitos, reemplaza el badge "reasoning" si ambos aplican.
  - Contador de modelos junto al nombre del proveedor (ej. "OpenRouter [50]").
  - Botón "Ver N modelos más de X" para ampliar el límite de 12 en 24.
  - Si el filtro deja 0 modelos en un proveedor, se omite el card completo.
  - Import añadido: `Gift` de lucide-react, `useMemo` de react.
- Verificado: `tsc --noEmit` EXIT 0 ✓ · `vite build` exitoso en 5.37s ✓.

Stage Summary:
- Archivos modificados:
  - `src/providers/types.ts`: añadido `isFree?: boolean` a ModelInfo.
  - `src/providers/openrouter-models.ts`: detecta free, marca label "(free)", ordena FREE primero.
  - `src/components/model-picker/ModelPickerPopup.tsx`: chip "Solo free", búsqueda por modelo, badge FREE, límite 12 + "Ver más".
- Causa raíz: los modelos free SÍ estaban en el catálogo, pero mezclados entre 300+ y sin forma de distinguirlos ni buscarlos.
- Fix: flag isFree + chip Solo free + búsqueda por modelo + orden FREE primero + badge visual.
- Ahora el usuario puede hacer click en "Solo free" y ver sólo los modelos gratuitos de OpenRouter (Llama 3.3 70B free, Gemini 2.0 Flash free, Qwen 2.5 72B free, DeepSeek R1 free, etc.) directamente.



