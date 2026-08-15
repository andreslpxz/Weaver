/**
 * FASE 6 — Tests del Validator.
 */

import { describe, it, expect } from 'vitest';
import { validateWorkflow, isValidWorkflow } from '../index';
import type { Workflow } from '../../types/definition';

function makeWorkflow(overrides: Partial<Workflow> = {}): Workflow {
  return {
    id: 'wf-1',
    name: 'Test workflow',
    nodes: [],
    edges: [],
    chat: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    enabled: true,
    ...overrides,
  };
}

describe('Validator', () => {
  it('fails on empty workflow', () => {
    const result = validateWorkflow(makeWorkflow({ nodes: [], edges: [] }));
    expect(result.valid).toBe(false);
    expect(result.errors[0].code).toBe('no_nodes');
  });

  it('fails when no trigger node', () => {
    const wf = makeWorkflow({
      nodes: [
        { id: 'n1', type: 'code', label: 'Code', position: { x: 0, y: 0 }, config: {} },
        { id: 'n2', type: 'set', label: 'Set', position: { x: 100, y: 0 }, config: {} },
      ],
      edges: [{ id: 'e1', source: 'n1', target: 'n2' }],
    });
    const result = validateWorkflow(wf);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === 'no_trigger')).toBe(true);
  });

  it('passes for valid linear workflow', () => {
    const wf = makeWorkflow({
      nodes: [
        { id: 'n1', type: 'webhook', label: 'Webhook', position: { x: 0, y: 0 }, config: { path: '/test' } },
        { id: 'n2', type: 'set', label: 'Set', position: { x: 100, y: 0 }, config: { fields: [{ key: 'k', value: 'v' }] } },
      ],
      edges: [{ id: 'e1', source: 'n1', target: 'n2' }],
    });
    const result = validateWorkflow(wf);
    expect(result.valid).toBe(true);
  });

  it('warns on disconnected node', () => {
    const wf = makeWorkflow({
      nodes: [
        { id: 'n1', type: 'webhook', label: 'Webhook', position: { x: 0, y: 0 }, config: {} },
        { id: 'n2', type: 'set', label: 'Set disconnected', position: { x: 100, y: 0 }, config: {} },
      ],
      edges: [],
    });
    const result = validateWorkflow(wf);
    expect(result.warnings.some((w) => w.code === 'disconnected_node')).toBe(true);
  });

  it('detects duplicate node IDs', () => {
    const wf = makeWorkflow({
      nodes: [
        { id: 'dup', type: 'webhook', label: 'A', position: { x: 0, y: 0 }, config: {} },
        { id: 'dup', type: 'set', label: 'B', position: { x: 100, y: 0 }, config: {} },
      ],
      edges: [],
    });
    const result = validateWorkflow(wf);
    expect(result.errors.some((e) => e.code === 'duplicate_node_id')).toBe(true);
  });

  it('detects cycle', () => {
    const wf = makeWorkflow({
      nodes: [
        { id: 'n1', type: 'webhook', label: 'A', position: { x: 0, y: 0 }, config: {} },
        { id: 'n2', type: 'set', label: 'B', position: { x: 100, y: 0 }, config: {} },
        { id: 'n3', type: 'set', label: 'C', position: { x: 200, y: 0 }, config: {} },
      ],
      edges: [
        { id: 'e1', source: 'n1', target: 'n2' },
        { id: 'e2', source: 'n2', target: 'n3' },
        { id: 'e3', source: 'n3', target: 'n2' }, // cycle n2 → n3 → n2
      ],
    });
    const result = validateWorkflow(wf);
    expect(result.errors.some((e) => e.code === 'cycle_detected')).toBe(true);
  });

  it('detects invalid edge reference', () => {
    const wf = makeWorkflow({
      nodes: [
        { id: 'n1', type: 'webhook', label: 'A', position: { x: 0, y: 0 }, config: {} },
      ],
      edges: [
        { id: 'e1', source: 'n1', target: 'nonexistent' },
      ],
    });
    const result = validateWorkflow(wf);
    expect(result.errors.some((e) => e.code === 'invalid_edge_ref')).toBe(true);
  });

  it('validates IF missing branch as warning', () => {
    const wf = makeWorkflow({
      nodes: [
        { id: 'n1', type: 'webhook', label: 'A', position: { x: 0, y: 0 }, config: {} },
        { id: 'n2', type: 'if', label: 'IF', position: { x: 100, y: 0 }, config: { expression: '{{$json.x}}' } },
        { id: 'n3', type: 'set', label: 'Yes', position: { x: 200, y: 0 }, config: {} },
      ],
      edges: [
        { id: 'e1', source: 'n1', target: 'n2' },
        { id: 'e2', source: 'n2', target: 'n3', sourceHandle: 'true' },
        // missing false branch
      ],
    });
    const result = validateWorkflow(wf);
    expect(result.warnings.some((w) => w.code === 'if_missing_branch')).toBe(true);
  });

  it('detects invalid expression', () => {
    const wf = makeWorkflow({
      nodes: [
        { id: 'n1', type: 'webhook', label: 'A', position: { x: 0, y: 0 }, config: {} },
        { id: 'n2', type: 'if', label: 'IF', position: { x: 100, y: 0 }, config: { expression: '{{$json.}}' } },
        { id: 'n3', type: 'set', label: 'Y', position: { x: 200, y: 0 }, config: {} },
        { id: 'n4', type: 'set', label: 'N', position: { x: 200, y: 100 }, config: {} },
      ],
      edges: [
        { id: 'e1', source: 'n1', target: 'n2' },
        { id: 'e2', source: 'n2', target: 'n3', sourceHandle: 'true' },
        { id: 'e3', source: 'n2', target: 'n4', sourceHandle: 'false' },
      ],
    });
    const result = validateWorkflow(wf);
    expect(result.errors.some((e) => e.code === 'invalid_expression')).toBe(true);
  });

  it('detects merge with insufficient inputs', () => {
    const wf = makeWorkflow({
      nodes: [
        { id: 'n1', type: 'webhook', label: 'A', position: { x: 0, y: 0 }, config: {} },
        { id: 'n2', type: 'merge', label: 'Merge', position: { x: 100, y: 0 }, config: {} },
        { id: 'n3', type: 'set', label: 'Out', position: { x: 200, y: 0 }, config: {} },
      ],
      edges: [
        { id: 'e1', source: 'n1', target: 'n2' }, // only 1 input
        { id: 'e2', source: 'n2', target: 'n3' },
      ],
    });
    const result = validateWorkflow(wf);
    expect(result.errors.some((e) => e.code === 'merge_insufficient_inputs')).toBe(true);
  });

  it('detects missing credential', () => {
    const wf = makeWorkflow({
      nodes: [
        { id: 'n1', type: 'webhook', label: 'A', position: { x: 0, y: 0 }, config: {} },
        { id: 'n2', type: 'http_request', label: 'HTTP', position: { x: 100, y: 0 }, config: { url: 'https://api.example.com', credentialId: 'cred-123' } },
      ],
      edges: [{ id: 'e1', source: 'n1', target: 'n2' }],
    });
    const result = validateWorkflow(wf, { knownCredentialIds: new Set(['other-cred']) });
    expect(result.errors.some((e) => e.code === 'missing_credential')).toBe(true);
  });

  it('isValidWorkflow returns boolean', () => {
    const validWf = makeWorkflow({
      nodes: [
        { id: 'n1', type: 'webhook', label: 'A', position: { x: 0, y: 0 }, config: {} },
      ],
      edges: [],
    });
    expect(isValidWorkflow(validWf)).toBe(true);

    const invalidWf = makeWorkflow({ nodes: [], edges: [] });
    expect(isValidWorkflow(invalidWf)).toBe(false);
  });

  it('execute_workflow requires workflowId or workflowName', () => {
    const wf = makeWorkflow({
      nodes: [
        { id: 'n1', type: 'webhook', label: 'A', position: { x: 0, y: 0 }, config: {} },
        { id: 'n2', type: 'execute_workflow', label: 'Sub', position: { x: 100, y: 0 }, config: {} },
      ],
      edges: [{ id: 'e1', source: 'n1', target: 'n2' }],
    });
    const result = validateWorkflow(wf);
    expect(result.errors.some((e) => e.code === 'invalid_node_config')).toBe(true);
  });
});
