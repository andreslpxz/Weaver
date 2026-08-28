import { useEffect, useRef, useState, useCallback } from 'react';
import {
  Plus,
  Mic,
  ArrowUp,
  Square,
  ChevronDown,
  UploadCloud,
  Paperclip,
  FileText,
  Image as ImageIcon,
  Folder,
  Link as LinkIcon,
  Globe,
  Brain,
  Target,
  Map,
  Puzzle,
  Monitor,
  Network,
  Workflow,
  X,
  Settings as SettingsIcon,
  BookMarked,
} from 'lucide-react';
import { useWeaver } from '@/store/weaver';
import { getProvider, PROVIDERS } from '@/providers/registry';
import { IconButton, Button } from '@/components/common/Button';
import { ModelPickerPopup } from '@/components/model-picker/ModelPickerPopup';
import { AttachmentChips } from '@/components/composer/AttachmentChips';
import { AppPicker, type PickedApp } from '@/components/composer/AppPicker';
import { createProvider } from '@/providers';
import { apiKeyStore } from '@/providers/store';
import { runAgent } from '@/agent/loop';
import { streamChat, streamUntilDone } from '@/lib/chain';
import {
  fileToAttachment,
  buildMessageWithAttachments,
  getFilesFromDrop,
} from '@/lib/attachments';
import { runtime, atspi } from '@/lib/tauri';
import type { Message, ImageContent } from '@/providers/types';
import type { Attachment } from '@/lib/attachments';
import { skillsRegistry } from '@/skills/registry';
import type { Skill } from '@/skills/registry';
import { mcpClient, type McpServer } from '@/mcp/client';
import { getPreset } from '@/mcp/presets';
import { useVoiceStore } from '@/store/voice';
import { BrainIcon } from '@/components/chat/MessageList';

const newMsgId = () =>
  typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `m-${Date.now()}-${Math.random().toString(36).slice(2)}`;

