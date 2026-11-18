# Discord API の対応状況

dismock の Mock が、Discord の公開ドキュメントの API のうちどれに対応しているかの一覧です。リンクは Discord の公開ドキュメントを開きます。

REST API の対応は **100%**（235 件中 235 件）です。一覧にない API を Bot が呼び出すと、Mock は 404 を返します。

## 対応率

| 区分 | 対応 | 件数 |
|---|---|---|
| **REST API（全体）** | **100%** | 235 / 235 |
| REST: チャンネル | **100%** | 26 / 26 |
| REST: メッセージ | **100%** | 17 / 17 |
| REST: サーバー | **100%** | 47 / 47 |
| REST: ユーザー | **100%** | 12 / 12 |
| REST: アプリケーションコマンド | **100%** | 16 / 16 |
| REST: インタラクションの応答 | **100%** | 8 / 8 |
| REST: ウェブフック | **100%** | 15 / 15 |
| REST: 絵文字 | **100%** | 10 / 10 |
| REST: スタンプ | **100%** | 8 / 8 |
| REST: 招待 | **100%** | 9 / 9 |
| REST: ステージ | **100%** | 4 / 4 |
| REST: ボイス | **100%** | 5 / 5 |
| REST: AutoMod | **100%** | 5 / 5 |
| REST: 監査ログ | **100%** | 1 / 1 |
| REST: 投票 | **100%** | 2 / 2 |
| REST: アプリケーション | **100%** | 3 / 3 |
| REST: Gateway | **100%** | 2 / 2 |
| REST: イベント | **100%** | 6 / 6 |
| REST: サウンドボード | **100%** | 7 / 7 |
| REST: サーバーテンプレート | **100%** | 6 / 6 |
| REST: 収益化（エンタイトルメント） | **100%** | 5 / 5 |
| REST: 収益化（SKU） | **100%** | 1 / 1 |
| REST: 収益化（サブスクリプション） | **100%** | 2 / 2 |
| REST: ロール連携のメタデータ | **100%** | 2 / 2 |
| REST: ロビー | **100%** | 16 / 16 |
| Gateway の送信イベント | **100%** | 8 / 8 |
| Gateway の受信イベント | **100%** | 82 / 82 |

