// Local transport: connects browser tabs (or iframes) on one device with BroadcastChannel.
// For development and testing; milestone 3 swaps in a WebRTC transport with the same shape.
//
// Every message is broadcast, so `to` is only a filter. That is fine for local testing,
// but it means any tab could read other players' views; the WebRTC transport is point to point.

const HOST = '@host';
const channelName = (room) => `avalon-room-${room}`;

/** Host side: receive(from, msg) for every client message, send(to, msg) to one client. */
export function localHostTransport(room, onMessage) {
  const ch = new BroadcastChannel(channelName(room));
  ch.onmessage = ({ data }) => {
    if (data?.to === HOST) onMessage(data.from, data.msg);
  };
  return {
    send: (to, msg) => ch.postMessage({ from: HOST, to, msg }),
    close: () => ch.close(),
  };
}

/** Client side: send(msg) to the host; onMessage(msg) for messages addressed to this player. */
export function localClientTransport(room, playerId, onMessage) {
  const ch = new BroadcastChannel(channelName(room));
  ch.onmessage = ({ data }) => {
    if (data?.from === HOST && data.to === playerId) onMessage(data.msg);
  };
  return {
    send: (msg) => ch.postMessage({ from: playerId, to: HOST, msg }),
    close: () => ch.close(),
  };
}
