import { useContext, useState, type ReactNode } from 'react';
import type { Json } from '../api';
import { CHANNEL_LINK_PATTERN, type ChannelLinkTarget, channelUrl, OpenLinkContext } from '../links';
import { displayName } from './Avatar';

/** メンションや絵文字の名前を引くための情報。 */
export interface MarkdownContext {
  state: Json;
  guildId?: string;
  /** テストのユーザーは終了後に消えるため、メッセージが持つメンションの情報も使う。 */
  mentions?: Json[];
}

/** `<t:秒:形式>` の形式ごとの表示。`R` は相対時間。 */
const TIMESTAMP_FORMATS: Record<string, Intl.DateTimeFormatOptions> = {
  t: { hour: '2-digit', minute: '2-digit' },
  T: { hour: '2-digit', minute: '2-digit', second: '2-digit' },
  d: { year: 'numeric', month: '2-digit', day: '2-digit' },
  D: { year: 'numeric', month: 'long', day: 'numeric' },
  f: { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' },
  F: { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long', hour: '2-digit', minute: '2-digit' },
};
const DEFAULT_TIMESTAMP_FORMAT = 'f';
const RELATIVE_UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 365 * 24 * 3600],
  ['month', 30 * 24 * 3600],
  ['day', 24 * 3600],
  ['hour', 3600],
  ['minute', 60],
  ['second', 1],
];

function formatTimestamp(seconds: number, style: string): string {
  if (style === 'R') {
    const diff = seconds - Date.now() / 1000;
    const [unit, size] = RELATIVE_UNITS.find(([, length]) => Math.abs(diff) >= length) ?? RELATIVE_UNITS.at(-1)!;
    return new Intl.RelativeTimeFormat('ja-JP', { numeric: 'auto' }).format(Math.round(diff / size), unit);
  }
  return new Date(seconds * 1000).toLocaleString('ja-JP', TIMESTAMP_FORMATS[style] ?? TIMESTAMP_FORMATS[DEFAULT_TIMESTAMP_FORMAT]);
}

/** チャンネルとメッセージのリンク。チャンネル名の付いたボタンにし、押すとそのチャンネルを開く。 */
function ChannelLink({ state, target }: { state: Json; target: ChannelLinkTarget }) {
  const open = useContext(OpenLinkContext);
  const channel = state.channels[target.channelId] as Json | undefined;
  const name = channel ? (channel.name ?? 'DM') : '不明なチャンネル';
  return (
    <button type="button" className="channel-link" title={channelUrl(target)} disabled={!channel} onClick={() => open(target)}>
      #{name}{target.messageId && <span className="channel-link-message"> › 💬</span>}
    </button>
  );
}

function Spoiler({ children }: { children: ReactNode }) {
  const [shown, setShown] = useState(false);
  return (
    <span className={shown ? 'md-spoiler shown' : 'md-spoiler'} role="button" tabIndex={0} aria-label={shown ? undefined : 'ネタバレ'}
      onClick={() => setShown(true)} onKeyDown={(event) => event.key === 'Enter' && setShown(true)}>
      {children}
    </span>
  );
}

interface InlineRule {
  pattern: RegExp;
  render: (match: RegExpExecArray, context: MarkdownContext, key: number) => ReactNode;
}

