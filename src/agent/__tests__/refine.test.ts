/**
 * RLM-3 — Tests del /refine command y auto-refinamiento.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  refine,
  evaluateRefine,
  revertToSnapshot,
  runRefineCommand,
  type RefineSnapshot,
  type RefineAction,
} from '../rlm/refine';
import type { Episode } from '../types';
import type { LLMProvider } from '@/providers/types';

vi.mock('@/lib/chain', () => ({
  streamChat: vi.fn(),
  streamUntilDone: vi.fn(async (_p: unknown, _m: unknown, _msgs: unknown, _opts: unknown) =>
    JSON.stringify({
      actions: [
        {
          type: 'prompt_refine',
          target: 'default-web-researcher',
          description: 'Add explicit instruction to verify URLs',
          patch: { systemPrompt: 'new prompt with URL verification' },
          rationale: 'Web researcher missed URLs in 3 episodes',
          expectedImprovement: 'reduce retries by 30%',
        },
      ],
      summary: 'Improved web researcher prompt',
    }),
  ),
}));

vi.mock('@/skills/registry', () => ({
  skillsRegistry: {
    saveLearnedSkill: vi.fn(async () => undefined),
  },
}));

vi.mock('../subagent', () => ({
  subagentRegistry: {
    list: () => [{
      id: 'default-web-researcher',
      name: 'Web Researcher',
      description: 'research',
      providerId: null,
      model: null,
      allowedTools: ['web_search', 'web_fetch'],
      systemPrompt: 'old prompt',
      verificationPrompt: 'verify',
      defaultBudget: { maxSteps: 8, maxTokens: 8000, maxTimeMs: 90_000 },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }],
    get: (id: string) => id === 'default-web-researcher' ? {
      id: 'default-web-researcher',
      name: 'Web Researcher',
      description: 'research',
      providerId: null,
      model: null,
      allowedTools: ['web_search', 'web_fetch'],
      systemPrompt: 'old prompt',
      verificationPrompt: 'verify',
      defaultBudget: { maxSteps: 8, maxTokens: 8000, maxTimeMs: 90_000 },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    } : undefined,
    save: vi.fn(),
    delete: vi.fn(),
  },
  runSubagent: vi.fn(),
}));

const mockProvider: LLMProvider = {
  info: { id: 'test', name: 'Test', kind: 'openai-compat', models: [] },
  streamChat: vi.fn(),
} as unknown as LLMProvider;

function makeEpisode(outcome: Episode['outcome'] = 'success', traceCount = 10): Episode {
  return {
    id: 'ep-1',
    objective: 'test objective',
    plan: {
      objective: { id: 'o1', text: 'test', createdAt: Date.now() },
      subtasks: [{
        id: 'st-1',
        description: 'do thing',
        successCriteria: 'thing done',
        dependsOn: [],
        status: 'succeeded',
        attempts: 1,
        maxAttempts: 3,
        trace: Array.from({ length: traceCount }, (_, i) => ({
          ts: i,
          kind: 'tool_call' as const,
          content: `step ${i}`,
        })),
      }],
    },
    startedAt: 1000,
    finishedAt: 2000,
    outcome,
    lessons: [],
  };
}

describe('refine', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns actions from LLM response', async () => {
    const episode = makeEpisode();
    const result = await refine(mockProvider, 'test-model', episode, [], { autoApply: false });
    expect(result.actions.length).toBe(1);
    expect(result.actions[0].type).toBe('prompt_refine');
    expect(result.actions[0].target).toBe('default-web-researcher');
    expect(result.applied).toBe(false);
  });

  it('applies actions when autoApply is true', async () => {
    const episode = makeEpisode();
    const result = await refine(mockProvider, 'test-model', episode, [], { autoApply: true });
    expect(result.applied).toBe(true);
    expect(result.snapshot).toBeDefined();
    // Verificar que se llamó save en el registry.
    const { subagentRegistry } = await import('../subagent');
    expect(subagentRegistry.save).toHaveBeenCalled();
  });

  it('takes a snapshot before applying', async () => {
    const episode = makeEpisode();
    const result = await refine(mockProvider, 'test-model', episode, [], { autoApply: true });
    expect(result.snapshot.timestamp).toBeGreaterThan(0);
    expect(result.snapshot.subagents.length).toBeGreaterThan(0);
    expect(result.snapshot.traceSteps).toBe(10);
  });

  it('caps actions at 3', async () => {
    const { streamUntilDone } = await import('@/lib/chain');
    (streamUntilDone as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      JSON.stringify({
        actions: Array.from({ length: 10 }, (_, i) => ({
          type: 'prompt_refine',
          target: `sa-${i}`,
          description: 'change',
          patch: { systemPrompt: 'x' },
          rationale: 'r',
        })),
        summary: 'many',
      }),
    );
    const episode = makeEpisode();
    const result = await refine(mockProvider, 'test-model', episode);
    expect(result.actions.length).toBe(3);
  });

  it('handles invalid LLM response', async () => {
    const { streamUntilDone } = await import('@/lib/chain');
    (streamUntilDone as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce('not json');
    const episode = makeEpisode();
    const result = await refine(mockProvider, 'test-model', episode);
    expect(result.actions).toEqual([]);
    expect(result.summary.toLowerCase()).toContain('no se pudo');
  });

  it('handles empty actions array', async () => {
    const { streamUntilDone } = await import('@/lib/chain');
    (streamUntilDone as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      JSON.stringify({ actions: [], summary: 'no changes needed' }),
    );
    const episode = makeEpisode();
    const result = await refine(mockProvider, 'test-model', episode, [], { autoApply: true });
    expect(result.actions).toEqual([]);
    expect(result.applied).toBe(false); // no actions to apply
  });
});

describe('evaluateRefine', () => {
  it('returns neutral when no after episodes', () => {
    const snap: RefineSnapshot = {
      timestamp: Date.now(),
      subagents: [],
      skills: [],
      contextStoreSize: 0,
      traceSteps: 10,
      version: 1,
    };
    const evaluation = evaluateRefine(snap, []);
    expect(evaluation.outcome).toBe('neutral');
    expect(evaluation.shouldRevert).toBe(false);
  });

  it('detects improvement when tokens/steps decrease', () => {
    const snap: RefineSnapshot = {
      timestamp: Date.now(),
      subagents: [],
      skills: [],
      contextStoreSize: 0,
      traceSteps: 20,
      version: 1,
    };
    // After episodes con menos steps.
    const afterEpisodes = [makeEpisode('success', 5)];
    const evaluation = evaluateRefine(snap, afterEpisodes);
    expect(evaluation.outcome).toBe('improved');
    expect(evaluation.delta.steps).toBeGreaterThan(0);
    expect(evaluation.shouldRevert).toBe(false);
  });

  it('detects regression when steps increase significantly', () => {
    const snap: RefineSnapshot = {
      timestamp: Date.now(),
      subagents: [],
      skills: [],
      contextStoreSize: 0,
      traceSteps: 5,
      version: 1,
    };
    // After episodes con muchos más steps.
    const afterEpisodes = [makeEpisode('failure', 20)];
    const evaluation = evaluateRefine(snap, afterEpisodes);
    expect(evaluation.outcome).toBe('regressed');
    expect(evaluation.shouldRevert).toBe(true);
  });
});

describe('revertToSnapshot', () => {
  it('restores subagents from snapshot', async () => {
    const { subagentRegistry } = await import('../subagent');
    const snap: RefineSnapshot = {
      timestamp: Date.now(),
      subagents: [{
        id: 'old-sa',
        name: 'Old',
        description: 'restored',
        providerId: null,
        model: null,
        allowedTools: [],
        systemPrompt: 'old',
        verificationPrompt: '',
        defaultBudget: { maxSteps: 1, maxTokens: 1, maxTimeMs: 1 },
        createdAt: 1,
        updatedAt: 1,
      }],
      skills: [],
      contextStoreSize: 0,
      traceSteps: 0,
      version: 1,
    };
    await revertToSnapshot(snap);
    expect(subagentRegistry.save).toHaveBeenCalledWith(expect.objectContaining({ id: 'old-sa' }));
  });
});

describe('runRefineCommand', () => {
  it('fails when no episodes', async () => {
    const result = await runRefineCommand(mockProvider, 'test-model', []);
    expect(result.ok).toBe(false);
    expect(result.message.toLowerCase()).toContain('no hay episodios');
  });

  it('runs refine on the last episode', async () => {
    const episodes = [makeEpisode(), makeEpisode()];
    const result = await runRefineCommand(mockProvider, 'test-model', episodes);
    expect(result.ok).toBe(true);
    expect(result.actionsCount).toBeGreaterThan(0);
  });

  it('reports applied status', async () => {
    const episodes = [makeEpisode()];
    const result = await runRefineCommand(mockProvider, 'test-model', episodes, true);
    expect(result.applied).toBe(true);
    expect(result.message).toContain('aplicados');
  });

  it('reports not-applied when autoApply false', async () => {
    const episodes = [makeEpisode()];
    const result = await runRefineCommand(mockProvider, 'test-model', episodes, false);
    expect(result.applied).toBe(false);
    expect(result.message).toContain('NO aplicados');
  });
});

describe('RefineAction types', () => {
  it('supports all action types', async () => {
    const { streamUntilDone } = await import('@/lib/chain');
    (streamUntilDone as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      JSON.stringify({
        actions: [
          { type: 'prompt_refine', target: 'sa1', description: 'd', patch: { systemPrompt: 'p' }, rationale: 'r' },
          { type: 'skill_create', target: 'skill1', description: 'd', patch: { name: 'skill1', description: 'd', triggers: [], body: '' }, rationale: 'r' },
          { type: 'skill_update', target: 'skill1', description: 'd', patch: { name: 'skill1', description: 'd', triggers: [], body: 'new' }, rationale: 'r' },
          { type: 'subagent_create', target: 'new-sa', description: 'd', patch: { name: 'New SA' }, rationale: 'r' },
          { type: 'tool_allowlist_update', target: 'sa1', description: 'd', patch: { add: ['tool1'] }, rationale: 'r' },
        ],
        summary: 'all types',
      }),
    );
    const episode = makeEpisode();
    const result = await refine(mockProvider, 'test-model', episode, [], { autoApply: true });
    expect(result.actions.length).toBe(3); // capped at 3
    expect(result.applied).toBe(true);
  });
});