export function Composer() {
  const [value, setValue] = useState('');
  const [isRunning, setIsRunning] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [plusOpen, setPlusOpen] = useState(false);
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionQuery, setMentionQuery] = useState('');
  const [mentionIndex, setMentionIndex] = useState(0);
  const [mentionItems, setMentionItems] = useState<MentionItem[]>([]);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [mcpServers, setMcpServers] = useState<McpServer[]>([]);
  const [appPickerOpen, setAppPickerOpen] = useState(false);
  const [attachedApp, setAttachedApp] = useState<PickedApp | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragCounterRef = useRef(0);
  const plusBtnRef = useRef<HTMLButtonElement>(null);

  const {
    providerId: globalProviderId,
    modelId: globalModelId,
    setModelPickerOpen,
    modelPickerOpen,
    appendMessage: storeAppendMessage,
    updateLastAssistantMessage: storeUpdateLastAssistantMessage,
    updateLastAssistantReasoning: storeUpdateLastAssistantReasoning,
    setLastAssistantThinkingDuration: storeSetLastAssistantThinkingDuration,
    setLastAssistantMessage: storeSetLastAssistantMessage,
    setAgentState,
    handleAgentEvent,
    activeConversationId,
    newConversation,
    draftAttachments,
    addDraftAttachments,
    removeDraftAttachment,
    clearDraftAttachments,
    planMode,
    pursueObjective,
    cognitiveMode,
    chatMemoryMode,
    projectMemoryMode,
    setPlanMode,
    setPursueObjective,
    setCognitiveMode,
    setChatMemoryMode,
    setProjectMemoryMode,
    projects,
    setView,
    view,
    rlmEnabled,
    setRlmEnabled,
    addRlmSpawn,
    addRlmResult,
    setRlmFragments,
    clearRlmState,
  } = useWeaver();

  // Si hay un miembro activo con su propio provider+model, usarlo en lugar del global.
  // Esto es lo que permite "cada persona usa su propio modelo" dentro de un proyecto.
  const activeMemberId = useWeaver((s) => s.activeMemberId);
  const activeMember = useWeaver((s) =>
    s.members.find((m) => m.id === activeMemberId) ?? null,
  );
  const providerId = (activeMember?.providerId as typeof globalProviderId | null) ?? globalProviderId;
  const modelId = activeMember?.modelId ?? globalModelId;

  // Cargar skills para el menú @
  useEffect(() => {
    skillsRegistry.loadAll().then(setSkills).catch(() => setSkills([]));
  }, []);

  // Cargar servidores MCP instalados para el menú @
  useEffect(() => {
    const load = () => {
      try { setMcpServers(mcpClient.listServers()); } catch { setMcpServers([]); }
    };
    load();
    // Recargar en estos casos:
    // 1. Evento 'weaver:mcp-changed' (instalación/eliminación/toggle en Ajustes).
    // 2. Cuando el usuario vuelve a la vista 'chat' (por si instaló MCP estando
    //    en otra vista y el evento se disparó antes de que el Composer existiera).
    window.addEventListener('weaver:mcp-changed', load as EventListener);
    return () => window.removeEventListener('weaver:mcp-changed', load as EventListener);
  }, [view]);

  // Autosize textarea
  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = '0px';
    ta.style.height = Math.min(ta.scrollHeight, 200) + 'px';
  }, [value]);

  // Escuchar sugerencias de la UI
  useEffect(() => {
    const handler = (e: Event) => {
      const text = (e as CustomEvent<string>).detail;
      setValue(text);
      taRef.current?.focus();
    };
    window.addEventListener('weaver:set-composer', handler as EventListener);
    return () => window.removeEventListener('weaver:set-composer', handler as EventListener);
  }, []);

  // Cerrar popup + al hacer click fuera
  useEffect(() => {
    if (!plusOpen) return;
    const handler = (e: MouseEvent) => {
      if (plusBtnRef.current && !plusBtnRef.current.contains(e.target as Node)) {
        // Verificar también si el click fue dentro del popup
        const popup = document.getElementById('plus-popup');
        if (popup && popup.contains(e.target as Node)) return;
        setPlusOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [plusOpen]);

  const provider = getProvider(providerId);
  const modelLabel = provider?.models.find((m) => m.id === modelId)?.label ?? modelId;

  // --- Detección de @ en el texto -------------------------------------------
  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    const cursor = ta.selectionStart;
    const before = value.slice(0, cursor);
    const atMatch = before.match(/(?:^|\s)@([\w\-/]*)$/);
    if (atMatch) {
      setMentionOpen(true);
      setMentionQuery(atMatch[1]);
      setMentionIndex(0);
      const q = atMatch[1].toLowerCase();
      const items: MentionItem[] = [];
      // Skills
      let skillsAdded = 0;
      for (const s of skills) {
        if (!q || s.name.toLowerCase().includes(q)) {
          items.push({
            type: 'skill',
            label: s.name,
            desc: s.description,
            icon: 'brain',
            insert: `@skill:${s.name}`,
          });
          skillsAdded++;
        }
      }
      // Pista si no hay skills instaladas y el usuario está buscando skills
      if (skillsAdded === 0 && (!q || 'skill'.includes(q) || 'habilidad'.includes(q) || 'habilidades'.includes(q))) {
        items.push({
          type: 'hint',
          label: skills.length === 0 ? 'No hay skills instaladas' : 'Ninguna skill coincide',
          desc: skills.length === 0
            ? 'Abre Habilidades para instalar o crear una skill'
            : `Tienes ${skills.length} skill(s) — prueba con otro término`,
          icon: 'settings',
          insert: '',
          action: () => setView('habilidades'),
        });
      }
      // Proyectos
      for (const p of projects) {
        if (!q || p.name.toLowerCase().includes(q)) {
          items.push({
            type: 'project',
            label: p.name,
            desc: `Proyecto · ${p.id.slice(0, 8)}`,
            icon: 'file',
            insert: `@project:${p.name}`,
          });
        }
      }
      // Proveedores
      for (const p of PROVIDERS) {
        if (!q || p.label.toLowerCase().includes(q) || p.id.includes(q)) {
          items.push({
            type: 'provider',
            label: p.label,
            desc: p.desc,
            icon: 'globe',
            insert: `@provider:${p.id}`,
          });
        }
      }
      // Servidores MCP instalados
      let mcpAdded = 0;
      for (const s of mcpServers) {
        if (!s.enabled) continue;
        if (!q || s.name.toLowerCase().includes(q)) {
          const preset = s.presetId ? getPreset(s.presetId) : undefined;
          items.push({
            type: 'mcp',
            label: s.name,
            desc: `MCP · ${preset ? preset.description : (s.command ?? s.url ?? 'servidor')}${s.status === 'error' ? ' · ERROR' : s.status === 'running' ? ' · activo' : ''}`,
            icon: 'puzzle',
            insert: `@mcp:${s.name}`,
          });
          mcpAdded++;
        }
      }
      // Pista si no hay servidores MCP instalados/activos y el usuario busca MCP
      if (mcpAdded === 0 && (!q || 'mcp'.includes(q))) {
        const enabledCount = mcpServers.filter((s) => s.enabled).length;
        items.push({
          type: 'hint',
          label: mcpServers.length === 0
            ? 'No hay servidores MCP instalados'
            : enabledCount === 0
              ? 'No hay servidores MCP activos'
              : 'Ningún servidor MCP coincide',
          desc: mcpServers.length === 0
            ? 'Abre Ajustes → MCP para instalar Figma, Notion, etc.'
            : enabledCount === 0
              ? 'Activa al menos uno en Ajustes → MCP'
              : 'Prueba con otro término',
          icon: 'settings',
          insert: '',
          action: () => setView('configuracion'),
        });
      }
      // Adjuntos recientes
      for (const a of draftAttachments) {
        if (!q || a.name.toLowerCase().includes(q)) {
          items.push({
            type: 'file',
            label: a.name,
            desc: `${a.kind} · ${a.size} B`,
            icon: a.kind === 'image' ? 'image' : 'file',
            insert: `@file:${a.name}`,
          });
        }
      }
      // Comandos rápidos
      if (!q || 'web'.includes(q)) {
        items.push({ type: 'command', label: 'Buscar en internet', desc: 'web_search (Tavily)', icon: 'globe', insert: 'busca en internet ' });
      }
      if (!q || 'shell'.includes(q) || 'terminal'.includes(q)) {
        items.push({ type: 'command', label: 'Ejecutar comando shell', desc: 'shell_exec (Tauri)', icon: 'file', insert: 'ejecuta en la terminal: ' });
      }
      if (!q || 'plan'.includes(q)) {
        items.push({ type: 'command', label: 'Modo plan', desc: 'Proponer plan antes de ejecutar', icon: 'brain', insert: 'planea esto paso a paso: ' });
      }
      setMentionItems(items.slice(0, 12));
    } else {
      setMentionOpen(false);
    }
  }, [value, skills, draftAttachments, projects, mcpServers]);

  const addFiles = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;
      setAttachmentError(null);
      const newAtts: Attachment[] = [];
      const errors: string[] = [];
      for (const f of files) {
        try {
          const att = await fileToAttachment(f);
          newAtts.push(att);
        } catch (e) {
          errors.push(e instanceof Error ? e.message : String(e));
        }
      }
      if (newAtts.length > 0) addDraftAttachments(newAtts);
      if (errors.length > 0) setAttachmentError(errors.join('\n'));
    },
    [addDraftAttachments],
  );

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    addFiles(files);
    e.target.value = '';
    setPlusOpen(false);
  };

  // --- Drag & Drop ----------------------------------------------------------
  const onDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer?.types?.includes('Files')) {
      dragCounterRef.current += 1;
      setIsDragOver(true);
    }
  };
  const onDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current = Math.max(0, dragCounterRef.current - 1);
    if (dragCounterRef.current === 0) setIsDragOver(false);
  };
  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
  };
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current = 0;
    setIsDragOver(false);
    const files = getFilesFromDrop(e);
    addFiles(files);
  };

  // --- Envío ---------------------------------------------------------------
  /**
   * Maneja slash commands del Composer.
   * Devuelve true si el input era un comando y fue procesado (no se debe
   * enviar como mensaje normal). Devuelve false si no es comando.
   */
  async function maybeHandleSlashCommand(input: string): Promise<boolean> {
    const trimmed = input.trim();
    if (!trimmed.startsWith('/')) return false;

    const { parseSlashCommand, validateCommand, getHelpMessage, runRefineCommand } = await import('@/agent/rlm');
    const parsed = parseSlashCommand(trimmed);
    if (!parsed) return false;

    const validation = validateCommand(parsed);
    if (!validation.valid) {
      storeAppendMessage({
        id: newMsgId(),
        ts: Date.now(),
        role: 'assistant',
        content: `⚠ ${validation.error}\n\nUsa \`/help\` para ver los comandos disponibles.`,
      });
      return true;
    }

    if (parsed.command === 'help') {
      storeAppendMessage({
        id: newMsgId(),
        ts: Date.now(),
        role: 'assistant',
        content: getHelpMessage(),
      });
      return true;
    }

    if (parsed.command === 'rlm') {
      const sub = parsed.subcommand;
      if (sub === 'on') {
        setRlmEnabled(true);
        storeAppendMessage({
          id: newMsgId(),
          ts: Date.now(),
          role: 'assistant',
          content: '✓ Modo RLM activado. Las próximas ejecuciones del agente usarán ContextStore + recursión de subagentes.',
        });
      } else if (sub === 'off') {
        setRlmEnabled(false);
        storeAppendMessage({
          id: newMsgId(),
          ts: Date.now(),
          role: 'assistant',
          content: '✓ Modo RLM desactivado. Volviendo al executor legacy.',
        });
      } else if (sub === 'status') {
        storeAppendMessage({
          id: newMsgId(),
          ts: Date.now(),
          role: 'assistant',
          content: `Modo RLM: **${rlmEnabled ? 'activado' : 'desactivado'}**\n\nLímites:\n- Max depth: 3\n- Max children: 50\n- Max concurrent: 5\n- Max time: 10 min\n\nUsa \`/rlm on\` o \`/rlm off\` para cambiar.`,
        });
      } else {
        storeAppendMessage({
          id: newMsgId(),
          ts: Date.now(),
          role: 'assistant',
          content: 'Uso: `/rlm on`, `/rlm off`, `/rlm status`.',
        });
      }
      return true;
    }

    if (parsed.command === 'refine') {
      const sub = parsed.subcommand;
      const autoApply = sub === 'auto';
      try {
        const llm = await createProvider(providerId);
        const { memory } = await import('@/agent/memory');
        const episodes = await memory.listEpisodes();
        if (episodes.length === 0) {
          storeAppendMessage({
            id: newMsgId(),
            ts: Date.now(),
            role: 'assistant',
            content: 'No hay episodios recientes para refinar. Ejecuta una tarea primero.',
          });
          return true;
        }
        storeAppendMessage({
          id: newMsgId(),
          ts: Date.now(),
          role: 'assistant',
          content: `⏳ Analizando ${episodes.length} episodio(s) para refinamiento...`,
        });
        const result = await runRefineCommand(llm, modelId, episodes, autoApply);
        storeAppendMessage({
          id: newMsgId(),
          ts: Date.now(),
          role: 'assistant',
          content: result.message,
        });
        // Emitir evento para que RlmPanel actualice.
        if (result.actionsCount > 0) {
          window.dispatchEvent(new CustomEvent('weaver:rlm-refine', {
            detail: { summary: result.message, applied: result.applied, actionsCount: result.actionsCount },
          }));
        }
      } catch (e) {
        storeAppendMessage({
          id: newMsgId(),
          ts: Date.now(),
          role: 'assistant',
          content: `❌ Error en /refine: ${e instanceof Error ? e.message : String(e)}`,
        });
      }
      return true;
    }

    if (parsed.command === 'ctx') {
      const sub = parsed.subcommand;
      // El ContextStore está en el loop del agente; para acceso desde aquí
      // usamos un evento global que el loop escucha.
      if (sub === 'list') {
        window.dispatchEvent(new CustomEvent('weaver:rlm-context-list-request'));
        storeAppendMessage({
          id: newMsgId(),
          ts: Date.now(),
          role: 'assistant',
          content: 'Consulta el panel RLM para ver los fragmentos actuales.',
        });
      } else if (sub === 'clear') {
        window.dispatchEvent(new CustomEvent('weaver:rlm-context-clear'));
        setRlmFragments([], 0);
        storeAppendMessage({
          id: newMsgId(),
          ts: Date.now(),
          role: 'assistant',
          content: '✓ ContextStore limpiado.',
        });
      } else if (sub === 'get') {
        const key = parsed.args?.[0];
        if (!key) {
          storeAppendMessage({
            id: newMsgId(),
            ts: Date.now(),
            role: 'assistant',
            content: 'Uso: `/ctx get <key>`.',
          });
        } else {
          storeAppendMessage({
            id: newMsgId(),
            ts: Date.now(),
            role: 'assistant',
            content: `Para ver el contenido de "${key}", abre el panel RLM y expande el fragmento.`,
          });
        }
      }
      return true;
    }

    return false;
  }

  async function handleSend() {
    if ((!value.trim() && draftAttachments.length === 0) || isRunning) return;

    // Detectar slash commands ANTES de procesar como mensaje normal.
    const slashResult = await maybeHandleSlashCommand(value);
    if (slashResult) {
      setValue('');
      return;
    }

    let convId = activeConversationId;
    if (!convId) convId = newConversation();

    const built = buildMessageWithAttachments(value, draftAttachments);
    const images: ImageContent[] = draftAttachments
      .filter((a) => a.kind === 'image' && a.content)
      .map((a) => ({
        dataUrl: a.content!,
        mime: a.mime.startsWith('image/') ? a.mime : 'image/png',
        name: a.name,
      }));

    const userMsg: Message = {
      id: newMsgId(),
      ts: Date.now(),
      role: 'user',
      content: built.toUI,
      attachments: draftAttachments.map((a) => ({
        id: a.id,
        name: a.name,
        kind: a.kind,
        size: a.size,
        mime: a.mime,
        truncated: a.truncated,
      })),
      images: images.length > 0 ? images : undefined,
    };
    storeAppendMessage(userMsg, convId);

    // Construir prompt del usuario — texto puro del usuario, sin inyectar
    // directrices de modo aquí. Las directrices de comportamiento (planMode,
    // pursueObjective, cognitiveMode) van en el SYSTEM PROMPT, no prependedas
    // al mensaje del usuario. Si las prependeamos, el LLM las ve como una
    // instrucción nueva del usuario en CADA turno y las confirma con
    // "Entendido, he registrado esta directriz..." cada vez.
    const objectiveText = built.toLLM;

    // Detectar menciones @mcp:<name> en el texto para cargar tools MCP específicas.
    const mcpMentionRegex = /@mcp:([\w\- ]+)/g;
    const mcpMentionedNames: string[] = [];
    let mcpMatch: RegExpExecArray | null;
    while ((mcpMatch = mcpMentionRegex.exec(objectiveText)) !== null) {
      const name = mcpMatch[1].trim();
      if (name && !mcpMentionedNames.includes(name)) mcpMentionedNames.push(name);
    }

    // Detectar menciones @skill:<name> en el texto para inyectar el cuerpo de
    // la skill en el system prompt. A diferencia de MCP (que carga tools), las
    // skills son GUÍAS de procedimiento que el LLM debe seguir.
    const skillMentionRegex = /@skill:([\w\- ]+)/g;
    const skillMentionedNames: string[] = [];
    let skillMatch: RegExpExecArray | null;
    while ((skillMatch = skillMentionRegex.exec(objectiveText)) !== null) {
      const name = skillMatch[1].trim();
      if (name && !skillMentionedNames.includes(name)) skillMentionedNames.push(name);
    }

    setValue('');
    clearDraftAttachments();
    setIsRunning(true);
    setAgentState('planning');

    const ac = new AbortController();
    abortRef.current = ac;

    // Mantiene la app "despierta" mientras el agente trabaja, para que el
    // streaming no se ralentice si el usuario minimiza la ventana o cambia
    // de app (ver src/lib/wakeLock.ts). Best-effort — si el SO/WebView no
    // lo soporta, simplemente no hace nada.
    const { acquireAgentWakeLock, releaseAgentWakeLock } = await import('@/lib/wakeLock');
    await acquireAgentWakeLock();

    try {
      // Si hay un miembro activo, usar su API key específica (o fallback a la global).
      const apiKeyOverride = activeMember
        ? await apiKeyStore.getForMember(activeMember.id, providerId)
        : undefined;
      const llm = await createProvider(providerId, { apiKeyOverride });

      // Detección de tipo de tarea:
      // 1. desktopAgentive: tareas que requieren operar apps de escritorio
      //    vía AT-SPI (abrir gedit, escribir en una ventana, clickear botones).
      //    → Usa runAgent (bucle planner → executor → critic con tools AT-SPI).
      //
      // 2. Cualquier otra cosa (búsqueda web, ejecutar comandos shell, leer
      //    archivos, preguntas generales) → Usa runChatWithTools que tiene
      //    web_search, shell_exec, file_read, etc.
      const desktopAgentive = /\b(abre|abrir|escribe en|escribir en|copia|copiar|pega|pegar|transfiere|transferir|envía|enviar|completa|completar|rellena|rellenar|click|clic|presiona|pulsa)\b/i.test(
        objectiveText,
      );

      if (desktopAgentive && runtime.isTauri) {
        // Nota: NO hacemos appendMessage vacío aquí — handleAgentEvent
        // ya agrega sus propios mensajes (planificando, plan, episodio, etc.).
        // Un append vacío dejaría un mensaje fantasma al inicio del chat.
        for await (const _event of runAgent(llm, modelId, objectiveText, {
          signal: ac.signal,
          // Fija convId explícito por la misma razón que en runChatWithTools
          // (ver comentario ahí): sin esto, los mensajes de progreso del
          // agente (planificando, plan, episodio) aterrizan en la
          // conversación que esté activa al momento de cada evento, no en
          // la que arrancó la tarea.
          onEvent: (event) => handleAgentEvent(event, convId),
          useRlm: rlmEnabled,
        })) {
          // Manejar eventos RLM específicos para actualizar el store.
          if (_event.type === 'rlm_spawn') {
            addRlmSpawn(_event.info);
          } else if (_event.type === 'rlm_context_updated') {
            setRlmFragments(_event.fragments, _event.totalSize);
          }
        }
      } else {
        // Chat con tools: SIEMPRE pasamos tools al LLM para que sepa que
        // tiene capacidades de agente de escritorio, incluso si la pregunta
        // no es directamente agentiva. Así puede responder "sí, puedo
        // ejecutar comandos" en lugar de "no puedo".
        await runChatWithTools(llm, objectiveText, images, ac.signal, convId, mcpMentionedNames, skillMentionedNames);
      }
    } catch (e) {
      storeAppendMessage({
        role: 'assistant',
        content: `❌ Error: ${e instanceof Error ? e.message : String(e)}`,
      }, convId);
      setAgentState('error');
    } finally {
      setIsRunning(false);
      abortRef.current = null;
      setAgentState('idle');
      await releaseAgentWakeLock();
    }
  }

  /**
   * Detecta si una respuesta del LLM niega tener información cuando sabemos
   * que la tool previa devolvió datos. Busca frases como "no se encontró
   * información", "no tengo datos", "no existe documentación", "no hay
   * registros", "sin resultados". Solo dispara si la frase aparece en los
   * primeros 400 caracteres de la respuesta (donde el LLM suele declarar
   * la "no existencia" antes de inventar contexto).
   *
   * IMPORTANTE: esta función es intencionalmente CONSERVADORA. Solo detecta
   * negaciones explícitas, no afirmaciones vagas. Falsos positivos arruinarían
   * el chat — mejor pecar de cauto.
   */
  function responseDeniesToolData(text: string): boolean {
    if (!text || text.trim().length === 0) return false;
    // Solo mirar el inicio de la respuesta (donde el LLM declara "no encontré").
    const head = text.slice(0, 600).toLowerCase();
    // Patrones de negación explícita. Cuidado con las tildes y variantes.
    const denyPatterns = [
      /no se (ha )?(encontrado|hallado|localizado) (informaci[oó]n|datos|resultados|documentaci[oó]n|registros)/,
      /no (he )?(encontrado|hallado|podido encontrar|pude encontrar) (informaci[oó]n|datos|resultados|documentaci[oó]n|registros|nada)/,
      /no (tengo|poseo|existe|hay|se conoce|se tiene) (informaci[oó]n|datos|documentaci[oó]n|registros|nada)/,
      /no aparece asociado/,
      /no hay (informaci[oó]n|datos|resultados|documentaci[oó]n|registros) (p[uú]blica|oficial|disponible)/,
      /sin resultados/,
      /0 resultados encontrados/,
      /no se ha podido localizar/,
      /no se ha publicado nada/,
      /no existe (una versi[oó]n|un modelo|un producto|un lanzamiento)/,
      /no consta en los registros/,
    ];
    return denyPatterns.some((p) => p.test(head));
  }

  async function runChatWithTools(
    llm: import('@/providers/types').LLMProvider,
    userText: string,
    images: ImageContent[],
    signal: AbortSignal,
    conversationId: string,
    mcpMentionedNames: string[] = [],
    skillMentionedNames: string[] = [],
  ) {
    const { buildAdvancedToolsList, dispatchAdvancedTool } = await import('@/lib/tools');
    const { streamChat } = await import('@/lib/chain');
    const { parseTextToolCalls, maybeHasTextToolCall } = await import('@/lib/textToolParser');

    // ------------------------------------------------------------------------
    // FIX crítico: appendMessage/updateLastAssistantMessage/setLastAssistantMessage
    // del store escriben por defecto en la conversación ACTIVA en ese instante.
    // Si el usuario navega a otro chat (o crea uno nuevo) mientras esta tarea
    // sigue generando en segundo plano, los deltas de texto se mezclaban con
    // la conversación que quedara abierta — dos respuestas entrelazadas en un
    // mismo mensaje, o una respuesta completa "apareciendo" en el chat
    // equivocado. Los wrappers de abajo fijan SIEMPRE `conversationId` (el
    // chat donde arrancó ESTA tarea), sin importar a dónde navegue el usuario
    // después. Todo el resto de esta función usa estos wrappers en vez de las
    // funciones del store directamente.
    // ------------------------------------------------------------------------
    const appendMessage = (msg: Message) => storeAppendMessage(msg, conversationId);
    const updateLastAssistantMessage = (delta: string) =>
      storeUpdateLastAssistantMessage(delta, conversationId);
    const updateLastAssistantReasoning = (delta: string) =>
      storeUpdateLastAssistantReasoning(delta, conversationId);
    const setLastAssistantThinkingDuration = (seconds: number) =>
      storeSetLastAssistantThinkingDuration(seconds, conversationId);
    const setLastAssistantMessage = (content: string) =>
      storeSetLastAssistantMessage(content, conversationId);

    appendMessage({ role: 'assistant', content: '', id: newMsgId(), ts: Date.now() });

    // --- Cargar memoria semántica del agente para inyectar en el contexto ---
    // Esto permite que el agente "recuerde" al usuario y proyectos pasados.
    // Si la memoria está vacía, no se añade nada (se indica en el system prompt).
    let memoryContext = '';
    try {
      const { memory } = await import('@/agent/memory');
      const facts = await memory.listFacts();
      if (facts.length > 0) {
        // Limitar a los 30 hechos más recientes para no inflar el prompt.
        const recent = facts.slice(-30);
        memoryContext = recent
          .map((f) => `- ${f.key}: ${f.value}`)
          .join('\n');
      }
    } catch (e) {
      console.warn('[Chat] No se pudo cargar memoria para contexto:', e);
    }
    const chatMemoryMode = useWeaver.getState().chatMemoryMode;

    // --- Cargar memoria de PROYECTO (scoped a este chat) para inyectar ---
    // Bitácora de trabajo de esta conversación: qué se hizo, qué falta,
    // decisiones tomadas. No cruza a otros chats (a diferencia de memoryContext
    // arriba, que es memoria semántica global sobre el usuario).
    let projectMemoryContext = '';
    try {
      const { memory } = await import('@/agent/memory');
      const convId = useWeaver.getState().activeConversationId;
      if (convId) {
        const projectFacts = await memory.listProjectFacts(convId);
        if (projectFacts.length > 0) {
          projectMemoryContext = projectFacts.map((f) => `- ${f.key}: ${f.value}`).join('\n');
        }
      }
    } catch (e) {
      console.warn('[Chat] No se pudo cargar memoria de proyecto:', e);
    }
    const projectMemoryMode = useWeaver.getState().projectMemoryMode;

    // Detectar OS para que el LLM use comandos correctos (dir vs ls, etc.)
    const isWindows = typeof navigator !== 'undefined' && navigator.platform.toLowerCase().includes('win');
    const osName = isWindows ? 'Windows' : runtime.isTauri ? 'Linux/macOS' : 'navegador';
    const shellHint = isWindows
      ? 'El shell es PowerShell/CMD en Windows. Usa "dir" (no "ls"), "type" (no "cat"), rutas con "C:\\Users\\" (no "/home/"). La variable de entorno es %USERNAME% (no $USER).'
      : 'El shell es bash en Linux. Usa "ls", "cat", rutas con "/home/".';

    // ── Cargar tools MCP de los servidores MENCIONADOS con @mcp:<name> ──
    // Las tools MCP se nombran con prefijo mcp__<serverId>__<toolName> para
    // evitar colisiones con las tools nativas (shell_exec, web_search, etc.).
    // El dispatcher en lib/tools.ts las rutea a mcpClient.callTool.
    //
    // NOTA: sólo cargamos los MCPs explícitamente mencionados. Esto evita
    // lanzar subprocesos stdio innecesariamente en cada mensaje (los
    // servidores MCP se arrancan bajo demanda al hacer listTools en Rust).
    let mcpExtraTools: { type: 'function'; function: { name: string; description: string; parameters: Record<string, unknown> } }[] = [];
    let mcpServersInfo = '';
    let mcpUnavailableHint = '';
    if (mcpMentionedNames.length > 0) {
      if (!runtime.isTauri) {
        mcpUnavailableHint =
          '\n\n═══ MCP NO DISPONIBLE EN MODO NAVEGADOR ═══\n' +
          'El usuario mencionó @mcp: pero MCP sólo funciona en el backend de Tauri.\n' +
          'Informale que debe ejecutar Weaver con `npm run tauri:dev` o la app de escritorio\n' +
          'instalada para usar los servidores MCP. En modo navegador las tools MCP\n' +
          'NO están disponibles. Continúa usando las tools nativas (shell_exec, web_search, etc.).';
      } else {
        try {
          const { mcpClient } = await import('@/mcp/client');
          const allServers = mcpClient.listServers().filter((s) => s.enabled);
          const targetServers = allServers.filter((s) =>
            mcpMentionedNames.some((n) => n.toLowerCase() === s.name.toLowerCase()),
          );
          if (targetServers.length === 0) {
            mcpUnavailableHint =
              '\n\n═══ MCP MENCIONADO NO ENCONTRADO ═══\n' +
              `El usuario mencionó @mcp: pero no hay servidores MCP habilitados con ese nombre. ` +
              `Servidores disponibles: ${allServers.map((s) => s.name).join(', ') || 'ninguno'}. ` +
              `Pídele al usuario que instale el servidor MCP en Ajustes > Servidores MCP.`;
          } else {
            const allMcpTools = await mcpClient.listTools();
            mcpExtraTools = targetServers.flatMap((srv) => {
              const serverTools = allMcpTools.filter((t) => t.serverId === srv.id);
              const approved = serverTools.filter(
                (t) => mcpClient.isToolApproved(srv.id, t.name) && !mcpClient.isToolDenied(srv.id, t.name),
              );
              return approved.map((t) => ({
                type: 'function' as const,
                function: {
                  name: `mcp__${srv.id}__${t.name}`,
                  description: `[MCP:${srv.name}] ${t.description}`,
                  parameters:
                    t.inputSchema && typeof t.inputSchema === 'object' && 'properties' in t.inputSchema
                      ? t.inputSchema
                      : { type: 'object' as const, properties: {}, additionalProperties: true },
                },
              }));
            });
            const totalAvailable = targetServers.reduce(
              (acc, s) => acc + allMcpTools.filter((t) => t.serverId === s.id).length,
              0,
            );
            if (mcpExtraTools.length === 0 && totalAvailable > 0) {
              mcpUnavailableHint =
                '\n\n═══ MCP SIN TOOLS APROBADAS ═══\n' +
                `Hay tools MCP disponibles en ${targetServers.map((s) => s.name).join(', ')} ` +
                `pero ninguna está aprobada. Pídele al usuario que apruebe las tools en ` +
                `Ajustes > Servidores MCP > ${targetServers[0]?.name} > Tools.`;
            } else if (mcpExtraTools.length === 0) {
              mcpUnavailableHint =
                '\n\n═══ MCP SIN TOOLS ═══\n' +
                `El servidor MCP mencionado no expuso ninguna tool. Posibles causas:\n` +
                `- El servidor no está corriendo correctamente\n` +
                `- La API key del servidor es inválida\n` +
                `Sugiérele al usuario verificar la configuración en Ajustes > Servidores MCP.`;
            } else {
              mcpServersInfo =
                '\n\n═══ SERVIDORES MCP ACTIVOS PARA ESTE MENSAJE ═══\n' +
                `El usuario mencionó @mcp: lo que activa las siguientes tools MCP. ` +
                `Úsalas cuando sean relevantes para la petición del usuario.\n` +
                targetServers
                  .map((s) => {
                    const all = allMcpTools.filter((t) => t.serverId === s.id);
                    const appr = all.filter((t) => mcpClient.isToolApproved(s.id, t.name) && !mcpClient.isToolDenied(s.id, t.name));
                    return `- ${s.name}: ${appr.length}/${all.length} tools aprobadas — ` +
                      appr.map((t) => `mcp__${s.id}__${t.name}`).join(', ');
                  })
                  .join('\n');
            }
          }
        } catch (e) {
          console.warn('[MCP] No se pudieron cargar tools MCP:', e);
          mcpUnavailableHint =
            '\n\n═══ ERROR AL CARGAR MCP ═══\n' +
            `No se pudieron cargar las tools MCP: ${e instanceof Error ? e.message : String(e)}.\n` +
            `Informale al usuario y continúa con las tools nativas.`;
        }
      }
    }

    // ═══ Cargar catálogo de subagentes para disclosure en el system prompt ═══
    // Esto le dice al LLM qué subagentes tiene disponibles para delegar con
    // delegate_to_subagent. Sin esto, el LLM no sabría que tiene subagentes.
    let subagentsContext = '';
    try {
      const { subagentRegistry } = await import('@/agent/subagent');
      const subs = subagentRegistry.list();
      if (subs.length > 0) {
        subagentsContext =
          '\n\n═══ SUBAGENTES DISPONIBLES ═══\n' +
          'Tienes un equipo de subagentes especializados. Usa delegate_to_subagent para delegar\n' +
          'subtareas a un subagente. Cada subagente tiene sus propias tools (restringidas), su propio\n' +
          'system prompt y su propio presupuesto. Devuelve el resultado estructurado con evidencia.\n\n' +
          'Úsalos cuando:\n' +
          '- La tarea tiene un componente aislable (ej: "investiga X en internet", "lee estos 5 archivos").\n' +
          '- Quieres que un especialista haga una parte (Web Researcher, File Reader, etc.).\n' +
          '- Necesitas aislamiento de errores (si el subagente falla, no te afecta a ti).\n\n' +
          'Catálogo:\n' +
          subs.map((s) =>
            `- ${s.name}: ${s.description} (tools: ${s.allowedTools.join(', ') || 'ninguna'})`,
          ).join('\n') +
          '\n\nPara delegar: delegate_to_subagent(objective="...", subagent_name="<nombre exacto>", context="...")\n' +
          'Si omites subagent_name, se selecciona automáticamente por keyword match.\n';
      }
    } catch (e) {
      console.warn('[Subagents] No se pudo cargar el catálogo:', e);
    }

    // ═══ Cargar bodies de skills mencionadas con @skill:<name> ═══
    // A diferencia de MCP (que carga tools dinámicamente), las skills son GUÍAS
    // de procedimiento — texto que se inyecta en el system prompt para que el
    // LLM sepa cómo proceder. Sin esto, @skill: era un texto literal ignorado.
    let skillsContext = '';
    if (skillMentionedNames.length > 0) {
      try {
        const allSkills = await skillsRegistry.loadAll();
        const matched = allSkills.filter((s) =>
          skillMentionedNames.some((n) => n.toLowerCase() === s.name.toLowerCase()),
        );
        if (matched.length > 0) {
          skillsContext =
            '\n\n═══ SKILLS ACTIVAS PARA ESTE MENSAJE ═══\n' +
            'El usuario mencionó @skill: lo que activa las siguientes skills. Úsalas como GUÍA\n' +
            'de cómo proceder (no son tools, son instrucciones de procedimiento):\n\n' +
            matched
              .map(
                (s) =>
                  `── SKILL: ${s.name} ──\n` +
                  `Descripción: ${s.description}\n` +
                  `Triggers: ${s.triggers.join(', ') || '(ninguno)'}\n` +
                  `Tools requeridas: ${s.toolsRequired.join(', ') || '(ninguna)'}\n` +
                  `Contenido:\n${s.body}`,
              )
              .join('\n\n');
        } else {
          skillsContext =
            '\n\n═══ SKILL NO ENCONTRADA ═══\n' +
            `Mencionaste @skill: pero no hay skills con esos nombres. ` +
            `Skills disponibles: ${allSkills.map((s) => s.name).join(', ') || 'ninguna'}.`;
        }
      } catch (e) {
        console.warn('[Skills] No se pudieron cargar skills mencionadas:', e);
      }
    }

    // ═══ Inyectar HISTORIAL de la conversación previa ═══
    // Esto es CRÍTICO: sin esto, cada turno del usuario se envía al LLM como si
    // fuera el inicio de un chat nuevo — el agente no recordaría ni la pregunta
    // anterior. Leemos conv.messages, dejamos fuera el último user message (que
    // ya se añade explícitamente abajo) y el placeholder assistant vacío que se
    // acaba de añadir en línea 491. Ventaneamos a los últimos 20 mensajes para
    // no inflar el contexto.
    const priorMsgs: Message[] = [];
    try {
      const wState = useWeaver.getState();
      const conv = wState.conversations.find((c) => c.id === wState.activeConversationId);
      if (conv) {
        // conv.messages = [...prev, userMsgJustAdded, assistantPlaceholderEmpty]
        const cutoff = conv.messages.length - 2;
        const hist = cutoff > 0 ? conv.messages.slice(0, cutoff) : [];
        const windowed = hist.slice(-20); // últimos 20 mensajes
        for (const m of windowed) {
          if (m.role !== 'user' && m.role !== 'assistant') continue;
          if (m.content === null) continue;
          if (m.role === 'assistant' && m.content.trim() === '') continue;
          priorMsgs.push({
            role: m.role,
            content: m.content,
            ...(m.images && m.images.length > 0 ? { images: m.images } : {}),
          });
        }
      }
    } catch (e) {
      console.warn('[Chat History] No se pudo cargar historial previo:', e);
    }

    // ═══ Construir bloque de MODOS ACTIVOS para el system prompt ═══
    // Antes estos modos se prependeaban al mensaje del usuario, lo que hacía
    // que el LLM los viera como una instrucción nueva en cada turno y los
    // confirmara con "Entendido, he registrado esta directriz...". Ahora van
    // en el system prompt como comportamiento persistente, no como petición
    // del usuario. El LLM no debe anunciar que los activó — simplemente debe
    // comportarse según ellos.
    const modesBlock: string[] = [];
    if (planMode) {
      modesBlock.push(
        '═══ MODO PLAN ACTIVO ═══\n' +
        'Antes de ejecutar cualquier acción, propón un plan paso a paso y espera la confirmación\n' +
        'del usuario antes de proceder. No anuncies que estás en modo plan — simplemente planifica.',
      );
    }
    if (pursueObjective) {
      modesBlock.push(
        '═══ PERSEGUIR OBJETIVO ACTIVO ═══\n' +
        'Debes perseguir el objetivo hasta completarlo. Si algo falla, replanifica e inténtalo\n' +
        'de nuevo (máximo 3 intentos por subtarea). No te rindas al primer error.\n' +
        'No anuncies esta directriz al usuario — simplemente aplícala.',
      );
    }
    if (cognitiveMode) {
      modesBlock.push(
        '═══ MODO COGNITIVO ACTIVO ═══\n' +
        'Te vuelves HIPER-ESPECIALIZADO en el proyecto activo.\n' +
        'Antes de proponer cualquier cambio al código, sigue este protocolo de 3 fases:\n' +
        '   1) INTUICIÓN (Telaraña): Llama a cognitive_query para buscar nodos relacionados con\n' +
        '      lo que pide el usuario. Identifica posibles restricciones previas (Performance_Budget,\n' +
        '      dependencias circulares, conflictos conocidos). Asocia el pedido con el historial del grafo.\n' +
        '   2) LÓGICA (Construcción del Grafo): Traza los pasos como una cadena de nodos A → B → C.\n' +
        '      Verifica si algún nodo prohíbe la lógica (usa cognitive_query path/neighbors).\n' +
        '   3) JUICIO (Emisión): Responde con: (a) resumen de lo que encontraste en el grafo,\n' +
        '      (b) nodos afectados y riesgos detectados, (c) propuesta concreta, (d) pregunta de\n' +
        '      confirmación al usuario.\n' +
        'Si no existe un Grafo Cognitivo construido, primero llama a cognitive_graphify con la\n' +
        'ruta del proyecto (si no la sabes, pídela al usuario). NUNCA propongas cambios sin antes\n' +
        'consultar el grafo.',
      );
    }
    const modesSection = modesBlock.length > 0
      ? modesBlock.join('\n\n') + '\n\n'
      : '';

    const messages: Message[] = [
      {
        role: 'system',
        content:
          `Tu nombre es Weaver. Si el usuario te pregunta quién eres, cómo te llamas o quién te creó, responde SIEMPRE que eres Weaver, un agente de escritorio PROACTIVO y AUTÓNOMO ejecutándose en ${osName}. ` +
          (runtime.isTauri
            ? 'Tienes acceso al sistema de archivos real y puedes ejecutar comandos shell. '
            : 'Estás en modo navegador (sin acceso al filesystem real). ') +
          shellHint + '\n\n' +
          'TIENES ACCESO A HERRAMIENTAS REALES para:\n' +
          '- Lanzar aplicaciones de escritorio en segundo plano (launch_app)\n' +
          '- Ejecutar comandos shell (shell_exec)\n' +
          '- Controlar e interactuar con la interfaz del PC vía AT-SPI y automatización (click, double_click, focus, type_text, press_key, mouse_click_at, query_tree, list_applications, list_windows, activate_window)\n' +
          '- Leer y escribir archivos (file_read, file_write, file_list)\n' +
          '- Buscar en internet (web_search)\n' +
          '- Descargar contenido de URLs (web_fetch)\n' +
          '- Generar archivos descargables (save_file)\n' +
          '- Renderizar contenido VISUAL/INTERACTIVO dentro del chat en una mini-ventana (render)\n' +
          '  render({kind, title, content}) — kind es uno de: "html", "svg", "mermaid", "markdown", "pdf".\n' +
          '  ⚠️ REGLA OBLIGATORIA: si el usuario pide "renderiza/muéstrame/genera/crea/haz/dibuja" algo\n' +
          '  visual o interactivo, DEBES llamar a render con el kind correcto — NUNCA escribas el\n' +
          '  código (HTML, SVG, Mermaid) como texto plano de tu respuesta. Escribir el código como\n' +
          '  texto en vez de llamar render es un ERROR: el usuario NO verá ninguna ventana, sólo\n' +
          '  código crudo sin sentido. La única excepción es si el usuario pide explícitamente "el\n' +
          '  código" o "muéstrame el código fuente" (ahí sí va como bloque ```html normal).\n\n' +
          '  Cuándo usar cada kind:\n' +
          '  · kind="html" → JUEGOS Y CUALQUIER COSA INTERACTIVA (cartas, memoria, trivia/quiz con\n' +
          '    puntaje, tres en raya, temporizadores, calculadoras, formularios, dashboards,\n' +
          '    animaciones, prototipos de UI). El HTML corre en un iframe CON JavaScript habilitado —\n' +
          '    escribe la lógica completa en <script> (estado del juego, event listeners de click,\n' +
          '    puntajes, temporizadores, validaciones) usando sólo JS vanilla, sin backend ni Python.\n' +
          '    Ejemplo: "hazme un juego de cartas" → genera un <div id="game"> con las cartas como\n' +
          '    elementos clicables y toda la lógica (baraja, turnos, puntaje) en un <script> dentro\n' +
          '    del mismo HTML. Para gráficas de datos usa Chart.js vía CDN\n' +
          '    (<script src="https://cdn.jsdelivr.net/npm/chart.js">), es más flexible que dibujar a mano.\n' +
          '  · kind="svg" → sólo el código <svg>...</svg> (sin html/head/body) para íconos, diagramas\n' +
          '    geométricos, ilustraciones vectoriales estáticas.\n' +
          '  · kind="mermaid" → sólo el código Mermaid ("graph TD; A-->B;") para diagramas de flujo,\n' +
          '    secuencia, Gantt, ER, mapas mentales. Se renderiza solo, no necesitas escribir HTML.\n' +
          '  · kind="markdown" → texto con formato en su propia ventana separada de la respuesta.\n' +
          '  · kind="pdf" → documentos PDF (texto/HTML o base64).\n' +
          '  render_html y render_pdf siguen disponibles como alias directos de compatibilidad.\n' +
          '- Ejecutar código Python/Node/Bash en un sandbox efímero (sandbox_run)\n' +
          '- Crear notas/tareas/eventos en el espacio personal del usuario (me_create_*)\n' +
          '- Recordar hechos clave sobre el usuario/proyecto con memory_save_fact / memory_list_facts / memory_delete_fact\n' +
          '- Llevar la bitácora de ESTE chat (qué se hizo/falta) con project_memory_save / project_memory_list / project_memory_delete\n' +
          '- Delegar subtareas a subagentes especializados (delegate_to_subagent)\n' +
          '- Construir un Grafo Cognitivo del proyecto (cognitive_graphify, cognitive_query)\n' +
          '- Usar tools de servidores MCP externos cuando el usuario las mencione con @mcp:\n\n' +
          '═══ MCP (Model Context Protocol) ═══\n' +
          'Los servidores MCP son herramientas externas que el usuario instala en Weaver. Para usarlas,\n' +
          'el usuario debe mencionarlas en su mensaje con @mcp:<nombre> (ej: "@mcp:Figma obtén el\n' +
          'archivo XYZ"). Cuando lo hace, las tools MCP se cargan automáticamente en tu lista de tools\n' +
          'con el prefijo mcp__<serverId>__<toolName>. Úsalas como cualquier otra tool.\n' +
          'Si el usuario NO menciona @mcp:, las tools MCP NO están disponibles — no intentes usarlas.\n' +
          'Si el usuario menciona @mcp: pero no hay tools cargadas, informa del problema y continúa.\n' +
          mcpServersInfo +
          mcpUnavailableHint +
          subagentsContext +
          skillsContext + '\n\n' +
          '═══ COMPORTAMIENTO PROACTIVO Y AUTÓNOMO ═══\n' +
          'Eres un agente AUTÓNOMO. Esto significa:\n' +
          '1. NUNCA te rindas al primer error. Si algo falla, intenta una alternativa.\n' +
          '2. Si no conoces el username o una ruta, DESCÚBRELA primero con shell_exec ("echo %USERNAME%" en Windows, "whoami" en Linux).\n' +
          '3. NUNCA uses variables de entorno sin expandir en rutas de file_read/file_write/file_list. Primero resuelve el valor con shell_exec, luego úsalo.\n' +
          '4. Si file_write falla por permisos, intenta otra ruta (ej: Documents en vez de Desktop).\n' +
          '5. Si shell_exec falla con un comando, prueba otro equivalente.\n' +
          '6. Encadena tools: usa shell_exec para descubrir info, luego file_read/write para actuar.\n' +
          '7. Si el usuario pide algo ambiguo, INTERPRETA lo más probable y actúa.\n' +
          '8. No pidas confirmación para cada paso. Solo actúa y reporta al final.\n\n' +
          '═══ RAZONAMIENTO INTERCALADO (VISIBLE ENTRE TOOL CALLS) ═══\n' +
          'Antes de cada tool call cuya necesidad no sea obvia (es decir, salvo la primerísima tool de un turno simple), escribe una línea breve de razonamiento envuelta así:\n' +
          '[think]una frase corta explicando qué vas a hacer ahora y por qué[/think]\n' +
          'Reglas para [think]:\n' +
          '- Va INMEDIATAMENTE ANTES de la tool call a la que corresponde, no todo junto al inicio del turno.\n' +
          '- Una frase por bloque (máx. ~25 palabras). No un párrafo largo.\n' +
          '- Sé específico: qué vas a hacer y por qué esta tool en particular ("Necesito confirmar la ruta antes de escribir el archivo" es útil; "voy a pensar" no lo es).\n' +
          '- No emitas [think] después de la última tool call ni antes de tu respuesta final en texto.\n' +
          '- No abuses: solo cuando la siguiente acción no sea evidente por sí misma.\n\n' +
          modesSection +
          '═══ REGLAS DE RUTAS ═══\n' +
          '- En Windows: C:\\Users\\<username>\\Documents\\ — descubre username primero\n' +
          '- En Linux: /home/<username>/ — descubre username primero\n' +
          '- %USERNAME% y $USER NO se expanden en file_read/file_write/file_list, SOLO en shell_exec\n' +
          '- Para save_file no necesitas ruta, solo filename\n\n' +
          '═══ REGLAS DE TOOLS ═══\n' +
          '- web_search ya devuelve un resumen. Úsalo directamente.\n' +
          '- Si web_fetch falla, no insistas. Usa web_search.\n' +
          '- Para crear archivos que el usuario descargue, usa save_file (no file_write).\n' +
          '- Máximo 1 intento de web_fetch por URL.\n' +
          '- RENDERIZAR EN EL CHAT: Si el usuario te pide renderizar, mostrar, previsualizar o ver\n' +
          '  HTML (dashboards, portafolios, prototipos, tablas interactivas, animaciones) DENTRO del\n' +
          '  chat, usa render_html — NO uses file_write ni save_file. file_write y save_file sólo\n' +
          '  guardan en disco; render_html es lo ÚNICO que abre la mini-ventana con iframe en el chat.\n' +
          '  Triggers: "renderiza", "muéstrame el HTML", "previsualiza", "abre en el chat", "visualiza".\n' +
          '  Si el usuario dice "crea un HTML y renderízalo", USA render_html (no file_write).\n' +
          '- DELEGAR: Para tareas complejas con sub-componentes aislables, considera delegate_to_subagent\n' +
          '  antes de hacerlo todo tú mismo. Los subagentes son especialistas con su propio presupuesto.\n\n' +
          '═══ REGLA CRÍTICA SOBRE RESULTADOS DE TOOLS (ANTI-ALUCINACIÓN) ═══\n' +
          'Cuando una tool (web_search, web_fetch, file_read, shell_exec, sandbox_run, etc.)\n' +
          'devuelva resultados exitosos, DEBES reportarlos. NUNCA digas "no se encontró información",\n' +
          '"no tengo datos sobre esto", "no existe documentación" o frases similares si la tool\n' +
          'devolvió contenido. Los resultados de las tools SON VERDAD — tu trabajo es REPORTARLOS,\n' +
          'no contradecirlos. Si la tool devuelve algo sorprendente o que no esperabas, reporta\n' +
          'exactamente lo que dice. NO filtres los resultados según tu conocimiento previo.\n' +
          'Si la tool falla (error, vacío, sin resultados), SÍ puedes decir "no se encontró",\n' +
          'pero SOLO en ese caso. Confundir "tool exitosa con datos" y "tool sin datos" es\n' +
          'un error grave que viola la confianza del usuario.\n\n' +
          '═══ SANDBOX DE CÓDIGO ═══\n' +
          'Tienes una tool sandbox_run para ejecutar código Python, Node.js o Bash de forma\n' +
          'segura. Úsala cuando necesites:\n' +
          '- Procesar datos (parsear JSON, calcular estadísticas, transformar archivos).\n' +
          '- Generar contenido programáticamente (CSV, Markdown, imágenes con matplotlib).\n' +
          '- Validar hypotheses con cálculos (comparar valores, hacer queries complejas).\n' +
          '- Ejecutar scripts que el usuario te pida (analiza, ejecuta, reporta stdout).\n' +
          'NO uses sandbox_run para tareas que ya tienen tools específicas (shell_exec para\n' +
          'comandos del sistema, file_read para leer archivos, save_file para generar descargas).\n' +
          'sandbox_run es para LÓGICA: cuando necesitas pensar con código, no solo ejecutar.\n' +
          'El sandbox está aislado: NO ve tus archivos personales ni el sistema del host.\n' +
          'Si necesitas datos del host, pásalos como `stdin` en el código o úsalos como string.\n\n' +
          '═══ REGLA CRÍTICA SOBRE "MI" / "ME" ═══\n' +
          '"MI" (también llamada "ME" en las tools) es la sección PERSONAL DEL USUARIO ' +
          'dentro de Weaver: SUS notas, SUS tareas, SU calendario, SU lista de la compra, ' +
          'SU registro de salud. NO es tu espacio personal como agente.\n' +
          '- NUNCA uses me_create_note / me_create_task / me_create_event / me_add_shopping / ' +
          'me_log_health para registrar cosas sobre ti mismo (tus capacidades, tu estado, ' +
          'tus reflexiones, tu memoria, etc.). Esos datos van al USUARIO, no a ti.\n' +
          '- Usa estas tools cuando el usuario te pida EXPLÍCITA O IMPLÍCITAMENTE ' +
          'recordar/anotar/guardar algo PARA ÉL en sus espacios personales. Triggers ' +
          'válidos (lista NO exhaustiva — ante la duda razonable, USA la tool):\n' +
          '  · "anota en MI…", "agrega a mi lista…", "recuérdame…", "pon en mi calendario…",\n' +
          '  · "apunta en mi lista de la compra…", "registra mi peso…"\n' +
          '  · "guarda esto: X" (si X es una nota/tarea/evento, va a MI)\n' +
          '  · "recuerda que…", "anota", "apunta", "guárdame"\n' +
          '  · "no te olvides de X"\n' +
          '- Si el usuario pregunta "¿qué puedes hacer?" o "¿quién eres?", RESPONDE en el ' +
          'chat directamente. NO crees una nota en MI con la respuesta.\n' +
          '- Tu propia memoria/estado como agente se gestiona con memory_save_fact (ver abajo).\n\n' +
          '═══ MEMORIA DEL AGENTE (chat memory) ═══\n' +
          'Tienes una MEMORIA PROPIA semántica con tres tools:\n' +
          '- memory_save_fact(key, value): guarda un hecho breve para recordar en futuros chats.\n' +
          '- memory_list_facts(): lista todo lo que recuerdas.\n' +
          '- memory_delete_fact(key): olvida un hecho específico.\n\n' +
          'USA memory_save_fact ACTIVAMENTE cuando el usuario comparta información que valga ' +
          'la pena recordar en futuras conversaciones. Ejemplos:\n' +
          '  · "me llamo John"           → memory_save_fact("user:name", "John")\n' +
          '  · "trabajo como ingeniero"  → memory_save_fact("user:job", "Ingeniero")\n' +
          '  · "prefiero respuestas cortas" → memory_save_fact("user:pref", "respuestas cortas")\n' +
          '  · "hablo español"           → memory_save_fact("user:lang", "es")\n' +
          '  · "ya configuré el deploy"  → memory_save_fact("project:deploy", "configurado")\n' +
          '  · "mi cumple es el 15 de marzo" → memory_save_fact("user:birthday", "15 de marzo")\n' +
          '  · "no me uses markdown"     → memory_save_fact("user:no_markdown", "true")\n\n' +
          'Cuando el usuario diga "guarda esto: X" o "recuerda que X" o "anota X" o similar,\n' +
          'DECIDE si X es una nota/tarea/evento (→ va a MI con me_create_*) o un hecho breve ' +
          'sobre el usuario/proyecto (→ va a chat memory con memory_save_fact). Por defecto,\n' +
          'si es info personal como nombre/profesión/gustos/preferencias, usa memory_save_fact.\n\n' +
          'Cuando el usuario te pregunte "¿qué recuerdas de mí?", "¿qué tienes en tu memoria?",\n' +
          '"¿qué sabes sobre mí?", usa memory_list_facts() para responder con la verdad — NO ' +
          'inventes. Si la memoria está vacía, dilo honestamente.\n\n' +
          'Cuando el usuario te pida "olvida X" / "borra Y de tu memoria", usa memory_delete_fact.\n\n' +
          (chatMemoryMode
            ? 'MODO MEMORIA CHAT ACTIVO: vas a guardar AUTOMÁTICAMENTE hechos clave que notes ' +
              'en la conversación (sin que el usuario te lo pida). Si el usuario menciona su ' +
              'nombre, profesión, preferencias, proyectos, decisiones importantes, instrucciones ' +
              'de uso — llama memory_save_fact de forma proactiva. No anuncies que lo estás ' +
              'haciendo, simplemente hazlo y responde al usuario normalmente.\n\n'
            : 'Memoria chat está desactivada — sólo guarda hechos cuando el usuario te lo pida ' +
              'explícitamente ("guarda X", "recuerda Y").\n\n') +
          '═══ CONTEXTO RECUPERADO DE TU MEMORIA ═══\n' +
          (memoryContext || '(memoria vacía — aún no has guardado ningún hecho)') + '\n\n' +
          'Usa este contexto PARA PERSONALIZAR tus respuestas (ej: si sabes su nombre, ' +
          'úsalo; si sabes su profesión, adapta el nivel técnico; si sabes sus preferencias, ' +
          'respétalas). NUNCA digas "según mi memoria…", simplemente úsala naturalmente.\n\n' +
          '═══ MEMORIA DE PROYECTO (bitácora de ESTE chat) ═══\n' +
          'Además de tu memoria semántica global (arriba), tienes una bitácora PROPIA de ' +
          'ESTA conversación con tres tools:\n' +
          '- project_memory_save(key, value): guarda o actualiza el estado del trabajo en curso.\n' +
          '- project_memory_list(): lista todo lo que llevas registrado de este proyecto.\n' +
          '- project_memory_delete(key): elimina una entrada que ya no aplica.\n\n' +
          'Esta bitácora es DISTINTA de memory_save_fact: memory_save_fact es sobre EL USUARIO ' +
          '(nombre, gustos, preferencias) y se comparte entre TODOS los chats. project_memory_save ' +
          'es sobre ESTE PROYECTO/TRABAJO específico y NO se comparte con otros chats — es tu ' +
          'bitácora de "qué llevamos hecho aquí".\n\n' +
          'USA project_memory_save PROACTIVAMENTE, sin que el usuario te lo pida, cuando:\n' +
          '  · Completes una parte del trabajo → project_memory_save("hecho:<algo>", "qué se hizo")\n' +
          '  · Identifiques algo pendiente → project_memory_save("pendiente:<algo>", "qué falta")\n' +
          '  · Se tome una decisión de diseño/enfoque → project_memory_save("decision:<tema>", "qué se decidió")\n' +
          '  · El usuario defina el objetivo general → project_memory_save("objetivo", "resumen breve")\n' +
          'No anuncies que lo estás haciendo — hazlo en silencio y sigue respondiendo normal. ' +
          'Actualiza (sobrescribe) una entrada existente en vez de duplicarla cuando el estado cambie ' +
          '(ej: si "pendiente:tests" ya no aplica porque los hiciste, bórrala con project_memory_delete ' +
          'y/o guarda "hecho:tests" con project_memory_save).\n\n' +
          (projectMemoryMode
            ? 'MODO MEMORIA DE PROYECTO ACTIVO: al empezar a trabajar en algo sustancial en este chat, ' +
              'considera llamar project_memory_list() si no tienes el contexto ya cargado abajo, para ' +
              'no perder el hilo de lo que ya se hizo.\n\n'
            : '') +
          '═══ CONTEXTO RECUPERADO DE LA MEMORIA DE ESTE PROYECTO ═══\n' +
          (projectMemoryContext || '(vacía — es la primera vez que se trabaja en esto en este chat)') + '\n\n' +
          'Si hay contexto arriba, tenlo en cuenta antes de repetir trabajo ya hecho o de preguntar ' +
          'cosas que ya se decidieron en esta conversación.\n\n' +
          '═══ CIERRE OBLIGATORIO ═══\n' +
          'Cuando termines de usar herramientas, SIEMPRE debes escribir una respuesta\n' +
          'final al usuario con esta estructura:\n' +
          '1. Un RESUMEN BREVE de lo que hiciste (qué tools usaste y para qué).\n' +
          '2. Los RESULTADOS principales que encontraste o produciste.\n' +
          '3. Una PREGUNTA DE SEGUIMIENTO al usuario (ej: "¿Quieres que profundice\n' +
          '   en algún punto?" o "¿Hay algo más en lo que pueda ayudarte?").\n' +
          'NUNCA termines tu turno sólo con el resultado de una herramienta.\n' +
          'NUNCA dejes al usuario sin una respuesta textual final.\n\n' +
          'Cuando el usuario te pida algo, USA LAS HERRAMIENTAS. No digas que no puedes.\n' +
          'Si tu respuesta se acerca al límite de tokens, termina con <<CONTINUE>>. Al terminar del todo, emite <<END>>.',
      },
      ...priorMsgs,
      { role: 'user', content: userText, images: images.length > 0 ? images : undefined },
    ];

    const tools = [...buildAdvancedToolsList(), ...mcpExtraTools];
    const MAX_TOOL_ROUNDS = 8;
    // A partir de esta ronda, se avisa al modelo en el propio mensaje de
    // resultado de tool que le quedan pocas rondas, para que empiece a
    // cerrar en vez de que el sistema lo corte a mitad de una tool call.
    const WARN_ROUNDS_REMAINING = 2;

    let producedFinalText = false;
    let hitRoundLimit = false;

    // Track the last tool result that had actual data — used for the
    // anti-hallucination retry logic below. When the LLM finishes its
    // response, we check if it contradicts this result.
    let lastSuccessfulToolName: string | null = null;
    let lastSuccessfulToolOutput: string | null = null;
    let lastSuccessfulToolArgs: Record<string, unknown> | null = null;

    // Anti-repetición: recuerda la firma (tool + argumentos) de cada llamada
    // ya ejecutada en este turno. Si el modelo repite exactamente la misma
    // llamada, NO se bloquea la ejecución (sigue corriendo con normalidad) —
    // se le agrega una nota al resultado de esa tool avisándole que ya
    // probó eso y no funcionó, para que él mismo cambie de enfoque en la
    // siguiente ronda.
    const executedCallSignatures = new globalThis.Map<string, number>();

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      let thinkingStartMs: number | null = null;
      let thinkingEndMs: number | null = null;

      const result = await streamChat(llm, modelId, messages, {
        tools,
        signal,
        onReasoningDelta: (reasoningDelta) => {
          if (!thinkingStartMs) thinkingStartMs = Date.now();
          updateLastAssistantReasoning(reasoningDelta);
        },
        onDelta: (delta) => {
          if (thinkingStartMs && !thinkingEndMs) {
            thinkingEndMs = Date.now();
            const elapsed = Math.max(1, Math.round((thinkingEndMs - thinkingStartMs) / 1000));
            setLastAssistantThinkingDuration(elapsed);
          }
          updateLastAssistantMessage(delta);
        },
      });

      if (thinkingStartMs && !thinkingEndMs) {
        thinkingEndMs = Date.now();
        const elapsed = Math.max(1, Math.round((thinkingEndMs - thinkingStartMs) / 1000));
        setLastAssistantThinkingDuration(elapsed);
      }

      // Registrar uso en métricas globales (tokens + costo estimado + éxito/fracaso).
      try {
        const { metrics } = await import('@/lib/metrics');
        metrics.recordUsage({
          providerId: llm.info.id,
          model: modelId,
          inputTokens: result.usage.inputTokens,
          outputTokens: result.usage.outputTokens,
          source: 'chat',
          success: result.toolCalls.length === 0 || result.text.trim().length > 0,
          taskKind: 'chat',
        });
      } catch {
        /* ignore metrics errors — no romper el chat */
      }

      // ----------------------------------------------------------------------
      // Detectar tool calls emitidos como TEXTO por modelos que no usan
      // function calling nativo. Ejemplos:
      //   <function(web_search){"query": "...", "max_results": 5}</function>
      //   <tool_call>{"name": "web_search", "arguments": {...}}</tool_call>
      //   [TOOL_CALLS: [{...}]]
      //   <|tool_call|>{...}
      // Sin este parser, estos tool calls se mostrarían como texto crudo al
      // usuario y nunca se ejecutarían (bug reportado: "agente sin respuesta"
      // o "agente emite <function(...)> como texto").
      // ----------------------------------------------------------------------
      if (result.toolCalls.length === 0 && maybeHasTextToolCall(result.text)) {
        const parsed = parseTextToolCalls(result.text);
        if (parsed.found) {
          result.toolCalls = parsed.toolCalls;
          // Reemplazar el texto visible (que contenía las marcas del tool call)
          // por el texto limpio. Si no había texto fuera de los tool calls,
          // queda vacío — el siguiente bloque añade el feedback de ejecución.
          setLastAssistantMessage(parsed.cleanedText);
          result.text = parsed.cleanedText;
        }
      }

      // ----------------------------------------------------------------------
      // Red de seguridad: modelos pequeños/gratuitos a veces IGNORAN la
      // instrucción de usar la tool render y escriben el código (HTML o SVG)
      // completo como texto plano de su respuesta (bug reportado: usuario
      // pide "renderiza un HTML de un dado" y el modelo devuelve el código
      // crudo en vez de abrir la mini-ventana). Si detectamos un documento
      // HTML o un bloque <svg> completo sin que haya habido tool call, lo
      // envolvemos nosotros mismos con el mismo marcador que produce la tool
      // render, para que se abra la ventana igual — sin depender de que el
      // modelo haya llamado la tool.
      // ----------------------------------------------------------------------
      if (result.toolCalls.length === 0 && result.text && !result.text.includes('[render:')) {
        const htmlMatch = result.text.match(/<!DOCTYPE html[\s\S]*<\/html\s*>/i)
          ?? result.text.match(/<html[\s>][\s\S]*<\/html\s*>/i);
        const svgMatch = !htmlMatch ? result.text.match(/<svg[\s>][\s\S]*<\/svg\s*>/i) : null;
        const rawMatch = htmlMatch ?? svgMatch;
        const kind = htmlMatch ? 'html' : 'svg';
        const mime = htmlMatch ? 'text/html' : 'image/svg+xml';
        if (rawMatch) {
          const rawCode = rawMatch[0];
          const id = crypto.randomUUID();
          const title = kind === 'html' ? 'HTML renderizado' : 'SVG renderizado';
          const renderMarker = `\n[render:${kind}:${id}:${title}]\n[render-content:${id}:${mime}]\n${rawCode}\n[/render-content]\n`;
          // Reemplazar solo el bloque de código crudo por el marcador — se
          // conserva cualquier texto explicativo que el modelo haya escrito
          // alrededor.
          const newText = result.text.slice(0, rawMatch.index) + renderMarker
            + result.text.slice((rawMatch.index ?? 0) + rawCode.length);
          setLastAssistantMessage(newText);
          result.text = newText;
        }
      }

      // Limpieza de marcadores de fin de turno propios de Weaver (<<END>>,
      // <<CONTINUE>>) que algunos modelos pequeños emiten mal formados
      // (ej: ">>END>>" en vez de "<<END>>") y que nunca deben quedar
      // visibles en el chat — son instrucciones de protocolo, no contenido.
      if (result.text && /(<<|>>)\s*(END|CONTINUE)\s*(>>|<<)/i.test(result.text)) {
        const cleanedEnd = result.text.replace(/\s*(<<|>>)\s*(END|CONTINUE)\s*(>>|<<)\s*$/i, '').trimEnd();
        if (cleanedEnd !== result.text) {
          setLastAssistantMessage(cleanedEnd);
          result.text = cleanedEnd;
        }
      }

      // Si no hay tool calls (nativos ni text-based), el LLM ya respondió → terminamos.
      // PERO sólo marcamos producedFinalText=true si HAY texto real. Si el LLM
      // respondió vacío (ni texto ni tools — pasa con modelos pequeños o cuando
      // el stream se corta), dejamos producedFinalText=false para que el bloque
      // post-loop fuerce una respuesta. Esto fixea el bug "sale el de pensar y
      // luego no sale mensaje".
      if (result.toolCalls.length === 0) {
        if (result.text && result.text.trim().length > 0) {
          // ─── ANTI-HALLUCINATION CHECK ───────────────────────────────────
          // Si el LLM acababa de recibir un tool result exitoso con datos,
          // y su respuesta dice "no se encontró información" / "no tengo datos"
          // / "no existe documentación" o similares — está MINTIENDO. Reintentamos
          // una vez con el resultado del tool reinyectado de forma más fuerte.
          // Esto fixea el bug donde Gemma-4-26B decía "no se encontró" después
          // de que web_search devolvió resultados válidos.
          if (
            lastSuccessfulToolOutput &&
            lastSuccessfulToolName &&
            responseDeniesToolData(result.text)
          ) {
            // Marcar el falso final en el chat con una nota visible.
            updateLastAssistantMessage(
              `\n\n> ⚠️ Detecté que mi respuesta anterior contradecía los resultados del tool. Reintentando con los datos...\n\n`,
            );
            // Reinyectar: descartar la mentira y forzar otra llamada con el
            // resultado del tool puesto de vuelta como un mensaje user fuerte.
            // Quitamos el último assistant message (la mentira) del contexto.
            // (No hace falta tocar el store UI — el updateLastAssistantMessage
            //  anterior ya añadió la nota visual.)
            messages.push({
              role: 'user',
              content:
                `Tu respuesta anterior dijo "no se encontró información" pero la tool ` +
                `${lastSuccessfulToolName} SÍ devolvió datos. Esto es INACEPTABLE.\n\n` +
                `Aquí está el resultado EXACTO que la tool devolvió:\n` +
                `──────────────────────────────────────\n` +
                `${lastSuccessfulToolOutput.slice(0, 3000)}\n` +
                `──────────────────────────────────────\n\n` +
                `Responde AHORA reportando fielmente lo que la tool devolvió. ` +
                `NO digas "no se encontró". NO contradigas los resultados de la tool. ` +
                `Si los resultados sorprenden, REPÓRTALOS TAL CUAL. ` +
                `Si la tool devolvió URLs, MÍRALAS. Si devolvió texto, CÍTALO.\n\n` +
                `Estructura: 1) Resumen breve. 2) Resultados principales (con datos del tool). 3) Pregunta de seguimiento.`,
            });
            // Limpiar para no reentrar al chequeo en el siguiente round.
            lastSuccessfulToolOutput = null;
            lastSuccessfulToolName = null;
            lastSuccessfulToolArgs = null;
            // Limpiar el mensaje visible actual y dejar que el retry reemplace.
            setLastAssistantMessage('');
            continue; // vuelve al for loop, otro streamChat
          }
          producedFinalText = true;
        }
        break;
      }

      // Agregar el mensaje del asistente con tool_calls al historial.
      // IMPORTANTE: content debe ser null (no string vacío) cuando hay tool_calls,
      // porque muchos proveedores LLM (OpenAI, Groq, etc.) lo requieren así.
      messages.push({
        role: 'assistant',
        content: result.text || null,
        tool_calls: result.toolCalls,
      });

      // Ejecutar cada tool call y agregar resultados.
      for (const tc of result.toolCalls) {
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(tc.function.arguments || '{}');
        } catch {
          // ignore parse errors
        }

        // Feedback visual limpio: mostrar qué tool se está ejecutando.
        const toolLabel = formatToolLabel(tc.function.name, args);
        updateLastAssistantMessage(`\n\n[tool ${tc.function.name}: ${toolLabel}]\n`);

        const toolResult = await dispatchAdvancedTool(tc.function.name, args);

        // Resultado para el LLM (completo, hasta 4000 chars).
        let llmResult = toolResult.ok
          ? toolResult.output.slice(0, 4000)
          : `ERROR: ${toolResult.error ?? 'unknown'}`;

        // ─── ANTI-REPETICIÓN (no bloquea la ejecución) ─────────────────────
        // Si esta misma tool+argumentos ya se ejecutó antes en este turno,
        // no se detiene nada — se ejecuta igual — pero se le añade al
        // resultado una nota explícita para que el modelo se dé cuenta y
        // pruebe otra cosa en la siguiente ronda, en vez de quedar atascado
        // repitiendo lo mismo hasta agotar las rondas.
        const callSignature = `${tc.function.name}:${JSON.stringify(args)}`;
        const priorCount = executedCallSignatures.get(callSignature) ?? 0;
        executedCallSignatures.set(callSignature, priorCount + 1);
        if (priorCount >= 1) {
          llmResult =
            `⚠️ NOTA: ya llamaste a "${tc.function.name}" con estos mismos argumentos ` +
            `${priorCount + 1} vez/veces en este turno y el resultado no cambió. Repetir la ` +
            `misma llamada no va a darte un resultado distinto — prueba un enfoque diferente ` +
            `(otros argumentos, otra tool, o si ya tienes suficiente información, responde ` +
            `directamente en vez de seguir intentando).\n\n${llmResult}`;
        }

        // ─── AVISO DE CIERRE POR LÍMITE DE RONDAS ──────────────────────────
        // A partir de WARN_ROUNDS_REMAINING rondas antes del final, se avisa
        // al modelo en cada resultado de tool cuántas rondas le quedan, para
        // que decida cerrar con un resumen en vez de que el sistema lo corte
        // a mitad de una tool call.
        const roundsRemaining = MAX_TOOL_ROUNDS - 1 - round;
        if (roundsRemaining <= WARN_ROUNDS_REMAINING && roundsRemaining > 0) {
          llmResult =
            `${llmResult}\n\n⏳ AVISO DE SISTEMA: te quedan ${roundsRemaining} ronda(s) de ` +
            `herramientas antes del límite de este turno. Si no vas a terminar a tiempo, no ` +
            `sigas intentando más tools sin necesidad — usa la(s) ronda(s) que quedan para lo ` +
            `esencial y luego cierra tu respuesta explicando: qué llevas hecho, qué falta, y ` +
            `pregunta si el usuario quiere que continúes en el siguiente mensaje.`;
        }

        // Track this result if it was successful AND has real content (not empty).
        // Used by the anti-hallucination check after the LLM finishes responding.
        if (toolResult.ok && toolResult.output.trim().length > 0) {
          lastSuccessfulToolName = tc.function.name;
          lastSuccessfulToolOutput = toolResult.output;
          lastSuccessfulToolArgs = args;
        }

        // Resultado visual limpio (no crudo).
        const visualResult = formatToolResult(tc.function.name, toolResult);
        updateLastAssistantMessage(`${visualResult}\n\n`);

        messages.push({
          role: 'tool',
          tool_call_id: tc.id,
          content: llmResult,
        });
      }

      // Ceder el hilo brevemente para que el UI pinte el resultado del tool
      // antes del siguiente round. OJO: NO usar setTimeout aquí — los
      // navegadores/WebViews clampan setTimeout a ~1s+ cuando la ventana
      // está minimizada/oculta (throttling de background tabs), lo que hacía
      // que el agente pareciera "congelarse" en tareas largas al minimizar
      // la app. requestAnimationFrame también se pausa en background, así
      // que usamos una microtask (setTimeout(fn, 0) vía Promise.resolve),
      // que los motores V8/JSC NO throttlean — sigue corriendo a máxima
      // velocidad esté o no la ventana visible.
      await Promise.resolve();
    }

    // Si el loop terminó las MAX_TOOL_ROUNDS sin que el modelo haya
    // producido texto final, es porque se agotaron las rondas (no porque
    // el modelo decidiera parar) — se distingue este caso para pedirle el
    // cierre explicado ("llegué al límite, me falta X, ¿continúo?") en vez
    // del cierre genérico de "ya terminaste, resume".
    if (!producedFinalText) {
      hitRoundLimit = true;
    }

    // Si el LLM nunca produjo texto final (sólo llamó tools hasta agotar rounds,
    // O respondió vacío), forzar una respuesta final SIN tools para que el
    // usuario sí reciba respuesta.
    if (!producedFinalText) {
      updateLastAssistantMessage('\n\n');
      messages.push({
        role: 'user',
        content: hitRoundLimit
          ? 'Alcanzaste el límite de herramientas disponibles para este turno (' +
            MAX_TOOL_ROUNDS +
            ' rondas) antes de terminar. Ahora DEBES responderme en texto plano, sin usar más ' +
            'herramientas, con este formato exacto:\n' +
            '1) "He alcanzado el máximo de herramientas para este turno."\n' +
            '2) Qué llevas hecho hasta ahora (resultados concretos obtenidos).\n' +
            '3) Qué falta por terminar exactamente.\n' +
            '4) Pregunta: "¿Quieres que continúe?"\n' +
            'No repitas herramientas ya usadas. Responde directamente.'
          : 'Ya usaste las herramientas necesarias. Ahora DEBES responderme en texto plano:\n' +
            '1) Un resumen breve de lo que hiciste.\n' +
            '2) Los resultados principales.\n' +
            '3) Una pregunta de seguimiento.\n' +
            'No intentes usar más herramientas. Responde directamente.',
      });
      try {
        const finalResult = await streamChat(llm, modelId, messages, {
          signal,
          onDelta: (delta) => updateLastAssistantMessage(delta),
        });
        // El LLM podría seguir emitiendo tool calls como texto (modelos
        // test-only-style). Limpiarlos del texto visible SIN ejecutarlos
        // (ya cerramos la fase de tools).
        let finalText = finalResult.text;
        if (maybeHasTextToolCall(finalText)) {
          const parsed = parseTextToolCalls(finalText);
          if (parsed.found) {
            finalText = parsed.cleanedText;
            setLastAssistantMessage(finalText);
          }
        }
        // Si aún así el LLM no produce nada útil, mostrar un fallback claro
        // para que el usuario no se quede con mensaje vacío.
        if (!finalText || finalText.trim().length === 0) {
          updateLastAssistantMessage(
            '\n\n*(El modelo no generó una respuesta. Posibles causas:\n' +
              '- El modelo no soporta tools y se confundió\n' +
              '- El stream se cortó\n' +
              '- La API key del proveedor es inválida o sin cuota\n' +
              'Intenta reformular el mensaje, cambia de modelo en el selector, o revisa la configuración.)*',
          );
        }
      } catch (e) {
        updateLastAssistantMessage(
          `\n\n*(No se pudo generar el resumen final: ${e instanceof Error ? e.message : String(e)})*`,
        );
      }
    }
  }

  /** Formatea el label de un tool call para mostrar en el UI. */
  function formatToolLabel(toolName: string, args: Record<string, unknown>): string {
    switch (toolName) {
      case 'web_search':
        return `buscando: "${args.query ?? args.q ?? ''}"`;
      case 'web_fetch':
        return `descargando: ${args.url ?? ''}`;
      case 'sandbox_run':
        return `ejecutando ${args.language ?? 'python'}: ${(String(args.code ?? '').split('\n')[0] ?? '').slice(0, 60)}`;
      case 'shell_exec':
        return `ejecutando: ${(args.command ?? '').toString().slice(0, 60)}`;
      case 'file_read':
        return `leyendo: ${args.path ?? ''}`;
      case 'file_write':
        return `escribiendo: ${args.path ?? ''}`;
      case 'file_list':
        return `listando: ${args.path ?? ''}`;
      case 'save_file':
        return `generando: ${args.filename ?? 'archivo'}`;
      case 'render':
        return `renderizando ${String(args.kind ?? 'html').toUpperCase()}: "${args.title ?? 'sin título'}"`;
      case 'render_html':
        return `renderizando HTML: "${args.title ?? 'sin título'}"`;
      case 'render_pdf':
        return `renderizando PDF: "${args.title ?? 'sin título'}"`;
      case 'delegate_to_subagent':
        return args.subagent_name
          ? `delegando a subagente: ${args.subagent_name}`
          : `delegando a subagente (auto-selección)`;
      case 'memory_save_fact':
        return `recordando: ${args.key ?? ''}`;
      case 'memory_list_facts':
        return `revisando memoria`;
      case 'memory_delete_fact':
        return `olvidando: ${args.key ?? ''}`;
      case 'project_memory_save':
        return `bitácora: ${args.key ?? ''}`;
      case 'project_memory_list':
        return `revisando bitácora del proyecto`;
      case 'project_memory_delete':
        return `borrando de bitácora: ${args.key ?? ''}`;
      default:
        // Tools MCP con prefijo mcp__<serverId>__<toolName>
        if (toolName.startsWith('mcp__')) {
          const parts = toolName.split('__');
          const toolShortName = parts[parts.length - 1];
          return `MCP · ${toolShortName}`;
        }
        return toolName;
    }
  }

  /** Formatea el resultado de un tool de forma limpia para el UI (no crudo). */
  function formatToolResult(
    _toolName: string,
    result: { ok: boolean; output: string; error?: string },
  ): string {
    if (!result.ok) {
      const err = result.error ?? 'error desconocido';
      const shortErr = err.split('\n')[0].slice(0, 120);
      return `[result ${_toolName}]❌ ${shortErr}[/result]`;
    }
    const output = result.output;
    // Patrones que DEBEN preservarse completos (no truncarse) porque el
    // MessageList los parsea para renderizar ventanas especiales.
    // OJO: renderHtml/renderPdf devuelven el output con un "\n" inicial
    // (para separarlo visualmente en el prompt del LLM), así que hay que
    // comparar contra la versión sin espacios — de lo contrario
    // startsWith('[render:') daba false, el marcador caía al camino de
    // truncado normal de abajo, y en vez de abrirse la ventana con el
    // HTML/PDF renderizado se veía el texto crudo "[render:html:...]"
    // cortado a 150 caracteres dentro de la cápsula de resultado.
    const trimmedOutput = output.trimStart();
    if (trimmedOutput.startsWith('[file:') || trimmedOutput.startsWith('[render:')) {
      return trimmedOutput;
    }
    const truncated = output.slice(0, 150);
    const hasMore = output.length > 150;
    // Delimitador de cierre explícito [/result] en vez de "]" — el output de
    // una tool (JSON, URLs, shell) casi siempre contiene corchetes, y un "]"
    // como terminador cortaba el parseo en MessageList a mitad del resultado
    // (dejando la cápsula sin abrir y el texto crudo visible en el chat).
    return `[result ${_toolName}]✅ ${truncated}${hasMore ? '…' : ''}[/result]`;
  }

  function handleStop() {
    abortRef.current?.abort();
    setIsRunning(false);
  }

  function applyMention(item: MentionItem) {
    // Si es una pista (hint) con acción (ej: "ir a Ajustes"), ejecutarla
    // en vez de insertar texto.
    if (item.action) {
      item.action();
      setMentionOpen(false);
      return;
    }
    const ta = taRef.current;
    if (!ta) return;
    const cursor = ta.selectionStart;
    const before = value.slice(0, cursor);
    const after = value.slice(cursor);
    const atIdx = before.search(/(?:^|\s)@[\w\-/]*$/);
    if (atIdx < 0) return;
    const prefix = before.slice(0, atIdx).trimEnd();
    const newValue = (prefix ? prefix + ' ' : '') + item.insert + ' ' + after;
    setValue(newValue);
    setMentionOpen(false);
    setTimeout(() => {
      if (taRef.current) {
        const pos = (prefix ? prefix.length + 1 : 0) + item.insert.length + 1;
        taRef.current.selectionStart = pos;
        taRef.current.selectionEnd = pos;
        taRef.current.focus();
      }
    }, 0);
  }

  // --- Render ---------------------------------------------------------------
  const placeholder =
    draftAttachments.length > 0
      ? 'Añade contexto o instrucciones sobre los archivos…'
      : 'Dime lo que quieres hacer… (usa @ para mencionar skills, proyectos, proveedores)';

  return (
    <div className="composer-outer px-2 sm:px-4 pb-2 sm:pb-4 pt-2 relative">
      <div className="w-full max-w-3xl mx-auto relative">
        {/* Drag overlay */}
        {isDragOver && (
          <div
            className="absolute inset-0 z-20 rounded-codex border-2 border-dashed border-accent bg-accent/10 flex items-center justify-center pointer-events-none"
            style={{ margin: '-4px' }}
          >
            <div className="flex items-center gap-2 text-accent-strong">
              <UploadCloud size={20} />
              <span className="font-medium text-sm">
                Suelta para adjuntar {dragCounterRef.current > 1 ? `${dragCounterRef.current} archivos` : 'el archivo'}
              </span>
            </div>
          </div>
        )}

        <div
          onDragEnter={onDragEnter}
          onDragLeave={onDragLeave}
          onDragOver={onDragOver}
          onDrop={onDrop}
          className={`codex-input rounded-codex border p-2 flex flex-col gap-2 transition-colors ${
            isDragOver ? 'border-accent bg-accent/5' : 'border-border-accent'
          }`}
        >
          {/* Attachment chips (si hay) */}
          {draftAttachments.length > 0 && (
            <div className="px-1 pt-1">
              <AttachmentChips
                attachments={draftAttachments}
                onRemove={removeDraftAttachment}
              />
            </div>
          )}

          {/* Error de adjuntos */}
          {attachmentError && (
            <div className="mx-1 px-2 py-1.5 rounded-codex bg-danger/10 border border-danger/30 text-danger text-xs whitespace-pre-wrap">
              {attachmentError}
            </div>
          )}

          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={handleFileInputChange}
            accept=".txt,.md,.markdown,.json,.js,.jsx,.ts,.tsx,.py,.rs,.go,.java,.c,.cpp,.h,.hpp,.html,.htm,.css,.scss,.yml,.yaml,.toml,.ini,.cfg,.sh,.bash,.zsh,.sql,.csv,.tsv,.xml,.svg,.log,.env,.png,.jpg,.jpeg,.gif,.webp,.bmp"
          />

          {/* Textarea con overlay de menciones @ */}
          <div className="relative">
            <textarea
              ref={taRef}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (mentionOpen && mentionItems.length > 0) {
                  if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    setMentionIndex((i) => (i + 1) % mentionItems.length);
                    return;
                  }
                  if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    setMentionIndex((i) => (i - 1 + mentionItems.length) % mentionItems.length);
                    return;
                  }
                  if (e.key === 'Enter' || e.key === 'Tab') {
                    e.preventDefault();
                    applyMention(mentionItems[mentionIndex]);
                    return;
                  }
                  if (e.key === 'Escape') {
                    setMentionOpen(false);
                    return;
                  }
                }
                if (e.key === 'Enter' && !e.shiftKey && !(e.ctrlKey || e.metaKey)) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              onPaste={(e) => {
                const files = e.clipboardData?.files;
                if (files && files.length > 0) {
                  e.preventDefault();
                  const arr: File[] = [];
                  for (let i = 0; i < files.length; i++) {
                    const f = files.item(i);
                    if (f) arr.push(f);
                  }
                  addFiles(arr);
                }
              }}
              placeholder={placeholder}
              className="w-full bg-transparent text-sm text-text-primary placeholder:text-text-muted outline-none resize-none px-1 py-1 min-h-[28px] max-h-[200px]"
              rows={1}
            />

            {/* Menú @ flotante */}
            {mentionOpen && mentionItems.length > 0 && (
              <div className="absolute bottom-full left-1 mb-1 z-30 w-80 max-h-64 overflow-y-auto bg-app-elevated border border-border-accent rounded-codex shadow-2xl animate-slide-up">
                <div className="px-2 py-1 text-[10px] text-text-muted uppercase tracking-wider border-b border-border">
                  Menciones — skills, proyectos, proveedores, MCP, archivos
                </div>
                {mentionItems.map((item, i) => (
                  <button
                    key={i}
                    onMouseEnter={() => setMentionIndex(i)}
                    onClick={() => applyMention(item)}
                    className={`w-full flex items-center gap-2 px-2 py-1.5 text-left transition-colors ${
                      i === mentionIndex ? 'bg-app-input' : 'hover:bg-app-input'
                    } ${item.type === 'hint' ? 'italic' : ''}`}
                  >
                    <MentionIcon icon={item.icon} />
                    <div className="flex-1 min-w-0">
                      <div className={`text-sm truncate ${item.type === 'hint' ? 'text-text-muted' : 'text-text-primary'}`}>{item.label}</div>
                      <div className="text-[10px] text-text-muted truncate">{item.desc}</div>
                    </div>
                    <span className="text-[9px] px-1 py-0.5 rounded bg-app-bg text-text-muted uppercase">
                      {item.type}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Bottom row: + popup | model picker | mic | send
              Sin el paperclip redundante (el + ya abre el menú de adjuntar).
              En modo IDE el model picker se oculta (ya está en la StatusBar).
              NO usar overflow-hidden aquí: el popup del + se despliega hacia arriba
              (bottom-9) y quedaría recortado. El model picker ya tiene truncate + shrink-0. */}
          <div className="flex items-center gap-1.5 px-1 relative flex-nowrap overflow-visible">
            {/* Botón + (abajo, al lado del model picker) — popup tipo Codex/Claude */}
            <div className="relative shrink-0">
              <button
                ref={plusBtnRef}
                onClick={() => setPlusOpen((v) => !v)}
                className="codex-icon-btn w-7 h-7 shrink-0"
                title="Añadir (archivo, carpeta, URL, modos…)"
              >
                <Plus size={16} />
              </button>

              {plusOpen && (
                <div
                  id="plus-popup"
                  className="absolute bottom-9 left-0 z-30 w-[30rem] max-w-[calc(100vw-2rem)] bg-app-elevated border border-border-accent rounded-codex shadow-2xl animate-slide-up overflow-hidden"
                >
                  {/* Dos columnas lado a lado (Añadir | Modos): el popup deja de
                      extenderse media pantalla en vertical. Cada columna scrollea
                      por sí sola si no cabe (max-h 65vh). */}
                  <div className="flex items-stretch divide-x divide-border">
                  {/* Columna izquierda: Añadir */}
                  <div className="w-44 shrink-0 overflow-y-auto max-h-[65vh]">
                  {/* Cabecera */}
                  <div className="px-3 py-2 text-[10px] text-text-muted uppercase tracking-wider border-b border-border">
                    Añadir
                  </div>

                  {/* Agregar fotos y archivos */}
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="w-full flex items-center gap-2 px-2.5 py-1.5 text-sm text-text-secondary hover:text-text-primary hover:bg-app-input transition-colors text-left"
                  >
                    <Paperclip size={15} className="text-accent shrink-0" />
                    <div className="flex-1">
                      <div className="font-medium">Agregar fotos y archivos</div>
                      <div className="text-[10px] text-text-muted">Texto, imagen o binario</div>
                    </div>
                  </button>

                  {/* Subir carpeta */}
                  <button
                    onClick={() => {
                      const input = document.createElement('input');
                      input.type = 'file';
                      input.setAttribute('webkitdirectory', '');
                      input.setAttribute('directory', '');
                      input.multiple = true;
                      input.onchange = (e) => {
                        const files = Array.from((e.target as HTMLInputElement).files ?? []);
                        addFiles(files);
                        setPlusOpen(false);
                      };
                      input.click();
                    }}
                    className="w-full flex items-center gap-2 px-2.5 py-1.5 text-sm text-text-secondary hover:text-text-primary hover:bg-app-input transition-colors text-left"
                  >
                    <Folder size={15} className="text-accent shrink-0" />
                    <div className="flex-1">
                      <div className="font-medium">Subir carpeta</div>
                      <div className="text-[10px] text-text-muted">Todos los archivos recursivamente</div>
                    </div>
                  </button>

                  {/* Añadir desde URL */}
                  <button
                    onClick={async () => {
                      const url = prompt('URL del archivo a descargar:');
                      if (!url) return;
                      setPlusOpen(false);
                      try {
                        const resp = await fetch(url);
                        const blob = await resp.blob();
                        const name = url.split('/').pop()?.split('?')[0] ?? 'download';
                        const file = new File([blob], name, { type: blob.type });
                        await addFiles([file]);
                      } catch (e) {
                        setAttachmentError(`No se pudo descargar: ${e instanceof Error ? e.message : String(e)}`);
                      }
                    }}
                    className="w-full flex items-center gap-2 px-2.5 py-1.5 text-sm text-text-secondary hover:text-text-primary hover:bg-app-input transition-colors text-left"
                  >
                    <LinkIcon size={15} className="text-accent shrink-0" />
                    <div className="flex-1">
                      <div className="font-medium">Añadir desde URL</div>
                      <div className="text-[10px] text-text-muted">Descarga y adjunta</div>
                    </div>
                  </button>

                  {/* Adjuntar app (AT-SPI, solo Tauri) */}
                  <button
                    onClick={() => {
                      setPlusOpen(false);
                      if (runtime.isBrowser) {
                        setAttachmentError('Adjuntar app requiere modo Tauri. Ejecuta con npm run tauri:dev.');
                        return;
                      }
                      setAppPickerOpen(true);
                    }}
                    className="w-full flex items-center gap-2 px-2.5 py-1.5 text-sm text-text-secondary hover:text-text-primary hover:bg-app-input transition-colors text-left"
                  >
                    <Monitor size={15} className="text-accent shrink-0" />
                    <div className="flex-1">
                      <div className="font-medium">Adjuntar app</div>
                      <div className="text-[10px] text-text-muted">
                        {runtime.isTauri ? 'Conectar vía AT-SPI' : 'Requiere Tauri'}
                      </div>
                    </div>
                  </button>

                  {/* Complementos (ir a vista) — cierra la columna Añadir */}
                  <button
                    onClick={() => {
                      setPlusOpen(false);
                      setView('complementos');
                    }}
                    className="w-full flex items-center gap-2 px-2.5 py-1.5 text-sm text-text-secondary hover:text-text-primary hover:bg-app-input transition-colors text-left"
                  >
                    <Puzzle size={15} className="text-accent shrink-0" />
                    <div className="flex-1">
                      <div className="font-medium">Complementos</div>
                      <div className="text-[10px] text-text-muted">Skills y servidores MCP</div>
                    </div>
                    <ChevronDown size={12} className="text-text-muted -rotate-90" />
                  </button>
                  </div>

                  {/* Columna derecha: Modos — toggles compactos */}
                  <div className="flex-1 min-w-0 overflow-y-auto max-h-[65vh]">
                  {/* Los modos son excluyentes: solo uno activo a la vez */}
                  <div className="px-3 py-2 text-[10px] uppercase tracking-wider text-text-muted border-b border-border">
                    Modos · solo uno activo
                  </div>

                  {/* Modo plan (toggle) */}
                  <button
                    onClick={() => setPlanMode(!planMode)}
                    className="w-full flex items-center gap-2 px-2.5 py-1.5 text-sm text-text-secondary hover:text-text-primary hover:bg-app-input transition-colors text-left"
                  >
                    <Map size={15} className={planMode ? 'text-accent' : 'text-text-muted shrink-0'} />
                    <div className="flex-1">
                      <div className="font-medium">Modo plan</div>
                      <div className="text-[10px] text-text-muted">Proponer plan y esperar confirmación</div>
                    </div>
                    <ToggleSwitch on={planMode} />
                  </button>

                  {/* Perseguir objetivo (toggle) */}
                  <button
                    onClick={() => setPursueObjective(!pursueObjective)}
                    className="w-full flex items-center gap-2 px-2.5 py-1.5 text-sm text-text-secondary hover:text-text-primary hover:bg-app-input transition-colors text-left"
                  >
                    <Target size={15} className={pursueObjective ? 'text-accent' : 'text-text-muted shrink-0'} />
                    <div className="flex-1">
                      <div className="font-medium">Perseguir objetivo</div>
                      <div className="text-[10px] text-text-muted">Iterar hasta completar (3 intentos)</div>
                    </div>
                    <ToggleSwitch on={pursueObjective} />
                  </button>

                  {/* Modo Cognitivo (toggle) */}
                  <button
                    onClick={() => setCognitiveMode(!cognitiveMode)}
                    className="w-full flex items-center gap-2 px-2.5 py-1.5 text-sm text-text-secondary hover:text-text-primary hover:bg-app-input transition-colors text-left"
                  >
                    <Network size={15} className={cognitiveMode ? 'text-accent' : 'text-text-muted shrink-0'} />
                    <div className="flex-1 min-w-0">
                      <div className="font-medium">Modo cognitivo</div>
                      <div className="text-[10px] text-text-muted truncate">
                        Hiper-especializado · grafo del proyecto (graphify)
                      </div>
                    </div>
                    <ToggleSwitch on={cognitiveMode} />
                  </button>

                  {/* Memoria Chat (toggle) */}
                  <button
                    onClick={() => setChatMemoryMode(!chatMemoryMode)}
                    className="w-full flex items-center gap-2 px-2.5 py-1.5 text-sm text-text-secondary hover:text-text-primary hover:bg-app-input transition-colors text-left"
                  >
                    <BookMarked size={15} className={chatMemoryMode ? 'text-accent' : 'text-text-muted shrink-0'} />
                    <div className="flex-1 min-w-0">
                      <div className="font-medium">Memoria chat</div>
                      <div className="text-[10px] text-text-muted truncate">
                        Recuerda nombre, gustos y contexto entre chats (memoria infinita)
                      </div>
                    </div>
                    <ToggleSwitch on={chatMemoryMode} />
                  </button>

                  {/* Memoria de Proyecto (toggle) — bitácora scoped a ESTE chat */}
                  <button
                    onClick={() => setProjectMemoryMode(!projectMemoryMode)}
                    className="w-full flex items-center gap-2 px-2.5 py-1.5 text-sm text-text-secondary hover:text-text-primary hover:bg-app-input transition-colors text-left"
                  >
                    <BrainIcon size={15} className={projectMemoryMode ? 'text-accent' : 'text-text-muted shrink-0'} />
                    <div className="flex-1 min-w-0">
                      <div className="font-medium">Memoria de proyecto</div>
                      <div className="text-[10px] text-text-muted truncate">
                        Bitácora de este chat: qué se hizo, qué falta, decisiones
                      </div>
                    </div>
                    <ToggleSwitch on={projectMemoryMode} />
                  </button>

                  {/* RLM — Recursive Language Model (toggle) */}
                  <button
                    onClick={() => setRlmEnabled(!rlmEnabled)}
                    className="w-full flex items-center gap-2 px-2.5 py-1.5 text-sm text-text-secondary hover:text-text-primary hover:bg-app-input transition-colors text-left"
                  >
                    <Workflow size={15} className={rlmEnabled ? 'text-accent' : 'text-text-muted shrink-0'} />
                    <div className="flex-1 min-w-0">
                      <div className="font-medium">Modo RLM</div>
                      <div className="text-[10px] text-text-muted truncate">
                        Contexto como variable · subagentes recursivos · auto-refine (/refine)
                      </div>
                    </div>
                    <ToggleSwitch on={rlmEnabled} />
                  </button>

                  </div>
                  </div>
                </div>
              )}
            </div>

            {/* Model picker — se comprime en pantallas estrechas, en IDE se oculta */}
            <button
              onClick={() => setModelPickerOpen(!modelPickerOpen)}
              className="composer-model-picker inline-flex items-center gap-1 px-2 py-1 rounded-codex border border-border-accent text-xs text-text-primary hover:bg-app-elevated transition-colors cursor-pointer min-w-0 shrink-0"
              title="Cambiar modelo"
            >
              <span className="opacity-70 truncate max-w-[80px] sm:max-w-none">{provider?.label.split(' ')[0]}</span>
              <span className="font-medium truncate max-w-[100px] sm:max-w-none">{modelLabel}</span>
              <ChevronDown size={12} className="opacity-60 shrink-0" />
            </button>

            {/* Indicadores de modos activos — ocultos en pantallas estrechas */}
            {planMode && (
              <span className="hidden md:inline-flex text-[10px] px-1.5 py-0.5 rounded bg-accent/15 text-accent border border-accent/30 items-center gap-1">
                <Map size={9} /> Plan
              </span>
            )}
            {pursueObjective && (
              <span className="hidden md:inline-flex text-[10px] px-1.5 py-0.5 rounded bg-accent/15 text-accent border border-accent/30 items-center gap-1">
                <Target size={9} /> Perseguir
              </span>
            )}
            {cognitiveMode && (
              <span className="hidden md:inline-flex text-[10px] px-1.5 py-0.5 rounded bg-accent/15 text-accent border border-accent/30 items-center gap-1">
                <Network size={9} /> Cognitivo
              </span>
            )}
            {chatMemoryMode && (
              <span className="hidden md:inline-flex text-[10px] px-1.5 py-0.5 rounded bg-accent/15 text-accent border border-accent/30 items-center gap-1">
                <BookMarked size={9} /> Memoria
              </span>
            )}
            {projectMemoryMode && (
              <span className="hidden md:inline-flex text-[10px] px-1.5 py-0.5 rounded bg-accent/15 text-accent border border-accent/30 items-center gap-1">
                <BrainIcon size={9} /> Bitácora
              </span>
            )}
            {rlmEnabled && (
              <span className="hidden md:inline-flex text-[10px] px-1.5 py-0.5 rounded bg-accent/15 text-accent border border-accent/30 items-center gap-1">
                <Workflow size={9} /> RLM
              </span>
            )}

            <div className="flex-1 min-w-0" />

            {/* El botón + ya cubre adjuntar (paperclip redundante eliminado) */}

            {/* Botón Voz — abre Weaver Live (modo voz bidireccional) */}
            <IconButton
              title="Modo Live (voz)"
              onClick={() => useVoiceStore.getState().setOpen(true)}
              className="w-7 h-7 shrink-0 hover:text-accent transition-colors"
            >
              <Mic size={14} />
            </IconButton>

            {isRunning ? (
              <Button variant="danger" onClick={handleStop} className="!p-1.5 shrink-0">
                <Square size={14} fill="currentColor" />
              </Button>
            ) : (
              <button
                onClick={handleSend}
                disabled={!value.trim() && draftAttachments.length === 0}
                className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-accent text-app-bg hover:bg-accent-strong transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer shrink-0"
                title="Enviar (Enter)"
              >
                <ArrowUp size={16} strokeWidth={2.5} />
              </button>
            )}
          </div>
        </div>

        {modelPickerOpen && <ModelPickerPopup onClose={() => setModelPickerOpen(false)} />}

        {appPickerOpen && (
          <AppPicker
            onClose={() => setAppPickerOpen(false)}
            onPick={async (app) => {
              setAttachedApp(app);
              // Inyectar contexto de la app en el composer.
              // Si estamos en Tauri, intentar capturar el árbol de accesibilidad
              // de la ventana seleccionada para que el agente tenga contexto real.
              let ctx = `\n[App adjunta: ${app.name} (${app.kind}, bus=${app.busName})]`;
              if (runtime.isTauri) {
                try {
                  // queryTree devuelve un AccessibleNode con children anidados.
                  // Limitamos la profundidad para no inflar el prompt.
                  const tree = await atspi.queryTree(app.busName, app.path, 3);
                  const summary = summarizeTree(tree, 3, 50);
                  if (summary) {
                    ctx += `\n[Árbol de accesibilidad (profundidad 3, máx 50 nodos)]:\n${summary}`;
                  }
                } catch (e) {
                  console.warn('[AppPicker] no se pudo capturar árbol AT-SPI:', e);
                  ctx += `\n[Nota: no se pudo capturar el árbol de accesibilidad — el agente puede usar la tool atspi_query_tree para explorarla en tiempo real]`;
                }
              }
              setValue((v) => v + ctx);
            }}
          />
        )}

        {/* Chip de app adjunta */}
        {attachedApp && (
          <div className="flex items-center gap-2 px-3 py-1.5 mx-auto max-w-3xl mt-2 rounded-codex bg-accent/10 border border-accent/30 text-xs">
            <Monitor size={12} className="text-accent" />
            <span className="text-text-primary font-medium">{attachedApp.name}</span>
            <span className="text-text-muted">· {attachedApp.kind}</span>
            <button
              onClick={() => {
                setAttachedApp(null);
                setValue((v) => v.replace(/\n\[App adjunta: [^\]]+\]/, ''));
              }}
              className="ml-auto codex-icon-btn w-5 h-5"
              title="Quitar app adjunta"
            >
              <X size={10} />
            </button>
          </div>
        )}

        <div className="text-center mt-2">
          <span className="text-[10px] sm:text-xs text-text-muted">
            {draftAttachments.length > 0
              ? `${draftAttachments.length} adjunto(s) · arrastrar más o pulsar + para añadir`
              : 'Weaver puede equivocarse. Verifica acciones críticas.'}
          </span>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Toggle Switch (estilo iOS/Codex)
// ============================================================================

function ToggleSwitch({ on }: { on: boolean }) {
  return (
    <span
      className={`relative inline-block w-8 h-4 rounded-full transition-colors ${
        on ? 'bg-accent' : 'bg-border-accent'
      }`}
    >
      <span
        className={`absolute top-0.5 left-0.5 w-3 h-3 rounded-full bg-white transition-transform ${
          on ? 'translate-x-4' : 'translate-x-0'
        }`}
      />
    </span>
  );
}

// ============================================================================
// Tipos y helpers para menciones @
// ============================================================================

interface MentionItem {
  type: 'skill' | 'provider' | 'file' | 'project' | 'command' | 'mcp' | 'hint';
  label: string;
  desc: string;
  icon: 'brain' | 'globe' | 'file' | 'image' | 'puzzle' | 'settings';
  insert: string;
  /** Si está presente, al hacer click se ejecuta esta acción (en vez de insertar texto). */
  action?: () => void;
}

function MentionIcon({ icon }: { icon: MentionItem['icon'] }) {
  const props = { size: 14, className: 'text-accent shrink-0' };
  switch (icon) {
    case 'brain':
      return <Brain {...props} />;
    case 'globe':
      return <Globe {...props} />;
    case 'image':
      return <ImageIcon {...props} />;
    case 'puzzle':
      return <Puzzle {...props} />;
    case 'settings':
      return <SettingsIcon {...props} />;
    case 'file':
    default:
      return <FileText {...props} />;
  }
}

/**
 * Resume un árbol de accesibilidad en texto plano para inyectarlo como
 * contexto del agente cuando se adjunta una app.
 * - Profundidad limitada para no inflar el prompt.
 * - Máximo N nodos para evitar árboles gigantes (Chrome, VSCode).
 */
function summarizeTree(
  node: { name?: string | null; role?: string; text?: string | null; children?: unknown[] },
  depth: number,
  maxNodes: number,
): string {
  const lines: string[] = [];
  let count = 0;
  function walk(n: typeof node, d: number) {
    if (count >= maxNodes) return;
    if (d > depth) return;
    const indent = '  '.repeat(d);
    const label = n.name || n.text || '';
    const role = n.role || '?';
    lines.push(`${indent}- [${role}]${label ? ` ${String(label).slice(0, 80)}` : ''}`);
    count++;
    if (Array.isArray(n.children)) {
      for (const c of n.children) {
        walk(c as typeof node, d + 1);
        if (count >= maxNodes) return;
      }
    }
  }
  walk(node, 0);
  if (count >= maxNodes) lines.push(`... (truncado a ${maxNodes} nodos)`);
  return lines.join('\n');
}
