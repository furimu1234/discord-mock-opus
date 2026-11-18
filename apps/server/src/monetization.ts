import { NO_CONTENT, type ApiRoute, type RouteModule } from './routes.js';
import { BadRequest, NotFound, snowflake, type Json, type Store } from './store.js';

/** Discord の公開ドキュメントの値。 */
export const SkuType = { durable: 2, consumable: 3, subscription: 5, subscriptionGroup: 6 } as const;
export const EntitlementType = { purchase: 1, testModePurchase: 4, applicationSubscription: 8 } as const;
export const EntitlementOwnerType = { guild: 1, user: 2 } as const;
export const SubscriptionStatus = { active: 0, ending: 1, inactive: 2 } as const;
const DEFAULT_LIMIT = 100;
const SUBSCRIPTION_PERIOD_MS = 30 * 24 * 60 * 60 * 1000;
const ErrorCode = { unknownSku: 10046, invalidForm: 50035 };

/** SKU、エンタイトルメント、サブスクリプション。購入とサブスクリプションは画面とテストから作る。 */
export class Monetization implements RouteModule {
  constructor(private readonly store: Store) {}

  private dispatch(event: string, data: Json): void {
    this.store.emit('dispatch', event, data);
  }

  routes(api: ApiRoute): void {
    const { store } = this;
    api('GET', '/applications/:app/skus', () => store.state.skus);
    api('GET', '/applications/:app/entitlements', ({ query }) => this.listEntitlements(query));
    api('GET', '/applications/:app/entitlements/:entitlement', ({ params }) => this.requireEntitlement(params.entitlement!));
    api('POST', '/applications/:app/entitlements/:entitlement/consume', ({ params }) => {
      this.consume(params.entitlement!);
      return NO_CONTENT;
    });
    api('POST', '/applications/:app/entitlements', ({ body }) => this.createTestEntitlement(body));
    api('DELETE', '/applications/:app/entitlements/:entitlement', ({ params }) => {
      const entitlement = this.requireEntitlement(params.entitlement!);
      if (entitlement.type !== EntitlementType.testModePurchase) throw new BadRequest('テスト用のエンタイトルメントだけを削除できます', ErrorCode.invalidForm);
      delete store.state.entitlements[entitlement.id];
      store.changed();
      this.dispatch('ENTITLEMENT_DELETE', entitlement);
      return NO_CONTENT;
    });
    api('GET', '/skus/:sku/subscriptions', ({ params, query }) => this.listSubscriptions(params.sku!, query));
    api('GET', '/skus/:sku/subscriptions/:subscription', ({ params }) => this.requireSubscription(params.sku!, params.subscription!));
  }

  mockRoutes(mock: ApiRoute): void {
    // SKU は Discord の開発者ポータルで作る。Mock では画面とテストから作る。
    mock('POST', '/skus', ({ body }) => this.createSku(body));
    // ユーザーが購入したことにする。
    mock('POST', '/entitlements', ({ body }) => this.grant(body.skuId, body.userId, body.guildId, EntitlementType.purchase));
    // ユーザーがサブスクリプションを始める、解約する、終了する。
    mock('POST', '/subscriptions', ({ body }) => this.subscribe(body.skuId, body.userId));
    mock('POST', '/subscriptions/:subscription/cancel', ({ params }) => this.cancel(params.subscription!));
    mock('DELETE', '/subscriptions/:subscription', ({ params }) => {
      this.endSubscription(params.subscription!);
      return { ok: true };
    });
  }

  createSku(body: Json): Json {
    const name = String(body.name ?? '');
    if (!name) throw new BadRequest('name を指定してください', ErrorCode.invalidForm);
    const sku = {
      id: snowflake(),
      type: body.type ?? SkuType.durable,
      application_id: this.store.state.applicationId,
      name,
      slug: name.toLowerCase().replace(/\s+/g, '-'),
      flags: body.flags ?? 0,
    };
    this.store.state.skus.push(sku);
    this.store.changed();
    return sku;
  }

  private requireSku(skuId: string): Json {
    const sku = this.store.state.skus.find((candidate) => candidate.id === skuId);
    if (!sku) throw new NotFound('Unknown SKU', ErrorCode.unknownSku);
    return sku;
  }

  requireEntitlement(entitlementId: string): Json {
    const entitlement = this.store.state.entitlements[entitlementId];
    if (!entitlement) throw new NotFound('Unknown Entitlement');
    return entitlement;
  }

