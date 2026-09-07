/**
 * Servicio y Gestor de Telegram Bot para Weaver.
 *
 * Permite que Weaver se comunique directamente con Telegram mediante
 * Long Polling (`getUpdates`) y responda a comandos y mensajes.
 *
 * Funcionalidades:
 *   - `/start` o `/help`: Muestra bienvenida y lista de comandos.
 *   - `/models`: Lista los proveedores e IA configurados en la app.
 *   - `/new`: Abre una conversación nueva en Weaver con contexto limpio.
 *   - `/chat`: Lista las conversaciones o cambia a una por ID/número.
 *   - Mensajes normales: Envía el mensaje a Weaver, ejecuta el modelo de IA
 *     y responde al chat de Telegram mientras sincroniza el chat en Weaver.
 */

import { useWeaver, type Conversation } from '@/store/weaver';
import { PROVIDERS } from '@/providers/registry';
import { createProvider } from '@/providers';
import { apiKeyStore } from '@/providers/store';
import { streamChat } from '@/lib/chain';
import type { Message } from '@/providers/types';

export interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    from?: {
      id: number;
      is_bot: boolean;
      first_name: string;
      last_name?: string;
      username?: string;
    };
    chat: {
      id: number;
      type: string;
      title?: string;
      username?: string;
      first_name?: string;
      last_name?: string;
    };
    date: number;
    text?: string;
  };
}

export class TelegramBotManager {
  private isPolling = false;
  private abortController: AbortController | null = null;
  private lastUpdateId = 0;
  private botToken = '';
  private defaultChatId = '';

  /** Mapeo entre Telegram chat.id (o user.id) y conversationId activo de Weaver. */
  private sessionMap = new Map<number, string>();

  /** Devuelve si el bot está actualmente en ejecución. */
  public isRunning(): boolean {
    return this.isPolling;
  }

  /**
   * Obtiene la configuración actual de Telegram desde el store de Weaver.
   */
  public getConfig(): { enabled: boolean; botToken: string; chatId: string } {
    const { meIntegrations } = useWeaver.getState();
    const tgInt = meIntegrations.find((i) => i.id === 'telegram');
    if (!tgInt || !tgInt.enabled) {
      return { enabled: false, botToken: '', chatId: '' };
    }
    try {
      const cfg = JSON.parse(tgInt.config_json);
      return {
        enabled: true,
        botToken: (cfg.bot_token ?? '').trim(),
        chatId: (cfg.chat_id ?? '').trim(),
      };
    } catch {
      return { enabled: false, botToken: '', chatId: '' };
    }
  }

  /**
   * Revisa la configuración e inicia o detiene el polling en segundo plano.
   */
  public syncState(): void {
    const config = this.getConfig();
    if (config.enabled && config.botToken) {
      if (!this.isPolling || this.botToken !== config.botToken) {
        this.start(config.botToken, config.chatId);
      }
    } else {
      if (this.isPolling) {
        this.stop();
      }
    }
  }

  /**
   * Inicia el ciclo de polling del bot de Telegram.
   */
  public start(token: string, defaultChatId = ''): void {
    if (this.isPolling) {
      this.stop();
    }
    this.botToken = token;
    this.defaultChatId = defaultChatId;
    this.isPolling = true;
    this.abortController = new AbortController();

    // Arrancar el bucle de polling en background (non-blocking)
    void this.pollLoop(this.abortController.signal);
  }

  /**
   * Detiene el polling del bot.
   */
  public stop(): void {
    this.isPolling = false;
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }

  /**
   * Bucle de Long Polling para recibir mensajes de Telegram.
   */
  private async pollLoop(signal: AbortSignal): Promise<void> {
    while (this.isPolling && !signal.aborted) {
      try {
        const url = `https://api.telegram.org/bot${this.botToken}/getUpdates?offset=${
          this.lastUpdateId + 1
        }&timeout=20`;

        const response = await fetch(url, { signal });
        if (!response.ok) {
          // Esperar 5s antes de reintentar si Telegram da error (HTTP 4xx/5xx)
          await new Promise((r) => setTimeout(r, 5000));
          continue;
        }

        const data = (await response.json()) as { ok: boolean; result?: TelegramUpdate[] };
        if (data.ok && Array.isArray(data.result)) {
          for (const update of data.result) {
            this.lastUpdateId = Math.max(this.lastUpdateId, update.update_id);
            if (update.message && update.message.text) {
              // Procesar el mensaje sin bloquear el loop de updates
              void this.handleIncomingMessage(update.message);
            }
          }
        }
        // Ceder el hilo brevemente antes de la siguiente llamada de polling
        await new Promise((r) => setTimeout(r, 200));
      } catch (e: unknown) {
        if (signal.aborted) break;
        // Esperar brevemente ante errores de red
        await new Promise((r) => setTimeout(r, 3000));
      }
    }
  }

