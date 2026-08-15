/**
 * Modal de ajustes de proyecto: miembros, permisos, contraseña y scope.
 *
 * Cada proyecto puede tener N miembros. Cada miembro puede usar su propio
 * proveedor+modelo (la API key se guarda en el keyring del OS bajo
 * provider_id = `member:<memberId>:<providerId>`). Así cada quien paga su
 * consumo.
 *
 * Las conversaciones pueden aislarse por miembro (carpeta privada) si el
 * miembro no tiene `canSeeOtherChats`.
 *
 * El "scope" del agent decide dónde corren los tools:
 * - 'local'      → en la máquina donde se ejecuta Weaver (default)
 * - 'owner_only' → sólo en la máquina del dueño del proyecto
 * - 'each_user'  → cada miembro corre sus tools en su propia máquina
 *
 * PERMISOS DE EDICIÓN: sólo el dueño del proyecto (`activeMemberId === null`)
 * o un admin (`canManageMembers === true`) pueden:
 *   - cambiar el nombre del proyecto
 *   - cambiar el scope
 *   - cambiar la contraseña del proyecto
 *   - invitar / eliminar miembros
 *   - cambiar rol / permisos / proveedor / modelo de un miembro
 *   - cambiar la contraseña de un miembro
 *   - cambiar la API key de un miembro
 *
 * Un admin puede promover a otro miembro a admin (porque tiene canManageMembers).
 * Esto responde a la pregunta: "¿un admin puede poner a alguien más como admin?"
 * Sí — y ese nuevo admin podrá a su vez gestionar miembros.
 *
 * NOTA: como Weaver es una app local sin backend, la sincronización entre
 * máquinas no es automática. El 'owner_only' es una directriz que la UI
 * respeta, pero el cumplimiento real depende de que cada máquina use su db.
 */

import { useEffect, useState } from 'react';
import { X, Users, Plus, Trash2, Lock, Unlock, Shield, Globe, Server, Key, AlertCircle } from 'lucide-react';
import { useWeaver, type Project, type ProjectMember } from '@/store/weaver';
import { PROVIDERS } from '@/providers/registry';
import { apiKeyStore, maskKey } from '@/providers/store';
import { cn } from '@/components/common/Button';

interface Props {
  project: Project;
  onClose: () => void;
}

type Scope = Project['agentExecutionScope'];
type Role = ProjectMember['role'];

const SCOPE_INFO: Record<Scope, { label: string; desc: string; icon: typeof Globe }> = {
  local: {
    label: 'Local',
    desc: 'Los tools del agent corren en la máquina donde se abre Weaver. Útil si trabajas solo en una máquina.',
    icon: Globe,
  },
  owner_only: {
    label: 'Sólo dueño',
    desc: 'Sólo el dueño del proyecto puede ejecutar tools (shell, archivos, MCP). Los demás sólo chatean.',
    icon: Shield,
  },
  each_user: {
    label: 'Cada quien',
    desc: 'Cada miembro corre los tools en su propia máquina. Nadie toca la máquina del otro.',
    icon: Server,
  },
};

