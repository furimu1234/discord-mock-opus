import { randomBytes } from 'node:crypto';
import { AuditLogEvent, ChannelType, creatableMessageFlags, isInvitable, isThreadType, MessageFlag, WebhookType } from './constants.js';
import { auditChanges, BadRequest, NotFound, snowflake, type Json, type Store } from './store.js';

/** Discord の公開ドキュメントの値。 */
const INVITE_CODE_LENGTH = 8;
const DEFAULT_INVITE_MAX_AGE = 86400;
const MAX_INVITE_AGE = 604800;
const WEBHOOK_TOKEN_BYTES = 51;
const ErrorCode = {
  unknownInvite: 10006,
  unknownWebhook: 10015,
  bannedFromGuild: 40007,
  alreadyCrossposted: 40033,
  wrongChannelType: 50024,
  invalidWebhookToken: 50027,
};

const inviteCode = () => randomBytes(INVITE_CODE_LENGTH).toString('base64url').slice(0, INVITE_CODE_LENGTH);

/** 招待、ウェブフック、お知らせのフォローを扱う。 */
const INVITE_AUDIT_KEYS = ['code', 'channel_id', 'max_uses', 'max_age', 'temporary'];
const WEBHOOK_AUDIT_KEYS = ['name', 'channel_id', 'type', 'avatar'];

export class Integrations {
  /** `isBanned` は BAN 中のユーザーかを返す。BAN は Moderation が持つ。 */
  constructor(
    private readonly store: Store,
    private readonly isBanned: (guildId: string, userId: string) => boolean = () => false,
  ) {}

  private dispatch(event: string, data: Json): void {
    this.store.emit('dispatch', event, data);
  }

  private requireInvitable(channelId: string): Json {
    const channel = this.store.requireChannel(channelId);
    if (!isInvitable(channel.type)) {
      throw new BadRequest('このチャンネルには作成できません', ErrorCode.wrongChannelType);
    }
    return channel;
  }

  // 招待

  private expired(invite: Json): boolean {
    return invite.max_age > 0 && Date.parse(invite.created_at) + invite.max_age * 1000 < Date.now();
  }

  /** 期限の切れた招待を消してから返す。 */
  private liveInvites(): Json[] {
    const { invites } = this.store.state;
    for (const invite of Object.values(invites)) {
      if (this.expired(invite)) delete invites[invite.code];
    }
    return Object.values(invites);
  }

  invitePayload(invite: Json): Json {
    const guild = this.store.requireGuild(invite.guild_id);
    const channel = this.store.requireChannel(invite.channel_id);
    const expires = invite.max_age > 0 ? new Date(Date.parse(invite.created_at) + invite.max_age * 1000).toISOString() : null;
    return {
      type: 0,
      code: invite.code,
      guild: { id: guild.id, name: guild.name, splash: null, banner: null, description: null, icon: null, features: [], verification_level: 0, vanity_url_code: null, nsfw_level: 0 },
      channel: { id: channel.id, name: channel.name, type: channel.type },
      inviter: this.store.state.users[invite.inviter_id],
      approximate_member_count: Object.keys(guild.members).length,
      approximate_presence_count: Object.keys(guild.members).length,
      expires_at: expires,
      uses: invite.uses,
      max_uses: invite.max_uses,
      max_age: invite.max_age,
      temporary: invite.temporary,
      created_at: invite.created_at,
    };
  }

  /** `unique` でなければ、同じ設定の招待を使い回す。 */
  createInvite(channelId: string, inviterId: string, body: Json): Json {
    const channel = this.requireInvitable(channelId);
    const settings = {
      max_age: Math.min(body.max_age ?? DEFAULT_INVITE_MAX_AGE, MAX_INVITE_AGE),
      max_uses: body.max_uses ?? 0,
      temporary: Boolean(body.temporary),
    };
    const reusable = !body.unique && this.liveInvites().find((invite) =>
      invite.channel_id === channelId && invite.inviter_id === inviterId && invite.uses === 0
      && invite.max_age === settings.max_age && invite.max_uses === settings.max_uses && invite.temporary === settings.temporary);
    if (reusable) return this.invitePayload(reusable);
    const invite = { code: inviteCode(), guild_id: channel.guild_id, channel_id: channelId, inviter_id: inviterId, uses: 0, created_at: new Date().toISOString(), ...settings };
    this.store.state.invites[invite.code] = invite;
    this.store.markCreated(invite.code);
    this.store.changed();
    const payload = this.invitePayload(invite);
    const { guild: _guild, channel: _channel, type: _type, approximate_member_count: _m, approximate_presence_count: _p, ...event } = payload;
    this.dispatch('INVITE_CREATE', { ...event, channel_id: channelId, guild_id: channel.guild_id });
    this.store.audit(channel.guild_id, AuditLogEvent.inviteCreate, null, auditChanges({}, invite, INVITE_AUDIT_KEYS));
    return payload;
  }

  requireInvite(code: string): Json {
    const invite = this.liveInvites().find((candidate) => candidate.code === code);
    if (!invite) throw new NotFound('Unknown Invite', ErrorCode.unknownInvite);
    return invite;
  }