  /**
   * Procesa un mensaje entrante de Telegram.
   */
  public async handleIncomingMessage(msg: NonNullable<TelegramUpdate['message']>): Promise<void> {
    const chatId = msg.chat.id;
    const text = (msg.text ?? '').trim();
    if (!text) return;

    // Verificar si es un comando de barra (slash command)
    if (text.startsWith('/')) {
      const parts = text.split(/\s+/);
      const command = parts[0].toLowerCase().split('@')[0]; // Ignora el username del bot en /cmd@botname
      const args = parts.slice(1);

      switch (command) {
        case '/start':
        case '/help':
          await this.handleHelpCommand(chatId);
          return;
        case '/models':
          await this.handleModelsCommand(chatId);
          return;
        case '/new':
          await this.handleNewCommand(chatId);
          return;
        case '/chat':
          await this.handleChatCommand(chatId, args);
          return;
        default:
          await this.sendMessage(
            chatId,
            `❓ Comando no reconocido: \`${command}\`\n\nUsa /help para ver la lista de comandos disponibles.`,
          );
          return;
      }
    }

    // Mensaje normal: procesar con el LLM en la conversación de Weaver correspondiente
    await this.handleUserMessage(chatId, text);
  }

  /**
   * Maneja el comando /start o /help.
   */
  private async handleHelpCommand(chatId: number): Promise<void> {
    const helpText =
      `🤖 *¡Hola! Soy Weaver Bot.*\n\n` +
      `Puedes hablar conmigo directamente y responderé usando el modelo de IA configurado en la app.\n\n` +
      `*Comandos disponibles:*\n` +
      `• \`/new\` — Inicia una conversación nueva con memoria e historial limpios.\n` +
      `• \`/chat\` — Lista las conversaciones disponibles en Weaver.\n` +
      `• \`/chat <id_o_numero>\` — Cambia a un chat existente y recupera su contexto.\n` +
      `• \`/models\` — Muestra los proveedores y modelos de IA configurados.\n` +
      `• \`/help\` — Muestra este mensaje de ayuda.`;

    await this.sendMessage(chatId, helpText);
  }

  /**
   * Maneja el comando /models.
   */
  private async handleModelsCommand(chatId: number): Promise<void> {
    const weaver = useWeaver.getState();
    const activeProvider = weaver.providerId;
    const activeModel = weaver.modelId;

    let response = `🧠 *Modelos e IA en Weaver*\n\n`;
    response += `*Modelo Activo:* \`${activeProvider}\` → \`${activeModel}\`\n\n`;
    response += `*Proveedores Soportados (${PROVIDERS.length}):*\n`;

    for (const p of PROVIDERS.slice(0, 10)) {
      const isCurrent = p.id === activeProvider;
      response += `${isCurrent ? '⭐' : '•'} *${p.label}* (\`${p.id}\`): ${p.models.length} modelos\n`;
    }
    if (PROVIDERS.length > 10) {
      response += `• ... y ${PROVIDERS.length - 10} proveedores más.\n`;
    }

    response += `\nPuedes cambiar el modelo activo directamente desde la app Weaver.`;
    await this.sendMessage(chatId, response);
  }

  /**
   * Maneja el comando /new: Crea un nuevo chat en Weaver con memoria limpia.
   */
  private async handleNewCommand(chatId: number): Promise<void> {
    const weaver = useWeaver.getState();
    const newConvId = weaver.newConversation();

    // Mapear este chat de Telegram a la nueva conversación
    this.sessionMap.set(chatId, newConvId);

    const msg =
      `✨ *Nuevo chat iniciado en Weaver.*\n\n` +
      `Se ha creado una conversación limpia (ID: \`${newConvId.slice(0, 8)}\`). ` +
      `Envía tu primer mensaje para empezar.`;

    await this.sendMessage(chatId, msg);
  }

