import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TelegramBotManager } from '../telegramBot';
import { useWeaver } from '@/store/weaver';

// Mock fetch globally
const globalFetch = vi.fn();
globalThis.fetch = globalFetch;

describe('TelegramBotManager', () => {
  let manager: TelegramBotManager;

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new TelegramBotManager();
    // Reset Weaver store state with a dummy initial conversation
    const initialId = 'init-conv';
    useWeaver.setState({
      conversations: [
        {
          id: initialId,
          title: 'Chat Inicial',
          projectId: null,
          messages: [],
          traces: {},
          agentState: 'idle',
          createdAt: Date.now(),
          updatedAt: Date.now(),
          ownerMemberId: null,
        },
      ],
      activeConversationId: initialId,
      meIntegrations: [],
      providerId: 'openai',
      modelId: 'gpt-4o',
    });
  });

  describe('getConfig & syncState', () => {
    it('returns disabled when no telegram integration exists', () => {
      const cfg = manager.getConfig();
      expect(cfg.enabled).toBe(false);
      expect(cfg.botToken).toBe('');
    });

    it('returns enabled config when telegram integration is present', () => {
      useWeaver.setState({
        meIntegrations: [
          {
            id: 'telegram',
            kind: 'messaging',
            label: 'Telegram',
            config_json: JSON.stringify({ bot_token: '123456:ABC-DEF', chat_id: '999' }),
            enabled: true,
            created_at: Date.now(),
          },
        ],
      });

      const cfg = manager.getConfig();
      expect(cfg.enabled).toBe(true);
      expect(cfg.botToken).toBe('123456:ABC-DEF');
      expect(cfg.chatId).toBe('999');
    });

    it('syncState starts and stops the bot depending on integration state', () => {
      expect(manager.isRunning()).toBe(false);

      useWeaver.setState({
        meIntegrations: [
          {
            id: 'telegram',
            kind: 'messaging',
            label: 'Telegram',
            config_json: JSON.stringify({ bot_token: '123456:ABC-DEF' }),
            enabled: true,
            created_at: Date.now(),
          },
        ],
      });

      // Mock fetch to prevent infinite loop or pending network request in test
      globalFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ ok: true, result: [] }),
      });

      manager.syncState();
      expect(manager.isRunning()).toBe(true);

      // Disable integration and sync
      useWeaver.setState({
        meIntegrations: [
          {
            id: 'telegram',
            kind: 'messaging',
            label: 'Telegram',
            config_json: JSON.stringify({ bot_token: '123456:ABC-DEF' }),
            enabled: false,
            created_at: Date.now(),
          },
        ],
      });

      manager.syncState();
      expect(manager.isRunning()).toBe(false);
    });
  });

  describe('handleIncomingMessage commands', () => {
    const fakeChatId = 12345;

    beforeEach(() => {
      // Mock sendMessage network calls to return ok
      globalFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ ok: true }),
      });
      // Set token without running long polling
      (manager as unknown as { botToken: string }).botToken = 'test-token';
    });

    it('responds to /help with command list', async () => {
      await manager.handleIncomingMessage({
        message_id: 1,
        chat: { id: fakeChatId, type: 'private' },
        date: Date.now(),
        text: '/help',
      });

      expect(globalFetch).toHaveBeenCalledWith(
        expect.stringContaining('/sendMessage'),
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('/new'),
        }),
      );
    });

    it('responds to /models with model and provider information', async () => {
      await manager.handleIncomingMessage({
        message_id: 2,
        chat: { id: fakeChatId, type: 'private' },
        date: Date.now(),
        text: '/models',
      });

      expect(globalFetch).toHaveBeenCalledWith(
        expect.stringContaining('/sendMessage'),
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('openai'),
        }),
      );
    });

    it('creates a new conversation on /new', async () => {
      const prevCount = useWeaver.getState().conversations.length;

      await manager.handleIncomingMessage({
        message_id: 3,
        chat: { id: fakeChatId, type: 'private' },
        date: Date.now(),
        text: '/new',
      });

      const conversations = useWeaver.getState().conversations;
      expect(conversations.length).toBe(prevCount + 1);
      expect(conversations[0].title).toBe('Nuevo chat');

      expect(globalFetch).toHaveBeenCalledWith(
        expect.stringContaining('/sendMessage'),
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('Nuevo chat iniciado'),
        }),
      );
    });

    it('lists conversations on /chat without arguments', async () => {
      await manager.handleIncomingMessage({
        message_id: 4,
        chat: { id: fakeChatId, type: 'private' },
        date: Date.now(),
        text: '/chat',
      });

      expect(globalFetch).toHaveBeenCalledWith(
        expect.stringContaining('/sendMessage'),
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('Chat Inicial'),
        }),
      );
    });

    it('switches conversation on /chat <number>', async () => {
      const id2 = useWeaver.getState().newConversation();
      useWeaver.getState().renameConversation(id2, 'Chat Dos');

      await manager.handleIncomingMessage({
        message_id: 5,
        chat: { id: fakeChatId, type: 'private' },
        date: Date.now(),
        text: '/chat 1', // 1st conversation in list (1-based index)
      });

      expect(globalFetch).toHaveBeenCalledWith(
        expect.stringContaining('/sendMessage'),
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('Cambiado a la conversación'),
        }),
      );
    });

    it('notifies error on unknown commands', async () => {
      await manager.handleIncomingMessage({
        message_id: 6,
        chat: { id: fakeChatId, type: 'private' },
        date: Date.now(),
        text: '/invalidcommand',
      });

      expect(globalFetch).toHaveBeenCalledWith(
        expect.stringContaining('/sendMessage'),
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('Comando no reconocido'),
        }),
      );
    });
  });

  describe('sendMessage formatting and splitting', () => {
    beforeEach(() => {
      globalFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ ok: true }),
      });
      (manager as unknown as { botToken: string }).botToken = 'test-token';
    });

    it('sends long messages in multiple chunks', async () => {
      const longText = 'A'.repeat(5000);
      await manager.sendLongMessage(12345, longText);

      // Should split 5000 chars into 2 API calls (max chunk ~3800)
      expect(globalFetch).toHaveBeenCalledTimes(2);
    });
  });
});
