import { AuditLogEvent, AutoModAction, AutoModTrigger } from './constants.js';
import { auditChanges, BadRequest, NotFound, snowflake, type Json, type Store } from './store.js';

/** Discord の公開ドキュメントの値。 */
const ErrorCode = { unknownBan: 10026, unknownRule: 10066, blockedByAutoMod: 200000 };
const DEFAULT_AUDIT_LIMIT = 50;
const MAX_AUDIT_LIMIT = 100;
const MAX_BULK_BAN = 200;
const MESSAGE_SEND_EVENT = 1;
const AUTO_MODERATION_MESSAGE = 24;
const RULE_FIELDS = ['name', 'event_type', 'trigger_metadata', 'actions', 'enabled', 'exempt_roles', 'exempt_channels'];

/** ワイルドカード `*` の付いたキーワードを、Discord と同じく単語の一致として扱う。 */
function keywordPattern(keyword: string): RegExp {
  const prefix = keyword.startsWith('*');
  const suffix = keyword.endsWith('*');
  const core = keyword.replace(/^\*|\*$/g, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`${prefix ? '' : '(?<![\\p{L}\\p{N}_])'}${core}${suffix ? '' : '(?![\\p{L}\\p{N}_])'}`, 'iu');
}

/** BAN、キック、監査ログの取得、AutoMod を扱う。 */
export class Moderation {
  constructor(private readonly store: Store) {
    store.moderate = (channel, author, message) => this.enforce(channel, author, message);
  }

  private dispatch(event: string, data: Json): void {
    this.store.emit('dispatch', event, data);
  }

  // 監査ログ

  /** 新しい順に返す。`before` と `after` はエントリーの ID。 */
  auditLog(guildId: string, query: URLSearchParams): Json {
    this.store.requireGuild(guildId);
    const userId = query.get('user_id');
    const actionType = query.get('action_type');
    const before = query.get('before');
    const after = query.get('after');
    const limit = Math.min(Number(query.get('limit') ?? DEFAULT_AUDIT_LIMIT), MAX_AUDIT_LIMIT);
    const entries = (this.store.state.auditLogs[guildId] ?? [])
      .filter((entry) => !userId || entry.user_id === userId)
      .filter((entry) => !actionType || entry.action_type === Number(actionType))
      .filter((entry) => !before || BigInt(entry.id) < BigInt(before))
      .filter((entry) => !after || BigInt(entry.id) > BigInt(after))
      .slice(0, limit)
      .map(({ guild_id: _guild, ...entry }) => entry);
    const ids = new Set(entries.flatMap((entry) => [entry.user_id, entry.target_id]));
    const { users, channels, webhooks } = this.store.state;
    return {
      audit_log_entries: entries,
      users: Object.values(users).filter((user) => ids.has(user.id)),
      webhooks: Object.values(webhooks).filter((webhook) => ids.has(webhook.id)).map(({ token: _token, ...webhook }) => webhook),
      threads: Object.values(channels).filter((channel) => ids.has(channel.id) && channel.thread_metadata),
      integrations: [],
      application_commands: [],
      auto_moderation_rules: this.rules(guildId).filter((rule) => ids.has(rule.id)),
      guild_scheduled_events: [],
    };
  }

  // キックと BAN

  kick(guildId: string, userId: string): void {
    this.store.removeMember(guildId, userId);
    this.store.audit(guildId, AuditLogEvent.memberKick, userId);
  }

  isBanned(guildId: string, userId: string): boolean {
    return Boolean(this.store.state.bans[guildId]?.[userId]);
  }

  /** BAN してサーバーから外す。`delete_message_seconds` の間に送ったメッセージも消す。 */
  ban(guildId: string, userId: string, body: Json = {}): void {
    this.store.requireGuild(guildId);
    const user = this.store.requireUser(userId);
    const bans = (this.store.state.bans[guildId] ??= {});
    bans[userId] = { user, reason: this.store.actor?.reason ?? null };
    if (this.store.state.guilds[guildId]!.members[userId]) this.store.removeMember(guildId, userId);
    const since = Date.now() - Number(body.delete_message_seconds ?? 0) * 1000;
    for (const channel of Object.values(this.store.state.channels)) {
      if (channel.guild_id !== guildId) continue;
      const messages = (this.store.state.messages[channel.id] ?? [])
        .filter((message) => message.author.id === userId && Date.parse(message.timestamp) >= since);
      for (const message of messages) this.store.deleteMessage(channel.id, message.id);
    }
    this.store.changed();
    this.dispatch('GUILD_BAN_ADD', { guild_id: guildId, user });
    this.store.audit(guildId, AuditLogEvent.memberBanAdd, userId);
  }