  /**
   * Maneja el comando /chat [id_o_numero].
   */
  private async handleChatCommand(chatId: number, args: string[]): Promise<void> {
    const weaver = useWeaver.getState();
    const conversations = weaver.conversations;

    if (conversations.length === 0) {
      await this.sendMessage(chatId, `❌ No hay conversaciones en Weaver. Usa /new para crear una.`);
      return;
    }

    const currentConvId = this.sessionMap.get(chatId) ?? weaver.activeConversationId;

    // Si no se proporcionó argumento, listar conversaciones
    if (args.length === 0) {
      let listMsg = `💬 *Conversaciones en Weaver (${conversations.length}):*\n\n`;
      conversations.forEach((c, idx) => {
        const num = idx + 1;
        const isActive = c.id === currentConvId;
        const icon = isActive ? '🔹' : '▫️';
        const shortId = c.id.slice(0, 8);
        listMsg += `${icon} *${num}.* ${c.title} \`[${shortId}]\`${isActive ? ' *(Activo)*' : ''}\n`;
      });

      listMsg += `\nPara cambiarte a un chat, envía:\n\`/chat <número>\` o \`/chat <id>\``;
      await this.sendMessage(chatId, listMsg);
      return;
    }

    // Argumento proporcionado: intentar seleccionar por índice o ID o título
    const targetArg = args.join(' ').trim().toLowerCase();
    let selected: Conversation | undefined;

    // Intento 1: número (índice 1-based)
    const numIdx = parseInt(targetArg, 10);
    if (!isNaN(numIdx) && numIdx >= 1 && numIdx <= conversations.length) {
      selected = conversations[numIdx - 1];
    }

    // Intento 2: coincidencia por ID (exacto o prefijo)
    if (!selected) {
      selected = conversations.find(
        (c) => c.id.toLowerCase() === targetArg || c.id.toLowerCase().startsWith(targetArg),
      );
    }

    // Intento 3: coincidencia por título
    if (!selected) {
      selected = conversations.find((c) => c.title.toLowerCase().includes(targetArg));
    }

    if (!selected) {
      await this.sendMessage(
        chatId,
        `❌ No se encontró ninguna conversación que coincida con "${targetArg}".\n\nUsa /chat para ver la lista.`,
      );
      return;
    }

    // Cambiar sesión
    this.sessionMap.set(chatId, selected.id);
    weaver.selectConversation(selected.id);

    const msg =
      `🔄 *Cambiado a la conversación:* "${selected.title}"\n` +
      `ID: \`${selected.id.slice(0, 8)}\` · Mensajes: ${selected.messages.length}\n\n` +
      `Contexto recuperado. ¡Puedes continuar conversando!`;

    await this.sendMessage(chatId, msg);
  }

  /**
   * Maneja un mensaje normal del usuario: envía a la conversación en Weaver,
   * ejecuta el LLM y envía la respuesta a Telegram.
   */
  private async handleUserMessage(chatId: number, text: string): Promise<void> {
    const weaver = useWeaver.getState();

    // Obtener la conversación vinculada a esta sesión de Telegram
    let convId = this.sessionMap.get(chatId);
    let conv = conversationsFind(convId);

    if (!conv) {
      // Si no hay conversación vinculada o ya no existe, usar la activa o crear una nueva
      if (weaver.activeConversationId && conversationsFind(weaver.activeConversationId)) {
        convId = weaver.activeConversationId;
      } else {
        convId = weaver.newConversation();
      }
      if (convId) {
        this.sessionMap.set(chatId, convId);
      }
    }

    if (!convId) return;

    // 1. Añadir el mensaje del usuario a la conversación de Weaver
    const userMsg: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content: text,
      ts: Date.now(),
    };
    weaver.appendMessage(userMsg, convId);

    // Indicador visual en Telegram
    await this.sendChatAction(chatId, 'typing');

    // 2. Preparar el LLM
    const { providerId, modelId, activeMemberId, members } = useWeaver.getState();
    const activeMember = members.find((m) => m.id === activeMemberId);
    const effProviderId = (activeMember?.providerId as typeof providerId | null) ?? providerId;
    const effModelId = activeMember?.modelId ?? modelId;