::: info
対応済みでも、Discord のすべての動作を再現しているわけではありません。たとえば AutoMod のスパム、プリセット、プロフィールのルールは保存だけで判定しません。Mock での動作の違いは「[Mock での動作](#mock-での動作)」を参照してください。
:::

## Mock での動作

Mock には OAuth、課金、Discord のクライアントがないため、次の API は Mock に合わせて動きます。

| API | Mock での動作 |
|---|---|
| Add Guild Member、Group DM Add Recipient | `access_token` は使わず、パスのダミーユーザーを追加します |
| Leave Guild | Mock のサーバーの所有者は Bot なので、400 を返します（Discord でも所有者は退出できません） |
| Delete Guild Integration | Bot の連携を削除したことにして、イベントを配信します。Bot はサーバーに残ります |
| Get Guild Widget Image | 図柄を描かず、1 ピクセルの透明な PNG を返します |
| List Sticker Packs | Discord のスタンプパックがないので、空の一覧を返します |
| List SKUs、エンタイトルメント、サブスクリプション | SKU、購入、サブスクリプションの開始と解約は `/api/mock/skus`、`/api/mock/entitlements`、`/api/mock/subscriptions` で作ります |
| Get Application Activity Instance | 起動中のアクティビティは `/api/mock/activity-instances` で作ります |
| Update Target Users | CSV をその場で処理するので、ジョブはすぐ完了します |
| Prune | 発言も参加もしていない期間で対象を決めます。Mock はログインの記録を持ちません |

Bot に届くイベントのうち、ユーザーの操作で起きるものは `/api/mock` から起こします。

| イベント | 起こし方 |
|---|---|
| `TYPING_START` | `POST /api/mock/channels/:channelId/typing` |
| `PRESENCE_UPDATE` | `PUT /api/mock/users/:userId/presence`。Bot の Update Presence でも配信します |
| `GUILD_SCHEDULED_EVENT_USER_ADD` / `REMOVE` | `PUT` / `DELETE /api/mock/guilds/:guildId/scheduled-events/:eventId/users/:userId` |
| `RECONNECT` | `POST /api/mock/gateway/reconnect`。Mock の終了時にも送ります |
| `INVALID_SESSION` | `POST /api/mock/gateway/invalid-session`。知らないセッションの再開（Resume）にも送ります |
| `RATE_LIMITED` | `POST /api/mock/gateway/rate-limit` の後の、指定した opcode の要求を 1 回だけ断ります |

## 対応済み

### チャンネル

- [●] [Get Channel](https://docs.discord.com/developers/resources/channel#get-channel) `GET /channels/{channel.id}`
- [●] [Modify Channel](https://docs.discord.com/developers/resources/channel#modify-channel) `PATCH /channels/{channel.id}`
- [●] [Delete/Close Channel](https://docs.discord.com/developers/resources/channel#deleteclose-channel) `DELETE /channels/{channel.id}`
- [●] [Get Channel Member Permissions](https://docs.discord.com/developers/resources/channel#get-channel-member-permissions) `GET /channels/{channel.id}/permissions/member/{user.id}`
- [●] [Get Channel Role Permissions](https://docs.discord.com/developers/resources/channel#get-channel-role-permissions) `GET /channels/{channel.id}/permissions/role/{role.id}`
- [●] [Set Voice Channel Status](https://docs.discord.com/developers/resources/channel#set-voice-channel-status) `PUT /channels/{channel.id}/voice-status`
- [●] [Edit Channel Permissions](https://docs.discord.com/developers/resources/channel#edit-channel-permissions) `PUT /channels/{channel.id}/permissions/{overwrite.id}`
- [●] [Delete Channel Permission](https://docs.discord.com/developers/resources/channel#delete-channel-permission) `DELETE /channels/{channel.id}/permissions/{overwrite.id}`
- [●] [Get Channel Invites](https://docs.discord.com/developers/resources/channel#get-channel-invites) `GET /channels/{channel.id}/invites`
- [●] [Create Channel Invite](https://docs.discord.com/developers/resources/channel#create-channel-invite) `POST /channels/{channel.id}/invites`
- [●] [Follow Announcement Channel](https://docs.discord.com/developers/resources/channel#follow-announcement-channel) `POST /channels/{channel.id}/followers`
- [●] [Trigger Typing Indicator](https://docs.discord.com/developers/resources/channel#trigger-typing-indicator) `POST /channels/{channel.id}/typing`
- [●] [Group DM Add Recipient](https://docs.discord.com/developers/resources/channel#group-dm-add-recipient) `PUT /channels/{channel.id}/recipients/{user.id}`
- [●] [Group DM Remove Recipient](https://docs.discord.com/developers/resources/channel#group-dm-remove-recipient) `DELETE /channels/{channel.id}/recipients/{user.id}`
- [●] [Start Thread from Message](https://docs.discord.com/developers/resources/channel#start-thread-from-message) `POST /channels/{channel.id}/messages/{message.id}/threads`
- [●] [Start Thread without Message](https://docs.discord.com/developers/resources/channel#start-thread-without-message) `POST /channels/{channel.id}/threads`
- [●] [Start Thread in Forum or Media Channel](https://docs.discord.com/developers/resources/channel#start-thread-in-forum-or-media-channel) `POST /channels/{channel.id}/threads`
- [●] [Join Thread](https://docs.discord.com/developers/resources/channel#join-thread) `PUT /channels/{channel.id}/thread-members/@me`
- [●] [Add Thread Member](https://docs.discord.com/developers/resources/channel#add-thread-member) `PUT /channels/{channel.id}/thread-members/{user.id}`
- [●] [Leave Thread](https://docs.discord.com/developers/resources/channel#leave-thread) `DELETE /channels/{channel.id}/thread-members/@me`
- [●] [Remove Thread Member](https://docs.discord.com/developers/resources/channel#remove-thread-member) `DELETE /channels/{channel.id}/thread-members/{user.id}`
- [●] [Get Thread Member](https://docs.discord.com/developers/resources/channel#get-thread-member) `GET /channels/{channel.id}/thread-members/{user.id}`
- [●] [List Thread Members](https://docs.discord.com/developers/resources/channel#list-thread-members) `GET /channels/{channel.id}/thread-members`
- [●] [List Public Archived Threads](https://docs.discord.com/developers/resources/channel#list-public-archived-threads) `GET /channels/{channel.id}/threads/archived/public`
- [●] [List Private Archived Threads](https://docs.discord.com/developers/resources/channel#list-private-archived-threads) `GET /channels/{channel.id}/threads/archived/private`
- [●] [List Joined Private Archived Threads](https://docs.discord.com/developers/resources/channel#list-joined-private-archived-threads) `GET /channels/{channel.id}/users/@me/threads/archived/private`

### メッセージ

- [●] [Get Channel Messages](https://docs.discord.com/developers/resources/message#get-channel-messages) `GET /channels/{channel.id}/messages`
- [●] [Search Guild Messages](https://docs.discord.com/developers/resources/message#search-guild-messages) `GET /guilds/{guild.id}/messages/search`
- [●] [Get Channel Message](https://docs.discord.com/developers/resources/message#get-channel-message) `GET /channels/{channel.id}/messages/{message.id}`
- [●] [Create Message](https://docs.discord.com/developers/resources/message#create-message) `POST /channels/{channel.id}/messages`
- [●] [Crosspost Message](https://docs.discord.com/developers/resources/message#crosspost-message) `POST /channels/{channel.id}/messages/{message.id}/crosspost`
- [●] [Create Reaction](https://docs.discord.com/developers/resources/message#create-reaction) `PUT /channels/{channel.id}/messages/{message.id}/reactions/{emoji}/@me`
- [●] [Delete Own Reaction](https://docs.discord.com/developers/resources/message#delete-own-reaction) `DELETE /channels/{channel.id}/messages/{message.id}/reactions/{emoji}/@me`
- [●] [Delete User Reaction](https://docs.discord.com/developers/resources/message#delete-user-reaction) `DELETE /channels/{channel.id}/messages/{message.id}/reactions/{emoji}/{user.id}`
- [●] [Get Reactions](https://docs.discord.com/developers/resources/message#get-reactions) `GET /channels/{channel.id}/messages/{message.id}/reactions/{emoji}`
- [●] [Delete All Reactions](https://docs.discord.com/developers/resources/message#delete-all-reactions) `DELETE /channels/{channel.id}/messages/{message.id}/reactions`
- [●] [Delete All Reactions for Emoji](https://docs.discord.com/developers/resources/message#delete-all-reactions-for-emoji) `DELETE /channels/{channel.id}/messages/{message.id}/reactions/{emoji}`
- [●] [Edit Message](https://docs.discord.com/developers/resources/message#edit-message) `PATCH /channels/{channel.id}/messages/{message.id}`
- [●] [Delete Message](https://docs.discord.com/developers/resources/message#delete-message) `DELETE /channels/{channel.id}/messages/{message.id}`
- [●] [Bulk Delete Messages](https://docs.discord.com/developers/resources/message#bulk-delete-messages) `POST /channels/{channel.id}/messages/bulk-delete`
- [●] [Get Channel Pins](https://docs.discord.com/developers/resources/message#get-channel-pins) `GET /channels/{channel.id}/messages/pins`
- [●] [Pin Message](https://docs.discord.com/developers/resources/message#pin-message) `PUT /channels/{channel.id}/messages/pins/{message.id}`
- [●] [Unpin Message](https://docs.discord.com/developers/resources/message#unpin-message) `DELETE /channels/{channel.id}/messages/pins/{message.id}`

### サーバー

- [●] [Get Guild](https://docs.discord.com/developers/resources/guild#get-guild) `GET /guilds/{guild.id}`
- [●] [Get Guild Preview](https://docs.discord.com/developers/resources/guild#get-guild-preview) `GET /guilds/{guild.id}/preview`
- [●] [Modify Guild](https://docs.discord.com/developers/resources/guild#modify-guild) `PATCH /guilds/{guild.id}`
- [●] [Get Guild Channels](https://docs.discord.com/developers/resources/guild#get-guild-channels) `GET /guilds/{guild.id}/channels`
- [●] [Create Guild Channel](https://docs.discord.com/developers/resources/guild#create-guild-channel) `POST /guilds/{guild.id}/channels`
- [●] [Modify Guild Channel Positions](https://docs.discord.com/developers/resources/guild#modify-guild-channel-positions) `PATCH /guilds/{guild.id}/channels`
- [●] [List Active Guild Threads](https://docs.discord.com/developers/resources/guild#list-active-guild-threads) `GET /guilds/{guild.id}/threads/active`
- [●] [Get Guild Member](https://docs.discord.com/developers/resources/guild#get-guild-member) `GET /guilds/{guild.id}/members/{user.id}`
- [●] [List Guild Members](https://docs.discord.com/developers/resources/guild#list-guild-members) `GET /guilds/{guild.id}/members`
- [●] [Search Guild Members](https://docs.discord.com/developers/resources/guild#search-guild-members) `GET /guilds/{guild.id}/members/search`
- [●] [Get Guild Member Permissions](https://docs.discord.com/developers/resources/guild#get-guild-member-permissions) `GET /guilds/{guild.id}/permissions/member/{user.id}`
- [●] [Add Guild Member](https://docs.discord.com/developers/resources/guild#add-guild-member) `PUT /guilds/{guild.id}/members/{user.id}`
- [●] [Modify Guild Member](https://docs.discord.com/developers/resources/guild#modify-guild-member) `PATCH /guilds/{guild.id}/members/{user.id}`
- [●] [Modify Current Member](https://docs.discord.com/developers/resources/guild#modify-current-member) `PATCH /guilds/{guild.id}/members/@me`
- [●] [Modify Current User Nick](https://docs.discord.com/developers/resources/guild#modify-current-user-nick) `PATCH /guilds/{guild.id}/members/@me/nick`
- [●] [Add Guild Member Role](https://docs.discord.com/developers/resources/guild#add-guild-member-role) `PUT /guilds/{guild.id}/members/{user.id}/roles/{role.id}`
- [●] [Remove Guild Member Role](https://docs.discord.com/developers/resources/guild#remove-guild-member-role) `DELETE /guilds/{guild.id}/members/{user.id}/roles/{role.id}`
- [●] [Remove Guild Member](https://docs.discord.com/developers/resources/guild#remove-guild-member) `DELETE /guilds/{guild.id}/members/{user.id}`
- [●] [Get Guild Bans](https://docs.discord.com/developers/resources/guild#get-guild-bans) `GET /guilds/{guild.id}/bans`
- [●] [Get Guild Ban](https://docs.discord.com/developers/resources/guild#get-guild-ban) `GET /guilds/{guild.id}/bans/{user.id}`
- [●] [Create Guild Ban](https://docs.discord.com/developers/resources/guild#create-guild-ban) `PUT /guilds/{guild.id}/bans/{user.id}`
- [●] [Remove Guild Ban](https://docs.discord.com/developers/resources/guild#remove-guild-ban) `DELETE /guilds/{guild.id}/bans/{user.id}`
- [●] [Bulk Guild Ban](https://docs.discord.com/developers/resources/guild#bulk-guild-ban) `POST /guilds/{guild.id}/bulk-ban`
- [●] [Get Guild Roles](https://docs.discord.com/developers/resources/guild#get-guild-roles) `GET /guilds/{guild.id}/roles`
- [●] [Get Guild Role](https://docs.discord.com/developers/resources/guild#get-guild-role) `GET /guilds/{guild.id}/roles/{role.id}`
- [●] [Get Guild Role Permissions](https://docs.discord.com/developers/resources/guild#get-guild-role-permissions) `GET /guilds/{guild.id}/permissions/role/{role.id}`
- [●] [Get Guild Role Member Counts](https://docs.discord.com/developers/resources/guild#get-guild-role-member-counts) `GET /guilds/{guild.id}/roles/member-counts`
- [●] [Create Guild Role](https://docs.discord.com/developers/resources/guild#create-guild-role) `POST /guilds/{guild.id}/roles`
- [●] [Modify Guild Role Positions](https://docs.discord.com/developers/resources/guild#modify-guild-role-positions) `PATCH /guilds/{guild.id}/roles`
- [●] [Modify Guild Role](https://docs.discord.com/developers/resources/guild#modify-guild-role) `PATCH /guilds/{guild.id}/roles/{role.id}`
- [●] [Delete Guild Role](https://docs.discord.com/developers/resources/guild#delete-guild-role) `DELETE /guilds/{guild.id}/roles/{role.id}`
- [●] [Get Guild Prune Count](https://docs.discord.com/developers/resources/guild#get-guild-prune-count) `GET /guilds/{guild.id}/prune`
- [●] [Begin Guild Prune](https://docs.discord.com/developers/resources/guild#begin-guild-prune) `POST /guilds/{guild.id}/prune`
- [●] [Get Guild Voice Regions](https://docs.discord.com/developers/resources/guild#get-guild-voice-regions) `GET /guilds/{guild.id}/regions`
- [●] [Get Guild Invites](https://docs.discord.com/developers/resources/guild#get-guild-invites) `GET /guilds/{guild.id}/invites`
- [●] [Get Guild Integrations](https://docs.discord.com/developers/resources/guild#get-guild-integrations) `GET /guilds/{guild.id}/integrations`
- [●] [Delete Guild Integration](https://docs.discord.com/developers/resources/guild#delete-guild-integration) `DELETE /guilds/{guild.id}/integrations/{integration.id}`
- [●] [Get Guild Widget Settings](https://docs.discord.com/developers/resources/guild#get-guild-widget-settings) `GET /guilds/{guild.id}/widget`
- [●] [Modify Guild Widget](https://docs.discord.com/developers/resources/guild#modify-guild-widget) `PATCH /guilds/{guild.id}/widget`
- [●] [Get Guild Widget](https://docs.discord.com/developers/resources/guild#get-guild-widget) `GET /guilds/{guild.id}/widget.json`
- [●] [Get Guild Vanity URL](https://docs.discord.com/developers/resources/guild#get-guild-vanity-url) `GET /guilds/{guild.id}/vanity-url`
- [●] [Get Guild Widget Image](https://docs.discord.com/developers/resources/guild#get-guild-widget-image) `GET /guilds/{guild.id}/widget.png`
- [●] [Get Guild Welcome Screen](https://docs.discord.com/developers/resources/guild#get-guild-welcome-screen) `GET /guilds/{guild.id}/welcome-screen`
- [●] [Modify Guild Welcome Screen](https://docs.discord.com/developers/resources/guild#modify-guild-welcome-screen) `PATCH /guilds/{guild.id}/welcome-screen`
- [●] [Get Guild Onboarding](https://docs.discord.com/developers/resources/guild#get-guild-onboarding) `GET /guilds/{guild.id}/onboarding`
- [●] [Modify Guild Onboarding](https://docs.discord.com/developers/resources/guild#modify-guild-onboarding) `PUT /guilds/{guild.id}/onboarding`
- [●] [Modify Guild Incident Actions](https://docs.discord.com/developers/resources/guild#modify-guild-incident-actions) `PUT /guilds/{guild.id}/incident-actions`

### ユーザー

- [●] [Get Current User](https://docs.discord.com/developers/resources/user#get-current-user) `GET /users/@me`
- [●] [Get User](https://docs.discord.com/developers/resources/user#get-user) `GET /users/{user.id}`
- [●] [Modify Current User](https://docs.discord.com/developers/resources/user#modify-current-user) `PATCH /users/@me`
- [●] [Get Current User Guilds](https://docs.discord.com/developers/resources/user#get-current-user-guilds) `GET /users/@me/guilds`
- [●] [Get Current User Guild Member](https://docs.discord.com/developers/resources/user#get-current-user-guild-member) `GET /users/@me/guilds/{guild.id}/member`
- [●] [Leave Guild](https://docs.discord.com/developers/resources/user#leave-guild) `DELETE /users/@me/guilds/{guild.id}`
- [●] [Create DM](https://docs.discord.com/developers/resources/user#create-dm) `POST /users/@me/channels`
- [●] [Create Group DM](https://docs.discord.com/developers/resources/user#create-group-dm) `POST /users/@me/channels`
- [●] [Get Current User Connections](https://docs.discord.com/developers/resources/user#get-current-user-connections) `GET /users/@me/connections`
- [●] [Get Current User Application Role Connection](https://docs.discord.com/developers/resources/user#get-current-user-application-role-connection) `GET /users/@me/applications/{application.id}/role-connection`
- [●] [Update Current User Application Role Connection](https://docs.discord.com/developers/resources/user#update-current-user-application-role-connection) `PUT /users/@me/applications/{application.id}/role-connection`
- [●] [Delete Current User Application Role Connection](https://docs.discord.com/developers/resources/user#delete-current-user-application-role-connection) `DELETE /users/@me/applications/{application.id}/role-connection`

### アプリケーションコマンド

- [●] [Get Global Application Commands](https://docs.discord.com/developers/interactions/application-commands#get-global-application-commands) `GET /applications/{application.id}/commands`
- [●] [Create Global Application Command](https://docs.discord.com/developers/interactions/application-commands#create-global-application-command) `POST /applications/{application.id}/commands`
- [●] [Get Global Application Command](https://docs.discord.com/developers/interactions/application-commands#get-global-application-command) `GET /applications/{application.id}/commands/{command.id}`
- [●] [Edit Global Application Command](https://docs.discord.com/developers/interactions/application-commands#edit-global-application-command) `PATCH /applications/{application.id}/commands/{command.id}`
- [●] [Delete Global Application Command](https://docs.discord.com/developers/interactions/application-commands#delete-global-application-command) `DELETE /applications/{application.id}/commands/{command.id}`
- [●] [Bulk Overwrite Global Application Commands](https://docs.discord.com/developers/interactions/application-commands#bulk-overwrite-global-application-commands) `PUT /applications/{application.id}/commands`
- [●] [Get Guild Application Commands](https://docs.discord.com/developers/interactions/application-commands#get-guild-application-commands) `GET /applications/{application.id}/guilds/{guild.id}/commands`
- [●] [Create Guild Application Command](https://docs.discord.com/developers/interactions/application-commands#create-guild-application-command) `POST /applications/{application.id}/guilds/{guild.id}/commands`
- [●] [Get Guild Application Command](https://docs.discord.com/developers/interactions/application-commands#get-guild-application-command) `GET /applications/{application.id}/guilds/{guild.id}/commands/{command.id}`
- [●] [Edit Guild Application Command](https://docs.discord.com/developers/interactions/application-commands#edit-guild-application-command) `PATCH /applications/{application.id}/guilds/{guild.id}/commands/{command.id}`
- [●] [Delete Guild Application Command](https://docs.discord.com/developers/interactions/application-commands#delete-guild-application-command) `DELETE /applications/{application.id}/guilds/{guild.id}/commands/{command.id}`
- [●] [Bulk Overwrite Guild Application Commands](https://docs.discord.com/developers/interactions/application-commands#bulk-overwrite-guild-application-commands) `PUT /applications/{application.id}/guilds/{guild.id}/commands`
- [●] [Get Guild Application Command Permissions](https://docs.discord.com/developers/interactions/application-commands#get-guild-application-command-permissions) `GET /applications/{application.id}/guilds/{guild.id}/commands/permissions`
- [●] [Get Application Command Permissions](https://docs.discord.com/developers/interactions/application-commands#get-application-command-permissions) `GET /applications/{application.id}/guilds/{guild.id}/commands/{command.id}/permissions`
- [●] [Edit Application Command Permissions](https://docs.discord.com/developers/interactions/application-commands#edit-application-command-permissions) `PUT /applications/{application.id}/guilds/{guild.id}/commands/{command.id}/permissions`
- [●] [Batch Edit Application Command Permissions](https://docs.discord.com/developers/interactions/application-commands#batch-edit-application-command-permissions) `PUT /applications/{application.id}/guilds/{guild.id}/commands/permissions`

### インタラクションの応答

- [●] [Create Interaction Response](https://docs.discord.com/developers/interactions/receiving-and-responding#create-interaction-response) `POST /interactions/{interaction.id}/{interaction.token}/callback`
- [●] [Get Original Interaction Response](https://docs.discord.com/developers/interactions/receiving-and-responding#get-original-interaction-response) `GET /webhooks/{application.id}/{interaction.token}/messages/@original`
- [●] [Edit Original Interaction Response](https://docs.discord.com/developers/interactions/receiving-and-responding#edit-original-interaction-response) `PATCH /webhooks/{application.id}/{interaction.token}/messages/@original`
- [●] [Delete Original Interaction Response](https://docs.discord.com/developers/interactions/receiving-and-responding#delete-original-interaction-response) `DELETE /webhooks/{application.id}/{interaction.token}/messages/@original`
- [●] [Create Followup Message](https://docs.discord.com/developers/interactions/receiving-and-responding#create-followup-message) `POST /webhooks/{application.id}/{interaction.token}`
- [●] [Get Followup Message](https://docs.discord.com/developers/interactions/receiving-and-responding#get-followup-message) `GET /webhooks/{application.id}/{interaction.token}/messages/{message.id}`
- [●] [Edit Followup Message](https://docs.discord.com/developers/interactions/receiving-and-responding#edit-followup-message) `PATCH /webhooks/{application.id}/{interaction.token}/messages/{message.id}`
- [●] [Delete Followup Message](https://docs.discord.com/developers/interactions/receiving-and-responding#delete-followup-message) `DELETE /webhooks/{application.id}/{interaction.token}/messages/{message.id}`

### ウェブフック

- [●] [Create Webhook](https://docs.discord.com/developers/resources/webhook#create-webhook) `POST /channels/{channel.id}/webhooks`
- [●] [Get Channel Webhooks](https://docs.discord.com/developers/resources/webhook#get-channel-webhooks) `GET /channels/{channel.id}/webhooks`
- [●] [Get Guild Webhooks](https://docs.discord.com/developers/resources/webhook#get-guild-webhooks) `GET /guilds/{guild.id}/webhooks`
- [●] [Get Webhook](https://docs.discord.com/developers/resources/webhook#get-webhook) `GET /webhooks/{webhook.id}`
- [●] [Get Webhook with Token](https://docs.discord.com/developers/resources/webhook#get-webhook-with-token) `GET /webhooks/{webhook.id}/{webhook.token}`
- [●] [Modify Webhook](https://docs.discord.com/developers/resources/webhook#modify-webhook) `PATCH /webhooks/{webhook.id}`
- [●] [Modify Webhook with Token](https://docs.discord.com/developers/resources/webhook#modify-webhook-with-token) `PATCH /webhooks/{webhook.id}/{webhook.token}`
- [●] [Delete Webhook](https://docs.discord.com/developers/resources/webhook#delete-webhook) `DELETE /webhooks/{webhook.id}`
- [●] [Delete Webhook with Token](https://docs.discord.com/developers/resources/webhook#delete-webhook-with-token) `DELETE /webhooks/{webhook.id}/{webhook.token}`
- [●] [Execute Webhook](https://docs.discord.com/developers/resources/webhook#execute-webhook) `POST /webhooks/{webhook.id}/{webhook.token}`
- [●] [Execute Slack-Compatible Webhook](https://docs.discord.com/developers/resources/webhook#execute-slack-compatible-webhook) `POST /webhooks/{webhook.id}/{webhook.token}/slack`
- [●] [Execute GitHub-Compatible Webhook](https://docs.discord.com/developers/resources/webhook#execute-github-compatible-webhook) `POST /webhooks/{webhook.id}/{webhook.token}/github`
- [●] [Get Webhook Message](https://docs.discord.com/developers/resources/webhook#get-webhook-message) `GET /webhooks/{webhook.id}/{webhook.token}/messages/{message.id}`
- [●] [Edit Webhook Message](https://docs.discord.com/developers/resources/webhook#edit-webhook-message) `PATCH /webhooks/{webhook.id}/{webhook.token}/messages/{message.id}`
- [●] [Delete Webhook Message](https://docs.discord.com/developers/resources/webhook#delete-webhook-message) `DELETE /webhooks/{webhook.id}/{webhook.token}/messages/{message.id}`

### 絵文字

- [●] [List Guild Emojis](https://docs.discord.com/developers/resources/emoji#list-guild-emojis) `GET /guilds/{guild.id}/emojis`
- [●] [Get Guild Emoji](https://docs.discord.com/developers/resources/emoji#get-guild-emoji) `GET /guilds/{guild.id}/emojis/{emoji.id}`
- [●] [Create Guild Emoji](https://docs.discord.com/developers/resources/emoji#create-guild-emoji) `POST /guilds/{guild.id}/emojis`
- [●] [Modify Guild Emoji](https://docs.discord.com/developers/resources/emoji#modify-guild-emoji) `PATCH /guilds/{guild.id}/emojis/{emoji.id}`
- [●] [Delete Guild Emoji](https://docs.discord.com/developers/resources/emoji#delete-guild-emoji) `DELETE /guilds/{guild.id}/emojis/{emoji.id}`
- [●] [List Application Emojis](https://docs.discord.com/developers/resources/emoji#list-application-emojis) `GET /applications/{application.id}/emojis`
- [●] [Get Application Emoji](https://docs.discord.com/developers/resources/emoji#get-application-emoji) `GET /applications/{application.id}/emojis/{emoji.id}`
- [●] [Create Application Emoji](https://docs.discord.com/developers/resources/emoji#create-application-emoji) `POST /applications/{application.id}/emojis`
- [●] [Modify Application Emoji](https://docs.discord.com/developers/resources/emoji#modify-application-emoji) `PATCH /applications/{application.id}/emojis/{emoji.id}`
- [●] [Delete Application Emoji](https://docs.discord.com/developers/resources/emoji#delete-application-emoji) `DELETE /applications/{application.id}/emojis/{emoji.id}`

### スタンプ

- [●] [Get Sticker](https://docs.discord.com/developers/resources/sticker#get-sticker) `GET /stickers/{sticker.id}`
- [●] [List Sticker Packs](https://docs.discord.com/developers/resources/sticker#list-sticker-packs) `GET /sticker-packs`
- [●] [Get Sticker Pack](https://docs.discord.com/developers/resources/sticker#get-sticker-pack) `GET /sticker-packs/{pack.id}`
- [●] [List Guild Stickers](https://docs.discord.com/developers/resources/sticker#list-guild-stickers) `GET /guilds/{guild.id}/stickers`
- [●] [Get Guild Sticker](https://docs.discord.com/developers/resources/sticker#get-guild-sticker) `GET /guilds/{guild.id}/stickers/{sticker.id}`
- [●] [Create Guild Sticker](https://docs.discord.com/developers/resources/sticker#create-guild-sticker) `POST /guilds/{guild.id}/stickers`
- [●] [Modify Guild Sticker](https://docs.discord.com/developers/resources/sticker#modify-guild-sticker) `PATCH /guilds/{guild.id}/stickers/{sticker.id}`
- [●] [Delete Guild Sticker](https://docs.discord.com/developers/resources/sticker#delete-guild-sticker) `DELETE /guilds/{guild.id}/stickers/{sticker.id}`

### 招待

- [●] [Get Invite](https://docs.discord.com/developers/resources/invite#get-invite) `GET /invites/{invite.code}`
- [●] [Delete Invite](https://docs.discord.com/developers/resources/invite#delete-invite) `DELETE /invites/{invite.code}`
- [●] [Get Target Users](https://docs.discord.com/developers/resources/invite#get-target-users) `GET /invites/{invite.code}/target-users`
- [●] [Add Target User](https://docs.discord.com/developers/resources/invite#add-target-user) `PUT /invites/{invite.code}/target-users/{user.id}`
- [●] [Remove Target User](https://docs.discord.com/developers/resources/invite#remove-target-user) `DELETE /invites/{invite.code}/target-users/{user.id}`
- [●] [Update Target Users](https://docs.discord.com/developers/resources/invite#update-target-users) `PUT /invites/{invite.code}/target-users`
- [●] [Bulk-Add Target Users](https://docs.discord.com/developers/resources/invite#bulk-add-target-users) `POST /invites/{invite.code}/target-users/bulk-add`
- [●] [Bulk-Delete Target Users](https://docs.discord.com/developers/resources/invite#bulk-delete-target-users) `POST /invites/{invite.code}/target-users/bulk-delete`
- [●] [Get Target Users Job Status](https://docs.discord.com/developers/resources/invite#get-target-users-job-status) `GET /invites/{invite.code}/target-users/job-status`

### ステージ

- [●] [Create Stage Instance](https://docs.discord.com/developers/resources/stage-instance#create-stage-instance) `POST /stage-instances`
- [●] [Get Stage Instance](https://docs.discord.com/developers/resources/stage-instance#get-stage-instance) `GET /stage-instances/{channel.id}`
- [●] [Modify Stage Instance](https://docs.discord.com/developers/resources/stage-instance#modify-stage-instance) `PATCH /stage-instances/{channel.id}`
- [●] [Delete Stage Instance](https://docs.discord.com/developers/resources/stage-instance#delete-stage-instance) `DELETE /stage-instances/{channel.id}`

### ボイス

- [●] [List Voice Regions](https://docs.discord.com/developers/resources/voice#list-voice-regions) `GET /voice/regions`
- [●] [Get Current User Voice State](https://docs.discord.com/developers/resources/voice#get-current-user-voice-state) `GET /guilds/{guild.id}/voice-states/@me`
- [●] [Get User Voice State](https://docs.discord.com/developers/resources/voice#get-user-voice-state) `GET /guilds/{guild.id}/voice-states/{user.id}`
- [●] [Modify Current User Voice State](https://docs.discord.com/developers/resources/voice#modify-current-user-voice-state) `PATCH /guilds/{guild.id}/voice-states/@me`
- [●] [Modify User Voice State](https://docs.discord.com/developers/resources/voice#modify-user-voice-state) `PATCH /guilds/{guild.id}/voice-states/{user.id}`

### AutoMod

- [●] [List Auto Moderation Rules for Guild](https://docs.discord.com/developers/resources/auto-moderation#list-auto-moderation-rules-for-guild) `GET /guilds/{guild.id}/auto-moderation/rules`
- [●] [Get Auto Moderation Rule](https://docs.discord.com/developers/resources/auto-moderation#get-auto-moderation-rule) `GET /guilds/{guild.id}/auto-moderation/rules/{rule.id}`
- [●] [Create Auto Moderation Rule](https://docs.discord.com/developers/resources/auto-moderation#create-auto-moderation-rule) `POST /guilds/{guild.id}/auto-moderation/rules`
- [●] [Modify Auto Moderation Rule](https://docs.discord.com/developers/resources/auto-moderation#modify-auto-moderation-rule) `PATCH /guilds/{guild.id}/auto-moderation/rules/{rule.id}`
- [●] [Delete Auto Moderation Rule](https://docs.discord.com/developers/resources/auto-moderation#delete-auto-moderation-rule) `DELETE /guilds/{guild.id}/auto-moderation/rules/{rule.id}`

### 監査ログ

- [●] [Get Guild Audit Log](https://docs.discord.com/developers/resources/audit-log#get-guild-audit-log) `GET /guilds/{guild.id}/audit-logs`

### 投票

- [●] [Get Answer Voters](https://docs.discord.com/developers/resources/poll#get-answer-voters) `GET /channels/{channel.id}/polls/{message.id}/answers/{answer_id}`
- [●] [End Poll](https://docs.discord.com/developers/resources/poll#end-poll) `POST /channels/{channel.id}/polls/{message.id}/expire`

### アプリケーション

- [●] [Get Current Application](https://docs.discord.com/developers/resources/application#get-current-application) `GET /applications/@me`
- [●] [Edit Current Application](https://docs.discord.com/developers/resources/application#edit-current-application) `PATCH /applications/@me`
- [●] [Get Application Activity Instance](https://docs.discord.com/developers/resources/application#get-application-activity-instance) `GET /applications/{application.id}/activity-instances/{instance_id}`

### Gateway

- [●] [Get Gateway](https://docs.discord.com/developers/events/gateway#get-gateway) `GET /gateway`
- [●] [Get Gateway Bot](https://docs.discord.com/developers/events/gateway#get-gateway-bot) `GET /gateway/bot`

### イベント

- [●] [List Scheduled Events for Guild](https://docs.discord.com/developers/resources/guild-scheduled-event#list-scheduled-events-for-guild) `GET /guilds/{guild.id}/scheduled-events`
- [●] [Create Guild Scheduled Event](https://docs.discord.com/developers/resources/guild-scheduled-event#create-guild-scheduled-event) `POST /guilds/{guild.id}/scheduled-events`
- [●] [Get Guild Scheduled Event](https://docs.discord.com/developers/resources/guild-scheduled-event#get-guild-scheduled-event) `GET /guilds/{guild.id}/scheduled-events/{event.id}`
- [●] [Modify Guild Scheduled Event](https://docs.discord.com/developers/resources/guild-scheduled-event#modify-guild-scheduled-event) `PATCH /guilds/{guild.id}/scheduled-events/{event.id}`
- [●] [Delete Guild Scheduled Event](https://docs.discord.com/developers/resources/guild-scheduled-event#delete-guild-scheduled-event) `DELETE /guilds/{guild.id}/scheduled-events/{event.id}`
- [●] [Get Guild Scheduled Event Users](https://docs.discord.com/developers/resources/guild-scheduled-event#get-guild-scheduled-event-users) `GET /guilds/{guild.id}/scheduled-events/{event.id}/users`

### サウンドボード

- [●] [Send Soundboard Sound](https://docs.discord.com/developers/resources/soundboard#send-soundboard-sound) `POST /channels/{channel.id}/send-soundboard-sound`
- [●] [List Default Soundboard Sounds](https://docs.discord.com/developers/resources/soundboard#list-default-soundboard-sounds) `GET /soundboard-default-sounds`
- [●] [List Guild Soundboard Sounds](https://docs.discord.com/developers/resources/soundboard#list-guild-soundboard-sounds) `GET /guilds/{guild.id}/soundboard-sounds`
- [●] [Get Guild Soundboard Sound](https://docs.discord.com/developers/resources/soundboard#get-guild-soundboard-sound) `GET /guilds/{guild.id}/soundboard-sounds/{sound.id}`
- [●] [Create Guild Soundboard Sound](https://docs.discord.com/developers/resources/soundboard#create-guild-soundboard-sound) `POST /guilds/{guild.id}/soundboard-sounds`
- [●] [Modify Guild Soundboard Sound](https://docs.discord.com/developers/resources/soundboard#modify-guild-soundboard-sound) `PATCH /guilds/{guild.id}/soundboard-sounds/{sound.id}`
- [●] [Delete Guild Soundboard Sound](https://docs.discord.com/developers/resources/soundboard#delete-guild-soundboard-sound) `DELETE /guilds/{guild.id}/soundboard-sounds/{sound.id}`

### サーバーテンプレート

- [●] [Get Guild Template](https://docs.discord.com/developers/resources/guild-template#get-guild-template) `GET /guilds/templates/{template.code}`
- [●] [Get Guild Templates](https://docs.discord.com/developers/resources/guild-template#get-guild-templates) `GET /guilds/{guild.id}/templates`
- [●] [Create Guild Template](https://docs.discord.com/developers/resources/guild-template#create-guild-template) `POST /guilds/{guild.id}/templates`
- [●] [Sync Guild Template](https://docs.discord.com/developers/resources/guild-template#sync-guild-template) `PUT /guilds/{guild.id}/templates/{template.code}`
- [●] [Modify Guild Template](https://docs.discord.com/developers/resources/guild-template#modify-guild-template) `PATCH /guilds/{guild.id}/templates/{template.code}`
- [●] [Delete Guild Template](https://docs.discord.com/developers/resources/guild-template#delete-guild-template) `DELETE /guilds/{guild.id}/templates/{template.code}`

### 収益化（エンタイトルメント）

- [●] [List Entitlements](https://docs.discord.com/developers/resources/entitlement#list-entitlements) `GET /applications/{application.id}/entitlements`
- [●] [Get Entitlement](https://docs.discord.com/developers/resources/entitlement#get-entitlement) `GET /applications/{application.id}/entitlements/{entitlement.id}`
- [●] [Consume an Entitlement](https://docs.discord.com/developers/resources/entitlement#consume-an-entitlement) `POST /applications/{application.id}/entitlements/{entitlement.id}/consume`
- [●] [Create Test Entitlement](https://docs.discord.com/developers/resources/entitlement#create-test-entitlement) `POST /applications/{application.id}/entitlements`
- [●] [Delete Test Entitlement](https://docs.discord.com/developers/resources/entitlement#delete-test-entitlement) `DELETE /applications/{application.id}/entitlements/{entitlement.id}`

### 収益化（SKU）

- [●] [List SKUs](https://docs.discord.com/developers/resources/sku#list-skus) `GET /applications/{application.id}/skus`

### 収益化（サブスクリプション）

- [●] [List SKU Subscriptions](https://docs.discord.com/developers/resources/subscription#list-sku-subscriptions) `GET /skus/{sku.id}/subscriptions`
- [●] [Get SKU Subscription](https://docs.discord.com/developers/resources/subscription#get-sku-subscription) `GET /skus/{sku.id}/subscriptions/{subscription.id}`

### ロール連携のメタデータ

- [●] [Get Application Role Connection Metadata Records](https://docs.discord.com/developers/resources/application-role-connection-metadata#get-application-role-connection-metadata-records) `GET /applications/{application.id}/role-connections/metadata`
- [●] [Update Application Role Connection Metadata Records](https://docs.discord.com/developers/resources/application-role-connection-metadata#update-application-role-connection-metadata-records) `PUT /applications/{application.id}/role-connections/metadata`

### ロビー

- [●] [Create Lobby](https://docs.discord.com/developers/resources/lobby#create-lobby) `POST /lobbies`
- [●] [Create or Join Lobby](https://docs.discord.com/developers/resources/lobby#create-or-join-lobby) `PUT /lobbies`
- [●] [Get Lobby](https://docs.discord.com/developers/resources/lobby#get-lobby) `GET /lobbies/{lobby.id}`
- [●] [Modify Lobby](https://docs.discord.com/developers/resources/lobby#modify-lobby) `PATCH /lobbies/{lobby.id}`
- [●] [Delete Lobby](https://docs.discord.com/developers/resources/lobby#delete-lobby) `DELETE /lobbies/{lobby.id}`
- [●] [Add a Member to a Lobby](https://docs.discord.com/developers/resources/lobby#add-a-member-to-a-lobby) `PUT /lobbies/{lobby.id}/members/{user.id}`
- [●] [Bulk Update Lobby Members](https://docs.discord.com/developers/resources/lobby#bulk-update-lobby-members) `POST /lobbies/{lobby.id}/members/bulk`
- [●] [Remove a Member from a Lobby](https://docs.discord.com/developers/resources/lobby#remove-a-member-from-a-lobby) `DELETE /lobbies/{lobby.id}/members/{user.id}`
- [●] [Leave Lobby](https://docs.discord.com/developers/resources/lobby#leave-lobby) `DELETE /lobbies/{lobby.id}/members/@me`
- [●] [Link Channel to Lobby](https://docs.discord.com/developers/resources/lobby#link-channel-to-lobby) `PATCH /lobbies/{lobby.id}/channel-linking`
- [●] [Unlink Channel from Lobby](https://docs.discord.com/developers/resources/lobby#unlink-channel-from-lobby) `PATCH /lobbies/{lobby.id}/channel-linking`
- [●] [Send Lobby Message](https://docs.discord.com/developers/resources/lobby#send-lobby-message) `POST /lobbies/{lobby.id}/messages`
- [●] [Get Lobby Messages](https://docs.discord.com/developers/resources/lobby#get-lobby-messages) `GET /lobbies/{lobby.id}/messages`
- [●] [Update Lobby Message Moderation Metadata](https://docs.discord.com/developers/resources/lobby#update-lobby-message-moderation-metadata) `PUT /lobbies/{lobby.id}/messages/{message.id}/moderation-metadata`
- [●] [Create Lobby Channel Invite for Self](https://docs.discord.com/developers/resources/lobby#create-lobby-channel-invite-for-self) `POST /lobbies/{lobby.id}/members/@me/invites`
- [●] [Create Lobby Channel Invite for User](https://docs.discord.com/developers/resources/lobby#create-lobby-channel-invite-for-user) `POST /lobbies/{lobby.id}/members/{user.id}/invites`

### Gateway の送信イベント（Bot → Mock）

- [●] [Identify](https://docs.discord.com/developers/events/gateway-events#identify)
- [●] [Resume](https://docs.discord.com/developers/events/gateway-events#resume)
- [●] [Heartbeat](https://docs.discord.com/developers/events/gateway-events#heartbeat)
- [●] [Request Guild Members](https://docs.discord.com/developers/events/gateway-events#request-guild-members)
- [●] [Request Soundboard Sounds](https://docs.discord.com/developers/events/gateway-events#request-soundboard-sounds)
- [●] [Request Channel Info](https://docs.discord.com/developers/events/gateway-events#request-channel-info)
- [●] [Update Voice State](https://docs.discord.com/developers/events/gateway-events#update-voice-state)
- [●] [Update Presence](https://docs.discord.com/developers/events/gateway-events#update-presence)

### Gateway の受信イベント（Mock → Bot）

- [●] [Hello](https://docs.discord.com/developers/events/gateway-events#hello) `HELLO`
- [●] [Ready](https://docs.discord.com/developers/events/gateway-events#ready) `READY`
- [●] [Resumed](https://docs.discord.com/developers/events/gateway-events#resumed) `RESUMED`
- [●] [Reconnect](https://docs.discord.com/developers/events/gateway-events#reconnect) `RECONNECT`
- [●] [Rate Limited](https://docs.discord.com/developers/events/gateway-events#rate-limited) `RATE_LIMITED`
- [●] [Invalid Session](https://docs.discord.com/developers/events/gateway-events#invalid-session) `INVALID_SESSION`
- [●] [Application Command Permissions Update](https://docs.discord.com/developers/events/gateway-events#application-command-permissions-update) `APPLICATION_COMMAND_PERMISSIONS_UPDATE`
- [●] [Auto Moderation Rule Create](https://docs.discord.com/developers/events/gateway-events#auto-moderation-rule-create) `AUTO_MODERATION_RULE_CREATE`
- [●] [Auto Moderation Rule Update](https://docs.discord.com/developers/events/gateway-events#auto-moderation-rule-update) `AUTO_MODERATION_RULE_UPDATE`
- [●] [Auto Moderation Rule Delete](https://docs.discord.com/developers/events/gateway-events#auto-moderation-rule-delete) `AUTO_MODERATION_RULE_DELETE`
- [●] [Auto Moderation Action Execution](https://docs.discord.com/developers/events/gateway-events#auto-moderation-action-execution) `AUTO_MODERATION_ACTION_EXECUTION`
- [●] [Channel Create](https://docs.discord.com/developers/events/gateway-events#channel-create) `CHANNEL_CREATE`
- [●] [Channel Update](https://docs.discord.com/developers/events/gateway-events#channel-update) `CHANNEL_UPDATE`
- [●] [Channel Delete](https://docs.discord.com/developers/events/gateway-events#channel-delete) `CHANNEL_DELETE`
- [●] [Channel Info](https://docs.discord.com/developers/events/gateway-events#channel-info) `CHANNEL_INFO`
- [●] [Voice Channel Status Update](https://docs.discord.com/developers/events/gateway-events#voice-channel-status-update) `VOICE_CHANNEL_STATUS_UPDATE`
- [●] [Voice Channel Start Time Update](https://docs.discord.com/developers/events/gateway-events#voice-channel-start-time-update) `VOICE_CHANNEL_START_TIME_UPDATE`
- [●] [Channel Pins Update](https://docs.discord.com/developers/events/gateway-events#channel-pins-update) `CHANNEL_PINS_UPDATE`
- [●] [Thread Create](https://docs.discord.com/developers/events/gateway-events#thread-create) `THREAD_CREATE`
- [●] [Thread Update](https://docs.discord.com/developers/events/gateway-events#thread-update) `THREAD_UPDATE`
- [●] [Thread Delete](https://docs.discord.com/developers/events/gateway-events#thread-delete) `THREAD_DELETE`
- [●] [Thread List Sync](https://docs.discord.com/developers/events/gateway-events#thread-list-sync) `THREAD_LIST_SYNC`
- [●] [Thread Member Update](https://docs.discord.com/developers/events/gateway-events#thread-member-update) `THREAD_MEMBER_UPDATE`
- [●] [Thread Members Update](https://docs.discord.com/developers/events/gateway-events#thread-members-update) `THREAD_MEMBERS_UPDATE`
- [●] [Entitlement Create](https://docs.discord.com/developers/events/gateway-events#entitlement-create) `ENTITLEMENT_CREATE`
- [●] [Entitlement Update](https://docs.discord.com/developers/events/gateway-events#entitlement-update) `ENTITLEMENT_UPDATE`
- [●] [Entitlement Delete](https://docs.discord.com/developers/events/gateway-events#entitlement-delete) `ENTITLEMENT_DELETE`
- [●] [Guild Create](https://docs.discord.com/developers/events/gateway-events#guild-create) `GUILD_CREATE`
- [●] [Guild Update](https://docs.discord.com/developers/events/gateway-events#guild-update) `GUILD_UPDATE`
- [●] [Guild Delete](https://docs.discord.com/developers/events/gateway-events#guild-delete) `GUILD_DELETE`
- [●] [Guild Audit Log Entry Create](https://docs.discord.com/developers/events/gateway-events#guild-audit-log-entry-create) `GUILD_AUDIT_LOG_ENTRY_CREATE`
- [●] [Guild Ban Add](https://docs.discord.com/developers/events/gateway-events#guild-ban-add) `GUILD_BAN_ADD`
- [●] [Guild Ban Remove](https://docs.discord.com/developers/events/gateway-events#guild-ban-remove) `GUILD_BAN_REMOVE`
- [●] [Guild Emojis Update](https://docs.discord.com/developers/events/gateway-events#guild-emojis-update) `GUILD_EMOJIS_UPDATE`
- [●] [Guild Stickers Update](https://docs.discord.com/developers/events/gateway-events#guild-stickers-update) `GUILD_STICKERS_UPDATE`
- [●] [Guild Integrations Update](https://docs.discord.com/developers/events/gateway-events#guild-integrations-update) `GUILD_INTEGRATIONS_UPDATE`
- [●] [Guild Member Add](https://docs.discord.com/developers/events/gateway-events#guild-member-add) `GUILD_MEMBER_ADD`
- [●] [Guild Member Remove](https://docs.discord.com/developers/events/gateway-events#guild-member-remove) `GUILD_MEMBER_REMOVE`
- [●] [Guild Member Update](https://docs.discord.com/developers/events/gateway-events#guild-member-update) `GUILD_MEMBER_UPDATE`
- [●] [Guild Members Chunk](https://docs.discord.com/developers/events/gateway-events#guild-members-chunk) `GUILD_MEMBERS_CHUNK`
- [●] [Guild Role Create](https://docs.discord.com/developers/events/gateway-events#guild-role-create) `GUILD_ROLE_CREATE`
- [●] [Guild Role Update](https://docs.discord.com/developers/events/gateway-events#guild-role-update) `GUILD_ROLE_UPDATE`
- [●] [Guild Role Delete](https://docs.discord.com/developers/events/gateway-events#guild-role-delete) `GUILD_ROLE_DELETE`
- [●] [Guild Scheduled Event Create](https://docs.discord.com/developers/events/gateway-events#guild-scheduled-event-create) `GUILD_SCHEDULED_EVENT_CREATE`
- [●] [Guild Scheduled Event Update](https://docs.discord.com/developers/events/gateway-events#guild-scheduled-event-update) `GUILD_SCHEDULED_EVENT_UPDATE`
- [●] [Guild Scheduled Event Delete](https://docs.discord.com/developers/events/gateway-events#guild-scheduled-event-delete) `GUILD_SCHEDULED_EVENT_DELETE`
- [●] [Guild Scheduled Event User Add](https://docs.discord.com/developers/events/gateway-events#guild-scheduled-event-user-add) `GUILD_SCHEDULED_EVENT_USER_ADD`
- [●] [Guild Scheduled Event User Remove](https://docs.discord.com/developers/events/gateway-events#guild-scheduled-event-user-remove) `GUILD_SCHEDULED_EVENT_USER_REMOVE`
- [●] [Guild Soundboard Sound Create](https://docs.discord.com/developers/events/gateway-events#guild-soundboard-sound-create) `GUILD_SOUNDBOARD_SOUND_CREATE`
- [●] [Guild Soundboard Sound Update](https://docs.discord.com/developers/events/gateway-events#guild-soundboard-sound-update) `GUILD_SOUNDBOARD_SOUND_UPDATE`
- [●] [Guild Soundboard Sound Delete](https://docs.discord.com/developers/events/gateway-events#guild-soundboard-sound-delete) `GUILD_SOUNDBOARD_SOUND_DELETE`
- [●] [Guild Soundboard Sounds Update](https://docs.discord.com/developers/events/gateway-events#guild-soundboard-sounds-update) `GUILD_SOUNDBOARD_SOUNDS_UPDATE`
- [●] [Soundboard Sounds](https://docs.discord.com/developers/events/gateway-events#soundboard-sounds) `SOUNDBOARD_SOUNDS`
- [●] [Integration Create](https://docs.discord.com/developers/events/gateway-events#integration-create) `INTEGRATION_CREATE`
- [●] [Integration Update](https://docs.discord.com/developers/events/gateway-events#integration-update) `INTEGRATION_UPDATE`
- [●] [Integration Delete](https://docs.discord.com/developers/events/gateway-events#integration-delete) `INTEGRATION_DELETE`
- [●] [Interaction Create](https://docs.discord.com/developers/events/gateway-events#interaction-create) `INTERACTION_CREATE`
- [●] [Invite Create](https://docs.discord.com/developers/events/gateway-events#invite-create) `INVITE_CREATE`
- [●] [Invite Delete](https://docs.discord.com/developers/events/gateway-events#invite-delete) `INVITE_DELETE`
- [●] [Message Create](https://docs.discord.com/developers/events/gateway-events#message-create) `MESSAGE_CREATE`
- [●] [Message Update](https://docs.discord.com/developers/events/gateway-events#message-update) `MESSAGE_UPDATE`
- [●] [Message Delete](https://docs.discord.com/developers/events/gateway-events#message-delete) `MESSAGE_DELETE`
- [●] [Message Delete Bulk](https://docs.discord.com/developers/events/gateway-events#message-delete-bulk) `MESSAGE_DELETE_BULK`
- [●] [Message Reaction Add](https://docs.discord.com/developers/events/gateway-events#message-reaction-add) `MESSAGE_REACTION_ADD`
- [●] [Message Reaction Remove](https://docs.discord.com/developers/events/gateway-events#message-reaction-remove) `MESSAGE_REACTION_REMOVE`
- [●] [Message Reaction Remove All](https://docs.discord.com/developers/events/gateway-events#message-reaction-remove-all) `MESSAGE_REACTION_REMOVE_ALL`
- [●] [Message Reaction Remove Emoji](https://docs.discord.com/developers/events/gateway-events#message-reaction-remove-emoji) `MESSAGE_REACTION_REMOVE_EMOJI`
- [●] [Presence Update](https://docs.discord.com/developers/events/gateway-events#presence-update) `PRESENCE_UPDATE`
- [●] [Stage Instance Create](https://docs.discord.com/developers/events/gateway-events#stage-instance-create) `STAGE_INSTANCE_CREATE`
- [●] [Stage Instance Update](https://docs.discord.com/developers/events/gateway-events#stage-instance-update) `STAGE_INSTANCE_UPDATE`
- [●] [Stage Instance Delete](https://docs.discord.com/developers/events/gateway-events#stage-instance-delete) `STAGE_INSTANCE_DELETE`
- [●] [Subscription Create](https://docs.discord.com/developers/events/gateway-events#subscription-create) `SUBSCRIPTION_CREATE`
- [●] [Subscription Update](https://docs.discord.com/developers/events/gateway-events#subscription-update) `SUBSCRIPTION_UPDATE`
- [●] [Subscription Delete](https://docs.discord.com/developers/events/gateway-events#subscription-delete) `SUBSCRIPTION_DELETE`
- [●] [Typing Start](https://docs.discord.com/developers/events/gateway-events#typing-start) `TYPING_START`
- [●] [User Update](https://docs.discord.com/developers/events/gateway-events#user-update) `USER_UPDATE`
- [●] [Voice Channel Effect Send](https://docs.discord.com/developers/events/gateway-events#voice-channel-effect-send) `VOICE_CHANNEL_EFFECT_SEND`
- [●] [Voice State Update](https://docs.discord.com/developers/events/gateway-events#voice-state-update) `VOICE_STATE_UPDATE`
- [●] [Voice Server Update](https://docs.discord.com/developers/events/gateway-events#voice-server-update) `VOICE_SERVER_UPDATE`
- [●] [Webhooks Update](https://docs.discord.com/developers/events/gateway-events#webhooks-update) `WEBHOOKS_UPDATE`
- [●] [Message Poll Vote Add](https://docs.discord.com/developers/events/gateway-events#message-poll-vote-add) `MESSAGE_POLL_VOTE_ADD`
- [●] [Message Poll Vote Remove](https://docs.discord.com/developers/events/gateway-events#message-poll-vote-remove) `MESSAGE_POLL_VOTE_REMOVE`

### Voice Gateway

- [●] [Voice Gateway（v8）](https://docs.discord.com/developers/topics/voice-connections) と UDP の IP Discovery。暗号化は `aead_aes256_gcm_rtpsize` で、Bot が送信した音声を受信します。

## 未対応

未対応の API とイベントはありません。

## 対象外

- [DAVE（エンドツーエンド暗号化）](https://docs.discord.com/developers/topics/voice-connections)。dismock の要件で使わないことにしています。Mock は音声を画面で再生するために復号するので、エンドツーエンド暗号化とは両立しません。
