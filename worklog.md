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