    try {
      const apiKey = await apiKeyStore.get(effProviderId);
      if (!apiKey) {
        const errorText = `⚠️ API key no configurada para el proveedor ${effProviderId}. Configúrala en la app Weaver.`;
        weaver.appendMessage({ id: crypto.randomUUID(), role: 'assistant', content: errorText, ts: Date.now() }, convId);
        await this.sendMessage(chatId, errorText);
        return;
      }

      const llm = await createProvider(effProviderId, { apiKeyOverride: apiKey });

      // Cargar historial de la conversación
      const currentConv = conversationsFind(convId);
      const history = (currentConv?.messages ?? []).slice(-20);

      const systemPrompt: Message = {
        role: 'system',
        content:
          `Tu nombre es Weaver. Estás respondiendo a través de un chat de Telegram. ` +
          `Sé amable, claro y conciso. Puedes usar formato Markdown (negrita, código, etc.).`,
      };

      const messagesForLlm: Message[] = [
        systemPrompt,
        ...history.map((m) => ({ role: m.role, content: m.content })),
      ];

      // Mensaje de respuesta del asistente inicial en Weaver
      const assistantMsgId = crypto.randomUUID();
      weaver.appendMessage({ id: assistantMsgId, role: 'assistant', content: '', ts: Date.now() }, convId);

      let fullAssistantText = '';

      // Transmitir respuesta
      const result = await streamChat(llm, effModelId, messagesForLlm, {
        onDelta: (delta) => {
          fullAssistantText += delta;
          weaver.updateLastAssistantMessage(delta, convId);
        },
      });

      const finalText = result.text || fullAssistantText;

      if (!finalText.trim()) {
        const fallback = '*(El modelo no generó una respuesta)*';
        weaver.setLastAssistantMessage(fallback, convId);
        await this.sendMessage(chatId, fallback);
        return;
      }

      // 3. Enviar respuesta final a Telegram
      await this.sendLongMessage(chatId, finalText);
    } catch (e: unknown) {
      const errMsg = `❌ Error procesando el mensaje: ${e instanceof Error ? e.message : String(e)}`;
      weaver.appendMessage({ id: crypto.randomUUID(), role: 'assistant', content: errMsg, ts: Date.now() }, convId);
      await this.sendMessage(chatId, errMsg);
    }
  }

  /**
   * Envía una acción de chat a Telegram (ej: "typing").
   */
  public async sendChatAction(chatId: number, action = 'typing'): Promise<void> {
    if (!this.botToken) return;
    try {
      await fetch(`https://api.telegram.org/bot${this.botToken}/sendChatAction`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, action }),
      });
    } catch {
      // ignore
    }
  }

  /**
   * Envía un mensaje a un chat de Telegram.
   * Maneja fallback si el parseo de Markdown falla.
   */
  public async sendMessage(chatId: number | string, text: string, parseMode: 'Markdown' | 'HTML' | null = 'Markdown'): Promise<boolean> {
    if (!this.botToken) return false;
    const url = `https://api.telegram.org/bot${this.botToken}/sendMessage`;

    try {
      const body: Record<string, unknown> = {
        chat_id: chatId,
        text,
      };
      if (parseMode) {
        body.parse_mode = parseMode;
      }

      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        // Si falló por formato de Markdown, reintentar en texto plano
        if (parseMode) {
          return await this.sendMessage(chatId, text, null);
        }
        return false;
      }

      return true;
    } catch {
      return false;
    }
  }

  /**
   * Envía mensajes largos dividiéndolos si superan el límite de Telegram (4000 caracteres).
   */
  public async sendLongMessage(chatId: number | string, text: string): Promise<void> {
    const MAX_LEN = 3800;
    if (text.length <= MAX_LEN) {
      await this.sendMessage(chatId, text);
      return;
    }

    // Dividir en trozos por párrafos/líneas
    let remaining = text;
    while (remaining.length > 0) {
      if (remaining.length <= MAX_LEN) {
        await this.sendMessage(chatId, remaining);
        break;
      }

      let chunk = remaining.slice(0, MAX_LEN);
      const lastLineBreak = chunk.lastIndexOf('\n');
      if (lastLineBreak > 1000) {
        chunk = chunk.slice(0, lastLineBreak);
      }

      await this.sendMessage(chatId, chunk);
      remaining = remaining.slice(chunk.length);
    }
  }
}

/** Helper para buscar una conversación en el store de Weaver. */
function conversationsFind(convId?: string | null): Conversation | undefined {
  if (!convId) return undefined;
  return useWeaver.getState().conversations.find((c) => c.id === convId);
}

/** Instancia singleton global del gestor de Telegram. */
export const telegramBot = new TelegramBotManager();
