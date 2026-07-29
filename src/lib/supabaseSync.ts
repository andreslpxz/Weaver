/**
 * supabaseSync.ts
 *
 * Cliente ligero de la Supabase Management API
 * (https://api.supabase.com/v1) que permite:
 *
 *   1. Guardar el Personal Access Token (PAT) del usuario.
 *   2. Listar las organizaciones del usuario.
 *   3. Listar los proyectos Supabase existentes.
 *   4. Crear un nuevo proyecto Supabase desde Weaver.
 *   5. Importar un proyecto Supabase como proyecto local Weaver
 *      (mismo nombre + metadata para futura sincronización).
 *
 * El token se guarda en `localStorage` (modo navegador) o en el
 * keyring del OS (modo Tauri, si está disponible). NUNCA se envía
 * a ningún endpoint que no sea `api.supabase.com`.
 *
 * Referencia: https://supabase.com/docs/reference/api/introduction
 */

import { runtime, keyring } from '@/lib/tauri';

const TOKEN_KEY = 'weaver:supabase_pat';
const API_BASE = 'https://api.supabase.com/v1';

// ============================================================================
// Tipos
// ============================================================================

export interface SupabaseOrganization {
  id: string;
  name: string;
}

export interface SupabaseProject {
  id: string;
  name: string;
  region: string;
  organization_id: string;
  status: string;
  database_host?: string;
  database_url?: string;
  api_url?: string;
  api_key?: string;
}

export interface CreateSupabaseProjectOpts {
  name: string;
  organizationId: string;
  dbPassword: string;
  region?: string;
  plan?: 'free' | 'pro';
}

// ============================================================================
// Persistencia del token
// ============================================================================

const PAT_PROVIDER_ID = 'supabase_pat';

export async function getSupabaseToken(): Promise<string | null> {
  if (runtime.isTauri) {
    try {
      const v = await keyring.getApiKeyRaw(PAT_PROVIDER_ID);
      if (v) return v;
    } catch {
      /* fallthrough a localStorage */
    }
  }
  return localStorage.getItem(TOKEN_KEY);
}

export async function setSupabaseToken(token: string): Promise<void> {
  const clean = token.trim();
  if (runtime.isTauri) {
    try {
      await keyring.setApiKey(PAT_PROVIDER_ID, clean);
      return;
    } catch {
      /* fallthrough */
    }
  }
  localStorage.setItem(TOKEN_KEY, clean);
}

export async function clearSupabaseToken(): Promise<void> {
  if (runtime.isTauri) {
    try {
      await keyring.deleteApiKey(PAT_PROVIDER_ID);
    } catch {
      /* ignore */
    }
  }
  localStorage.removeItem(TOKEN_KEY);
}

// ============================================================================
// Helpers HTTP
// ============================================================================

async function sbFetch(path: string, init?: RequestInit, tokenOverride?: string): Promise<Response> {
  const token = tokenOverride ?? (await getSupabaseToken());
  if (!token) throw new Error('No hay token de Supabase guardado.');
  return fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
}

async function asJson<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`;
    try {
      const body = await res.json();
      if (body?.message) msg = body.message;
      else if (body?.error) msg = body.error;
      else if (typeof body === 'string') msg = body;
    } catch {
      /* sin body */
    }
    throw new Error(`Supabase API: ${msg}`);
  }
  return (await res.json()) as T;
}

// ============================================================================
// API
// ============================================================================

export async function listOrganizations(tokenOverride?: string): Promise<SupabaseOrganization[]> {
  const res = await sbFetch('/organizations', undefined, tokenOverride);
  const raw = await asJson<any[]>(res);
  return (raw || []).map((o) => ({ id: o.id, name: o.name }));
}

export async function listSupabaseProjects(tokenOverride?: string): Promise<SupabaseProject[]> {
  const res = await sbFetch('/projects', undefined, tokenOverride);
  const raw = await asJson<any[]>(res);
  return (raw || []).map((p) => ({
    id: p.id,
    name: p.name,
    region: p.region,
    organization_id: p.organization_id,
    status: p.status,
    database_host: p.database?.host,
    database_url: p.database?.connection_string,
    api_url: p.api?.url,
    api_key: p.api?.api_key,
  }));
}

export async function verifyToken(token: string): Promise<{
  ok: boolean;
  organizations: SupabaseOrganization[];
  projects: SupabaseProject[];
  error?: string;
}> {
  try {
    const [orgs, projects] = await Promise.all([
      listOrganizations(token),
      listSupabaseProjects(token),
    ]);
    return { ok: true, organizations: orgs, projects };
  } catch (e) {
    return {
      ok: false,
      organizations: [],
      projects: [],
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

export async function createSupabaseProject(
  opts: CreateSupabaseProjectOpts,
  tokenOverride?: string,
): Promise<SupabaseProject> {
  if (!opts.organizationId) throw new Error('Falta organization_id');
  if (!opts.dbPassword || opts.dbPassword.length < 6) {
    throw new Error('La contraseña de la BD debe tener al menos 6 caracteres');
  }
  const body = {
    organization_id: opts.organizationId,
    name: opts.name.trim(),
    db_password: opts.dbPassword,
    region: opts.region || 'us-east-1',
    plan: opts.plan || 'free',
  };
  const res = await sbFetch('/projects', {
    method: 'POST',
    body: JSON.stringify(body),
  }, tokenOverride);
  const p = await asJson<any>(res);
  return {
    id: p.id,
    name: p.name,
    region: p.region,
    organization_id: p.organization_id,
    status: p.status,
    database_host: p.database?.host,
    api_url: p.api?.url,
  };
}

// ============================================================================
// Mapeo local ↔ Supabase
// ============================================================================

/**
 * Persiste en localStorage el mapeo { projectIdLocal: supabaseId }
 * para futura sincronización de datos.
 */
const MAP_KEY = 'weaver:supabase_project_map';

export function getSupabaseProjectMap(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(MAP_KEY) || '{}');
  } catch {
    return {};
  }
}

export function linkLocalToSupabase(localId: string, supabaseId: string): void {
  const map = getSupabaseProjectMap();
  map[localId] = supabaseId;
  localStorage.setItem(MAP_KEY, JSON.stringify(map));
}

export function unlinkLocal(localId: string): void {
  const map = getSupabaseProjectMap();
  delete map[localId];
  localStorage.setItem(MAP_KEY, JSON.stringify(map));
}