/** 前にあるものほど優先する。コードと URL の中は書式として扱わない。 */
const INLINE_RULES: InlineRule[] = [
  { pattern: /\\([\\*_~`|<>#[\]()-])/, render: (match) => match[1] },
  { pattern: /``([^`]+?)``|`([^`]+?)`/, render: (match, _context, key) => <code key={key} className="md-code">{match[1] ?? match[2]}</code> },
  {
    pattern: /<a?:(\w+):(\d+)>/,
    render: (match, { state }, key) => {
      const image = state.media?.[match[2]!] as string | undefined;
      return image ? <img key={key} className="custom-emoji" src={image} alt={`:${match[1]}:`} title={`:${match[1]}:`} /> : `:${match[1]}:`;
    },
  },
  {
    pattern: /<@!?(\d+)>/,
    render: (match, { state, mentions = [] }, key) => {
      const user = state.users[match[1]!] ?? mentions.find((mention) => mention.id === match[1]);
      return <span key={key} className="mention">@{displayName(user)}</span>;
    },
  },
  {
    pattern: /<@&(\d+)>/,
    render: (match, { state, guildId }, key) => {
      const role = state.guilds[guildId ?? '']?.roles.find((r: Json) => r.id === match[1]);
      return <span key={key} className="mention">@{role?.name ?? '不明なロール'}</span>;
    },
  },
  { pattern: /<#(\d+)>/, render: (match, { state }, key) => <span key={key} className="mention">#{state.channels[match[1]!]?.name ?? '不明'}</span> },
  { pattern: /@(everyone|here)\b/, render: (match, _context, key) => <span key={key} className="mention">@{match[1]}</span> },
  {
    pattern: /<t:(-?\d+)(?::([tTdDfFR]))?>/,
    render: (match, _context, key) => <span key={key} className="md-timestamp">{formatTimestamp(Number(match[1]), match[2] ?? DEFAULT_TIMESTAMP_FORMAT)}</span>,
  },
  {
    pattern: /\[([^\]\n]+)\]\(<?(https?:\/\/[^\s)>]+)>?\)/,
    render: (match, context, key) => <a key={key} href={match[2]} target="_blank" rel="noreferrer">{inline(match[1]!, context)}</a>,
  },
  {
    pattern: new RegExp(`<?${CHANNEL_LINK_PATTERN.source}>?`),
    render: (match, { state }, key) => (
      <ChannelLink key={key} state={state} target={{ guildId: match[1]!, channelId: match[2]!, messageId: match[3] }} />
    ),
  },
  {
    pattern: /<?(https?:\/\/[^\s<>]*[^\s<>.,:;"')\]])>?/,
    render: (match, _context, key) => <a key={key} href={match[1]} target="_blank" rel="noreferrer">{match[1]}</a>,
  },
  { pattern: /\*\*\*([\s\S]+?)\*\*\*/, render: (match, context, key) => <strong key={key}><em>{inline(match[1]!, context)}</em></strong> },
  { pattern: /\*\*([\s\S]+?)\*\*/, render: (match, context, key) => <strong key={key}>{inline(match[1]!, context)}</strong> },
  { pattern: /__([\s\S]+?)__/, render: (match, context, key) => <u key={key}>{inline(match[1]!, context)}</u> },
  { pattern: /\*(?!\s)([\s\S]+?)\*|\b_(?!\s)([\s\S]+?)_\b/, render: (match, context, key) => <em key={key}>{inline((match[1] ?? match[2])!, context)}</em> },
  { pattern: /~~([\s\S]+?)~~/, render: (match, context, key) => <s key={key}>{inline(match[1]!, context)}</s> },
  { pattern: /\|\|([\s\S]+?)\|\|/, render: (match, context, key) => <Spoiler key={key}>{inline(match[1]!, context)}</Spoiler> },
];

/** 行の中の書式を要素にする。最も前で一致した書式から順に変換する。 */
function inline(text: string, context: MarkdownContext): ReactNode[] {
  const nodes: ReactNode[] = [];
  let rest = text;
  while (rest) {
    let best: { match: RegExpExecArray; rule: InlineRule } | undefined;
    for (const rule of INLINE_RULES) {
      const match = rule.pattern.exec(rest);
      if (match && (!best || match.index < best.match.index)) best = { match, rule };
    }
    if (!best) {
      nodes.push(rest);
      break;
    }
    if (best.match.index > 0) nodes.push(rest.slice(0, best.match.index));
    nodes.push(best.rule.render(best.match, context, nodes.length));
    rest = rest.slice(best.match.index + best.match[0].length);
  }
  return nodes;
}

const CODE_BLOCK = /```(?:([\w+-]+)\n)?\n?([\s\S]*?)```/g;
const LIST_ITEM = /^(\s*)([-*]|\d+\.) (.*)$/;

/** 行のまとまり（見出し、引用、リスト、通常の行）を要素にする。 */
function blocks(text: string, context: MarkdownContext): ReactNode[] {
  const lines = text.split('\n');
  const nodes: ReactNode[] = [];
  let plain: string[] = [];
  const flush = () => {
    if (plain.length === 0) return;
    nodes.push(<span key={nodes.length}>{inline(plain.join('\n'), context)}</span>);
    plain = [];
  };
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;
    if (line.startsWith('>>> ')) {
      flush();
      nodes.push(<blockquote key={nodes.length} className="md-quote">{blocks([line.slice(4), ...lines.slice(i + 1)].join('\n'), context)}</blockquote>);
      return nodes;
    }
    if (line.startsWith('> ') || line === '>') {
      flush();
      const quoted: string[] = [];
      while (i < lines.length && (lines[i]!.startsWith('> ') || lines[i] === '>')) quoted.push(lines[i++]!.slice(2));
      i -= 1;
      nodes.push(<blockquote key={nodes.length} className="md-quote">{blocks(quoted.join('\n'), context)}</blockquote>);
      continue;
    }
    const heading = /^(#{1,3}) (.+)$/.exec(line);
    if (heading) {
      flush();
      nodes.push(<div key={nodes.length} className={`md-h${heading[1]!.length}`}>{inline(heading[2]!, context)}</div>);
      continue;
    }
    const subtext = /^-# (.+)$/.exec(line);
    if (subtext) {
      flush();
      nodes.push(<div key={nodes.length} className="md-subtext">{inline(subtext[1]!, context)}</div>);
      continue;
    }
    if (LIST_ITEM.test(line)) {
      flush();
      const items: RegExpExecArray[] = [];
      while (i < lines.length && LIST_ITEM.test(lines[i]!)) items.push(LIST_ITEM.exec(lines[i++]!)!);
      i -= 1;
      const ordered = /^\d+\.$/.test(items[0]![2]!);
      const children = items.map((item, index) => (
        <li key={index} style={{ marginLeft: `${item[1]!.length * 8}px` }}>{inline(item[3]!, context)}</li>
      ));
      nodes.push(ordered
        ? <ol key={nodes.length} className="md-list" start={Number.parseInt(items[0]![2]!, 10)}>{children}</ol>
        : <ul key={nodes.length} className="md-list">{children}</ul>);
      continue;
    }
    plain.push(line);
  }
  flush();
  return nodes;
}

/**
 * Discord の公開ドキュメントのマークダウンを、読み取り専用の要素へ変換する。HTML としては扱わない。
 * コードブロックの中は書式として扱わない。
 */
export function renderMarkdown(content: string, context: MarkdownContext): ReactNode[] {
  const nodes: ReactNode[] = [];
  let last = 0;
  for (const match of content.matchAll(CODE_BLOCK)) {
    const before = content.slice(last, match.index).replace(/\n$/, '');
    if (before) nodes.push(<span key={nodes.length}>{blocks(before, context)}</span>);
    nodes.push(<pre key={nodes.length} className="md-code-block" data-language={match[1]}><code>{match[2]!.replace(/\n$/, '')}</code></pre>);
    last = match.index + match[0].length;
  }
  const rest = content.slice(last).replace(/^\n/, '');
  if (rest) nodes.push(<span key={nodes.length}>{blocks(rest, context)}</span>);
  return nodes;
}
