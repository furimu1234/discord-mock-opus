import type { Json } from '../api';

const COLORS = ['#5865f2', '#57f287', '#fee75c', '#eb459e', '#ed4245', '#3ba55c', '#faa61a', '#00a8fc'];

export function colorOf(id = '0'): string {
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return COLORS[hash % COLORS.length]!;
}

export function displayName(user?: Json | null): string {
  return (user?.global_name as string) ?? (user?.username as string) ?? '不明なユーザー';
}

export function Avatar({ user, size = 40, online }: { user?: Json | null; size?: number; online?: boolean }) {
  return (
    <span className="avatar" style={{ width: size, height: size, background: colorOf(user?.id), fontSize: size * 0.45 }}>
      {displayName(user).slice(0, 1).toUpperCase()}
      {online !== undefined && <span className={online ? 'presence online' : 'presence'} />}
    </span>
  );
}