  channelInvites(channelId: string): Json[] {
    this.store.requireChannel(channelId);
    return this.liveInvites().filter((invite) => invite.channel_id === channelId).map((invite) => this.invitePayload(invite));
  }

  guildInvites(guildId: string): Json[] {
    this.store.requireGuild(guildId);
    return this.liveInvites().filter((invite) => invite.guild_id === guildId).map((invite) => this.invitePayload(invite));
  }

  deleteInvite(code: string): Json {
    const invite = this.requireInvite(code);
    const payload = this.invitePayload(invite);
    delete this.store.state.invites[code];
    delete this.store.state.inviteTargets[code];
    this.store.changed();
    this.dispatch('INVITE_DELETE', { channel_id: invite.channel_id, guild_id: invite.guild_id, code });
    this.store.audit(invite.guild_id, AuditLogEvent.inviteDelete, null, auditChanges(invite, {}, INVITE_AUDIT_KEYS));
    return payload;
  }

  /** ダミーユーザーが招待でサーバーに参加する。使用回数の上限に達した招待は消える。 */
  acceptInvite(code: string, userId: string): Json {
    const invite = this.requireInvite(code);
    const guild = this.store.requireGuild(invite.guild_id);
    if (this.isBanned(invite.guild_id, userId)) {
      throw Object.assign(new Error('The user is banned from this guild'), { status: 403, code: ErrorCode.bannedFromGuild });
    }
    // 対象のユーザーを決めた招待は、そのユーザーだけが使える。
    const targets = this.store.state.inviteTargets[code];
    if (targets?.length && !targets.includes(userId)) {
      throw Object.assign(new Error('The user is not a target of this invite'), { status: 403, code: 0 });
    }
    if (!guild.members[userId]) this.store.addMember(invite.guild_id, userId);
    invite.uses += 1;
    this.store.changed();
    const payload = this.invitePayload(invite);
    if (invite.max_uses > 0 && invite.uses >= invite.max_uses) this.deleteInvite(code);
    return payload;
  }

  // ウェブフック

  private webhookPayload(webhook: Json, withToken = true): Json {
    const { token, creator_id, ...rest } = webhook;
    return {
      ...rest,
      user: this.store.state.users[creator_id],
      ...(withToken && token ? { token } : {}),
    };
  }

  private notifyWebhooks(webhook: Json): void {
    this.dispatch('WEBHOOKS_UPDATE', { guild_id: webhook.guild_id, channel_id: webhook.channel_id });
  }

  createWebhook(channelId: string, creatorId: string, body: Json): Json {
    const channel = this.requireInvitable(channelId);
    const name = String(body.name ?? '').trim();
    if (!name) throw new BadRequest('ウェブフックの名前を指定してください');
    const webhook = {
      id: snowflake(),
      type: WebhookType.incoming,
      guild_id: channel.guild_id,
      channel_id: channelId,
      creator_id: creatorId,
      name,
      avatar: body.avatar ?? null,
      application_id: null,
      token: randomBytes(WEBHOOK_TOKEN_BYTES).toString('base64url'),
    };
    this.store.state.webhooks[webhook.id] = webhook;
    this.store.markCreated(webhook.id);
    this.store.changed();
    this.notifyWebhooks(webhook);
    this.store.audit(webhook.guild_id, AuditLogEvent.webhookCreate, webhook.id, auditChanges({}, webhook, WEBHOOK_AUDIT_KEYS));
    return this.webhookPayload(webhook);
  }

  /** `token` を指定したときは、トークンが一致しなければ拒否する。 */
  requireWebhook(id: string, token?: string): Json {
    const webhook = this.store.state.webhooks[id];
    if (!webhook) throw new NotFound('Unknown Webhook', ErrorCode.unknownWebhook);
    if (token !== undefined && webhook.token !== token) {
      throw Object.assign(new Error('Invalid Webhook Token'), { status: 401, code: ErrorCode.invalidWebhookToken });
    }
    return webhook;
  }

  getWebhook(id: string, token?: string): Json {
    return this.webhookPayload(this.requireWebhook(id, token), token === undefined);
  }

  channelWebhooks(channelId: string): Json[] {
    this.store.requireChannel(channelId);
    return Object.values(this.store.state.webhooks).filter((webhook) => webhook.channel_id === channelId).map((webhook) => this.webhookPayload(webhook));
  }

  guildWebhooks(guildId: string): Json[] {
    this.store.requireGuild(guildId);
    return Object.values(this.store.state.webhooks).filter((webhook) => webhook.guild_id === guildId).map((webhook) => this.webhookPayload(webhook));
  }

  /** トークンで変更するときは、チャンネルを移せない。 */
  updateWebhook(id: string, body: Json, token?: string): Json {
    const webhook = this.requireWebhook(id, token);
    const before = { ...webhook };
    if (body.name !== undefined) webhook.name = body.name;
    if (body.avatar !== undefined) webhook.avatar = body.avatar;
    if (body.channel_id !== undefined && token === undefined) {
      webhook.channel_id = this.requireInvitable(body.channel_id).id;
    }
    this.store.changed();
    this.notifyWebhooks(webhook);
    this.store.audit(webhook.guild_id, AuditLogEvent.webhookUpdate, id, auditChanges(before, webhook, WEBHOOK_AUDIT_KEYS));
    return this.webhookPayload(webhook, token === undefined);
  }

