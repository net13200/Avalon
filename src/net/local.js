// Local transport: connects browser tabs (or iframes) on one device with BroadcastChannel.
// For development; same interface as the WebRTC transport in peer.js.
//
// Every message is broadcast, so `to` is only a filter. That is fine for local testing,
// but any tab could read other players' views; the WebRTC transport is point to point.

const HOST = '@host';
const channelName = (room) => `avalon-room-${room}`;

/**
 * Host side. Calls onMessage(connId, msg) for client messages.
 * @returns {{ send(connId, msg), drop(connId), close() }}
 */
export function localHostTransport({ room, onMessage, onStatus = () => {} }) {
  const ch = new BroadcastChannel(channelName(room));
  ch.onmessage = ({ data }) => {
    if (data?.to === HOST && typeof data.from === 'string') onMessage(data.from, data.msg);
  };
  queueMicrotask(() => onStatus('ready'));
  return {
    send: (connId, msg) => ch.postMessage({ from: HOST, to: connId, msg }),
    drop: () => {},
    close: () => ch.close(),
  };
}

/**
 * Client side. Calls onOpen() once connected (immediately here) and onMessage(msg).
 * @returns {{ send(msg), close(), reconnectNow() }}
 */
export function localClientTransport({ room, onMessage, onOpen = () => {}, onStatus = () => {} }) {
  const ch = new BroadcastChannel(channelName(room));
  const tag = `local-${Math.random().toString(36).slice(2)}`;
  ch.onmessage = ({ data }) => {
    if (data?.from === HOST && data.to === tag) onMessage(data.msg);
  };
  queueMicrotask(() => { onStatus('open'); onOpen(); });
  return {
    send: (msg) => ch.postMessage({ from: tag, to: HOST, msg }),
    close: () => ch.close(),
    reconnectNow: () => {},
  };
}
