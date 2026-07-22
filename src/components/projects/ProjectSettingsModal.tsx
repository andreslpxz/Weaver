/**
 * Modal de ajustes de proyecto: miembros, permisos, contraseña y scope.
 *
 * Cada proyecto puede tener N miembros. Cada miembro puede usar su propio
 * proveedor+modelo (la API key se guarda en el keyring del OS bajo
 * provider_id = `member:<memberId>`). Así cada quien paga su consumo.
 *
 * Las conversaciones pueden aislarse por miembro (carpeta privada) si el
 * miembro no tiene `canSeeOtherChats`.
 *
 * El "scope" del agent decide dónde corren los tools:
 * - 'local'      → en la máquina donde se ejecuta Weaver (default)
 * - 'owner_only' → sólo en la máquina del dueño del proyecto
 * - 'each_user'  → cada miembro corre sus tools en su propia máquina
 *
 * NOTA: como Weaver es una app local sin backend, la sincronización entre
 * máquinas no es automática. El 'owner_only' es una directriz que la UI
 * respeta (no muestra el botón "ejecutar" a no-owners), pero el cumplimiento
 * real depende de que cada máquina use su propia db.
 */

import { useEffect, useState } from 'react';
import { X, Users, Plus, Trash2, Lock, Unlock, Shield, Globe, Server } from 'lucide-react';
import { useWeaver, type Project, type ProjectMember } from '@/store/weaver';
import { PROVIDERS } from '@/providers/registry';
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
  } = useWeaver();

  const [name, setName] = useState(project.name);
  const [scope, setScope] = useState<Scope>(project.agentExecutionScope);
  const [pwInput, setPwInput] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState('');
  const [newRole, setNewRole] = useState<Role>('member');
  const [memberPw, setMemberPw] = useState<Record<string, string>>({});

  useEffect(() => {
    loadMembers(project.id);
  }, [project.id, loadMembers]);

  async function saveName() {
    const trimmed = name.trim();
    if (trimmed && trimmed !== project.name) {
      await renameProject(project.id, trimmed);
    }
  }

  async function saveScope(s: Scope) {
    setScope(s);
    await setProjectScope(project.id, s);
  }

  async function saveProjectPassword() {
    if (pwInput.length < 4) {
      alert('La contraseña debe tener al menos 4 caracteres.');
      return;
    }
    await setProjectPassword(project.id, pwInput);
    setPwInput('');
    alert('Contraseña del proyecto actualizada.');
  }

  async function clearProjectPassword() {
    if (!confirm('¿Quitar la contraseña del proyecto?')) return;
    await setProjectPassword(project.id, null);
  }

  async function addMember() {
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
    await updateMember({ ...m, [perm]: !m[perm] } as ProjectMember);
  }

  async function changeRole(m: ProjectMember, role: Role) {
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
    await updateMember({ ...m, providerId, modelId: null });
  }

  async function changeModel(m: ProjectMember, modelId: string | null) {
    await updateMember({ ...m, modelId });
  }

  async function saveMemberPassword(id: string) {
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
    if (!confirm(`¿Eliminar a "${m.name}" del proyecto? Sus chats pasarán a ser compartidos.`)) return;
    await deleteMember(m.id);
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

        <div className="p-5 space-y-6">
          {/* General */}
          <section>
            <h3 className="text-xs uppercase text-text-muted tracking-wider mb-2">General</h3>
            <label className="text-[10px] uppercase text-text-muted">Nombre del proyecto</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={saveName}
              className="codex-input w-full mt-0.5 px-2 py-1.5 text-sm"
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
                    className={cn(
                      'text-left p-3 border rounded-codex transition-colors',
                      active
                        ? 'border-accent bg-app-elevated'
                        : 'border-border hover:bg-app-elevated',
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
                placeholder={project.passwordHash ? 'Cambiar contraseña…' : 'Nueva contraseña…'}
                className="codex-input flex-1 px-2 py-1.5 text-sm"
              />
              <button onClick={saveProjectPassword} className="codex-btn px-3 py-1.5 text-xs">
                Guardar
              </button>
              {project.passwordHash && (
                <button onClick={clearProjectPassword} className="codex-btn-danger px-3 py-1.5 text-xs">
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
              <button
                onClick={() => setShowAdd((v) => !v)}
                className="codex-btn px-2 py-1 text-[11px] flex items-center gap-1"
              >
                <Plus size={10} /> Añadir
              </button>
            </div>
            <p className="text-[11px] text-text-muted mb-3">
              Cada miembro puede usar su propio proveedor+modelo. La API key se guarda en el
              keyring del OS, así cada quien paga su consumo. Las conversaciones pueden aislarse
              por miembro (carpeta privada) si desactivas "ver chats ajenos".
            </p>

            {showAdd && (
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
                    memberPw={memberPw[m.id] ?? ''}
                    onMemberPwChange={(v) => setMemberPw({ ...memberPw, [m.id]: v })}
                    onTogglePerm={togglePerm}
                    onChangeRole={changeRole}
                    onChangeProvider={changeProvider}
                    onChangeModel={changeModel}
                    onSavePassword={saveMemberPassword}
                    onRemove={removeMember}
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
  memberPw: string;
  onMemberPwChange: (v: string) => void;
  onTogglePerm: (m: ProjectMember, perm: keyof ProjectMember) => void;
  onChangeRole: (m: ProjectMember, role: Role) => void;
  onChangeProvider: (m: ProjectMember, providerId: string | null) => void;
  onChangeModel: (m: ProjectMember, modelId: string | null) => void;
  onSavePassword: (id: string) => void;
  onRemove: (m: ProjectMember) => void;
}

function MemberRow({
  m,
  memberPw,
  onMemberPwChange,
  onTogglePerm,
  onChangeRole,
  onChangeProvider,
  onChangeModel,
  onSavePassword,
  onRemove,
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
        <span className="flex-1 text-sm text-text-primary truncate">{m.name}</span>
        <span className="text-[10px] px-1.5 py-0.5 rounded bg-app-elevated text-text-muted uppercase">
          {m.role}
        </span>
        <button
          onClick={() => onRemove(m)}
          className="codex-icon-btn w-4 h-4"
          title="Eliminar miembro"
        >
          <Trash2 size={10} />
        </button>
      </div>

      {expanded && (
        <div className="border-t border-border px-3 py-3 space-y-3 bg-app-elevated/30">
          <div>
            <label className="text-[10px] uppercase text-text-muted">Rol</label>
            <select
              value={m.role}
              onChange={(e) => onChangeRole(m, e.target.value as Role)}
              className="codex-input w-full px-2 py-1.5 text-sm mt-0.5"
              disabled={m.role === 'owner'}
            >
              <option value="owner">Dueño (no cambiable)</option>
              <option value="admin">Admin</option>
              <option value="member">Miembro</option>
              <option value="viewer">Sólo lectura</option>
            </select>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[10px] uppercase text-text-muted">Proveedor propio</label>
              <select
                value={m.providerId ?? ''}
                onChange={(e) => onChangeProvider(m, e.target.value || null)}
                className="codex-input w-full px-2 py-1.5 text-sm mt-0.5"
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
                disabled={!provider}
              >
                <option value="">Por defecto</option>
                {models.map((md) => (
                  <option key={md.id} value={md.id}>{md.label}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="text-[10px] uppercase text-text-muted block mb-1">Permisos</label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
              <PermToggle
                label="Ejecutar agent"
                desc="Permitir que el agent use tools"
                value={m.canRunAgent}
                onChange={() => onTogglePerm(m, 'canRunAgent')}
              />
              <PermToggle
                label="Editar archivos"
                desc="file_write / file_read en este proyecto"
                value={m.canEditFiles}
                onChange={() => onTogglePerm(m, 'canEditFiles')}
              />
              <PermToggle
                label="Usar shell"
                desc="Ejecutar comandos shell_exec"
                value={m.canUseShell}
                onChange={() => onTogglePerm(m, 'canUseShell')}
              />
              <PermToggle
                label="Ver chats ajenos"
                desc="Si OFF, sus chats son privados (carpeta)"
                value={m.canSeeOtherChats}
                onChange={() => onTogglePerm(m, 'canSeeOtherChats')}
              />
              <PermToggle
                label="Gestionar miembros"
                desc="Invitar / eliminar / cambiar permisos"
                value={m.canManageMembers}
                onChange={() => onTogglePerm(m, 'canManageMembers')}
              />
            </div>
          </div>

          <div>
            <label className="text-[10px] uppercase text-text-muted">Contraseña del miembro</label>
            <div className="flex gap-2 mt-0.5">
              <input
                type="password"
                value={memberPw}
                onChange={(e) => onMemberPwChange(e.target.value)}
                placeholder={m.passwordHash ? 'Cambiar…' : 'Opcional…'}
                className="codex-input flex-1 px-2 py-1.5 text-sm"
              />
              <button
                onClick={() => onSavePassword(m.id)}
                className="codex-btn px-3 py-1.5 text-xs"
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
}: {
  label: string;
  desc: string;
  value: boolean;
  onChange: () => void;
}) {
  return (
    <label className="flex items-start gap-2 cursor-pointer">
      <input
        type="checkbox"
        checked={value}
        onChange={onChange}
        className="mt-0.5 accent-accent"
      />
      <div>
        <div className="text-xs text-text-primary">{label}</div>
        <div className="text-[10px] text-text-muted leading-snug">{desc}</div>
      </div>
    </label>
  );
}
