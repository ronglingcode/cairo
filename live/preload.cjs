const { contextBridge, ipcRenderer } = require('electron');

const invoke = (channel, ...args) => ipcRenderer.invoke(`cairo:${channel}`, ...args);
function subscribe(channel, handler) {
  const listener = (_event, value) => handler(value);
  ipcRenderer.on(`cairo:${channel}`, listener);
  return () => ipcRenderer.off(`cairo:${channel}`, listener);
}
contextBridge.exposeInMainWorld('cairo', {
  snapshot: () => invoke('snapshot'),
  ask: text => invoke('ask', text),
  cancelQuestion: () => invoke('cancel-question'),
  onSnapshot: handler => subscribe('snapshot', handler),
  onMuteOutput: handler => subscribe('mute-output', handler),
  replayPlan: value => invoke('replay-plan', value),
  backtest: () => invoke('backtest'),
  shadow: value => invoke('shadow', value),
  identify: (id, note) => invoke('identify', id, note),
  review: id => invoke('review', id),
  approve: id => invoke('approve', id),
  feedback: (id, value) => invoke('feedback', id, value),
  voiceStart: sdp => invoke('voice-start', sdp),
  voiceStop: () => invoke('voice-stop'),
});
