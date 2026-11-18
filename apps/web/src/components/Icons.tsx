import { ChannelType, isThreadType } from '@dismock/server/constants';
import type { ReactNode } from 'react';

function Icon({ size = 20, children }: { size?: number; children: ReactNode }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      {children}
    </svg>
  );
}

export const HashIcon = () => (
  <Icon>
    <path d="M10.2 3.5 9.5 8h5l.7-4.5 2 .3L16.5 8H20v2h-3.8l-.7 4H19v2h-3.8l-.7 4.5-2-.3.7-4.2h-5l-.7 4.5-2-.3.7-4.2H3v-2h3.5l.7-4H4V8h3.5l.7-4.8 2 .3ZM9.2 10l-.7 4h5l.7-4h-5Z" />
  </Icon>
);

export const SpeakerIcon = () => (
  <Icon>
    <path d="M12 4v16l-5-4H3V8h4l5-4Zm3.5 3.5a6 6 0 0 1 0 9l-1.4-1.4a4 4 0 0 0 0-6.2l1.4-1.4Z" />
  </Icon>
);

const MegaphoneIcon = () => (
  <Icon>
    <path d="M20 4v13l-8-3H9l1 5H7l-1-5H4a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1h8l8-3Z" />
  </Icon>
);

const StageIcon = () => (
  <Icon>
    <path d="M12 3a3 3 0 0 1 3 3v5a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3ZM6 10v1a6 6 0 0 0 12 0v-1h2v1a8 8 0 0 1-7 7.900V21h-2v-2.100A8 8 0 0 1 4 11v-1h2Z" />
  </Icon>
);

const ForumIcon = () => (
  <Icon>
    <path d="M4 4h12a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H9l-4 3v-3H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Zm16 4a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-1v2l-3-2h-5v-2h5a4 4 0 0 0 4-4V8Z" />
  </Icon>
);

const MediaIcon = () => (
  <Icon>
    <path d="M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Zm1 11h14l-4-6-3 4-2-2-5 4ZM8 8a1.500 1.500 0 1 0 0 3 1.500 1.500 0 0 0 0-3Z" />
  </Icon>
);

export const ThreadIcon = () => (
  <Icon>
    <path d="M5 3h2v9a2 2 0 0 0 2 2h7.200l-2.600-2.600L15 10l5 5-5 5-1.400-1.400 2.600-2.600H9a4 4 0 0 1-4-4V3Z" />
  </Icon>
);

const DirectoryIcon = () => (
  <Icon>
    <path d="M4 3h16v18H4V3Zm2 2v14h12V5H6Zm2 2h8v2H8V7Zm0 4h8v2H8v-2Zm0 4h5v2H8v-2Z" />
  </Icon>
);

/** チャンネルの種類のアイコン。 */
export function ChannelIcon({ type }: { type: number }) {
  if (isThreadType(type)) return <ThreadIcon />;
  if (type === ChannelType.voice) return <SpeakerIcon />;
  if (type === ChannelType.announcement) return <MegaphoneIcon />;
  if (type === ChannelType.stage) return <StageIcon />;
  if (type === ChannelType.forum) return <ForumIcon />;
  if (type === ChannelType.media) return <MediaIcon />;
  if (type === ChannelType.directory) return <DirectoryIcon />;
  return <HashIcon />;
}

export const ChatIcon = () => (
  <Icon size={26}>
    <path d="M4 4h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-5 4v-4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z" />
  </Icon>
);

export const PlusIcon = () => (
  <Icon size={24}>
    <path d="M11 4h2v7h7v2h-7v7h-2v-7H4v-2h7V4Z" />
  </Icon>
);

export const BeakerIcon = () => (
  <Icon size={24}>
    <path d="M9 3h6v2h-1v5.4l5.6 8.2A2 2 0 0 1 18 22H6a2 2 0 0 1-1.6-3.4L10 10.4V5H9V3Zm3 8-3.1 4.5h6.2L12 11Z" />
  </Icon>
);

