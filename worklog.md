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




---
Task ID: bug-fix-me-user-not-agent
Agent: main
Task: El usuario reporta que el agente se confunde y piensa que "MI" (la sección personal de Weaver) es para él mismo, no para el usuario. Síntoma: al preguntar "Hola, ¿qué puedes hacer?", el agente usó me_create_note para crear una nota titulada "Mis Capacidades / Funciones" listando sus propias habilidades, en vez de responder en el chat.

Work Log:
- Análisis: las descripciones de las tools me_create_note, me_create_task, me_create_event, me_add_shopping, me_log_health decían simplemente "crea una nota en ME" / "crea una tarea en ME" sin aclarar que ME es el espacio personal DEL USUARIO. El system prompt tampoco mencionaba la distinción. El agente interpretaba "ME" como "mi espacio (del agente)".
- Cambios en src/lib/tools.ts:
  - Cabecera del bloque ME cambió de "ME: Calendario y vida" a "ME: Espacio personal del USUARIO" + comentario aclaratorio.
  - me_create_event: ahora dice "Crea un evento en el calendario DEL USUARIO dentro de MI/ME". Aclara que NO es para auto-registro del agente.
  - me_list_events: "Lista los eventos del calendario DEL USUARIO".
  - me_create_task: "Crea una tarea en la lista de tareas DEL USUARIO en MI. IMPORTANTE: es una tarea para el USUARIO (ej: 'comprar pan'), NO una tarea del agente."
  - me_create_note: bloque CRÍTICO explicando que va al espacio del usuario, no a la memoria del agente. NUNCA usar para registrar cosas sobre sí mismo. Si el usuario pregunta "¿qué puedes hacer?", responder en chat, NO crear nota.
  - me_add_shopping: "lista de la compra DEL USUARIO".
  - me_log_health: "medición de salud DEL USUARIO".
- Cambios en src/components/composer/Composer.tsx (system prompt):
  - Añadido bloque "REGLA CRÍTICA SOBRE MI / ME" después de "REGLAS DE TOOLS".
  - Define: MI/ME es la sección personal DEL USUARIO (sus notas, tareas, calendario, lista de la compra, salud). NO es el espacio del agente.
  - Prohíbe explícitamente usar me_create_* para registrar cosas sobre el agente mismo.
  - Sólo usar estas tools cuando el usuario pida explícitamente anotar algo en SU espacio.
  - Caso concreto: si el usuario pregunta "¿qué puedes hacer?" o "¿quién eres?", responder en chat, NO crear nota en MI.
- Verificado: tsc --noEmit EXIT 0 ✓ · vite build exitoso en 5.66s ✓.

Stage Summary:
- Archivos modificados:
  - src/lib/tools.ts: descripciones de las 6 tools me_* reescritas para aclarar que son para datos DEL USUARIO.
  - src/components/composer/Composer.tsx: system prompt ampliado con bloque "REGLA CRÍTICA SOBRE MI / ME".
- Causa raíz: ambigüedad en el nombre "ME" + descripciones mínimas → el agente interpretaba "ME" como "mi (del agente)" en vez de "MI (del usuario)".
- Fix: doble refuerzo — system prompt + descripciones de cada tool. El agente ahora recibe la aclaración tanto al cargarse el contexto (system prompt) como al inspeccionar cada tool (description).
- Ahora al preguntar "¿qué puedes hacer?", el agente debería responder directamente en el chat en vez de crear una nota en MI.

---
Task ID: feat-mcp-mention-integration
Agent: main
Task: Implementar @mcp:<nombre> en el menú de menciones del Composer para que el usuario pueda activar servidores MCP instalados (ej: Figma, GitHub, Slack). Antes de esto, los servidores MCP estaban instalados pero no había forma de invocarlos desde el chat — el agente no los conocía.

Work Log:
- Análisis del estado MCP:
  - mcpClient en src/mcp/client.ts ya tenía listServers/listTools/callTool pero requieren Tauri (en navegador devuelven [] o throw).
  - Composer.tsx no mencionaba MCPs en su menú @.
  - dispatchAdvancedTool en lib/tools.ts no tenía dispatcher para tools MCP.