export function ProjectSettingsModal({ project, onClose }: Props) {
  const {
    members,
    loadMembers,
    createMember,
    updateMember,
    deleteMember,
    setMemberPassword,
    setProjectPassword,
    setProjectScope,
    renameProject,
    activeMemberId,
  } = useWeaver();

  const [name, setName] = useState(project.name);
  const [scope, setScope] = useState<Scope>(project.agentExecutionScope);
  const [pwInput, setPwInput] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState('');
  const [newRole, setNewRole] = useState<Role>('member');
  const [memberPw, setMemberPw] = useState<Record<string, string>>({});
  // API key per miembro: { [memberId]: { value: string, hasOwn: boolean, masked: string | null } }
  const [memberKeys, setMemberKeys] = useState<Record<string, { value: string; hasOwn: boolean; masked: string | null }>>({});

  useEffect(() => {
    loadMembers(project.id);
  }, [project.id, loadMembers]);

  // Cargar estado de las API keys por miembro cuando cambian los miembros.
  useEffect(() => {
    let cancelled = false;
    async function loadMemberKeys() {
      const next: Record<string, { value: string; hasOwn: boolean; masked: string | null }> = {};
      for (const m of members) {
        if (!m.providerId) {
          next[m.id] = { value: '', hasOwn: false, masked: null };
          continue;
        }
        const hasOwn = await apiKeyStore.hasForMemberAsync(m.id, m.providerId as any);
        if (hasOwn) {
          const raw = await apiKeyStore.getForMember(m.id, m.providerId as any);
          next[m.id] = {
            value: '',
            hasOwn: true,
            masked: raw ? maskKey(raw) : null,
          };
        } else {
          // No tiene propia — ¿existe una global?
          const globalRaw = await apiKeyStore.get(m.providerId as any);
          next[m.id] = {
            value: '',
            hasOwn: false,
            masked: globalRaw ? maskKey(globalRaw) : null,
          };
        }
      }
      if (!cancelled) setMemberKeys(next);
    }
    loadMemberKeys();
    return () => { cancelled = true; };
  }, [members]);

  // ¿El usuario actual puede gestionar este proyecto?
  // - activeMemberId === null → eres el dueño, tienes control total.
  // - activeMemberId === X → eres X, debes tener canManageMembers === true.
  const activeMember = members.find((m) => m.id === activeMemberId) ?? null;
  const canManage = activeMemberId === null || (activeMember?.canManageMembers ?? false);

  async function saveName() {
    if (!canManage) return;
    const trimmed = name.trim();
    if (trimmed && trimmed !== project.name) {
      await renameProject(project.id, trimmed);
    }
  }

  async function saveScope(s: Scope) {
    if (!canManage) return;
    setScope(s);
    await setProjectScope(project.id, s);
  }

  async function saveProjectPassword() {
    if (!canManage) return;
    if (pwInput.length < 4) {
      alert('La contraseña debe tener al menos 4 caracteres.');
      return;
    }
    await setProjectPassword(project.id, pwInput);
    setPwInput('');
    alert('Contraseña del proyecto actualizada.');
  }

  async function clearProjectPassword() {
    if (!canManage) return;
    if (!confirm('¿Quitar la contraseña del proyecto?')) return;
    await setProjectPassword(project.id, null);
  }

  async function addMember() {
    if (!canManage) return;
    const trimmed = newName.trim();
    if (!trimmed) return;
    await createMember({
      projectId: project.id,
      name: trimmed,
      color: null,
      providerId: null,
      modelId: null,
      role: newRole,
      canRunAgent: newRole !== 'viewer',
      canEditFiles: newRole === 'admin' || newRole === 'owner',
      canUseShell: false,
      canSeeOtherChats: newRole === 'admin' || newRole === 'owner',
      canManageMembers: newRole === 'admin' || newRole === 'owner',
    });
    setNewName('');
    setNewRole('member');
    setShowAdd(false);
  }

  async function togglePerm(m: ProjectMember, perm: keyof ProjectMember) {
    if (!canManage) return;
    await updateMember({ ...m, [perm]: !m[perm] } as ProjectMember);
  }

  async function changeRole(m: ProjectMember, role: Role) {
    if (!canManage) return;
    // No permitir degradar al único owner (siempre debe haber 1).
    if (m.role === 'owner' && role !== 'owner') {
      alert('No puedes degradar al dueño del proyecto.');
      return;
    }
    const patch: Partial<ProjectMember> = { role };
    if (role === 'viewer') {
      patch.canRunAgent = false;
      patch.canEditFiles = false;
      patch.canUseShell = false;
      patch.canManageMembers = false;
    } else if (role === 'member') {
      patch.canRunAgent = true;
      patch.canEditFiles = false;
      patch.canUseShell = false;
      patch.canManageMembers = false;
    } else if (role === 'admin') {
      patch.canRunAgent = true;
      patch.canEditFiles = true;
      patch.canUseShell = m.canUseShell;
      patch.canManageMembers = true;
      patch.canSeeOtherChats = true;
    }
    await updateMember({ ...m, ...patch });
  }

  async function changeProvider(m: ProjectMember, providerId: string | null) {
    if (!canManage) return;
    await updateMember({ ...m, providerId, modelId: null });
  }

  async function changeModel(m: ProjectMember, modelId: string | null) {
    if (!canManage) return;
    await updateMember({ ...m, modelId });
  }

  async function saveMemberPassword(id: string) {
    if (!canManage) return;
    const pw = memberPw[id] ?? '';
    if (pw && pw.length < 4) {
      alert('La contraseña debe tener al menos 4 caracteres.');
      return;
    }
    await setMemberPassword(id, pw || null);
    setMemberPw({ ...memberPw, [id]: '' });
    alert(pw ? 'Contraseña del miembro actualizada.' : 'Contraseña del miembro quitada.');
  }

  async function removeMember(m: ProjectMember) {
    if (!canManage) return;
    // No permitir eliminar al owner.
    if (m.role === 'owner') {
      alert('No puedes eliminar al dueño del proyecto.');
      return;
    }
    // No permitir eliminarte a ti mismo si eres admin (para evitar quedarse sin acceso).
    if (m.id === activeMemberId) {
      alert('No puedes eliminarte a ti mismo. Pide a otro admin que lo haga.');
      return;
    }
    if (!confirm(`¿Eliminar a "${m.name}" del proyecto? Sus chats pasarán a ser compartidos.`)) return;
    await deleteMember(m.id);
  }

  /** Guarda la API key específica del miembro en el keyring del OS. */
  async function saveMemberApiKey(m: ProjectMember) {
    if (!canManage) return;
    if (!m.providerId) {
      alert('Primero elige un proveedor para este miembro.');
      return;
    }
    const val = memberKeys[m.id]?.value ?? '';
    try {
      if (val) {
        await apiKeyStore.setForMember(m.id, m.providerId as any, val);
        alert('API key del miembro guardada.');
      } else {
        await apiKeyStore.deleteForMember(m.id, m.providerId as any);
        alert('API key del miembro borrada (caerá a la global si existe).');
      }
      // Refrescar estado.
      const hasOwn = val
        ? true
        : await apiKeyStore.hasForMemberAsync(m.id, m.providerId as any);
      const raw = hasOwn
        ? await apiKeyStore.getForMember(m.id, m.providerId as any)
        : await apiKeyStore.get(m.providerId as any);
      setMemberKeys({
        ...memberKeys,
        [m.id]: { value: '', hasOwn, masked: raw ? maskKey(raw) : null },
      });
    } catch (e) {
      alert(`Error al guardar la API key: ${e}`);
    }
  }

  /** Borra la API key específica del miembro. */
  async function clearMemberApiKey(m: ProjectMember) {
    if (!canManage) return;
    if (!m.providerId) return;
    if (!confirm(`¿Borrar la API key propia de "${m.name}"? Caerá a la global si existe.`)) return;
    try {
      await apiKeyStore.deleteForMember(m.id, m.providerId as any);
      const globalRaw = await apiKeyStore.get(m.providerId as any);
      setMemberKeys({
        ...memberKeys,
        [m.id]: {
          value: '',
          hasOwn: false,
          masked: globalRaw ? maskKey(globalRaw) : null,
        },
      });
    } catch (e) {
      alert(`Error al borrar la API key: ${e}`);
    }
  }

  return (
    <div
      className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-app-bg border border-border-accent rounded-codex shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-border sticky top-0 bg-app-bg z-10">
          <div className="flex items-center gap-2">
            <Users size={14} className="text-accent" />
            <h2 className="text-sm font-semibold">{project.name} — Ajustes del proyecto</h2>
          </div>
          <button onClick={onClose} className="codex-icon-btn"><X size={14} /></button>
        </div>

        {/* Banner de permisos si el usuario actual no puede gestionar. */}
        {!canManage && (
          <div className="mx-5 mt-3 p-2 border border-yellow-500/30 bg-yellow-500/10 rounded-codex flex items-start gap-2">
            <AlertCircle size={12} className="text-yellow-500 mt-0.5 shrink-0" />
            <div className="text-[11px] text-yellow-300">
              Estás viendo este proyecto como <strong>{activeMember?.name ?? 'miembro'}</strong>.
              No tienes permiso para gestionar miembros, permisos, contraseñas ni scope.
              Estas opciones están en modo sólo lectura.
            </div>
          </div>
        )}

        <div className="p-5 space-y-6">
          {/* General */}
          <section>
            <h3 className="text-xs uppercase text-text-muted tracking-wider mb-2">General</h3>
            <label className="text-[10px] uppercase text-text-muted">Nombre del proyecto</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={saveName}
              disabled={!canManage}
              className={cn(
                'codex-input w-full mt-0.5 px-2 py-1.5 text-sm',
                !canManage && 'opacity-60 cursor-not-allowed',
              )}
            />
          </section>

          {/* Scope del agent */}
          <section>
            <h3 className="text-xs uppercase text-text-muted tracking-wider mb-2">
              ¿Dónde corren los tools del agent?
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
              {(Object.keys(SCOPE_INFO) as Scope[]).map((s) => {
                const Info = SCOPE_INFO[s];
                const Icon = Info.icon;
                const active = scope === s;
                return (
                  <button
                    key={s}
                    onClick={() => saveScope(s)}
                    disabled={!canManage}
                    className={cn(
                      'text-left p-3 border rounded-codex transition-colors',
                      active
                        ? 'border-accent bg-app-elevated'
                        : 'border-border hover:bg-app-elevated',
                      !canManage && 'opacity-60 cursor-not-allowed',
                    )}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <Icon size={14} className="text-accent" />
                      <span className="text-sm font-medium">{Info.label}</span>
                    </div>
                    <div className="text-[10px] text-text-muted leading-snug">{Info.desc}</div>
                  </button>
                );
              })}
            </div>
          </section>

          {/* Contraseña del proyecto */}
          <section>
            <h3 className="text-xs uppercase text-text-muted tracking-wider mb-2">
              <Lock size={10} className="inline mr-1" />
              Contraseña del proyecto
            </h3>
            <p className="text-[11px] text-text-muted mb-2">
              Si la fijas, al abrir el proyecto se pedirá esta contraseña. Útil si compartes máquina.
              Estado actual: <strong>{project.passwordHash ? 'protegido' : 'sin protección'}</strong>.
            </p>
            <div className="flex gap-2">
              <input
                type="password"
                value={pwInput}
                onChange={(e) => setPwInput(e.target.value)}
                disabled={!canManage}
                placeholder={project.passwordHash ? 'Cambiar contraseña…' : 'Nueva contraseña…'}
                className={cn(
                  'codex-input flex-1 px-2 py-1.5 text-sm',
                  !canManage && 'opacity-60 cursor-not-allowed',
                )}
              />
              <button
                onClick={saveProjectPassword}
                disabled={!canManage}
                className={cn('codex-btn px-3 py-1.5 text-xs', !canManage && 'opacity-60 cursor-not-allowed')}
              >
                Guardar
              </button>
              {project.passwordHash && (
                <button
                  onClick={clearProjectPassword}
                  disabled={!canManage}
                  className={cn('codex-btn-danger px-3 py-1.5 text-xs', !canManage && 'opacity-60 cursor-not-allowed')}
                >
                  Quitar
                </button>
              )}
            </div>
          </section>

          {/* Miembros */}
          <section>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xs uppercase text-text-muted tracking-wider">
                Miembros ({members.length})
              </h3>
              {canManage && (
                <button
                  onClick={() => setShowAdd((v) => !v)}
                  className="codex-btn px-2 py-1 text-[11px] flex items-center gap-1"
                >
                  <Plus size={10} /> Añadir
                </button>
              )}
            </div>
            <p className="text-[11px] text-text-muted mb-3">
              Cada miembro puede usar su propio proveedor+modelo. La API key se guarda en el
              keyring del OS bajo <code className="text-text-secondary">member:&lt;id&gt;:&lt;provider&gt;</code>,
              así cada quien paga su consumo. Si el miembro no tiene key propia, cae a la global.
              Las conversaciones pueden aislarse por miembro (carpeta privada) si desactivas
              "ver chats ajenos".
            </p>

            {showAdd && canManage && (
              <div className="border border-border rounded-codex p-3 mb-3 bg-app-elevated">
                <div className="flex gap-2 items-end">
                  <div className="flex-1">
                    <label className="text-[10px] uppercase text-text-muted">Nombre</label>
                    <input
                      autoFocus
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && addMember()}
                      placeholder="Ej: Ana, Carlos…"
                      className="codex-input w-full px-2 py-1.5 text-sm"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] uppercase text-text-muted">Rol</label>
                    <select
                      value={newRole}
                      onChange={(e) => setNewRole(e.target.value as Role)}
                      className="codex-input px-2 py-1.5 text-sm"
                    >
                      <option value="member">Miembro</option>
                      <option value="admin">Admin</option>
                      <option value="viewer">Sólo lectura</option>
                    </select>
                  </div>
                  <button onClick={addMember} className="codex-btn px-3 py-1.5 text-xs">
                    Añadir
                  </button>
                </div>
              </div>
            )}

            {members.length === 0 ? (
              <div className="text-[11px] text-text-muted italic px-2 py-4 text-center border border-dashed border-border rounded-codex">
                Aún no hay miembros. Eres el único con acceso a este proyecto.
              </div>
            ) : (
              <div className="space-y-2">
                {members.map((m) => (
                  <MemberRow
                    key={m.id}
                    m={m}
                    canManage={canManage}
                    memberPw={memberPw[m.id] ?? ''}
                    onMemberPwChange={(v) => setMemberPw({ ...memberPw, [m.id]: v })}
                    onTogglePerm={togglePerm}
                    onChangeRole={changeRole}
                    onChangeProvider={changeProvider}
                    onChangeModel={changeModel}
                    onSavePassword={saveMemberPassword}
                    onRemove={removeMember}
                    apiKeyState={memberKeys[m.id] ?? { value: '', hasOwn: false, masked: null }}
                    onApiKeyChange={(v) =>
                      setMemberKeys({
                        ...memberKeys,
                        [m.id]: { ...(memberKeys[m.id] ?? { hasOwn: false, masked: null }), value: v },
                      })
                    }
                    onSaveApiKey={saveMemberApiKey}
                    onClearApiKey={clearMemberApiKey}
                    isSelf={m.id === activeMemberId}
                  />
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// MemberRow — fila de un miembro con sus permisos
// ============================================================================

interface MemberRowProps {
  m: ProjectMember;
  canManage: boolean;
  memberPw: string;
  onMemberPwChange: (v: string) => void;
  onTogglePerm: (m: ProjectMember, perm: keyof ProjectMember) => void;
  onChangeRole: (m: ProjectMember, role: Role) => void;
  onChangeProvider: (m: ProjectMember, providerId: string | null) => void;
  onChangeModel: (m: ProjectMember, modelId: string | null) => void;
  onSavePassword: (id: string) => void;
  onRemove: (m: ProjectMember) => void;
  apiKeyState: { value: string; hasOwn: boolean; masked: string | null };
  onApiKeyChange: (v: string) => void;
  onSaveApiKey: (m: ProjectMember) => void;
  onClearApiKey: (m: ProjectMember) => void;
  isSelf: boolean;
}

function MemberRow({
  m,
  canManage,
  memberPw,
  onMemberPwChange,
  onTogglePerm,
  onChangeRole,
  onChangeProvider,
  onChangeModel,
  onSavePassword,
  onRemove,
  apiKeyState,
  onApiKeyChange,
  onSaveApiKey,
  onClearApiKey,
  isSelf,
}: MemberRowProps) {
  const [expanded, setExpanded] = useState(false);
  const provider = m.providerId ? PROVIDERS.find((p) => p.id === m.providerId) : undefined;
  const models = provider?.models ?? [];

  return (
    <div className="border border-border rounded-codex bg-app-bg">
      <div className="flex items-center gap-2 px-3 py-2">
        <button
          onClick={() => setExpanded((v) => !v)}
          className="codex-icon-btn w-4 h-4"
          title={expanded ? 'Contraer' : 'Expandir'}
        >
          {expanded ? <Unlock size={10} /> : <Lock size={10} />}
        </button>
        <span
          className="w-2 h-2 rounded-full"
          style={{ background: m.color ?? '#7aa67a' }}
        />
        <span className="flex-1 text-sm text-text-primary truncate">
          {m.name}
          {isSelf && <span className="text-[10px] text-accent ml-1">(tú)</span>}
        </span>
        <span className="text-[10px] px-1.5 py-0.5 rounded bg-app-elevated text-text-muted uppercase">
          {m.role}
        </span>
        {canManage && m.role !== 'owner' && (
          <button
            onClick={() => onRemove(m)}
            className="codex-icon-btn w-4 h-4"
            title="Eliminar miembro"
          >
            <Trash2 size={10} />
          </button>
        )}
      </div>

      {expanded && (
        <div className="border-t border-border px-3 py-3 space-y-3 bg-app-elevated/30">
          <div>
            <label className="text-[10px] uppercase text-text-muted">Rol</label>
            <select
              value={m.role}
              onChange={(e) => onChangeRole(m, e.target.value as Role)}
              className="codex-input w-full px-2 py-1.5 text-sm mt-0.5"
              disabled={!canManage || m.role === 'owner'}
            >
              <option value="owner">Dueño (no cambiable)</option>
              <option value="admin">Admin</option>
              <option value="member">Miembro</option>
              <option value="viewer">Sólo lectura</option>
            </select>
            {!canManage && (
              <p className="text-[10px] text-text-muted mt-1">
                Sólo el dueño o un admin pueden cambiar el rol.
              </p>
            )}
            {m.role === 'admin' && (
              <p className="text-[10px] text-accent mt-1">
                Los admins pueden gestionar miembros, invitar nuevos y promover a otros admins.
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[10px] uppercase text-text-muted">Proveedor propio</label>
              <select
                value={m.providerId ?? ''}
                onChange={(e) => onChangeProvider(m, e.target.value || null)}
                className="codex-input w-full px-2 py-1.5 text-sm mt-0.5"
                disabled={!canManage}
              >
                <option value="">Usa el proveedor global</option>
                {PROVIDERS.map((p) => (
                  <option key={p.id} value={p.id}>{p.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[10px] uppercase text-text-muted">Modelo</label>
              <select
                value={m.modelId ?? ''}
                onChange={(e) => onChangeModel(m, e.target.value || null)}
                className="codex-input w-full px-2 py-1.5 text-sm mt-0.5"
                disabled={!canManage || !provider}
              >
                <option value="">Por defecto</option>
                {models.map((md) => (
                  <option key={md.id} value={md.id}>{md.label}</option>
                ))}
              </select>
            </div>
          </div>

          {/* API key propia del miembro */}
          {m.providerId && (
            <div>
              <label className="text-[10px] uppercase text-text-muted flex items-center gap-1">
                <Key size={9} /> API key propia
              </label>
              <div className="flex gap-2 mt-0.5">
                <input
                  type="password"
                  value={apiKeyState.value}
                  onChange={(e) => onApiKeyChange(e.target.value)}
                  disabled={!canManage}
                  placeholder={
                    apiKeyState.hasOwn
                      ? `Propia: ${apiKeyState.masked ?? '••••'} — escribir nueva…`
                      : apiKeyState.masked
                        ? `Global: ${apiKeyState.masked} — escribir para fijar propia…`
                        : 'Sin key — escribe para fijar la propia…'
                  }
                  className={cn(
                    'codex-input flex-1 px-2 py-1.5 text-sm',
                    !canManage && 'opacity-60 cursor-not-allowed',
                  )}
                />
                <button
                  onClick={() => onSaveApiKey(m)}
                  disabled={!canManage}
                  className={cn('codex-btn px-3 py-1.5 text-xs', !canManage && 'opacity-60 cursor-not-allowed')}
                >
                  {apiKeyState.hasOwn ? 'Cambiar' : 'Fijar'}
                </button>
                {apiKeyState.hasOwn && (
                  <button
                    onClick={() => onClearApiKey(m)}
                    disabled={!canManage}
                    className={cn('codex-btn-danger px-3 py-1.5 text-xs', !canManage && 'opacity-60 cursor-not-allowed')}
                  >
                    Borrar
                  </button>
                )}
              </div>
              <p className="text-[10px] text-text-muted mt-1">
                {apiKeyState.hasOwn
                  ? 'Este miembro tiene su propia key (aislada de la global).'
                  : apiKeyState.masked
                    ? 'Caerá a la key global del proveedor si no se fija una propia.'
                    : 'No hay key global ni propia — el proveedor fallará al usarse.'}
              </p>
            </div>
          )}

          <div>
            <label className="text-[10px] uppercase text-text-muted block mb-1">Permisos</label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
              <PermToggle
                label="Ejecutar agent"
                desc="Permitir que el agent use tools"
                value={m.canRunAgent}
                onChange={() => onTogglePerm(m, 'canRunAgent')}
                disabled={!canManage}
              />
              <PermToggle
                label="Editar archivos"
                desc="file_write / file_read en este proyecto"
                value={m.canEditFiles}
                onChange={() => onTogglePerm(m, 'canEditFiles')}
                disabled={!canManage}
              />
              <PermToggle
                label="Usar shell"
                desc="Ejecutar comandos shell_exec"
                value={m.canUseShell}
                onChange={() => onTogglePerm(m, 'canUseShell')}
                disabled={!canManage}
              />
              <PermToggle
                label="Ver chats ajenos"
                desc="Si OFF, sus chats son privados (carpeta)"
                value={m.canSeeOtherChats}
                onChange={() => onTogglePerm(m, 'canSeeOtherChats')}
                disabled={!canManage}
              />
              <PermToggle
                label="Gestionar miembros"
                desc="Invitar / eliminar / cambiar permisos / promover a admin"
                value={m.canManageMembers}
                onChange={() => onTogglePerm(m, 'canManageMembers')}
                disabled={!canManage || m.role === 'owner'}
              />
            </div>
            {!canManage && (
              <p className="text-[10px] text-text-muted mt-1">
                Sólo el dueño o un admin pueden cambiar permisos.
              </p>
            )}
          </div>

          <div>
            <label className="text-[10px] uppercase text-text-muted">Contraseña del miembro</label>
            <div className="flex gap-2 mt-0.5">
              <input
                type="password"
                value={memberPw}
                onChange={(e) => onMemberPwChange(e.target.value)}
                disabled={!canManage}
                placeholder={m.passwordHash ? 'Cambiar…' : 'Opcional…'}
                className={cn(
                  'codex-input flex-1 px-2 py-1.5 text-sm',
                  !canManage && 'opacity-60 cursor-not-allowed',
                )}
              />
              <button
                onClick={() => onSavePassword(m.id)}
                disabled={!canManage}
                className={cn('codex-btn px-3 py-1.5 text-xs', !canManage && 'opacity-60 cursor-not-allowed')}
              >
                {m.passwordHash ? 'Cambiar' : 'Fijar'}
              </button>
            </div>
            {m.passwordHash && (
              <p className="text-[10px] text-text-muted mt-1">
                Este miembro tiene contraseña. Déjalo vacío y "Cambiar" para quitarla.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function PermToggle({
  label,
  desc,
  value,
  onChange,
  disabled,
}: {
  label: string;
  desc: string;
  value: boolean;
  onChange: () => void;
  disabled?: boolean;
}) {
  return (
    <label className={cn('flex items-start gap-2', disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer')}>
      <input
        type="checkbox"
        checked={value}
        onChange={onChange}
        disabled={disabled}
        className="mt-0.5 accent-accent"
      />
      <div>
        <div className="text-xs text-text-primary">{label}</div>
        <div className="text-[10px] text-text-muted leading-snug">{desc}</div>
      </div>
    </label>
  );
}
