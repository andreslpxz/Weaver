/**
 * RLM-2 / RLM-4 — Tests de spawnChildAgent y recursion limits.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  spawnChildAgent,
  createRootRecursionContext,
  registerSpawnChildAgentHook,
  hasSpawnChildAgentHook,
  DEFAULT_RLM_LIMITS,
  type RecursionContext,
} from '../rlm/spawnChildAgent';
import { ContextStore } from '../rlm/contextStore';
import type { LLMProvider } from '@/providers/types';

// Mock runSubagent para no requerir provider real.
vi.mock('@/lib/chain', () => ({
  streamChat: vi.fn(async () => ({
    text: 'RESULT: test result',
    toolCalls: [],
    usage: { inputTokens: 10, outputTokens: 5 },
  })),
  streamUntilDone: vi.fn(async () => 'test result'),
}));

vi.mock('@/lib/metrics', () => ({
  metrics: { recordUsage: vi.fn() },
}));

vi.mock('@/lib/tools', () => ({
  dispatchAdvancedTool: vi.fn(async () => ({ ok: true, output: 'mock', error: undefined })),
  buildAdvancedToolsList: vi.fn(() => []),
}));

vi.mock('../subagent', () => ({
  subagentRegistry: {
    list: () => [
      {
        id: 'test-sa',
        name: 'Test Subagent',
        description: 'A test subagent',
        providerId: null,
        model: null,
        allowedTools: [],
        systemPrompt: 'test',
        verificationPrompt: 'test',
        defaultBudget: { maxSteps: 3, maxTokens: 1000, maxTimeMs: 10_000 },
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    ],
    get: (id: string) => (id === 'test-sa' ? {
      id: 'test-sa',
      name: 'Test Subagent',
      description: 'test',
      providerId: null,
      model: null,
      allowedTools: [],
      systemPrompt: 'test',
      verificationPrompt: 'test',
      defaultBudget: { maxSteps: 3, maxTokens: 1000, maxTimeMs: 10_000 },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    } : undefined),
  },
  runSubagent: vi.fn(async () => ({
    subagentId: 'test-sa',
    subagentName: 'Test Subagent',
    status: 'succeeded',
    result: 'subagent result',
    evidence: [],
    trace: [],
    usage: { inputTokens: 100, outputTokens: 50, steps: 2, elapsedMs: 500 },
  })),
}));

const mockProvider: LLMProvider = {
  info: { id: 'test', name: 'Test', kind: 'openai-compat', models: [] },
  streamChat: vi.fn(),
} as unknown as LLMProvider;

describe('createRootRecursionContext', () => {
  it('creates a context with depth 0', () => {
    const ctx = createRootRecursionContext({
      provider: mockProvider,
      model: 'test-model',
    });
    expect(ctx.depth).toBe(0);
    expect(ctx.path).toEqual(['root']);
    expect(ctx.store).toBeInstanceOf(ContextStore);
    expect(ctx.limits).toEqual(DEFAULT_RLM_LIMITS);
    expect(ctx.totalChildrenSpawned).toBe(0);
  });

  it('merges custom limits', () => {
    const ctx = createRootRecursionContext({
      provider: mockProvider,
      model: 'test-model',
      limits: { maxDepth: 2 },
    });
    expect(ctx.limits.maxDepth).toBe(2);
    expect(ctx.limits.maxTotalChildren).toBe(DEFAULT_RLM_LIMITS.maxTotalChildren);
  });
});

describe('spawnChildAgent', () => {
  let rootCtx: RecursionContext;

  beforeEach(() => {
    rootCtx = createRootRecursionContext({
      provider: mockProvider,
      model: 'test-model',
      limits: { maxDepth: 3, maxTotalChildren: 10, maxTotalTimeMs: 60_000 },
    });
  });

  it('spawns a child successfully', async () => {
    const result = await spawnChildAgent(
      'test objective',
      'Test Subagent',
      'test context',
      undefined,
      rootCtx,
    );
    expect(result.status).toBe('succeeded');
    expect(result.result).toBe('subagent result');
    expect(result.childId).toMatch(/^child-/);
  });

  it('auto-selects subagent when name not provided', async () => {
    const result = await spawnChildAgent(
      'research something',
      undefined,
      '',
      undefined,
      rootCtx,
    );
    expect(result.status).toBe('succeeded');
  });

  it('returns failed when subagent not found and no candidates', async () => {
    // Mock empty registry for this test.
    const { subagentRegistry } = await import('../subagent');
    const original = subagentRegistry.list;
    (subagentRegistry as { list: () => unknown[] }).list = () => [];
    const result = await spawnChildAgent('test', 'Nonexistent', '', undefined, rootCtx);
    expect(result.status).toBe('failed');
    (subagentRegistry as { list: () => unknown[] }).list = original;
  });

  it('returns depth_exceeded when at max depth', async () => {
    const deepCtx: RecursionContext = {
      ...rootCtx,
      depth: rootCtx.limits.maxDepth,
    };
    const result = await spawnChildAgent('test', 'Test Subagent', '', undefined, deepCtx);
    expect(result.status).toBe('depth_exceeded');
  });

  it('returns total_limit_exceeded when too many children spawned', async () => {
    const limitedCtx: RecursionContext = {
      ...rootCtx,
      totalChildrenSpawned: rootCtx.limits.maxTotalChildren,
    };
    const result = await spawnChildAgent('test', 'Test Subagent', '', undefined, limitedCtx);
    expect(result.status).toBe('total_limit_exceeded');
  });

  it('returns cancelled when signal aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const cancelledCtx: RecursionContext = {
      ...rootCtx,
      signal: controller.signal,
    };
    const result = await spawnChildAgent('test', 'Test Subagent', '', undefined, cancelledCtx);
    expect(result.status).toBe('cancelled');
  });

  it('returns timeout when total time exceeded', async () => {
    const expiredCtx: RecursionContext = {
      ...rootCtx,
      treeStart: Date.now() - rootCtx.limits.maxTotalTimeMs - 1,
    };
    const result = await spawnChildAgent('test', 'Test Subagent', '', undefined, expiredCtx);
    expect(result.status).toBe('timeout');
  });

  it('calls onSpawn callback', async () => {
    const onSpawn = vi.fn();
    const ctx = createRootRecursionContext({
      provider: mockProvider,
      model: 'test-model',
      onSpawn,
    });
    await spawnChildAgent('test objective', 'Test Subagent', 'context', undefined, ctx);
    expect(onSpawn).toHaveBeenCalledTimes(1);
    const info = onSpawn.mock.calls[0][0];
    expect(info.subagentName).toBe('Test Subagent');
    expect(info.objective).toBe('test objective');
    expect(info.depth).toBe(1);
  });

  it('overrides budget when provided', async () => {
    const { runSubagent } = await import('../subagent');
    (runSubagent as unknown as ReturnType<typeof vi.fn>).mockClear();
    await spawnChildAgent(
      'test',
      'Test Subagent',
      '',
      { maxSteps: 99, maxTokens: 9999, maxTimeMs: 99_999 },
      rootCtx,
    );
    expect((runSubagent as unknown as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        budgetOverride: expect.objectContaining({
          maxSteps: 99,
          maxTokens: 9999,
          maxTimeMs: 99_999,
        }),
      }),
    );
  });
});

describe('registerSpawnChildAgentHook', () => {
  it('registers a hook and cleans up', () => {
    const ctx = createRootRecursionContext({
      provider: mockProvider,
      model: 'test',
    });
    expect(hasSpawnChildAgentHook()).toBe(false);
    const cleanup = registerSpawnChildAgentHook(ctx);
    expect(hasSpawnChildAgentHook()).toBe(true);
    cleanup();
    expect(hasSpawnChildAgentHook()).toBe(false);
  });

  it('hook intercepts spawn_child_agent calls', async () => {
    const ctx = createRootRecursionContext({
      provider: mockProvider,
      model: 'test',
    });
    const cleanup = registerSpawnChildAgentHook(ctx);
    const hook = (window as unknown as { __weaverRlmSpawnHook?: (name: string, args: Record<string, unknown>) => Promise<{ ok: boolean; output: string; error?: string } | null> }).__weaverRlmSpawnHook;
    expect(hook).toBeDefined();

    const result = await hook!('spawn_child_agent', {
      objective: 'hook test',
      subagentName: 'Test Subagent',
    });
    expect(result).not.toBeNull();
    expect(result?.ok).toBe(true);

    // Verificar que el resultado se guardó en el ContextStore del padre.
    const keys = ctx.store.list();
    expect(keys.some((k) => k.key.startsWith('child:'))).toBe(true);

    cleanup();
  });

  it('hook returns null for non-spawn tools', async () => {
    const ctx = createRootRecursionContext({
      provider: mockProvider,
      model: 'test',
    });
    const cleanup = registerSpawnChildAgentHook(ctx);
    const hook = (window as unknown as { __weaverRlmSpawnHook?: (name: string, args: Record<string, unknown>) => Promise<{ ok: boolean; output: string; error?: string } | null> }).__weaverRlmSpawnHook;
    const result = await hook!('other_tool', {});
    expect(result).toBeNull();
    cleanup();
  });
});
