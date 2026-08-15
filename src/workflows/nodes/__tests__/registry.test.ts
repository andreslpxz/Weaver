/**
 * FASE 4 — Tests del Node Registry.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  registerNodeDefinition,
  getNodeDefinition,
  getLatestNodeDefinition,
  resolveNodeDefinition,
  listNodeDefinitions,
  listNodeTypes,
  clearNodeRegistry,
  loadBuiltinNodeDefinitions,
} from '../registry';
import type { NodeDefinition } from '../../types/node_definition';

function makeDef(type: string, version: number): NodeDefinition {
  return {
    type: type as NodeDefinition['type'],
    version,
    displayName: `Test ${type} v${version}`,
    description: 'test',
    category: 'data',
    inputs: [],
    outputs: [{ handle: 'default' }],
    parameters: [],
    execute: async () => ({ status: 'success', outputs: { default: [] } }),
  };
}

describe('NodeRegistry', () => {
  beforeEach(() => {
    clearNodeRegistry();
  });

  it('registers and retrieves a definition', () => {
    const def = makeDef('webhook', 1);
    registerNodeDefinition(def);
    expect(getNodeDefinition('webhook', 1)).toBe(def);
  });

  it('returns undefined for unknown type', () => {
    expect(getNodeDefinition('unknown' as NodeDefinition['type'], 1)).toBeUndefined();
  });

  it('tracks latest version', () => {
    registerNodeDefinition(makeDef('http_request', 1));
    registerNodeDefinition(makeDef('http_request', 2));
    expect(getLatestNodeDefinition('http_request')?.version).toBe(2);
  });

  it('resolveNodeDefinition falls back to latest with warning', () => {
    registerNodeDefinition(makeDef('http_request', 2));
    const { definition, migrated, warning } = resolveNodeDefinition('http_request', 1);
    expect(definition?.version).toBe(2);
    expect(migrated).toBe(true);
    expect(warning).toContain('@1');
  });

  it('resolveNodeDefinition returns exact match without warning', () => {
    registerNodeDefinition(makeDef('http_request', 1));
    registerNodeDefinition(makeDef('http_request', 2));
    const { definition, migrated, warning } = resolveNodeDefinition('http_request', 1);
    expect(definition?.version).toBe(1);
    expect(migrated).toBe(false);
    expect(warning).toBeUndefined();
  });

  it('listNodeDefinitions returns all registered', () => {
    registerNodeDefinition(makeDef('webhook', 1));
    registerNodeDefinition(makeDef('schedule', 1));
    expect(listNodeDefinitions().length).toBe(2);
  });

  it('listNodeTypes dedupes by type', () => {
    registerNodeDefinition(makeDef('http_request', 1));
    registerNodeDefinition(makeDef('http_request', 2));
    registerNodeDefinition(makeDef('webhook', 1));
    expect(listNodeTypes().length).toBe(2);
  });

  it('throws on invalid definition', () => {
    expect(() => registerNodeDefinition({} as NodeDefinition)).toThrow();
  });

  it('loadBuiltinNodeDefinitions loads all built-in nodes', async () => {
    await loadBuiltinNodeDefinitions();
    const types = listNodeTypes();
    expect(types).toContain('webhook');
    expect(types).toContain('schedule');
    expect(types).toContain('code');
    expect(types).toContain('if');
    expect(types).toContain('http_request');
    expect(types).toContain('filter');
    expect(types).toContain('merge');
    expect(types).toContain('loop');
    expect(types).toContain('execute_workflow');
    expect(types).toContain('llm');
  });
});
