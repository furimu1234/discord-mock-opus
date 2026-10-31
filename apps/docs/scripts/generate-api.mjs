import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Extractor, ExtractorConfig } from '@microsoft/api-extractor';
import { ApiItemKind, ApiModel, ExcerptTokenKind } from '@microsoft/api-extractor-model';
import { DocNodeTransforms } from '@microsoft/tsdoc';

const DOCS = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = resolve(DOCS, '../..');
const API_JSON = join(DOCS, '.api');
const OUTPUT = join(DOCS, 'api');

const PACKAGES = ['packages/client-js', 'packages/test'];

/** ドキュメントに載せる種類。配列の順に一覧へ並べる。 */
const KINDS = [
  { kind: ApiItemKind.Function, dir: 'function', label: '関数' },
  { kind: ApiItemKind.Variable, dir: 'variable', label: '変数' },
  { kind: ApiItemKind.Class, dir: 'class', label: 'クラス' },
  { kind: ApiItemKind.Interface, dir: 'interface', label: 'インターフェース' },
  { kind: ApiItemKind.TypeAlias, dir: 'type', label: '型エイリアス' },
];

const PROPERTY_KINDS = new Set([ApiItemKind.Property, ApiItemKind.PropertySignature]);
const METHOD_KINDS = new Set([ApiItemKind.Method, ApiItemKind.MethodSignature]);
/** 引数の説明だけで足りるため、概要がなくてもよい種類。 */
const SUMMARY_OPTIONAL = new Set([ApiItemKind.Constructor, ApiItemKind.CallSignature]);

const model = new ApiModel();
const undocumented = [];

function extract() {
  rmSync(API_JSON, { recursive: true, force: true });
  for (const project of PACKAGES) {
    const config = ExtractorConfig.loadFileAndPrepare(join(ROOT, project, 'api-extractor.json'));
    if (!Extractor.invoke(config, { localBuild: false }).succeeded) {
      throw new Error(`${project} の API の抽出で警告またはエラーが発生しました`);
    }
    model.loadPackage(config.apiJsonFilePath);
  }
}

const packageDir = (apiPackage) => apiPackage.displayName.split('/').at(-1);

function kindOf(item) {
  return KINDS.find(({ kind }) => kind === item.kind);
}

function topLevelItem(item) {
  let current = item;
  while (current && !kindOf(current)) current = current.parent;
  return current;
}

function pagePath(item) {
  return `${packageDir(item.getAssociatedPackage())}/${kindOf(item).dir}/${item.displayName}`;
}

function memberAnchor(item) {
  if (item.kind === ApiItemKind.Constructor) return 'constructor';
  const name = item.kind === ApiItemKind.CallSignature ? 'call' : item.displayName;
  return item.overloadIndex > 1 ? `${name}-${item.overloadIndex}` : name;
}

function hrefTo(target, from, extension) {
  const page = topLevelItem(target);
  if (!page) return undefined;
  const path = posix.relative(posix.dirname(pagePath(topLevelItem(from))), pagePath(page));
  const anchor = target === page ? '' : `#${memberAnchor(target)}`;
  return `${path.startsWith('.') ? path : `./${path}`}${extension}${anchor}`;
}

function resolveReference(reference) {
  return model.resolveDeclarationReference(reference, undefined).resolvedApiItem;
}

const ENTITIES = { '&': 'amp', '<': 'lt', '>': 'gt', '"': 'quot' };

