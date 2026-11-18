import { AuditLogEvent, ChannelType, isThreadType, isVoiceType } from './constants.js';
import { OverwriteType, type PermissionOverwrite } from './permissions.js';
import { NO_CONTENT, type ApiRoute, type RouteModule } from './routes.js';
import { BadRequest, NotFound, type Json, type Store } from './store.js';

/** Discord の公開ドキュメントの上限。 */
const MAX_VOICE_STATUS_LENGTH = 500;
const ErrorCode = { invalidForm: 50035, wrongChannelType: 50024, unknownOverwrite: 10009 };

/** 権限の上書き、権限の取得、ボイスチャンネルのステータス、グループ DM の参加者、入力中の表示。 */
export class ChannelActions implements RouteModule {
  constructor(private readonly store: Store) {
    // 誰かがボイスチャンネルに入ったときと、全員が出たときに、通話の開始時刻を更新する。
    store.on('dispatch', (event: string, data: Json) => {
      if (event === 'VOICE_STATE_UPDATE') this.updateStartTimes(data.guild_id);
    });
  }

  private dispatch(event: string, data: Json): void {
    this.store.emit('dispatch', event, data);
  }

  routes(api: ApiRoute): void {
    api('GET', '/channels/:channel/permissions/member/:user', ({ params }) => this.memberPermissions(params.channel!, params.user!));
    api('GET', '/channels/:channel/permissions/role/:role', ({ params }) => this.rolePermissions(params.channel!, params.role!));
    api('PUT', '/channels/:channel/permissions/:overwrite', ({ params, body }) => {
      this.editOverwrite(params.channel!, params.overwrite!, body);
      return NO_CONTENT;
    });
    api('DELETE', '/channels/:channel/permissions/:overwrite', ({ params }) => {
      this.deleteOverwrite(params.channel!, params.overwrite!);
      return NO_CONTENT;
    });
    api('PUT', '/channels/:channel/voice-status', ({ params, body }) => {
      this.setVoiceStatus(params.channel!, body.status ?? null);
      return NO_CONTENT;
    });
    api('PUT', '/channels/:channel/recipients/:user', ({ params }) => {
      this.addRecipient(params.channel!, params.user!);
      return NO_CONTENT;
    });
    api('DELETE', '/channels/:channel/recipients/:user', ({ params }) => {
      this.removeRecipient(params.channel!, params.user!);
      return NO_CONTENT;
    });
  }

  mockRoutes(mock: ApiRoute): void {
    // 画面とテストのユーザーが入力を始めたことを Bot に知らせる。
    mock('POST', '/channels/:channel/typing', ({ params, body }) => {
      this.typing(params.channel!, body.userId);
      return { ok: true };
    });
  }

  private requireGuildChannel(channelId: string): Json {
    const channel = this.store.requireChannel(channelId);
    if (!channel.guild_id) throw new BadRequest('サーバーのチャンネルではありません', ErrorCode.wrongChannelType);
    // スレッドの権限は親のチャンネルに従う。
    return isThreadType(channel.type) ? this.store.requireChannel(channel.parent_id) : channel;
  }

  memberPermissions(channelId: string, userId: string): Json {
    const channel = this.requireGuildChannel(channelId);
    return { permissions: this.store.memberPermissions(channel.guild_id, userId, channel.id) };
  }

  rolePermissions(channelId: string, roleId: string): Json {
    const channel = this.requireGuildChannel(channelId);
    return { permissions: this.store.rolePermissions(channel.guild_id, roleId, channel.permission_overwrites) };
  }

  editOverwrite(channelId: string, overwriteId: string, body: Json): void {
    const channel = this.store.requireChannel(channelId);
    if (!channel.guild_id || isThreadType(channel.type)) throw new BadRequest('サーバーのチャンネルではありません', ErrorCode.wrongChannelType);
    const type = Number(body.type);
    if (type !== OverwriteType.role && type !== OverwriteType.member) throw new BadRequest('type は 0 か 1 で指定してください', ErrorCode.invalidForm);
    const overwrite = { id: overwriteId, type, allow: String(body.allow ?? '0'), deny: String(body.deny ?? '0') };
    const others = (channel.permission_overwrites as PermissionOverwrite[]).filter((candidate) => candidate.id !== overwriteId);
    this.store.updateChannel(channelId, { permission_overwrites: [...others, overwrite] });
    this.syncThreads(channel);
  }

  deleteOverwrite(channelId: string, overwriteId: string): void {
    const channel = this.store.requireChannel(channelId);
    const overwrites = channel.permission_overwrites as PermissionOverwrite[];
    if (!overwrites.some((overwrite) => overwrite.id === overwriteId)) throw new NotFound('Unknown Overwrite', ErrorCode.unknownOverwrite);
    this.store.updateChannel(channelId, { permission_overwrites: overwrites.filter((overwrite) => overwrite.id !== overwriteId) });
    this.syncThreads(channel);
  }