- Cambios en src/components/composer/Composer.tsx:
  - Imports: mcpClient y McpServer desde @/mcp/client; getPreset desde @/mcp/presets; Puzzle desde lucide-react.
  - Estado nuevo: mcpServers: McpServer[] cargado en useEffect (recarga al recibir evento 'weaver:mcp-changed').
  - Menú @: añadido bloque "Servidores MCP instalados" que lista los servers habilitados, con icono Puzzle y desc que incluye el nombre del preset o el comando. Insert: `@mcp:${s.name}`.
  - MentionItem: añadido tipo 'mcp' e icon 'puzzle'.
  - MentionIcon: añadido case 'puzzle' → <Puzzle/>.
  - handleSend: regex `/@mcp:([\w\- ]+)/g` extrae los nombres mencionados → mcpMentionedNames: string[].
  - runChatWithTools: nuevo parámetro mcpMentionedNames=[].
    - Antes del system prompt: bloque que carga las tools MCP (sólo si hay menciones):
      * Si !runtime.isTauri → hint "MCP no disponible en navegador" en system prompt.
      * Si no encuentra el server mencionado → hint "MCP no encontrado, disponibles: X".
      * Si hay server pero 0 tools aprobadas → hint "aprueba tools en Ajustes".
      * Si hay server pero 0 tools expuestas → hint "servidor no corriendo / API key inválida".
      * Si todo OK → lista las tools MCP con prefijo mcp__<serverId>__<toolName> en system prompt.
    - System prompt ampliado con bloque "MCP (Model Context Protocol)" explicando:
      * Qué son los servidores MCP (externos, instalados por el usuario).
      * Cómo se activan (@mcp:<nombre> en el mensaje).
      * Prefijo mcp__<serverId>__<toolName> de las tools.
      * Si no hay @mcp:, no usarlas.
    - tools = [...buildAdvancedToolsList(), ...mcpExtraTools] — concatena las tools nativas con las MCP.
  - formatToolLabel: default case ahora detecta mcp__ y muestra "MCP · <toolShortName>".
- Cambios en src/lib/tools.ts:
  - dispatchAdvancedTool default case: si name.startsWith('mcp__') → dispatchMcpTool(name, args).
  - Nueva función dispatchMcpTool(fullToolName, args):
    * Parsea mcp__<serverId>__<toolName> (serverId puede contener '__' si el id lo tuviera, se une todo menos la última parte).
    * Llama mcpClient.callTool(serverId, toolName, args).
    * Formatea el resultado: une los .text de cada content item, trunca a 8000 chars.
    * Si is_error → ok=false + error=primeros 500 chars.
    * Catch: devuelve error "MCP serverId/toolName: msg".
- Verificado: tsc --noEmit EXIT 0 ✓ · vite build exitoso en 5.07s ✓.

Stage Summary:
- Archivos modificados:
  - src/components/composer/Composer.tsx: imports MCP, estado mcpServers, bloque @mcp en menú, parseo @mcp en handleSend, carga dinámica de tools MCP en runChatWithTools, system prompt ampliado con bloque MCP + hints contextuales, formatToolLabel para tools MCP.
  - src/lib/tools.ts: dispatcher default para tools mcp__, nueva función dispatchMcpTool.
- Causa raíz: los servidores MCP estaban instalados pero no había puente entre el chat y el cliente MCP — el LLM no los conocía y no había forma de invocarlos desde el Composer.
- Fix: feature completa de @mcp:<nombre> — el usuario escribe @mcp:Figma en su mensaje y las tools de Figma se cargan automáticamente al array de tools del LLM.
- IMPORTANTE: MCP sigue requiriendo Tauri para funcionar. En modo navegador (npm run dev puro), si el usuario menciona @mcp:, el agente le informará que debe ejecutar la app de escritorio.
- Próximo paso sugerido: emitir evento 'weaver:mcp-changed' desde la vista Ajustes > MCP cuando el usuario instale/desinstale/apruebe tools, para que el Composer recargue la lista sin recargar la página.

---
Task ID: bug-fix-win-keyring-mcp-reload
Agent: main
Task: El usuario en Windows reporta dos bugs con Tauri:
1. No se guardan las API keys de los proveedores (OpenAI, Anthropic, etc.).
2. Después de instalar el MCP de Figma, no aparece @mcp en el menú del Composer.

