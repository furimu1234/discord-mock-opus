import type { Integrations } from './integrations.js';
import { NO_CONTENT, type ApiRoute, type RouteModule } from './routes.js';
import type { Json } from './store.js';

/** Slack の色の名前。それ以外は `#rrggbb` で受け取る。 */
const SLACK_COLORS: Record<string, number> = { good: 0x2eb67d, warning: 0xecb22e, danger: 0xe01e5a };
const MAX_GITHUB_COMMITS = 5;

const slackColor = (color: unknown): number | undefined => {
  if (typeof color !== 'string') return undefined;
  return SLACK_COLORS[color] ?? (/^#?[0-9a-f]{6}$/i.test(color) ? Number.parseInt(color.replace('#', ''), 16) : undefined);
};

/** Slack 互換と GitHub 互換のウェブフック。本文をメッセージに変換して、通常のウェブフックとして実行する。 */
export class WebhookFormats implements RouteModule {
  constructor(private readonly integrations: Integrations) {}

  routes(api: ApiRoute): void {
    const execute = (params: Record<string, string>, query: URLSearchParams, message: Json | null) => {
      if (!message) return NO_CONTENT;
      const created = this.integrations.executeWebhook(params.webhook!, params.token!, message, query.get('thread_id') ?? undefined);
      return query.get('wait') === 'true' ? created : NO_CONTENT;
    };
    api('POST', '/webhooks/:webhook/:token/slack', ({ params, query, body }) => execute(params, query, this.fromSlack(body)));
    api('POST', '/webhooks/:webhook/:token/github', ({ params, query, body, headers }) =>
      execute(params, query, this.fromGitHub(String(headers['x-github-event'] ?? ''), body)),
    );
  }

  fromSlack(body: Json): Json {
    const embeds = ((body.attachments ?? []) as Json[]).map((attachment) => ({
      ...(attachment.title ? { title: attachment.title } : {}),
      ...(attachment.title_link ? { url: attachment.title_link } : {}),
      ...(attachment.text ?? attachment.fallback ? { description: attachment.text ?? attachment.fallback } : {}),
      ...(slackColor(attachment.color) !== undefined ? { color: slackColor(attachment.color) } : {}),
      ...(attachment.author_name ? { author: { name: attachment.author_name, url: attachment.author_link, icon_url: attachment.author_icon } } : {}),
      ...(attachment.footer ? { footer: { text: attachment.footer, icon_url: attachment.footer_icon } } : {}),
      ...(attachment.image_url ? { image: { url: attachment.image_url } } : {}),
      ...(attachment.thumb_url ? { thumbnail: { url: attachment.thumb_url } } : {}),
      fields: ((attachment.fields ?? []) as Json[]).map((field) => ({ name: field.title, value: field.value, inline: Boolean(field.short) })),
    }));
    return {
      content: body.text ?? '',
      ...(body.username ? { username: body.username } : {}),
      ...(body.icon_url ? { avatar_url: body.icon_url } : {}),
      embeds,
    };
  }

  /** GitHub のイベントを、リポジトリと送信者の付いた埋め込みにする。`ping` は送信しない。 */
  fromGitHub(event: string, body: Json): Json | null {
    if (event === 'ping') return null;
    const repository = body.repository?.full_name ?? '';
    const author = body.sender ? { name: body.sender.login, url: body.sender.html_url, icon_url: body.sender.avatar_url } : undefined;
    const embed: Json = { title: `[${repository}] ${event}`, url: body.repository?.html_url, ...(author ? { author } : {}) };
    if (event === 'push') {
      const branch = String(body.ref ?? '').replace('refs/heads/', '');
      const commits = (body.commits ?? []) as Json[];
      embed.title = `[${repository}:${branch}] ${commits.length} new commit${commits.length === 1 ? '' : 's'}`;
      embed.url = body.compare;
      embed.description = commits
        .slice(0, MAX_GITHUB_COMMITS)
        .map((commit) => `[\`${String(commit.id).slice(0, 7)}\`](${commit.url}) ${String(commit.message).split('\n')[0]} - ${commit.author?.username ?? commit.author?.name ?? ''}`)
        .join('\n');
    } else if (body.issue || body.pull_request) {
      const item = body.pull_request ?? body.issue;
      const kind = body.pull_request ? 'Pull request' : 'Issue';
      embed.title = `[${repository}] ${kind} ${body.action ?? ''}: #${item.number} ${item.title}`;
      embed.url = item.html_url;
      if (body.comment) embed.description = body.comment.body;
      else if (body.action === 'opened') embed.description = item.body ?? '';
    }
    return { embeds: [embed] };
  }
}
