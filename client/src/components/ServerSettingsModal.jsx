import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Plus, ChevronUp, ChevronDown, Trash2, Shield, Users, Search, Lock, Check, Link2, Loader2 } from 'lucide-react';
import Avatar from './Avatar';
import { useServer } from '../context/ServerContext';
import { useAuth } from '../context/AuthContext';
import { api } from '../services/api';
import { alertDialog, confirmDialog } from '../services/dialog';
import { gateway } from '../services/gateway';
import { displayLink, expiresIn } from '../services/invites';
import {
  PERMISSION_LIST, PERMS, ROLE_COLORS, canManageRole, hasPermission, memberRoles, outranks, roleColor
} from '../services/permissions';

function Switch({ checked, onChange, disabled }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative w-10 h-6 rounded-full shrink-0 transition-colors disabled:opacity-40 ${checked ? 'bg-ok' : 'bg-active'}`}
    >
      <span className={`absolute top-1 left-1 w-4 h-4 rounded-full bg-white transition-transform ${checked ? 'translate-x-4' : ''}`} />
    </button>
  );
}

const draftOf = (role) => ({ name: role.name, color: role.color || '', hoist: Boolean(role.hoist), permissions: role.permissions || 0 });

function RoleEditor({ server, me, role, memberCount }) {
  const [draft, setDraft] = useState(() => draftOf(role));
  const [saving, setSaving] = useState(false);
  const editable = role.is_default ? hasPermission(server, me.id, PERMS.MANAGE_ROLES, me) : canManageRole(server, me, role);
  const dirty = JSON.stringify(draft) !== JSON.stringify(draftOf(role));

  const togglePerm = (bit, on) => setDraft((d) => ({ ...d, permissions: on ? d.permissions | bit : d.permissions & ~bit }));

  const save = async () => {
    setSaving(true);
    try {
      await api.updateRole(server.id, role.id, role.is_default ? { permissions: draft.permissions } : draft);
    } catch (err) {
      alertDialog(err.message, 'Não foi possível salvar o cargo');
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    const ok = await confirmDialog({
      title: `Excluir o cargo "${role.name}"?`,
      message: memberCount ? `${memberCount} pessoa(s) perdem este cargo. Isso não pode ser desfeito.` : 'Isso não pode ser desfeito.',
      confirmLabel: 'Excluir cargo',
      danger: true
    });
    if (!ok) return;
    try {
      await api.deleteRole(server.id, role.id);
    } catch (err) {
      alertDialog(err.message);
    }
  };

  return (
    <div className="flex-1 min-w-0 flex flex-col">
      <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
        <div className="flex items-center gap-2">
          <span className="w-3.5 h-3.5 rounded-full shrink-0" style={{ background: draft.color || 'var(--c-fg-faint)' }} />
          <h3 className="text-base font-bold text-fg-strong truncate">Editar cargo — {role.name}</h3>
        </div>

        {!editable && (
          <div className="flex items-start gap-2 text-xs text-fg-2 bg-warn/10 border border-warn/30 rounded-lg px-3 py-2">
            <Lock className="w-4 h-4 text-warn shrink-0 mt-0.5" />
            Este cargo está no seu nível ou acima dele na hierarquia, então você só pode visualizá-lo.
          </div>
        )}

        {!role.is_default && (
          <>
            <section>
              <label className="text-sm font-semibold text-fg-muted">Nome do cargo</label>
              <input
                value={draft.name}
                disabled={!editable}
                maxLength={32}
                onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                className="mt-1.5 w-full bg-well text-sm text-fg-strong px-3 py-2 rounded-md border border-line focus:border-accent outline-none disabled:opacity-60"
              />
            </section>

            <section>
              <label className="text-sm font-semibold text-fg-muted">Cor</label>
              <p className="text-[11px] text-fg-muted mb-2">O nome das pessoas aparece com a cor do cargo mais alto delas que tenha cor.</p>
              <div className="flex gap-3">
                <button
                  disabled={!editable}
                  onClick={() => setDraft((d) => ({ ...d, color: '' }))}
                  className={`w-16 h-[52px] rounded-md border-2 flex items-center justify-center text-[10px] text-fg-muted bg-well ${
                    !draft.color ? 'border-fg-strong' : 'border-line'
                  }`}
                  title="Sem cor"
                >
                  {!draft.color ? <Check className="w-4 h-4 text-fg-strong" /> : 'Sem cor'}
                </button>
                <label
                  className={`relative w-16 h-[52px] rounded-md border-2 cursor-pointer overflow-hidden ${
                    draft.color && !ROLE_COLORS.includes(draft.color) ? 'border-fg-strong' : 'border-line'
                  }`}
                  title="Cor personalizada"
                  style={{ background: draft.color && !ROLE_COLORS.includes(draft.color) ? draft.color : 'conic-gradient(red, yellow, lime, aqua, blue, magenta, red)' }}
                >
                  <input
                    type="color"
                    disabled={!editable}
                    value={draft.color || '#99aab5'}
                    onChange={(e) => setDraft((d) => ({ ...d, color: e.target.value }))}
                    className="absolute inset-0 opacity-0 cursor-pointer"
                  />
                </label>
                <div className="grid grid-cols-10 gap-1.5">
                  {ROLE_COLORS.map((c) => (
                    <button
                      key={c}
                      disabled={!editable}
                      onClick={() => setDraft((d) => ({ ...d, color: c }))}
                      className="w-5 h-5 rounded flex items-center justify-center"
                      style={{ background: c }}
                      title={c}
                    >
                      {draft.color === c && <Check className="w-3.5 h-3.5 text-white" strokeWidth={3} />}
                    </button>
                  ))}
                </div>
              </div>
            </section>

            <section className="flex items-center justify-between gap-4">
              <div>
                <div className="text-sm font-medium text-fg-strong">Mostrar separado na lista de membros</div>
                <div className="text-[11px] text-fg-muted">Quem tem este cargo aparece num grupo próprio, com o nome do cargo.</div>
              </div>
              <Switch checked={draft.hoist} disabled={!editable} onChange={(v) => setDraft((d) => ({ ...d, hoist: v }))} />
            </section>
          </>
        )}

        <section>
          <label className="text-sm font-semibold text-fg-muted">Permissões</label>
          {role.is_default && (
            <p className="text-[11px] text-fg-muted mt-1">O @everyone vale para todos do servidor, inclusive quem não tem nenhum cargo.</p>
          )}
          <div className="mt-2 divide-y divide-line border border-line rounded-lg">
            {PERMISSION_LIST.map((p) => (
              <div key={p.bit} className="flex items-center justify-between gap-4 px-3 py-2.5">
                <div>
                  <div className="text-sm font-medium text-fg-strong">{p.label}</div>
                  <div className="text-[11px] text-fg-muted leading-snug">{p.hint}</div>
                </div>
                <Switch checked={Boolean(draft.permissions & p.bit)} disabled={!editable} onChange={(v) => togglePerm(p.bit, v)} />
              </div>
            ))}
          </div>
        </section>
      </div>

      {editable && (
        <div className="px-6 py-3 border-t border-line flex items-center justify-between gap-2 bg-panel/50">
          {!role.is_default ? (
            <button onClick={remove} className="text-sm font-medium text-danger hover:underline flex items-center gap-1.5">
              <Trash2 className="w-4 h-4" /> Excluir cargo
            </button>
          ) : (
            <span />
          )}
          <div className="flex items-center gap-2">
            {dirty && (
              <button onClick={() => setDraft(draftOf(role))} className="text-sm text-fg hover:underline px-3 py-1.5">
                Desfazer
              </button>
            )}
            <button
              onClick={save}
              disabled={!dirty || saving || !draft.name.trim()}
              className="bg-ok hover:bg-ok-hover text-white text-sm font-semibold px-4 py-2 rounded-md disabled:opacity-40"
            >
              {saving ? 'Salvando...' : 'Salvar alterações'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function RolesTab({ server, me }) {
  const roles = useMemo(() => [...(server.roles || [])].sort((a, b) => b.position - a.position), [server.roles]);
  const [selectedId, setSelectedId] = useState(() => roles.find((r) => !r.is_default)?.id ?? roles[0]?.id);
  const selected = roles.find((r) => r.id === selectedId) || roles[0];
  const canCreate = hasPermission(server, me.id, PERMS.MANAGE_ROLES, me);
  const countOf = (roleId) => (server.members || []).filter((m) => (m.role_ids || []).includes(roleId)).length;
  const ordered = roles.filter((r) => !r.is_default);

  const create = async () => {
    try {
      const role = await api.createRole(server.id, { name: 'novo cargo' });
      setSelectedId(role.id);
    } catch (err) {
      alertDialog(err.message);
    }
  };

  const move = async (role, delta) => {
    const ids = ordered.map((r) => r.id);
    const i = ids.indexOf(role.id);
    const j = i + delta;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    try {
      await api.reorderRoles(server.id, ids);
    } catch (err) {
      alertDialog(err.message);
    }
  };

  return (
    <div className="flex flex-1 min-h-0">
      <div className="w-60 shrink-0 border-r border-line flex flex-col">
        <div className="flex items-center justify-between px-4 pt-4 pb-2">
          <span className="text-sm font-semibold text-fg-muted">Cargos — {ordered.length}</span>
          {canCreate && (
            <button onClick={create} className="p-1 rounded text-fg-2 hover:text-fg-strong hover:bg-hover" title="Criar cargo">
              <Plus className="w-4 h-4" />
            </button>
          )}
        </div>
        <p className="px-4 text-[11px] text-fg-muted mb-2">Mais alto na lista = mais importante.</p>
        <div className="flex-1 overflow-y-auto px-2 pb-3 space-y-0.5">
          {roles.map((r) => {
            const i = ordered.findIndex((x) => x.id === r.id);
            const movable = !r.is_default && canManageRole(server, me, r);
            return (
              <div
                key={r.id}
                onClick={() => setSelectedId(r.id)}
                className={`group flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer text-sm ${
                  selected?.id === r.id ? 'bg-active text-fg-strong' : 'text-fg-2 hover:bg-hover'
                }`}
              >
                <span className="w-3 h-3 rounded-full shrink-0" style={{ background: r.color || 'var(--c-fg-faint)' }} />
                <span className="flex-1 truncate">{r.name}</span>
                {!r.is_default && <span className="text-[11px] text-fg-faint group-hover:hidden">{countOf(r.id)}</span>}
                {movable && (
                  <span className="hidden group-hover:flex items-center">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        move(r, -1);
                      }}
                      disabled={i <= 0 || !canManageRole(server, me, ordered[i - 1])}
                      className="p-0.5 rounded hover:bg-active disabled:opacity-30"
                      title="Subir"
                    >
                      <ChevronUp className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        move(r, 1);
                      }}
                      disabled={i >= ordered.length - 1}
                      className="p-0.5 rounded hover:bg-active disabled:opacity-30"
                      title="Descer"
                    >
                      <ChevronDown className="w-3.5 h-3.5" />
                    </button>
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>
      {selected ? (
        <RoleEditor key={`${selected.id}:${selected.name}:${selected.color}:${selected.hoist}:${selected.permissions}`} server={server} me={me} role={selected} memberCount={countOf(selected.id)} />
      ) : (
        <div className="flex-1 flex items-center justify-center text-sm text-fg-muted">Nenhum cargo.</div>
      )}
    </div>
  );
}

function MembersTab({ server, me }) {
  const [query, setQuery] = useState('');
  const [adding, setAdding] = useState(null); // user_id com o menu "+ cargo" aberto
  const assignable = [...(server.roles || [])].filter((r) => canManageRole(server, me, r)).sort((a, b) => b.position - a.position);

  const setRoles = async (userId, ids) => {
    try {
      await api.setMemberRoles(server.id, userId, ids);
    } catch (err) {
      alertDialog(err.message);
    }
  };

  const q = query.trim().toLowerCase();
  const members = (server.members || [])
    .filter((m) => !q || m.user.username.toLowerCase().includes(q))
    .sort((a, b) => a.user.username.localeCompare(b.user.username, 'pt-BR', { sensitivity: 'base' }));

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="px-6 pt-4 pb-3 flex items-center gap-3">
        <span className="text-sm font-semibold text-fg-muted">Membros — {server.members?.length || 0}</span>
        <div className="ml-auto flex items-center gap-2 bg-well rounded-md px-2.5 h-8 w-64">
          <Search className="w-4 h-4 text-fg-muted shrink-0" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar membro"
            className="flex-1 bg-transparent text-sm text-fg outline-none placeholder-fg-faint"
          />
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-4 pb-4">
        {members.map((m) => {
          const roles = memberRoles(server, m.user_id);
          const manageable = outranks(server, me, m.user_id) || m.user_id === me.id;
          const missing = assignable.filter((r) => !roles.some((x) => x.id === r.id));
          const color = roleColor(server, m.user_id);
          return (
            <div key={m.id} className="flex items-start gap-3 px-2 py-2.5 rounded-lg hover:bg-hover/50">
              <Avatar user={m.user} alt="" className="w-9 h-9 rounded-full object-cover bg-well shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold truncate" style={color ? { color } : undefined}>
                  <span className={color ? '' : 'text-fg-strong'}>{m.user.username}</span>
                  {m.role === 'owner' && <span className="ml-1.5 text-[10px] font-bold uppercase text-[#e9ac36]">dono</span>}
                </div>
                <div className="flex flex-wrap items-center gap-1 mt-1 relative">
                  {roles.map((r) => (
                    <span key={r.id} className="flex items-center gap-1 text-xs px-1.5 py-0.5 rounded bg-well border border-line text-fg-2">
                      <span className="w-2.5 h-2.5 rounded-full" style={{ background: r.color || 'var(--c-fg-faint)' }} />
                      {r.name}
                      {manageable && canManageRole(server, me, r) && (
                        <button
                          onClick={() => setRoles(m.user_id, roles.filter((x) => x.id !== r.id).map((x) => x.id))}
                          className="hover:text-danger"
                          title={`Tirar o cargo ${r.name}`}
                        >
                          <X className="w-3 h-3" />
                        </button>
                      )}
                    </span>
                  ))}
                  {roles.length === 0 && <span className="text-[11px] text-fg-faint">Sem cargos</span>}
                  {manageable && missing.length > 0 && (
                    <button
                      onClick={() => setAdding(adding === m.user_id ? null : m.user_id)}
                      className="w-6 h-6 rounded bg-well border border-line text-fg-2 hover:text-fg-strong flex items-center justify-center"
                      title="Dar cargo"
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                  )}
                  {adding === m.user_id && (
                    <div className="anim-drop absolute top-full left-0 mt-1 w-56 max-h-60 overflow-y-auto bg-float border border-line rounded-lg shadow-2xl p-1 z-10">
                      {missing.map((r) => (
                        <button
                          key={r.id}
                          onClick={() => {
                            setAdding(null);
                            setRoles(m.user_id, [...roles.map((x) => x.id), r.id]);
                          }}
                          className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-sm text-fg-2 hover:bg-hover hover:text-fg-strong text-left"
                        >
                          <span className="w-3 h-3 rounded-full" style={{ background: r.color || 'var(--c-fg-faint)' }} />
                          {r.name}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function InvitesTab({ server }) {
  const [invites, setInvites] = useState(null); // null = carregando
  const [error, setError] = useState(null);
  const [revoking, setRevoking] = useState(null);

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      api
        .listInvites(server.id)
        .then((list) => !cancelled && (setInvites(list), setError(null)))
        .catch((err) => !cancelled && (setInvites([]), setError(err.message)));
    load();
    const off = gateway.on('INVITE_UPDATE', (d) => d.server_id === server.id && load());
    return () => {
      cancelled = true;
      off();
    };
  }, [server.id]);

  const revoke = async (invite) => {
    const ok = await confirmDialog({
      title: 'Revogar convite?',
      message: `O link ${displayLink(invite.url)} para de funcionar na hora. Quem já entrou continua no servidor.`,
      confirmLabel: 'Revogar',
      danger: true
    });
    if (!ok) return;
    setRevoking(invite.code);
    try {
      await api.revokeInvite(invite.code);
      setInvites((list) => list.filter((i) => i.code !== invite.code));
    } catch (err) {
      alertDialog(err.message);
    } finally {
      setRevoking(null);
    }
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="px-6 pt-4 pb-3">
        <span className="text-sm font-semibold text-fg-muted">Convites ativos — {invites?.length ?? 0}</span>
        <p className="text-xs text-fg-muted mt-1">Revogar um convite faz o link parar de funcionar. Quem já entrou continua no servidor.</p>
      </div>
      <div className="flex-1 overflow-y-auto px-4 pb-4">
        {invites === null ? (
          <div className="flex justify-center py-10 text-fg-muted">
            <Loader2 className="w-5 h-5 animate-spin" />
          </div>
        ) : error ? (
          <p className="text-sm text-danger px-2">{error}</p>
        ) : invites.length === 0 ? (
          <div className="text-center py-12 text-fg-muted">
            <Link2 className="w-8 h-8 mx-auto mb-2 text-fg-faint" />
            <p className="text-sm">Nenhum convite ativo.</p>
            <p className="text-xs mt-1">Use “Convidar pessoas” no menu do servidor para criar um.</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[13px] font-semibold text-fg-muted">
                <th className="font-bold px-2 py-2">Criado por</th>
                <th className="font-bold px-2 py-2">Código</th>
                <th className="font-bold px-2 py-2">Usos</th>
                <th className="font-bold px-2 py-2">Expira em</th>
                <th className="px-2 py-2"><span className="sr-only">Ações</span></th>
              </tr>
            </thead>
            <tbody>
              {invites.map((invite) => (
                <tr key={invite.code} className="border-t border-line hover:bg-hover/40">
                  <td className="px-2 py-2.5">
                    <span className="flex items-center gap-2 min-w-0">
                      {invite.inviter && <Avatar user={invite.inviter} className="w-6 h-6 rounded-full object-cover bg-well shrink-0" />}
                      <span className="truncate text-fg-strong">{invite.inviter?.username || 'Conta excluída'}</span>
                    </span>
                  </td>
                  <td className="px-2 py-2.5 font-mono text-fg-2">{invite.code}</td>
                  <td className="px-2 py-2.5 tabular-nums text-fg-2">
                    {invite.uses}
                    {invite.max_uses ? `/${invite.max_uses}` : ''}
                  </td>
                  <td className="px-2 py-2.5 tabular-nums text-fg-2">{expiresIn(invite.expires_at)}</td>
                  <td className="px-2 py-2.5 text-right">
                    <button
                      onClick={() => revoke(invite)}
                      disabled={revoking === invite.code}
                      className="h-8 px-3 rounded-md text-xs font-semibold text-danger border border-danger/40 hover:bg-danger hover:text-white disabled:opacity-60"
                    >
                      Revogar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

/** Configurações do servidor: cargos (com permissões e hierarquia), cargos de cada membro e convites. */
export default function ServerSettingsModal({ onClose }) {
  const { currentServer } = useServer();
  const { user: me } = useAuth();
  const [tab, setTab] = useState('roles');
  const canManageServer = hasPermission(currentServer, me?.id, PERMS.MANAGE_SERVER, me);

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (!currentServer || !me) return null;

  return createPortal(
    <div className="anim-backdrop fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 select-none" onPointerDown={onClose}>
      <div onPointerDown={(e) => e.stopPropagation()} className="sheet w-full max-w-4xl h-[85dvh] flex flex-col bg-chat text-fg overflow-hidden">
        <div className="flex items-center justify-between px-5 pt-4 pb-0">
          <h2 className="text-lg font-bold text-fg-strong truncate">{currentServer.name} — Configurações</h2>
          <button onClick={onClose} className="p-1.5 rounded text-fg-muted hover:text-fg-strong hover:bg-hover" title="Fechar (Esc)">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="px-5 flex gap-5 border-b border-line mt-2">
          {[
            { id: 'roles', label: 'Cargos', icon: Shield },
            { id: 'members', label: 'Membros', icon: Users },
            ...(canManageServer ? [{ id: 'invites', label: 'Convites', icon: Link2 }] : [])
          ].map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`pb-2 pt-1 text-sm font-semibold flex items-center gap-1.5 border-b-2 transition-colors ${
                tab === t.id ? 'border-accent text-fg-strong' : 'border-transparent text-fg-muted hover:text-fg'
              }`}
            >
              <t.icon className="w-4 h-4" /> {t.label}
            </button>
          ))}
        </div>
        {tab === 'roles' ? (
          <RolesTab server={currentServer} me={me} />
        ) : tab === 'invites' && canManageServer ? (
          <InvitesTab server={currentServer} />
        ) : (
          <MembersTab server={currentServer} me={me} />
        )}
      </div>
    </div>,
    document.body
  );
}