Work Log:
- Bug 1 (API keys):
  - Análisis: en src/lib/tauri.ts, `deleteApiKey` pasaba `{ providerId }` (camelCase) al comando Rust `keyring_delete_api_key`, pero Rust espera `provider_id` (snake_case). Tauri v2 no mapea automáticamente, así que el delete fallaba silenciosamente.
  - Para `setApiKey` ya estaba bien (usaba `args: { provider_id, api_key }`), pero el apiKeyStore.set propagaba errores silenciosamente: si el keyring fallaba (ej: Credential Manager bloqueado en Windows), el caché quedaba con la key como si estuviera guardada pero en realidad no estaba en el OS.
  - Fix en src/lib/tauri.ts:
    * deleteApiKey ahora pasa ambos `{ providerId, provider_id: providerId }` para compatibilidad (Tauri hace match por nombre).
  - Fix en src/providers/store.ts:
    * apiKeyStore.set ahora hace try/catch y revierte el caché si el guardado falla, propagando el error.
    * apiKeyStore.delete también hace try/catch y recarga el estado real desde el OS si falla.
  - Fix en src/components/model-picker/ModelPickerPopup.tsx:
    * saveKey ahora muestra un mensaje claro si el keyring falla: "No se pudo guardar en el llavero del OS: <msg>. En Windows verifica que Credential Manager no esté bloqueado. Si el problema persiste, reinicia Weaver como administrador."
    * deleteKey también hace try/catch y muestra el error.
- Bug 2 (@mcp no aparece):
  - Análisis: el Composer cargaba mcpServers en un useEffect al montarse, pero si el usuario instalaba Figma DESPUÉS (estando en la vista Ajustes), el Composer no se enteraba. El useEffect no tenía mecanismo de recarga.
  - Fix en src/views/Views.tsx:
    * installPreset, removeServer y toggleEnabled ahora disparan `window.dispatchEvent(new CustomEvent('weaver:mcp-changed'))` después de modificar los servidores.
  - Fix en src/components/composer/Composer.tsx:
    * useEffect de mcpServers ahora tiene `[view]` como dependencia. Cuando el usuario vuelve a la vista 'chat' desde Ajustes, el useEffect se re-ejecuta y recarga mcpServers. Esto cubre el caso edge donde el evento 'weaver:mcp-changed' se disparó antes de que el Composer estuviera montado.
    * También recarga cuando llega el evento 'weaver:mcp-changed'.
- Verificado: tsc --noEmit EXIT 0 ✓ · vite build exitoso en 6.41s ✓.

Stage Summary:
- Archivos modificados:
  - src/lib/tauri.ts: deleteApiKey pasa provider_id (snake_case) para matchear el comando Rust.
  - src/providers/store.ts: apiKeyStore.set/delete propagan errores y revierten caché en fallo.
  - src/components/model-picker/ModelPickerPopup.tsx: saveKey/deleteKey muestran errores del keyring al usuario.
  - src/views/Views.tsx: installPreset/removeServer/toggleEnabled disparan 'weaver:mcp-changed'.
  - src/components/composer/Composer.tsx: useEffect mcpServers depende de [view], recarga al volver a chat.
- Causas raíz:
  1. API keys: deleteApiKey camelCase vs snake_case + errores tragados silenciosamente. Para set, si Windows Credential Manager fallaba (poco frecuente pero posible), el usuario no recibía feedback.
  2. @mcp: falta de evento de recarga entre Ajustes y Composer.
- Nota para el usuario: si después de este fix el guardado sigue fallando en Windows, el error ahora se mostrará en el UI con un mensaje claro. Las causas más comunes son: Credential Manager bloqueado por GPO, antivirus interceptando, o falta de permisos. Reiniciar como admin suele resolverlo.

---
Task ID: fix-rust-duplicate-keyring-linux
Agent: main
Task: Corregir error de compilación Rust en Linux: `error[E0428]: the name __tauri_command_name_keyring_set_api_key is defined multiple times` al correr `npm run tauri:dev`. Caused by both `commands.rs` (Linux-only, defines keyring_* + AT-SPI + automation) and `commands_crossplatform.rs` (always compiled, defines same keyring_* commands) being in the same crate on Linux, so the `#[tauri::command]` macro emits colliding `__cmd__*` / `__tauri_command_name_*` symbols.

