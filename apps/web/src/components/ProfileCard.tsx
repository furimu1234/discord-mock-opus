import { api, type Json } from '../api';
import { assignableRoles } from '../permissions';
import { Avatar, colorOf, displayName } from './Avatar';
import { Floating, type Anchor } from './ContextMenu';
import { Select } from './Select';

const roleColor = (role: Json) => (role.color ? `#${(role.color as number).toString(16).padStart(6, '0')}` : 'var(--text-muted)');

export function ProfileCard({ user, guild, activeUser, anchor, onClose, onError }: {
  user: Json;
  guild: Json;
  activeUser?: Json;
  anchor: Anchor;
  onClose: () => void;
  onError: (message: string) => void;
}) {
  const member = guild.members[user.id] as Json;
  const roles = guild.roles as Json[];
  const held = roles.filter((role) => member.roles.includes(role.id)).sort((a, b) => b.position - a.position);
  const assignable = assignableRoles(guild, activeUser?.id);
  const canAssign = (role: Json) => assignable.some((candidate) => candidate.id === role.id);
  const addable = assignable.filter((role) => !member.roles.includes(role.id));

  const setRoles = (next: string[]) => {
    api.put(`/guilds/${guild.id}/members/${user.id}`, { roles: next }).catch((error: Error) => onError(error.message));
  };

  return (
    <Floating anchor={anchor} className="profile-card floating" role="dialog" label={`${displayName(user)} のプロフィール`} onClose={onClose}>
      <div className="profile-banner" style={{ background: colorOf(user.id) }} />
      <div className="profile-avatar"><Avatar user={user} size={72} /></div>
      <div className="profile-names">
        <strong>{member.nick ?? displayName(user)}</strong>
        <span>{user.username}{user.bot && <span className="bot-tag">BOT</span>}</span>
      </div>
      <h3>ユーザー ID</h3>
      <code className="profile-id">{user.id}</code>
      <h3>ロール</h3>
      {held.length === 0 && <p className="profile-empty">ロールはありません</p>}
      <ul className="role-chips">
        {held.map((role) => (
          <li key={role.id} className="role-chip">
            <span className="role-dot" style={{ background: roleColor(role) }} />
            {role.name}
            {canAssign(role) && (
              <button aria-label={`${role.name} を剥奪`} title="剥奪"
                onClick={() => setRoles((member.roles as string[]).filter((id) => id !== role.id))}>×</button>
            )}
          </li>
        ))}
      </ul>
      {addable.length > 0 && (
        <Select className="role-add" label="ロールを付与" value="" placeholder="ロールを付与…"
          options={addable.map((role) => ({ value: role.id, label: role.name }))}
          onChange={(roleId) => setRoles([...member.roles, roleId])} />
      )}
    </Floating>
  );
}
