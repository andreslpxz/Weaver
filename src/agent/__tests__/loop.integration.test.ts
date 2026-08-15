/**
 * Test de integración del bucle agéntico con modo RLM activado.
 *
 * Verifica que runAgent use executeWithRlm cuando useRlm=true, y que
 * emita los eventos rlm_spawn y rlm_context_updated.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runAgent, type AgentEvent } from '../loop';
import type { LLMProvider } from '@/providers/types';

// Mock de todas las dependencias del loop.
vi.mock('@/lib/chain', () => ({
  streamChat: vi.fn(async () => ({
    text: 'RESULT: done',
    toolCalls: [],
    usage: { inputTokens: 10, outputTokens: 5 },
  })),
  streamUntilDone: vi.fn(async () => 'reflection result'),
}));

vi.mock('../planner', () => ({
  plan: vi.fn(async (_p, _m, _o) => ({
    objective: { id: 'o1', text: 'test', createdAt: Date.now() },
    subtasks: [{
      id: 'st-1',
      description: 'do the thing',
      successCriteria: 'thing done',
      dependsOn: [],
      status: 'pending',
      attempts: 0,
      maxAttempts: 3,
      trace: [],
    }],
  })),
}));

vi.mock('../executor', () => ({
  executeSubtask: vi.fn(async () => ({
    status: 'succeeded',
    summary: 'legacy executor result',
    trace: [{ ts: 1, kind: 'thought' as const, content: 'did it' }],
  })),
}));

vi.mock('../critic', () => ({
  critique: vi.fn(async () => ({
    verdict: 'satisfied' as const,
    reason: 'looks good',
  })),
}));

vi.mock('../reflection', () => ({
  reflect: vi.fn(async () => ({
    lessons: ['lesson 1'],
  })),
}));

vi.mock('../memory', () => ({
  memory: {
    findSimilar: vi.fn(async () => []),
    saveEpisode: vi.fn(async () => undefined),
    listEpisodes: vi.fn(async () => []),
  },
}));

// Mock del módulo RLM para espiar executeWithRlm.
vi.mock('../rlm', () => {
  // Store mock consistente.
  const mockStore = {
    list: () => [{ id: 'f1', key: 'test-key', content: 'test content', source: 'manual', createdAt: 1, size: 12 }],
    totalSize: () => 12,
  };
  return {
    executeWithRlm: vi.fn(async (_p, _m, _objective, _crit, _opts) => ({
      status: 'succeeded',
      summary: 'rlm executor result',
      trace: [{ ts: 1, kind: 'tool_call' as const, content: 'ctx_list' }],
      contextStore: mockStore,
      usage: { inputTokens: 50, outputTokens: 25, steps: 3, elapsedMs: 1000 },
    })),
    createRootRecursionContext: vi.fn(() => ({
      depth: 0,
      path: ['root'],
      store: mockStore,
      limits: { maxDepth: 3, maxTotalChildren: 50, maxConcurrentChildren: 5, maxTotalTimeMs: 600_000 },
      totalChildrenSpawned: 0,
      treeStart: Date.now(),
      provider: null,
      model: '',
      onSpawn: undefined,
      signal: undefined,
    })),
    registerSpawnChildAgentHook: vi.fn(() => () => {}),
  };
});

const mockProvider: LLMProvider = {
  info: { id: 'test', name: 'Test', kind: 'openai-compat', models: [] },
  streamChat: vi.fn(),
} as unknown as LLMProvider;

describe('runAgent con RLM', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('usa executeWithRlm cuando useRlm=true', async () => {
    const { executeWithRlm } = await import('../rlm');
    const events: AgentEvent[] = [];

    const gen = runAgent(mockProvider, 'test-model', 'test objective', {
      useRlm: true,
      onEvent: (e) => events.push(e),
    });

    for await (const _ of gen) void _;

    expect(executeWithRlm).toHaveBeenCalled();
    // El summary debe venir del RLM executor.
    const subtaskFinished = events.find((e) => e.type === 'subtask_finished');
    expect(subtaskFinished).toBeDefined();
    if (subtaskFinished?.type === 'subtask_finished') {
      expect(subtaskFinished.summary).toBe('rlm executor result');
    }
  });

  it('usa executor legacy cuando useRlm=false', async () => {
    const { executeWithRlm } = await import('../rlm');
    const { executeSubtask } = await import('../executor');

    const gen = runAgent(mockProvider, 'test-model', 'test objective', {
      useRlm: false,
      onEvent: () => {},
    });
    for await (const _ of gen) void _;

    expect(executeSubtask).toHaveBeenCalled();
    expect(executeWithRlm).not.toHaveBeenCalled();
  });

  it('emite evento rlm_context_updated tras cada subtarea RLM', async () => {
    const events: AgentEvent[] = [];
    const gen = runAgent(mockProvider, 'test-model', 'test', {
      useRlm: true,
      onEvent: (e) => events.push(e),
    });
    for await (const _ of gen) void _;

    const ctxUpdates = events.filter((e) => e.type === 'rlm_context_updated');
    expect(ctxUpdates.length).toBeGreaterThan(0);
    if (ctxUpdates[0]?.type === 'rlm_context_updated') {
      expect(ctxUpdates[0].fragments.length).toBe(1);
      expect(ctxUpdates[0].totalSize).toBe(12);
    }
  });

  it('registra y limpia el hook global de spawn_child_agent', async () => {
    const { registerSpawnChildAgentHook } = await import('../rlm');
    const gen = runAgent(mockProvider, 'test-model', 'test', { useRlm: true });
    for await (const _ of gen) void _;

    expect(registerSpawnChildAgentHook).toHaveBeenCalledTimes(1);
  });

  it('no registra hook cuando useRlm=false', async () => {
    const { registerSpawnChildAgentHook } = await import('../rlm');
    const gen = runAgent(mockProvider, 'test-model', 'test', { useRlm: false });
    for await (const _ of gen) void _;

    expect(registerSpawnChildAgentHook).not.toHaveBeenCalled();
  });

  it('emite episode_finished al final', async () => {
    const events: AgentEvent[] = [];
    const gen = runAgent(mockProvider, 'test-model', 'test', {
      useRlm: true,
      onEvent: (e) => events.push(e),
    });
    for await (const _ of gen) void _;

    expect(events.some((e) => e.type === 'episode_finished')).toBe(true);
    expect(events.some((e) => e.type === 'planning_started')).toBe(true);
    expect(events.some((e) => e.type === 'plan_ready')).toBe(true);
  });
});
