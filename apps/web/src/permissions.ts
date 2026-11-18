import { ChannelType, isThreadType } from '@dismock/server/constants';
import { computePermissions, Permission } from '@dismock/server/permissions';
import type { Json } from './api';

/** ユーザーが付与、剥奪できるロール。Bot のロールは Discord と同じく手動で操作できない。 */
export function assignableRoles(guild: Json, userId?: string): Json[] {
  const member = userId ? (guild.members[userId] as Json | undefined) : undefined;
  if (!member) return [];
  if (!(computePermissions(guild as never, userId!) & (Permission.administrator | Permission.manageRoles))) return [];
  return (guild.roles as Json[]).filter((role) => role.id !== guild.id && !role.managed);
}

/** スレッドの権限は親のチャンネルに従う。 */
const permissionSource = (state: Json, channel: Json): Json =>
  (isThreadType(channel.type) ? state.channels[channel.parent_id] : channel) ?? channel;

export function hasChannelPermission(state: Json, guild: Json, channel: Json, userId: string, flag: bigint): boolean {
  return (computePermissions(guild as never, userId, permissionSource(state, channel).permission_overwrites) & flag) !== 0n;
}

/** 未ログインのときは、すべてのチャンネルを表示する。 */
export function canViewChannel(state: Json, guild: Json, channel: Json, userId?: string | null): boolean {
  if (!userId) return true;
  if (!hasChannelPermission(state, guild, channel, userId, Permission.viewChannel)) return false;
  if (channel.type !== ChannelType.private_thread) return true;
  // 非公開スレッドは、参加者とスレッドの管理権限を持つユーザーだけが見られる。
  const joined = (state.threadMembers[channel.id] as Json[] | undefined)?.some((member) => member.user_id === userId);
  return Boolean(joined) || hasChannelPermission(state, guild, channel, userId, Permission.manageThreads);
}