  deleteWebhook(id: string, token?: string): void {
    const webhook = this.requireWebhook(id, token);
    delete this.store.state.webhooks[id];
    this.store.changed();
    this.notifyWebhooks(webhook);
    this.store.audit(webhook.guild_id, AuditLogEvent.webhookDelete, id, auditChanges(webhook, {}, WEBHOOK_AUDIT_KEYS));
  }

  private webhookAuthor(webhook: Json, username?: string): Json {
    return { id: webhook.id, username: username ?? webhook.name, discriminator: '0000', global_name: null, avatar: webhook.avatar, bot: true };
  }

  /** ウェブフックでメッセージを送信する。`threadId` を指定すると、そのスレッドに送信する。 */
  executeWebhook(id: string, token: string, body: Json, threadId?: string): Json {
    const webhook = this.requireWebhook(id, token);
    const channelId = threadId ?? webhook.channel_id;
    if (threadId && this.store.requireChannel(threadId).parent_id !== webhook.channel_id) throw new NotFound('Unknown Channel', 10003);
    if (!isThreadType(this.store.requireChannel(channelId).type) && threadId) throw new NotFound('Unknown Channel', 10003);
    return this.store.createMessage(channelId, this.webhookAuthor(webhook, body.username), { ...body, flags: creatableMessageFlags(body.flags) }, { webhook_id: id });
  }

  webhookMessage(id: string, token: string, messageId: string): Json {
    const webhook = this.requireWebhook(id, token);
    const message = Object.values(this.store.state.messages).flat().find((candidate) => candidate.id === messageId);
    if (!message || message.webhook_id !== webhook.id) throw new NotFound('Unknown Message', 10008);
    return message;
  }

  editWebhookMessage(id: string, token: string, messageId: string, body: Json): Json {
    const message = this.webhookMessage(id, token, messageId);
    return this.store.editMessage(message.channel_id, message.id, body);
  }

  deleteWebhookMessage(id: string, token: string, messageId: string): void {
    const message = this.webhookMessage(id, token, messageId);
    this.store.deleteMessage(message.channel_id, message.id);
  }

  // お知らせのフォロー

  /** お知らせチャンネルをフォローする。フォロー先のチャンネルに、チャンネルフォローのウェブフックを作成する。 */
  followChannel(sourceId: string, targetId: string, creatorId: string): Json {
    const source = this.store.requireChannel(sourceId);
    if (source.type !== ChannelType.announcement) throw new BadRequest('お知らせチャンネルではありません', ErrorCode.wrongChannelType);
    const target = this.requireInvitable(targetId);
    const existing = Object.values(this.store.state.webhooks).find((webhook) =>
      webhook.type === WebhookType.channelFollower && webhook.channel_id === targetId && webhook.source_channel.id === sourceId);
    if (existing) return { channel_id: sourceId, webhook_id: existing.id };
    const sourceGuild = this.store.requireGuild(source.guild_id);
    const webhook = {
      id: snowflake(),
      type: WebhookType.channelFollower,
      guild_id: target.guild_id,
      channel_id: targetId,
      creator_id: creatorId,
      name: `${sourceGuild.name} #${source.name}`,
      avatar: null,
      application_id: null,
      source_guild: { id: sourceGuild.id, name: sourceGuild.name, icon: null },
      source_channel: { id: source.id, name: source.name },
    };
    this.store.state.webhooks[webhook.id] = webhook;
    this.store.markCreated(webhook.id);
    this.store.changed();
    this.notifyWebhooks(webhook);
    return { channel_id: sourceId, webhook_id: webhook.id };
  }

  /** フォロー中のチャンネルへ、フォローのウェブフックからメッセージを届ける。 */
  crosspost(channelId: string, messageId: string): Json {
    const channel = this.store.requireChannel(channelId);
    if (channel.type !== ChannelType.announcement) throw new BadRequest('お知らせチャンネルではありません', ErrorCode.wrongChannelType);
    const message = this.store.findMessage(channelId, messageId);
    if (message.flags & MessageFlag.crossposted) throw new BadRequest('クロスポスト済みです', ErrorCode.alreadyCrossposted);
    message.flags |= MessageFlag.crossposted;
    this.store.changed();
    this.dispatch('MESSAGE_UPDATE', message);
    const followers = Object.values(this.store.state.webhooks)
      .filter((webhook) => webhook.type === WebhookType.channelFollower && webhook.source_channel.id === channelId);
    for (const webhook of followers) {
      this.store.createMessage(webhook.channel_id, this.webhookAuthor(webhook), message, {
        flags: MessageFlag.isCrosspost,
        webhook_id: webhook.id,
        message_reference: { message_id: messageId, channel_id: channelId, guild_id: channel.guild_id },
      });
    }
    return message;
  }
}
