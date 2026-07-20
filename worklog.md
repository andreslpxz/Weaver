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
