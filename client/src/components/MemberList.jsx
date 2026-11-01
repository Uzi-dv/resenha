import React from 'react';
import Avatar from './Avatar';
import { useServer } from '../context/ServerContext';
import { useStore } from '../services/store';
import { presenceStore } from '../services/voice/stores';
import { hoistedRole, roleColor } from '../services/permissions';
import { Crown } from 'lucide-react';

const PRESENCE_DOT = { online: 'bg-ok', idle: 'bg-warn', dnd: 'bg-danger', offline: 'bg-fg-faint' };

/**
 * Lista de membros agrupada como no Discord: quem está online aparece no grupo do seu cargo
 * mais alto marcado como "mostrar separado" (do cargo mais alto para o mais baixo), depois
 * "Disponível" para quem não tem cargo separado, e todo mundo offline junto no fim.
 */
export default function MemberList({ onOpenUserProfile, onUserContextMenu }) {
  const { currentServer } = useServer();
  const presences = useStore(presenceStore);

  if (!currentServer || !currentServer.members) return null;

  const byName = (a, b) => a.user.username.localeCompare(b.user.username, 'pt-BR', { sensitivity: 'base' });
  const members = currentServer.members.map((m) => ({ ...m, user: { ...m.user, presence: presences[m.user.id] || 'offline' } }));

  const groups = new Map(); // roleId -> { role, members }
  const online = [];
  const offline = [];
  for (const m of members) {
    if (m.user.presence === 'offline') {
      offline.push(m);
      continue;
    }
    const role = hoistedRole(currentServer, m.user_id);
    if (!role) {
      online.push(m);
      continue;
    }
    if (!groups.has(role.id)) groups.set(role.id, { role, members: [] });
    groups.get(role.id).members.push(m);
  }
  const sections = [
    ...[...groups.values()]
      .sort((a, b) => b.role.position - a.role.position)
      .map((g) => ({ key: `r${g.role.id}`, title: g.role.name, members: g.members.sort(byName) })),
    { key: 'online', title: 'Disponível', members: online.sort(byName) },
    { key: 'offline', title: 'Offline', members: offline.sort(byName), dim: true }
  ].filter((s) => s.members.length > 0);

  const renderMember = (member, dim) => {
    const owner = member.role === 'owner';
    const color = roleColor(currentServer, member.user_id);

    return (
      <div
        key={member.id}
        onClick={() => onOpenUserProfile(member.user.id)}
        onContextMenu={(e) => onUserContextMenu?.(e, member.user)}
        className={`flex items-center gap-3 px-2 py-1.5 rounded hover:bg-hover cursor-pointer transition group ${dim ? 'opacity-50 hover:opacity-100' : ''}`}
      >
        <div className="relative shrink-0">
          <Avatar user={member.user} alt={member.user.username} className="w-8 h-8 rounded-full object-cover bg-well" />
          <div className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-side ${PRESENCE_DOT[member.user.presence] || PRESENCE_DOT.offline}`} />
        </div>

        <div className="flex flex-col min-w-0">
          <div className="flex items-center gap-1 min-w-0">
            <span
              className={`text-sm font-medium truncate ${color ? '' : 'text-fg group-hover:text-fg-strong'}`}
              style={color ? { color } : undefined}
            >
              {member.user.username}
            </span>
            {owner && <Crown className="w-3.5 h-3.5 text-[#e9ac36] shrink-0" title="Dono do servidor" />}
          </div>
          {member.user.custom_status && <span className="text-[11px] text-fg-muted truncate">{member.user.custom_status}</span>}
        </div>
      </div>
    );
  };

  return (
    <aside className="w-60 bg-side border-l border-line flex flex-col px-2 py-4 shrink-0 overflow-y-auto select-none no-scrollbar">
      {sections.map((section) => (
        <div key={section.key} className="mb-4 last:mb-0">
          <h4 className="text-[13px] font-semibold text-fg-muted px-2 mb-1 truncate">
            {section.title} <span className="text-fg-faint font-medium">{section.members.length}</span>
          </h4>
          <div className="space-y-0.5">{section.members.map((m) => renderMember(m, section.dim))}</div>
        </div>
      ))}
    </aside>
  );
}