Work Log:
- Diagnosticado: `lib.rs` declaraba `pub mod commands_crossplatform;` sin `cfg`, así que se compilaba en todas las plataformas. En Linux también se compila `commands.rs` (gated con `#[cfg(target_os = "linux")]`), que redefine los 5 mismos comandos keyring_*.
- Fix aplicado en `src-tauri/src/lib.rs`: gate `commands_crossplatform` con `#[cfg(not(target_os = "linux"))]`. Así en Linux sólo compila `commands.rs` (que tiene keyring + AT-SPI/automation), y en Windows/macOS sólo compila `commands_crossplatform.rs` (keyring + tools + MCP). Los `invoke_handler!` ya estaban correctamente separados por cfg.
- Verificado que no hay otras referencias a `commands_crossplatform` fuera del bloque `#[cfg(not(target_os = "linux"))]` en `lib.rs`.
- Commit `8c1c6ff` y push a main.

Stage Summary:
- Root cause: `commands_crossplatform` no estaba gated, se compilaba en Linux donde `commands` ya define los mismos keyring commands.
- Fix: 1 línea en `src-tauri/src/lib.rs` agregando `#[cfg(not(target_os = "linux"))]` antes de `pub mod commands_crossplatform;`.
- Resultado: `npm run tauri:dev` debería compilar en Linux sin los 10 errores E0428.

---
Task ID: feat-project-collaboration
Agent: main
Task: Implementar colaboración local en proyectos: invitar miembros ilimitados, cada uno con su propio proveedor+modelo (para no saturar el modelo principal), carpetas aisladas por miembro (chats privados), contraseñas para proyecto y miembro, renombrar proyectos, matriz de permisos (ejecutar agent, editar archivos, shell, ver chats ajenos, gestionar miembros), y configurar dónde corren los tools del agent (local / sólo dueño / cada quien).

Work Log:
- Backend Rust (`src-tauri/src/db/mod.rs`):
  - Nueva tabla `project_members` con: id, project_id, name, color, provider_id, model_id, role ('owner'|'admin'|'member'|'viewer'), 5 bools de permisos, password_hash, created_at.
  - Migraciones ALTER (ejecutadas una por una ignorando "duplicate column name"):
    * `ALTER TABLE projects ADD COLUMN password_hash TEXT`
    * `ALTER TABLE projects ADD COLUMN agent_execution_scope TEXT DEFAULT 'local'`
    * `ALTER TABLE conversations ADD COLUMN owner_member_id TEXT`
  - Updated `Project` struct: +password_hash, +agent_execution_scope.
  - Updated `Conversation` struct: +owner_member_id.
  - Nuevo `ProjectMember` struct.
  - Helper `hash_password(p)` con DefaultHasher + salt estático "weaver-v1|" (suficiente para gate local).
  - Nuevos comandos:
    * `projects_set_password(id, password: Option<String>)`
    * `projects_verify_password(id, password) -> bool`
    * `projects_set_scope(id, scope: String)`
    * `members_list(project_id) -> Vec<ProjectMember>`
    * `members_create(member) -> ProjectMember`
    * `members_update(member)`
    * `members_delete(id)` (libera conversaciones del miembro)
    * `members_set_password(id, password: Option<String>)`
    * `members_verify_password(id, password) -> bool`
    * `conversations_set_owner(conv_id, member_id: Option<String>)`
  - `projects_delete` ahora también borra miembros del proyecto.
- `src-tauri/src/lib.rs`: registrados los 10 nuevos comandos en AMBOS invoke_handler blocks (Linux y crossplatform).
- TypeScript bindings (`src/lib/tauri.ts`):
  - `ProjectRow` +password_hash, +agent_execution_scope.
  - `ConversationRow` +owner_member_id.
  - Nuevo `ProjectMemberRow` con todos los campos.
  - Wrappers en `sqlite`: setProjectPassword, verifyProjectPassword, setProjectScope, listMembers, createMember, updateMember, deleteMember, setMemberPassword, verifyMemberPassword, setConversationOwner.
- Store (`src/store/weaver.ts`):
  - `Project` interface: +passwordHash, +agentExecutionScope.
  - `Conversation` interface: +ownerMemberId.
  - Nuevo `ProjectMember` interface.
  - Nuevas acciones: setProjectPassword, setProjectScope, setConversationOwner, loadMembers, createMember, updateMember, deleteMember, setMemberPassword.
  - Nuevo estado: `members: ProjectMember[]`, `activeMemberId: string | null`.
  - Nuevas acciones: `setActiveMember(id)`, `getActiveMember()`.
  - `loadProjects` mapea los nuevos campos. Fallback navegador también.
  - `deleteProject` limpia members del estado.