export const GearIcon = () => (
  <Icon size={24}>
    <path d="m13.5 2 .5 2.6 1.7.7L18 3.8l2.2 2.2-1.5 2.3.7 1.7 2.6.5v3l-2.6.5-.7 1.7 1.5 2.3-2.2 2.2-2.3-1.5-1.7.7-.5 2.6h-3l-.5-2.6-1.7-.7L6 20.2 3.8 18l1.5-2.3-.7-1.7-2.6-.5v-3l2.6-.5.7-1.7L3.8 6 6 3.8l2.3 1.5 1.7-.7.5-2.6h3ZM12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Z" />
  </Icon>
);

export const UsersIcon = () => (
  <Icon>
    <path d="M9 4a4 4 0 1 1 0 8 4 4 0 0 1 0-8Zm0 10c4 0 7 2 7 5v1H2v-1c0-3 3-5 7-5Zm7-9.5a4 4 0 0 1 0 7c.8-1 1.3-2.2 1.3-3.5S16.8 5.500 16 4.500ZM18 19c0-1.800-.7-3.400-2-4.600 3.300.3 6 2.100 6 4.600v1h-4v-1Z" />
  </Icon>
);

export const DatabaseIcon = () => (
  <Icon size={24}>
    <path d="M12 3c4.400 0 8 1.300 8 3s-3.600 3-8 3-8-1.300-8-3 3.600-3 8-3Zm8 5.400V12c0 1.700-3.600 3-8 3s-8-1.300-8-3V8.400C5.700 9.900 8.800 10.600 12 10.600s6.300-.7 8-2.200Zm0 6V18c0 1.700-3.600 3-8 3s-8-1.300-8-3v-3.600c1.700 1.500 4.800 2.200 8 2.200s6.300-.7 8-2.200Z" />
  </Icon>
);

export const FolderIcon = () => (
  <Icon size={16}>
    <path d="M3 6a2 2 0 0 1 2-2h4.600l2 2.500H19a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6Z" />
  </Icon>
);

export const ListIcon = () => (
  <Icon size={24}>
    <path d="M4 5h3v3H4V5Zm5 .5h11v2H9v-2ZM4 10.500h3v3H4v-3Zm5 .5h11v2H9v-2ZM4 16h3v3H4v-3Zm5 .5h11v2H9v-2Z" />
  </Icon>
);

export const ChevronIcon = () => (
  <Icon size={12}>
    <path d="m7 9 5 5 5-5 2 2-7 7-7-7 2-2Z" />
  </Icon>
);

export const HangUpIcon = () => (
  <Icon>
    <path d="M12 9c3.600 0 6.900 1 9.500 2.900.5.400.6 1 .3 1.500l-1.800 2.600c-.3.500-.9.600-1.400.3l-2.800-1.800c-.4-.2-.6-.7-.5-1.100l.4-1.800a12 12 0 0 0-7.400 0l.4 1.800c.1.400-.1.900-.5 1.100l-2.800 1.800c-.5.300-1.100.2-1.400-.3l-1.800-2.600c-.3-.5-.2-1.100.3-1.500C5.100 10 8.400 9 12 9Z" />
  </Icon>
);

export const ReplyIcon = () => (
  <Icon>
    <path d="M10 5v4c6 0 10 3 11 10-2.500-3.500-6-5-11-5v4L3 11l7-6Z" />
  </Icon>
);

export const PencilIcon = () => (
  <Icon>
    <path d="M15.500 4.500a2.100 2.100 0 0 1 3 3L8 18l-4 1 1-4L15.500 4.500Z" />
  </Icon>
);

export const MoreIcon = () => (
  <Icon>
    <path d="M6 10a2 2 0 1 1 0 4 2 2 0 0 1 0-4Zm6 0a2 2 0 1 1 0 4 2 2 0 0 1 0-4Zm6 0a2 2 0 1 1 0 4 2 2 0 0 1 0-4Z" />
  </Icon>
);

export const SmileIcon = () => (
  <Icon>
    <path d="M12 2a10 10 0 1 1 0 20 10 10 0 0 1 0-20ZM8.500 8a1.500 1.500 0 1 0 0 3 1.500 1.500 0 0 0 0-3Zm7 0a1.500 1.500 0 1 0 0 3 1.500 1.500 0 0 0 0-3ZM7 14c1 2.400 2.800 3.500 5 3.500s4-1.100 5-3.500H7Z" />
  </Icon>
);