  bulkBan(guildId: string, body: Json): Json {
    const userIds = (body.user_ids ?? []) as string[];
    if (userIds.length === 0 || userIds.length > MAX_BULK_BAN) throw new BadRequest(`user_ids は 1〜${MAX_BULK_BAN} 件で指定してください`, 50035);
    const banned: string[] = [];
    const failed: string[] = [];
    for (const userId of userIds) {
      if (this.isBanned(guildId, userId) || !this.store.state.users[userId]) failed.push(userId);
      else {
        this.ban(guildId, userId, body);
        banned.push(userId);
      }
    }
    return { banned_users: banned, failed_users: failed };
  }

  requireBan(guildId: string, userId: string): Json {
    const ban = this.store.state.bans[guildId]?.[userId];
    if (!ban) throw new NotFound('Unknown Ban', ErrorCode.unknownBan);
    return ban;
  }

  bans(guildId: string): Json[] {
    this.store.requireGuild(guildId);
    return Object.values(this.store.state.bans[guildId] ?? {});
  }

  unban(guildId: string, userId: string): void {
    const { user } = this.requireBan(guildId, userId);
    delete this.store.state.bans[guildId]![userId];
    this.store.changed();
    this.dispatch('GUILD_BAN_REMOVE', { guild_id: guildId, user });
    this.store.audit(guildId, AuditLogEvent.memberBanRemove, userId);
  }

  // AutoMod

  rules(guildId: string): Json[] {
    return Object.values(this.store.state.autoModRules).filter((rule) => rule.guild_id === guildId);
  }

  requireRule(guildId: string, ruleId: string): Json {
    const rule = this.store.state.autoModRules[ruleId];
    if (!rule || rule.guild_id !== guildId) throw new NotFound('Unknown auto moderation rule', ErrorCode.unknownRule);
    return rule;
  }

  createRule(guildId: string, body: Json): Json {
    this.store.requireGuild(guildId);
    if (!body.name || !body.trigger_type || !body.actions?.length) throw new BadRequest('name、trigger_type、actions を指定してください', 50035);
    const rule = {
      id: snowflake(),
      guild_id: guildId,
      name: body.name,
      creator_id: this.store.actor?.userId ?? this.store.state.botUserId,
      event_type: body.event_type ?? MESSAGE_SEND_EVENT,
      trigger_type: body.trigger_type,
      trigger_metadata: body.trigger_metadata ?? {},
      actions: body.actions,
      enabled: body.enabled ?? false,
      exempt_roles: body.exempt_roles ?? [],
      exempt_channels: body.exempt_channels ?? [],
    };
    this.store.state.autoModRules[rule.id] = rule;
    this.store.markCreated(rule.id);
    this.store.changed();
    this.dispatch('AUTO_MODERATION_RULE_CREATE', rule);
    this.store.audit(guildId, AuditLogEvent.autoModerationRuleCreate, rule.id, auditChanges({}, rule, RULE_FIELDS));
    return rule;
  }

  updateRule(guildId: string, ruleId: string, body: Json): Json {
    const rule = this.requireRule(guildId, ruleId);
    const before = structuredClone(rule);
    for (const key of RULE_FIELDS) {
      if (body[key] !== undefined) rule[key] = body[key];
    }
    this.store.changed();
    this.dispatch('AUTO_MODERATION_RULE_UPDATE', rule);
    this.store.audit(guildId, AuditLogEvent.autoModerationRuleUpdate, ruleId, auditChanges(before, rule, RULE_FIELDS));
    return rule;
  }

  deleteRule(guildId: string, ruleId: string): void {
    const rule = this.requireRule(guildId, ruleId);
    delete this.store.state.autoModRules[ruleId];
    this.store.changed();
    this.dispatch('AUTO_MODERATION_RULE_DELETE', rule);
    this.store.audit(guildId, AuditLogEvent.autoModerationRuleDelete, ruleId, auditChanges(rule, {}, RULE_FIELDS));
  }

  /** 一致したキーワードを返す。許可リストの語に一致したときは対象外。 */
  private match(rule: Json, content: string, mentionCount: number): string | undefined {
    const metadata = rule.trigger_metadata as Json;
    if (rule.trigger_type === AutoModTrigger.mentionSpam) {
      return mentionCount > (metadata.mention_total_limit ?? Number.POSITIVE_INFINITY) ? String(mentionCount) : undefined;
    }
    if (rule.trigger_type !== AutoModTrigger.keyword) return undefined;
    const allowed = ((metadata.allow_list ?? []) as string[]).some((keyword) => keywordPattern(keyword).test(content));
    if (allowed) return undefined;
    const keyword = ((metadata.keyword_filter ?? []) as string[]).find((candidate) => keywordPattern(candidate).test(content));
    if (keyword) return keyword;
    return ((metadata.regex_patterns ?? []) as string[]).find((pattern) => new RegExp(pattern).test(content));
  }

