import {
  createAudioPlayer,
  createAudioResource,
  entersState,
  getVoiceConnection,
  joinVoiceChannel,
  NoSubscriberBehavior,
  StreamType,
  VoiceConnectionStatus,
  type AudioPlayer,
  type VoiceConnection,
} from '@discordjs/voice';
import type { VoiceBasedChannel } from 'discord.js';
import { youtubeDl, type Payload } from 'youtube-dl-exec';

const CONNECT_TIMEOUT_MS = 20_000;
const RECONNECT_TIMEOUT_MS = 5_000;
const YOUTUBE_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be']);

/** yt-dlp に共通で渡すオプション。プレイリストの URL でも指定された動画だけを扱う。 */
const YTDLP_FLAGS = { noPlaylist: true, noWarnings: true, jsRuntimes: 'node' } as const;

interface Session {
  player: AudioPlayer;
  download?: { kill(): boolean };
}

const sessions = new Map<string, Session>();

/** yt-dlp は任意のサイトへアクセスできるので、YouTube の URL だけを受け付ける。 */
export function parseYoutubeUrl(input: string): string | undefined {
  if (!URL.canParse(input)) return undefined;
  const url = new URL(input);
  return url.protocol === 'https:' && YOUTUBE_HOSTS.has(url.hostname) ? url.href : undefined;
}

async function fetchTitle(url: string): Promise<string> {
  const info = await youtubeDl(url, { ...YTDLP_FLAGS, dumpSingleJson: true, skipDownload: true });
  return (info as Payload).title;
}

function endSession(guildId: string): void {
  const session = sessions.get(guildId);
  sessions.delete(guildId);
  session?.download?.kill();
  session?.player.stop(true);
}

/** サーバーの切り替えなどで切断されたときは再接続を待ち、戻らなければ終了する。 */
function watchConnection(connection: VoiceConnection): void {
  connection.on(VoiceConnectionStatus.Disconnected, () => {
    Promise.race([
      entersState(connection, VoiceConnectionStatus.Signalling, RECONNECT_TIMEOUT_MS),
      entersState(connection, VoiceConnectionStatus.Connecting, RECONNECT_TIMEOUT_MS),
    ]).catch(() => connection.destroy());
  });
  connection.once(VoiceConnectionStatus.Destroyed, () => endSession(connection.joinConfig.guildId));
}

function connect(channel: VoiceBasedChannel): { connection: VoiceConnection; session: Session } {
  const guildId = channel.guild.id;
  const connection = joinVoiceChannel({
    channelId: channel.id,
    guildId,
    adapterCreator: channel.guild.voiceAdapterCreator,
  });
  let session = sessions.get(guildId);
  if (!session) {
    session = { player: createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Pause } }) };
    session.player.on('error', (error) => console.error(error));
    connection.subscribe(session.player);
    watchConnection(connection);
    sessions.set(guildId, session);
  }
  return { connection, session };
}

function stream(session: Session, url: string): void {
  session.download?.kill();
  const download = youtubeDl.exec(
    url,
    { ...YTDLP_FLAGS, format: 'bestaudio/best', output: '-' },
    { stdio: ['ignore', 'pipe', 'ignore'] },
  );
  // 次の曲や /stop で止めると reject されるので、未処理のエラーにしない。
  download.catch(() => {});
  session.download = download;
  session.player.play(createAudioResource(download.stdout!, { inputType: StreamType.Arbitrary }));
}

/** ボイスチャンネルに接続して再生を始め、曲名を返す。再生中の曲があれば差し替える。 */
export async function play(channel: VoiceBasedChannel, url: string): Promise<string> {
  const title = await fetchTitle(url);
  const { connection, session } = connect(channel);
  try {
    await entersState(connection, VoiceConnectionStatus.Ready, CONNECT_TIMEOUT_MS);
  } catch (error) {
    connection.destroy();
    throw error;
  }
  stream(session, url);
  return title;
}

/** ボイスチャンネルから退出する。接続していなければ false を返す。 */
export function leave(guildId: string): boolean {
  const connection = getVoiceConnection(guildId);
  connection?.destroy();
  return connection !== undefined;
}