  /** 権限が変わったチャンネルの、参加中のスレッドを Bot に送り直す。 */
  private syncThreads(channel: Json): void {
    const { store } = this;
    const threads = store.activeThreads(channel.guild_id).threads.filter((thread: Json) => thread.parent_id === channel.id);
    this.dispatch('THREAD_LIST_SYNC', {
      guild_id: channel.guild_id,
      channel_ids: [channel.id],
      threads,
      members: threads.flatMap((thread: Json) =>
        (store.state.threadMembers[thread.id] ?? []).filter((member) => member.user_id === store.state.botUserId),
      ),
    });
  }

  setVoiceStatus(channelId: string, status: string | null): void {
    const channel = this.store.requireChannel(channelId);
    if (!isVoiceType(channel.type)) throw new BadRequest('ボイスチャンネルではありません', ErrorCode.wrongChannelType);
    if (status !== null && String(status).length > MAX_VOICE_STATUS_LENGTH) {
      throw new BadRequest(`status は ${MAX_VOICE_STATUS_LENGTH} 文字以内で指定してください`, ErrorCode.invalidForm);
    }
    const value = status || null;
    this.info(channelId).status = value;
    this.store.changed();
    this.dispatch('VOICE_CHANNEL_STATUS_UPDATE', { id: channelId, guild_id: channel.guild_id, status: value });
    this.store.audit(channel.guild_id, value ? AuditLogEvent.voiceChannelStatusUpdate : AuditLogEvent.voiceChannelStatusDelete, channelId, [], {
      channel_id: channelId,
      ...(value ? { status: value } : {}),
    });
  }

  private info(channelId: string) {
    return (this.store.state.voiceChannelInfo[channelId] ??= { status: null, voice_start_time: null });
  }

  /** 人のいるボイスチャンネルに通話の開始時刻を付け、空になったら開始時刻とステータスを消す。 */
  private updateStartTimes(guildId: string): void {
    const { store } = this;
    const occupied = new Set(Object.values(store.state.voiceStates).filter((state) => state.guild_id === guildId).map((state) => state.channel_id as string));
    for (const channel of store.guildChannels(guildId).filter((candidate) => isVoiceType(candidate.type))) {
      const info = store.state.voiceChannelInfo[channel.id];
      if (occupied.has(channel.id) && !info?.voice_start_time) {
        this.info(channel.id).voice_start_time = Math.floor(Date.now() / 1000);
        this.dispatch('VOICE_CHANNEL_START_TIME_UPDATE', { id: channel.id, guild_id: guildId, voice_start_time: this.info(channel.id).voice_start_time });
      } else if (!occupied.has(channel.id) && info?.voice_start_time) {
        info.voice_start_time = null;
        this.dispatch('VOICE_CHANNEL_START_TIME_UPDATE', { id: channel.id, guild_id: guildId, voice_start_time: null });
        if (info.status) {
          info.status = null;
          this.dispatch('VOICE_CHANNEL_STATUS_UPDATE', { id: channel.id, guild_id: guildId, status: null });
        }
      }
    }
  }

  /** Gateway の Request Channel Info への応答。サーバーのボイスチャンネルのステータスと通話の開始時刻。 */
  channelInfo(guildId: string): Json {
    const channels = this.store.guildChannels(guildId).filter((channel) => isVoiceType(channel.type));
    return {
      guild_id: guildId,
      channels: channels.map((channel) => ({ id: channel.id, ...this.info(channel.id) })),
    };
  }

  private requireGroupDm(channelId: string): Json {
    const channel = this.store.requireChannel(channelId);
    if (channel.type !== ChannelType.group_dm) throw new BadRequest('グループ DM ではありません', ErrorCode.wrongChannelType);
    return channel;
  }

  /** Mock に OAuth はないので、`access_token` は使わずダミーユーザーを追加する。 */
  addRecipient(channelId: string, userId: string): void {
    const channel = this.requireGroupDm(channelId);
    const user = this.store.requireUser(userId);
    if (channel.recipients.some((recipient: Json) => recipient.id === userId)) return;
    channel.recipients.push(user);
    this.store.changed();
  }

  removeRecipient(channelId: string, userId: string): void {
    const channel = this.requireGroupDm(channelId);
    channel.recipients = channel.recipients.filter((recipient: Json) => recipient.id !== userId);
    this.store.changed();
  }

  typing(channelId: string, userId: string): void {
    const channel = this.store.requireChannel(channelId);
    const member = channel.guild_id ? this.store.state.guilds[channel.guild_id]?.members[userId] : undefined;
    this.store.requireUser(userId);
    this.dispatch('TYPING_START', {
      channel_id: channelId,
      ...(channel.guild_id ? { guild_id: channel.guild_id } : {}),
      user_id: userId,
      timestamp: Math.floor(Date.now() / 1000),
      ...(member ? { member } : {}),
    });
  }
}
