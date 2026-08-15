/**
 * Parser de slash commands del Composer.
 *
 * Detecta comandos especiales en el input del usuario:
 *   /refine [auto]              → ejecuta auto-refinamiento RLM
 *   /refine status              → muestra estado del último refinamiento
 *   /refine revert              → revierte al snapshot anterior
 *   /rlm on                     → activa modo RLM para próximas ejecuciones
 *   /rlm off                    → desactiva modo RLM
 *   /rlm status                 → muestra estado RLM
 *   /ctx list                   → lista fragmentos del ContextStore activo
 *   /ctx clear                  → limpia el ContextStore activo
 *   /ctx get <key>              → muestra contenido de un fragmento
 *   /help                       → muestra ayuda
 *
 * Si el input no empieza con /, devuelve null (no es comando).
 */

export interface ParsedCommand {
  command: 'refine' | 'rlm' | 'ctx' | 'help' | 'unknown';
  subcommand?: string;
  args?: string[];
  raw: string;
}

/** Parsea un input de usuario. Devuelve null si no es slash command. */
export function parseSlashCommand(input: string): ParsedCommand | null {
  const trimmed = input.trim();
  if (!trimmed.startsWith('/')) return null;

  // Separar por whitespace, respetando comillas para args con espacios.
  const tokens = tokenize(trimmed.slice(1));
  if (tokens.length === 0) return null;

  const command = tokens[0].toLowerCase();
  const subcommand = tokens[1]?.toLowerCase();
  const args = tokens.slice(subcommand ? 2 : 1);

  switch (command) {
    case 'refine':
    case 'rlm':
    case 'ctx':
    case 'help':
      return { command: command as ParsedCommand['command'], subcommand, args, raw: trimmed };
    default:
      return { command: 'unknown', subcommand, args, raw: trimmed };
  }
}

/** Tokeniza respetando comillas simples y dobles. */
function tokenize(input: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let inQuote: '"' | "'" | null = null;

  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (inQuote) {
      if (c === inQuote) {
        inQuote = null;
      } else {
        current += c;
      }
    } else {
      if (c === '"' || c === "'") {
        inQuote = c;
      } else if (c === ' ' || c === '\t') {
        if (current) {
          tokens.push(current);
          current = '';
        }
      } else {
        current += c;
      }
    }
  }
  if (current) tokens.push(current);
  return tokens;
}

/** Genera mensaje de ayuda con todos los comandos disponibles. */
export function getHelpMessage(): string {
  return `## Comandos disponibles

**RLM (Recursive Language Model):**
- \`/rlm on\` — Activa modo RLM para próximas ejecuciones del agente
- \`/rlm off\` — Desactiva modo RLM (vuelve al executor legacy)
- \`/rlm status\` — Muestra si RLM está activo y la configuración de límites

**/refine — Auto-refinamiento:**
- \`/refine\` — Analiza el último episodio y propone cambios al scaffolding (no aplica)
- \`/refine auto\` — Analiza y aplica automáticamente los cambios propuestos
- \`/refine status\` — Muestra el estado del último refinamiento
- \`/refine revert\` — Revierte al snapshot anterior si el rendimiento decae

**/ctx — ContextStore (sólo en modo RLM activo):**
- \`/ctx list\` — Lista los fragmentos guardados en el ContextStore
- \`/ctx clear\` — Limpia todos los fragmentos
- \`/ctx get <key>\` — Muestra el contenido de un fragmento específico

**Otros:**
- \`/help\` — Muestra esta ayuda

**Tip:** El modo RLM trata el contexto como variable. El agente no lee archivos completos; en su lugar usa \`file_view_lines\`, \`file_view_structure\` o \`file_view_symbols\` para ver sólo lo necesario, y guarda fragmentos con \`ctx_set\` para reusarlos.`;
}

/** Valida que un comando tenga los argumentos correctos. */
export function validateCommand(parsed: ParsedCommand): { valid: boolean; error?: string } {
  switch (parsed.command) {
    case 'refine':
      if (parsed.subcommand && !['auto', 'status', 'revert', undefined].includes(parsed.subcommand)) {
        return { valid: false, error: `Subcomando /refine desconocido: "${parsed.subcommand}". Válidos: auto, status, revert.` };
      }
      return { valid: true };
    case 'rlm':
      if (parsed.subcommand && !['on', 'off', 'status'].includes(parsed.subcommand)) {
        return { valid: false, error: `Subcomando /rlm desconocido: "${parsed.subcommand}". Válidos: on, off, status.` };
      }
      return { valid: true };
    case 'ctx':
      if (!parsed.subcommand) {
        return { valid: false, error: '/ctx requiere un subcomando: list, clear, get.' };
      }
      if (!['list', 'clear', 'get'].includes(parsed.subcommand)) {
        return { valid: false, error: `Subcomando /ctx desconocido: "${parsed.subcommand}". Válidos: list, clear, get.` };
      }
      if (parsed.subcommand === 'get' && (!parsed.args || parsed.args.length === 0)) {
        return { valid: false, error: '/ctx get requiere un key.' };
      }
      return { valid: true };
    case 'help':
      return { valid: true };
    case 'unknown':
      return { valid: false, error: `Comando desconocido: /${parsed.raw.slice(1).split(/\s/)[0]}` };
  }
}
