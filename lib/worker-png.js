let UZIP = null;

self.importScripts('pako.js', 'upng.js');

self.onmessage = (event) => {
  let {data, width, height} = event.data;
  self.postMessage(UPNG.encode([data], width, height, 0));
};
