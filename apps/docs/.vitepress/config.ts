import { readFileSync } from 'node:fs';
import { defineConfig, type DefaultTheme } from 'vitepress';

const REPOSITORY = 'https://github.com/furimu1234/discord-mock-opus';
const base = process.env.DOCS_BASE ?? '/';

const apiSidebar = JSON.parse(
  readFileSync(new URL('../api/sidebar.json', import.meta.url), 'utf8'),
) as DefaultTheme.SidebarItem[];

const guide: DefaultTheme.SidebarItem[] = [
  {
    text: 'はじめに',
    items: [
      { text: 'dismock とは', link: '/guide/introduction' },
      { text: 'クイックスタート', link: '/guide/getting-started' },
    ],
  },
  {
    text: 'テストを書く',
    items: [
      { text: 'testClient', link: '/guide/test-client' },
      { text: 'テストの書き方', link: '/guide/writing-tests' },
      { text: 'ダミーデータ', link: '/guide/test-data' },
      { text: 'インメモリ DB', link: '/guide/database' },
    ],
  },
  {
    text: '実行する',
    items: [
      { text: 'Mock の画面', link: '/guide/web-ui' },
      { text: 'コマンド', link: '/guide/cli' },
      { text: 'セキュリティ', link: '/guide/security' },
    ],
  },
];

export default defineConfig({
  lang: 'ja',
  title: 'dismock',
  description: 'Discord Bot のテストを自動化するセルフホスト型のモック',
  base,
  head: [['link', { rel: 'icon', type: 'image/svg+xml', href: `${base}logo.svg` }]],
  themeConfig: {
    logo: '/logo.svg',
    nav: [
      { text: 'ガイド', link: '/guide/introduction', activeMatch: '/guide/' },
      { text: 'API', link: '/api/', activeMatch: '/api/' },
    ],
    sidebar: { '/guide/': guide, '/api/': apiSidebar },
    socialLinks: [{ icon: 'github', link: REPOSITORY }],
    search: {
      provider: 'local',
      options: {
        translations: {
          button: { buttonText: '検索', buttonAriaLabel: '検索' },
          modal: {
            displayDetails: '詳細を表示',
            resetButtonTitle: '検索をクリア',
            backButtonTitle: '検索を閉じる',
            noResultsText: '見つかりませんでした',
            footer: { selectText: '選択', navigateText: '移動', closeText: '閉じる' },
          },
        },
      },
    },
    outline: { label: 'このページの内容', level: [2, 3] },
    docFooter: { prev: '前のページ', next: '次のページ' },
    darkModeSwitchLabel: '外観',
    lightModeSwitchTitle: 'ライトモードに切り替える',
    darkModeSwitchTitle: 'ダークモードに切り替える',
    sidebarMenuLabel: 'メニュー',
    returnToTopLabel: 'ページの先頭へ',
    langMenuLabel: '言語を変更',
    footer: { message: 'dismock は Discord Inc. とは関係のない非公式のプロジェクトです。' },
  },
});