/** `<code>` の中に置く文字列を、Markdown にも Vue にも解釈されない形にする。 */
function escapeCode(text) {
  return text
    .replace(/\s+/g, ' ')
    .replace(/[&<>"]/g, (char) => `&${ENTITIES[char]};`)
    .replace(/[|*_`[\]{}\\]/g, (char) => `&#${char.charCodeAt(0)};`);
}

function escapeText(text) {
  return text.replace(/[\\`*_[\]<|]/g, '\\$&').replace(/[{}]/g, (char) => `&#${char.charCodeAt(0)};`);
}

/** 型をリンク付きのインラインコードにする。 */
function renderType(excerpt, from) {
  const tokens = excerpt.spannedTokens.map((token) => {
    const text = escapeCode(token.text);
    if (token.kind !== ExcerptTokenKind.Reference || !token.canonicalReference) return text;
    const target = resolveReference(token.canonicalReference);
    const href = target && hrefTo(target, from, '.html');
    return href ? `<a href="${href}">${text}</a>` : text;
  });
  return `<code v-pre>${tokens.join('').trim()}</code>`;
}

function renderLink(node, from) {
  if (node.urlDestination) return `[${node.linkText ?? node.urlDestination}](${node.urlDestination})`;
  const target = model.resolveDeclarationReference(node.codeDestination, from).resolvedApiItem;
  if (!target) throw new Error(`${from.displayName} のリンクを解決できません`);
  return `[${node.linkText ?? `\`${target.displayName}\``}](${hrefTo(target, from, '.md')})`;
}

function renderDoc(node, from) {
  switch (node.kind) {
    case 'PlainText':
      return escapeText(node.text);
    case 'EscapedText':
      return escapeText(node.decodedText);
    case 'SoftBreak':
      return '\n';
    case 'CodeSpan':
      return `\`${node.code}\``;
    case 'FencedCode':
      return `\`\`\`${node.language}\n${node.code.trimEnd()}\n\`\`\`\n\n`;
    case 'LinkTag':
      return renderLink(node, from);
    case 'Paragraph':
      return `${renderChildren(DocNodeTransforms.trimSpacesInParagraph(node), from).trim()}\n\n`;
    default:
      return renderChildren(node, from);
  }
}

function renderChildren(node, from) {
  return node.getChildNodes().map((child) => renderDoc(child, from)).join('');
}

/** API Extractor がコンストラクターの注記を英語で追加する。使い方は各クラスの説明に書くので取り除く。 */
const INTERNAL_CONSTRUCTOR_NOTE = /The constructor for this class is marked as internal\.[^\n]*/;

const section = (node, from) => (node ? renderDoc(node, from).replace(INTERNAL_CONSTRUCTOR_NOTE, '').trim() : '');

const summaryOf = (item, from = item) => section(item.tsdocComment?.summarySection, from);

const inTable = (text) => text.replace(/\s*\n\s*/g, ' ').replace(/(?<!\\)\|/g, '\\|');

function table(headers, rows) {
  return [
    `| ${headers.join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...rows.map((row) => `| ${row.map(inTable).join(' | ')} |`),
  ].join('\n');
}

/** ソースの宣言を、読みやすいシグネチャにする。 */
function signature(item) {
  const text = item.excerpt.text.replace(/^export\s+(declare\s+)?/, '').trim();
  return `\`\`\`ts\n${text}\n\`\`\``;
}

function renderParameters(item) {
  if (!item.parameters?.length) return '';
  const rows = item.parameters.map((parameter) => [
    `\`${parameter.name}${parameter.isOptional ? '?' : ''}\``,
    renderType(parameter.parameterTypeExcerpt, item),
    parameter.tsdocParamBlock ? section(parameter.tsdocParamBlock.content, item) : '',
  ]);
  return `**引数**\n\n${table(['名前', '型', '説明'], rows)}`;
}

function renderReturns(item) {
  const excerpt = item.returnTypeExcerpt;
  if (!excerpt || excerpt.isEmpty) return '';
  const note = section(item.tsdocComment?.returnsBlock?.content, item);
  return `**戻り値**: ${renderType(excerpt, item)}${note ? `\n\n${note}` : ''}`;
}

function renderDetails(item) {
  const comment = item.tsdocComment;
  const examples = comment?.customBlocks.filter((block) => block.blockTag.tagNameWithUpperCase === '@EXAMPLE') ?? [];
  return [
    comment?.remarksBlock ? section(comment.remarksBlock.content, item) : '',
    ...examples.map((block) => `**例**\n\n${section(block.content, item)}`),
  ];
}

function renderMember(item, heading) {
  const name = heading ?? item.displayName;
  return [
    `### ${escapeText(name)} {#${memberAnchor(item)}}`,
    signature(item),
    summaryOf(item),
    renderParameters(item),
    renderReturns(item),
    ...renderDetails(item),
  ];
}

function renderProperties(items, from) {
  const rows = items.map((item) => [
    `<span id="${memberAnchor(item)}"></span>\`${item.displayName}${item.isOptional ? '?' : ''}\``,
    renderType(item.propertyTypeExcerpt, from),
    summaryOf(item, from),
  ]);
  return ['## プロパティ', table(['名前', '型', '説明'], rows)];
}

function renderMembers(item) {
  const members = item.findMembersWithInheritance?.().items ?? [];
  const select = (kinds) => members.filter((member) => kinds.has(member.kind));
  const properties = select(PROPERTY_KINDS);
  const methods = select(METHOD_KINDS);
  const calls = select(new Set([ApiItemKind.CallSignature]));
  const constructors = select(new Set([ApiItemKind.Constructor]));
  return [
    ...(calls.length ? ['## 呼び出し', ...calls.flatMap((call) => renderMember(call, `呼び出し ${call.overloadIndex}`))] : []),
    ...(constructors.length ? ['## コンストラクター', ...constructors.flatMap((c) => renderMember(c, 'constructor'))] : []),
    ...(properties.length ? renderProperties(properties, item) : []),
    ...(methods.length ? ['## メソッド', ...methods.flatMap((method) => renderMember(method))] : []),
  ];
}

/** シグネチャから参照している型へのリンク。コードブロックの中にはリンクを置けないため、別に示す。 */
function renderRelated(item) {
  const links = new Map();
  for (const token of item.excerptTokens) {
    if (token.kind !== ExcerptTokenKind.Reference || !token.canonicalReference) continue;
    const target = resolveReference(token.canonicalReference);
    if (!target || target === item || !topLevelItem(target)) continue;
    links.set(target.displayName, `[\`${target.displayName}\`](${hrefTo(target, item, '.md')})`);
  }
  return links.size ? `**関連する型**: ${[...links.values()].join('、')}` : '';
}

function renderPage(item) {
  const blocks = [
    `---\ntitle: ${item.displayName}\n---`,
    `# ${escapeText(item.displayName)}`,
    `${kindOf(item).label} · \`${item.getAssociatedPackage().displayName}\``,
    summaryOf(item),
    signature(item),
    renderParameters(item),
    renderReturns(item),
    renderRelated(item),
    ...renderDetails(item),
    ...renderMembers(item),
  ];
  return `${blocks.filter(Boolean).join('\n\n')}\n`;
}

function checkDocumented(item) {
  if (!SUMMARY_OPTIONAL.has(item.kind) && !summaryOf(item)) {
    undocumented.push(`${item.getAssociatedPackage().displayName}: ${item.getScopedNameWithinPackage()}`);
  }
  if (kindOf(item) && item.kind !== ApiItemKind.Function) item.members.forEach(checkDocumented);
}

function itemsByKind(apiPackage) {
  const [entryPoint] = apiPackage.entryPoints;
  return KINDS.map((definition) => ({
    ...definition,
    items: entryPoint.members
      .filter((item) => item.kind === definition.kind)
      .sort((a, b) => a.displayName.localeCompare(b.displayName)),
  })).filter(({ items }) => items.length > 0);
}

function write(file, content) {
  const path = join(OUTPUT, file);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

/** 一覧のページから見た相対リンクにならないため、概要の中のリンクは外す。 */
const plainSummary = (item) => summaryOf(item).replace(/\[(`[^`]+`)\]\([^)]+\)/g, '$1');

function renderIndex() {
  const blocks = ['# API リファレンス', 'ソースコードの TSDoc から生成しています。'];
  for (const apiPackage of model.packages) {
    blocks.push(`## ${apiPackage.displayName} {#${packageDir(apiPackage)}}`);
    for (const { label, items } of itemsByKind(apiPackage)) {
      const rows = items.map((item) => [`[\`${item.displayName}\`](./${pagePath(item)}.md)`, plainSummary(item)]);
      blocks.push(`### ${label} {#${packageDir(apiPackage)}-${kindOf(items[0]).dir}}`, table(['名前', '説明'], rows));
    }
  }
  return `${blocks.join('\n\n')}\n`;
}

function renderSidebar() {
  return model.packages.map((apiPackage) => ({
    text: apiPackage.displayName,
    collapsed: false,
    items: itemsByKind(apiPackage).map(({ label, items }) => ({
      text: label,
      collapsed: true,
      items: items.map((item) => ({ text: item.displayName, link: `/api/${pagePath(item)}` })),
    })),
  }));
}

extract();
rmSync(OUTPUT, { recursive: true, force: true });
for (const apiPackage of model.packages) {
  for (const { items } of itemsByKind(apiPackage)) {
    for (const item of items) {
      checkDocumented(item);
      write(`${pagePath(item)}.md`, renderPage(item));
    }
  }
}
write('index.md', renderIndex());
write('sidebar.json', `${JSON.stringify(renderSidebar(), null, 2)}\n`);

if (undocumented.length > 0) {
  console.error(`TSDoc の説明がない公開 API があります:\n${undocumented.map((name) => `  ${name}`).join('\n')}`);
  process.exit(1);
}
