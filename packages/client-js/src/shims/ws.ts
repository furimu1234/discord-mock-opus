import WebSocket from 'ws';

/** `@discordjs/voice` は `wss://` で接続するが、Mock の Voice Gateway は `ws://` で待ち受ける。 */
class MockVoiceWebSocket extends WebSocket {
  constructor(address: string) {
    super(address.replace(/^wss:/, 'ws:'));
  }
}

export default MockVoiceWebSocket;
export { MockVoiceWebSocket as 'module.exports' };