  /**
   * メッセージの送信時に、有効なルールを適用する。Bot のメッセージは対象外。
   * スパムとプリセットのキーワード、プロフィールのルールは保存だけで、判定はしない。
   */
  private enforce(channel: Json, author: Json, input: Json): ((messageId?: string) => void) | undefined {
    const guildId = channel.guild_id as string | undefined;
    if (!guildId || author.bot) return undefined;
    const member = this.store.state.guilds[guildId]?.members[author.id];
    const content = String(input.content ?? '');
    const mentionCount = new Set([...content.matchAll(/<@[!&]?(\d+)>/g)].map((match) => match[1])).size;
    const parentId = channel.parent_id as string | null;
    const hits = this.rules(guildId)
      .filter((rule) => rule.enabled && rule.event_type === MESSAGE_SEND_EVENT)
      .filter((rule) => !rule.exempt_channels.includes(channel.id) && !(parentId && rule.exempt_channels.includes(parentId)))
      .filter((rule) => !(member?.roles as string[] | undefined)?.some((role) => rule.exempt_roles.includes(role)))
      .map((rule) => ({ rule, keyword: this.match(rule, content, mentionCount) }))
      .filter((hit): hit is { rule: Json; keyword: string } => hit.keyword !== undefined);
    if (hits.length === 0) return undefined;

    const execute = (messageId?: string) => {
      for (const { rule, keyword } of hits) {
        for (const action of rule.actions as Json[]) this.runAction(guildId, channel, author, rule, action, keyword, content, messageId);
      }
    };
    const block = hits.flatMap(({ rule }) => (rule.actions as Json[]).filter((action) => action.type === AutoModAction.blockMessage))[0];
    if (block) {
      execute();
      throw new BadRequest(block.metadata?.custom_message || 'Message was blocked by automatic moderation', ErrorCode.blockedByAutoMod);
    }
    return execute;
  }

  private runAction(guildId: string, channel: Json, author: Json, rule: Json, action: Json, keyword: string, content: string, messageId?: string): void {
    let alertId: string | undefined;
    if (action.type === AutoModAction.blockMessage) {
      this.store.audit(guildId, AuditLogEvent.autoModerationBlockMessage, author.id, [], { channel_id: channel.id, auto_moderation_rule_name: rule.name, auto_moderation_rule_trigger_type: String(rule.trigger_type) });
    }
    if (action.type === AutoModAction.sendAlertMessage && action.metadata?.channel_id) {
      const alert = this.store.createMessage(action.metadata.channel_id, author, {
        embeds: [{
          type: 'auto_moderation_message',
          description: content,
          fields: [
            { name: 'rule_name', value: rule.name, inline: true },
            { name: 'channel_id', value: channel.id, inline: true },
            { name: 'keyword', value: keyword, inline: true },
          ],
        }],
      }, { type: AUTO_MODERATION_MESSAGE });
      alertId = alert.id;
      this.store.audit(guildId, AuditLogEvent.autoModerationFlagToChannel, author.id, [], { channel_id: channel.id, auto_moderation_rule_name: rule.name, auto_moderation_rule_trigger_type: String(rule.trigger_type) });
    }
    if (action.type === AutoModAction.timeout && action.metadata?.duration_seconds) {
      const until = new Date(Date.now() + action.metadata.duration_seconds * 1000).toISOString();
      this.store.updateMember(guildId, author.id, { communication_disabled_until: until });
      this.store.audit(guildId, AuditLogEvent.autoModerationUserCommunicationDisabled, author.id, [], { channel_id: channel.id, auto_moderation_rule_name: rule.name, auto_moderation_rule_trigger_type: String(rule.trigger_type) });
    }
    this.dispatch('AUTO_MODERATION_ACTION_EXECUTION', {
      guild_id: guildId,
      action,
      rule_id: rule.id,
      rule_trigger_type: rule.trigger_type,
      user_id: author.id,
      channel_id: channel.id,
      ...(messageId ? { message_id: messageId } : {}),
      ...(alertId ? { alert_system_message_id: alertId } : {}),
      content,
      matched_keyword: rule.trigger_type === AutoModTrigger.keyword ? keyword : null,
      matched_content: rule.trigger_type === AutoModTrigger.keyword ? keyword.replace(/\*/g, '') : null,
    });
  }
}
