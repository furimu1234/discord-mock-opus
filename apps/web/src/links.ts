import { createContext } from 'react';

/** Discord のチャンネルとメッセージのリンクの先頭。Bot が送るリンクと同じ形にする。 */
export const CHANNEL_URL = 'https://discord.com/channels';

/** DM のリンクで、サーバーの ID の代わりに入る値。 */
export const DM_GUILD = '@me';

/** リンクが指すチャンネル。`messageId` があればメッセージのリンク。 */
export interface ChannelLinkTarget {
  guildId: string;
  channelId: string;
  messageId?: string;
}

export const channelUrl = ({ guildId, channelId, messageId }: ChannelLinkTarget) =>
  [CHANNEL_URL, guildId, channelId, ...(messageId ? [messageId] : [])].join('/');

/** 本文の中のチャンネルとメッセージのリンク。ptb、canary、discordapp.com のリンクも含める。 */
export const CHANNEL_LINK_PATTERN = /https:\/\/(?:ptb\.|canary\.)?discord(?:app)?\.com\/channels\/(\d+|@me)\/(\d+)(?:\/(\d+))?/;

/** リンクのチャンネルを開く。画面の外側（App）が、表示の切り替えを渡す。 */
export const OpenLinkContext = createContext<(target: ChannelLinkTarget) => void>(() => {});