- Modal (`src/components/projects/ProjectSettingsModal.tsx`, nuevo archivo 544 líneas):
  - Sección General: renombrar proyecto (onBlur guarda).
  - Sección Scope: 3 tarjetas (Local / Sólo dueño / Cada quien) con icono, label y descripción.
  - Sección Contraseña: input + botón Guardar/Quitar. Muestra estado "protegido" o "sin protección".
  - Sección Miembros: lista con count, formulario para añadir (nombre + rol), fila expandible por miembro con:
    * Rol (select: owner/admin/member/viewer).
    * Proveedor propio (select de PROVIDERS o "Usa el global").
    * Modelo propio (select dependiente del provider).
    * Matriz de 5 permisos (toggles): Ejecutar agent, Editar archivos, Usar shell, Ver chats ajenos, Gestionar miembros.
    * Contraseña del miembro (input + botón Fijar/Cambiar).
    * Botón eliminar.
- Sidebar (`src/components/sidebar/Sidebar.tsx`):
  - Botón "Cambiar de miembro" (UserCircle icon) por proyecto.
  - Switcher desplegable: "Tú (dueño)" + lista de miembros con color, candado si tienen contraseña, punto azul si activos.
  - Cambiar a miembro con contraseña → modal de prompt. Verifica via `sqlite.verifyMemberPassword`.
  - Icono Lock en projects con password_hash.
  - Modal ProjectSettingsModal renderizado al final.
- Composer (`src/components/composer/Composer.tsx`):
  - Sobreescribe `providerId`/`modelId` globales con los del `activeMember` cuando existe.
  - Así cada miembro usa su propio proveedor+modelo en sus chats (no satura el modelo principal).
- Verificado: tsc --noEmit EXIT 0 ✓ · vite build exitoso en 5.46s ✓.

Stage Summary:
- Archivos modificados/creados:
  - src-tauri/src/db/mod.rs (esquema + structs + 10 comandos nuevos + hash_password helper)
  - src-tauri/src/lib.rs (registro en ambos invoke_handler blocks)
  - src/lib/tauri.ts (bindings TS)
  - src/store/weaver.ts (interfaces + estado + acciones)
  - src/components/projects/ProjectSettingsModal.tsx (NUEVO)
  - src/components/sidebar/Sidebar.tsx (switcher + prompt + integración modal)
  - src/components/composer/Composer.tsx (override provider+model del active member)
- Cómo usarlo:
  1. Click en el icono Users de un proyecto → modal de ajustes.
  2. Añade miembros (Ana, Carlos, etc.) con su rol.
  3. Para cada miembro, expande y configura: proveedor propio + modelo propio + permisos + contraseña opcional.
  4. Click en UserCircle al lado del proyecto → switcher. Elige "Tú" o un miembro. Si el miembro tiene contraseña, se pide.
  5. Cuando un miembro está activo, el Composer usa SU provider+model en lugar del global. Así cada quien paga su consumo.
- Limitaciones locales (por ser app desktop sin server):
  - La "sincronización entre máquinas" no es automática. Cada máquina tiene su SQLite.
  - El scope 'owner_only' / 'each_user' es una directriz que la UI respeta (no enforcement real más allá de la matriz de permisos local).
  - Las API keys por miembro todavía usan el keyring global del provider (no hay "member:<id>:openai" todavía). Para v2: extender apiKeyStore para soportar keys miembro-específicas.

---
Task ID: feat-member-api-keys-permission-gating
Agent: main
Task: (1) Implementar API keys miembro-específicas en el keyring del OS (member:<id>:<provider>), para que cada persona pague realmente su consumo. (2) Gate permissions: sólo el dueño o un admin pueden modificar miembros/permisos/scope/contraseñas. Un admin puede promover a otro miembro a admin.

Work Log:
- `src/providers/store.ts`:
  - Cambiado `cache` y `known` de Map<ProviderId> a Map<string> (para soportar keys compuestas `member:<id>:<provider>`).
  - Nuevo helper `memberKey(memberId, providerId)` → `member:<memberId>:<providerId>`.
  - Nuevas APIs:
    * `getForMember(memberId, providerId)` → busca la key propia; si no existe, cae a la global (fallback graceful para miembros sin key propia).
    * `setForMember(memberId, providerId, apiKey)` → guarda la key propia.
    * `deleteForMember(memberId, providerId)` → borra la key propia (no afecta a la global).
    * `hasForMember(memberId, providerId)` → check síncrono en caché.
    * `hasForMemberAsync(memberId, providerId)` → check real en OS keyring.