  listEntitlements(query: URLSearchParams): Json[] {
    const userId = query.get('user_id');
    const guildId = query.get('guild_id');
    const skuIds = (query.get('sku_ids') ?? '').split(',').filter(Boolean);
    const before = query.get('before');
    const after = query.get('after');
    const limit = Number(query.get('limit') ?? DEFAULT_LIMIT);
    const excludeEnded = query.get('exclude_ended') === 'true';
    const now = new Date().toISOString();
    return Object.values(this.store.state.entitlements)
      .filter((entitlement) => !userId || entitlement.user_id === userId)
      .filter((entitlement) => !guildId || entitlement.guild_id === guildId)
      .filter((entitlement) => skuIds.length === 0 || skuIds.includes(entitlement.sku_id))
      .filter((entitlement) => (!before || BigInt(entitlement.id) < BigInt(before)) && (!after || BigInt(entitlement.id) > BigInt(after)))
      .filter((entitlement) => !excludeEnded || !entitlement.ends_at || entitlement.ends_at > now)
      .sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1))
      .slice(0, limit);
  }

  private grant(skuId: string, userId: string | undefined, guildId: string | undefined, type: number, endsAt: string | null = null): Json {
    this.requireSku(skuId);
    if (userId) this.store.requireUser(userId);
    if (guildId) this.store.requireGuild(guildId);
    if (!userId && !guildId) throw new BadRequest('ユーザーかサーバーを指定してください', ErrorCode.invalidForm);
    const entitlement = {
      id: snowflake(),
      sku_id: skuId,
      application_id: this.store.state.applicationId,
      ...(userId ? { user_id: userId } : {}),
      ...(guildId ? { guild_id: guildId } : {}),
      type,
      deleted: false,
      starts_at: type === EntitlementType.testModePurchase ? null : new Date().toISOString(),
      ends_at: endsAt,
      consumed: false,
    };
    this.store.state.entitlements[entitlement.id] = entitlement;
    this.store.changed();
    this.dispatch('ENTITLEMENT_CREATE', entitlement);
    return entitlement;
  }

  createTestEntitlement(body: Json): Json {
    const ownerType = Number(body.owner_type);
    if (ownerType !== EntitlementOwnerType.guild && ownerType !== EntitlementOwnerType.user) {
      throw new BadRequest('owner_type は 1 か 2 で指定してください', ErrorCode.invalidForm);
    }
    const ownerId = String(body.owner_id ?? '');
    return ownerType === EntitlementOwnerType.user
      ? this.grant(String(body.sku_id), ownerId, undefined, EntitlementType.testModePurchase)
      : this.grant(String(body.sku_id), undefined, ownerId, EntitlementType.testModePurchase);
  }

  /** 消費型の SKU のエンタイトルメントを使用済みにする。 */
  consume(entitlementId: string): void {
    const entitlement = this.requireEntitlement(entitlementId);
    if (this.requireSku(entitlement.sku_id).type !== SkuType.consumable) {
      throw new BadRequest('消費型の SKU のエンタイトルメントではありません', ErrorCode.invalidForm);
    }
    entitlement.consumed = true;
    this.store.changed();
    this.dispatch('ENTITLEMENT_UPDATE', entitlement);
  }

  requireSubscription(skuId: string, subscriptionId: string): Json {
    const subscription = this.store.state.subscriptions[subscriptionId];
    if (!subscription || !subscription.sku_ids.includes(skuId)) throw new NotFound('Unknown Subscription');
    return subscription;
  }

  listSubscriptions(skuId: string, query: URLSearchParams): Json[] {
    const userId = query.get('user_id');
    const before = query.get('before');
    const after = query.get('after');
    const limit = Number(query.get('limit') ?? 50);
    return Object.values(this.store.state.subscriptions)
      .filter((subscription) => subscription.sku_ids.includes(skuId) && (!userId || subscription.user_id === userId))
      .filter((subscription) => (!before || BigInt(subscription.id) < BigInt(before)) && (!after || BigInt(subscription.id) > BigInt(after)))
      .sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1))
      .slice(0, limit);
  }

  /** サブスクリプションを始め、期間の終わりまでのエンタイトルメントを付与する。 */
  subscribe(skuId: string, userId: string): Json {
    const sku = this.requireSku(skuId);
    if (sku.type !== SkuType.subscription) throw new BadRequest('サブスクリプションの SKU ではありません', ErrorCode.invalidForm);
    const start = new Date();
    const end = new Date(start.getTime() + SUBSCRIPTION_PERIOD_MS).toISOString();
    const entitlement = this.grant(skuId, userId, undefined, EntitlementType.applicationSubscription, end);
    const subscription = {
      id: snowflake(),
      user_id: userId,
      sku_ids: [skuId],
      entitlement_ids: [entitlement.id],
      renewal_sku_ids: null,
      current_period_start: start.toISOString(),
      current_period_end: end,
      status: SubscriptionStatus.active,
      canceled_at: null,
    };
    this.store.state.subscriptions[subscription.id] = subscription;
    this.store.changed();
    this.dispatch('SUBSCRIPTION_CREATE', subscription);
    return subscription;
  }

  /** 解約する。期間の終わりまでは使える。 */
  cancel(subscriptionId: string): Json {
    const subscription = this.store.state.subscriptions[subscriptionId];
    if (!subscription) throw new NotFound('Unknown Subscription');
    subscription.status = SubscriptionStatus.ending;
    subscription.canceled_at = new Date().toISOString();
    this.store.changed();
    this.dispatch('SUBSCRIPTION_UPDATE', subscription);
    return subscription;
  }

  /** 期間が終わったことにする。エンタイトルメントも終了する。 */
  endSubscription(subscriptionId: string): void {
    const subscription = this.store.state.subscriptions[subscriptionId];
    if (!subscription) throw new NotFound('Unknown Subscription');
    const now = new Date().toISOString();
    subscription.status = SubscriptionStatus.inactive;
    for (const id of subscription.entitlement_ids as string[]) {
      const entitlement = this.store.state.entitlements[id];
      if (!entitlement) continue;
      entitlement.ends_at = now;
      this.dispatch('ENTITLEMENT_UPDATE', entitlement);
    }
    delete this.store.state.subscriptions[subscriptionId];
    this.store.changed();
    this.dispatch('SUBSCRIPTION_DELETE', subscription);
  }
}
