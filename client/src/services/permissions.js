/**
 * Cargos e permissões (espelho de app/permissions.py do servidor).
 * O servidor sempre confere; aqui serve para mostrar ou esconder botões e montar a lista de membros.
 */
export const PERMS = {
  ADMINISTRATOR: 1 << 0,
  MANAGE_SERVER: 1 << 1,
  MANAGE_ROLES: 1 << 2,
  MANAGE_CHANNELS: 1 << 3,
  KICK_MEMBERS: 1 << 4,
  MANAGE_MESSAGES: 1 << 5,
  MOVE_MEMBERS: 1 << 6,
  CREATE_INVITE: 1 << 7
};
export const ALL_PERMISSIONS = (1 << 8) - 1;
export const OWNER_POSITION = 1e9;

export const PERMISSION_LIST = [
  { bit: PERMS.ADMINISTRATOR, label: 'Administrador', hint: 'Todas as permissões abaixo. Ainda respeita a hierarquia: não mexe em cargos acima do seu.' },
  { bit: PERMS.MANAGE_SERVER, label: 'Gerenciar servidor', hint: 'Mudar nome e ícone do servidor, ver e revogar os convites de todos.' },
  { bit: PERMS.MANAGE_ROLES, label: 'Gerenciar cargos', hint: 'Criar, editar e dar cargos que estejam abaixo do seu cargo mais alto.' },
  { bit: PERMS.MANAGE_CHANNELS, label: 'Gerenciar canais', hint: 'Criar, renomear e excluir canais.' },
  { bit: PERMS.KICK_MEMBERS, label: 'Expulsar membros', hint: 'Remover pessoas do servidor (elas podem voltar com um convite).' },
  { bit: PERMS.MANAGE_MESSAGES, label: 'Gerenciar mensagens', hint: 'Apagar mensagens de outras pessoas e encerrar enquetes.' },
  { bit: PERMS.MOVE_MEMBERS, label: 'Desconectar da call', hint: 'Tirar pessoas das calls deste servidor.' },
  { bit: PERMS.CREATE_INVITE, label: 'Criar convites', hint: 'Gerar links para chamar amigos para o servidor.' }
];

// Paleta de cores de cargo (a mesma do Discord)
export const ROLE_COLORS = [
  '#1abc9c', '#2ecc71', '#3498db', '#9b59b6', '#e91e63', '#f1c40f', '#e67e22', '#e74c3c', '#95a5a6', '#607d8b',
  '#11806a', '#1f8b4c', '#206694', '#71368a', '#ad1457', '#c27c0e', '#a84300', '#992d22', '#979c9f', '#546e7a'
];

const sortedRoles = (server) => [...(server?.roles || [])].sort((a, b) => b.position - a.position);

/** Cargos (sem @everyone) de alguém, do mais alto para o mais baixo. */
export function memberRoles(server, userId) {
  const member = server?.members?.find((m) => m.user_id === userId);
  if (!member) return [];
  const ids = new Set(member.role_ids || []);
  return sortedRoles(server).filter((r) => !r.is_default && ids.has(r.id));
}

export function isOwner(server, userId) {
  return server?.owner_id === userId;
}

/** Permissões efetivas. `me` (opcional) libera tudo para o super admin. */
export function permissionsOf(server, userId, me = null) {
  if (!server || userId == null) return 0;
  if (isOwner(server, userId) || (me?.id === userId && me?.is_superadmin)) return ALL_PERMISSIONS;
  const everyone = server.roles?.find((r) => r.is_default);
  let perms = everyone?.permissions || 0;
  for (const role of memberRoles(server, userId)) perms |= role.permissions || 0;
  return perms;
}

export function hasPermission(server, userId, perm, me = null) {
  const perms = permissionsOf(server, userId, me);
  return Boolean(perms & (PERMS.ADMINISTRATOR | perm));
}

export function topPosition(server, userId) {
  if (isOwner(server, userId)) return OWNER_POSITION;
  return memberRoles(server, userId)[0]?.position || 0;
}

/** Cor do nome: o cargo mais alto que tem cor. */
export function roleColor(server, userId) {
  return memberRoles(server, userId).find((r) => r.color)?.color || null;
}

/** Cargo em que a pessoa aparece na lista de membros: o mais alto marcado como "mostrar separado". */
export function hoistedRole(server, userId) {
  return memberRoles(server, userId).find((r) => r.hoist) || null;
}

/** Posso dar/tirar este cargo? (precisa de Gerenciar cargos e o cargo abaixo do meu mais alto) */
export function canManageRole(server, me, role) {
  if (!role || role.is_default || !hasPermission(server, me?.id, PERMS.MANAGE_ROLES, me)) return false;
  return (me?.is_superadmin ? OWNER_POSITION : topPosition(server, me?.id)) > role.position;
}

/** Posso moderar esta pessoa (expulsar, desconectar, mudar cargos)? Ela precisa estar abaixo de mim. */
export function outranks(server, me, userId) {
  if (isOwner(server, userId)) return false;
  const mine = me?.is_superadmin ? OWNER_POSITION : topPosition(server, me?.id);
  return mine > topPosition(server, userId);
}