- `src/providers/index.ts`:
  - Nueva interfaz `CreateProviderOpts { apiKeyOverride?: string }`.
  - `createProvider(id, opts?)` acepta override. Si se pasa, se usa en lugar de `apiKeyStore.get(id)`.
- `src/components/composer/Composer.tsx`:
  - Import `apiKeyStore`.
  - En `pursueObjective`: si hay `activeMember`, obtener su API key vía `apiKeyStore.getForMember(activeMember.id, providerId)` y pasarla como `apiKeyOverride` a `createProvider`. Así el chat usa la key del miembro activo (o la global si el miembro no tiene propia).
- `src/store/weaver.ts`:
  - `regenerateLast`: respeta activeMember (provider + model + API key).
  - `autoTitle`: respeta activeMember (provider + model + API key).
  - Ambos usan `apiKeyStore.getForMember` para obtener la key correcta.
- `src/components/projects/ProjectSettingsModal.tsx` (reescrito, 622 líneas):
  - **Gating de permisos**: computa `canManage = activeMemberId === null || activeMember?.canManageMembers`. Todas las acciones de escritura (saveName, saveScope, saveProjectPassword, addMember, togglePerm, changeRole, changeProvider, changeModel, saveMemberPassword, removeMember, saveMemberApiKey, clearMemberApiKey) terminan early si `!canManage`.
  - **Banner amarillo** cuando `!canManage`: "Estás viendo como X, no tienes permiso para gestionar…"
  - **Inputs disabled + opacity-60** cuando `!canManage`.
  - **No se puede degradar/eliminar al owner** (m.role === 'owner' → alert).
  - **No puedes eliminarte a ti mismo** como admin (para evitar quedarte sin acceso).
  - **Sección "API key propia" por miembro**:
    * Input password + botones Fijar/Cambiar/Borrar.
    * Muestra placeholder contextual: "Propia: abcd…wxyz — escribir nueva…" / "Global: abcd…wxyz — escribir para fijar propia…" / "Sin key — escribe para fijar la propia…".
    * Hint debajo: explica el estado actual (tiene propia / cae a global / no hay ninguna).
    * Llama a `apiKeyStore.setForMember` / `deleteForMember`.
    * Refresca el estado mostrado tras guardar.
  - **Rol admin**: hint explícito "Los admins pueden gestionar miembros, invitar nuevos y promover a otros admins."
  - **TogglePerm "Gestionar miembros"**: disabled si el miembro es owner (el owner siempre puede, no se puede quitar).
  - Badge "(tú)" al lado del nombre del miembro activo.
- Verificado: tsc --noEmit EXIT 0 ✓ · vite build exitoso en 4.89s ✓.

Stage Summary:
- Archivos modificados:
  - src/providers/store.ts (nuevas APIs getForMember/setForMember/deleteForMember/hasForMember/hasForMemberAsync)
  - src/providers/index.ts (createProvider acepta apiKeyOverride)
  - src/components/composer/Composer.tsx (pasa apiKeyOverride del activeMember)
  - src/store/weaver.ts (regenerateLast y autoTitle respetan activeMember)
  - src/components/projects/ProjectSettingsModal.tsx (reescrito: gating de permisos + sección API key por miembro)
- Respuesta a la pregunta del usuario:
  - "¿Sólo el admin puede modificar permisos?" → Sí. El dueño (activeMemberId === null) y los admins (canManageMembers === true) son los únicos que pueden editar. Los demás ven todo en modo sólo lectura con banner amarillo.
  - "¿Un admin puede poner a otro como admin?" → Sí. Como el admin tiene canManageMembers, puede cambiar el rol de cualquier miembro (excepto el owner) a 'admin'. Y ese nuevo admin podrá a su vez gestionar miembros.
- Cómo se aislan las API keys:
  - En el OS keyring (Windows Credential Manager / macOS Keychain / Linux Secret Service), la entrada para la key global es `openai`, `anthropic`, etc.
  - La entrada para la key propia del miembro X es `member:<uuid-de-X>:openai`. Son entradas totalmente independientes en el keyring.
  - `getForMember` busca primero la propia; si no existe, cae a la global (así un miembro sin key propia puede seguir usando la del dueño si así se quiere).
