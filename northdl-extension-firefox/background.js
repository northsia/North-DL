const INTERCEPT_EXTENSIONS = [
  '.zip', '.rar', '.7z', '.tar', '.gz', '.xz',
  '.exe', '.msi', '.iso',
  '.mp4', '.mkv', '.avi', '.mov', '.webm',
  '.mp3', '.flac', '.wav', '.ogg',
  '.pdf', '.apk', '.torrent', '.bin'
];


const passthroughUrls = new Set();

function shouldIntercept(url, filename) {
  const target = (url + (filename || '')).toLowerCase();
  return INTERCEPT_EXTENSIONS.some(ext => target.includes(ext));
}


browser.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'passthrough') {
    passthroughUrls.add(msg.url);
  }
});

browser.downloads.onCreated.addListener(async (item) => {

    if (passthroughUrls.has(item.url)) {
    passthroughUrls.delete(item.url);
    return;
  }

  if (!shouldIntercept(item.url, item.filename)) return;

  await browser.downloads.cancel(item.id).catch(() => {});
  await browser.downloads.erase({ id: item.id }).catch(() => {});

  const filename = item.filename
    ? item.filename.split(/[\\/]/).pop()
    : decodeURIComponent(item.url.split('/').pop().split('?')[0]) || 'Unknown file';

  await browser.storage.local.set({
    pendingDownload: { url: item.url, filename }
  });

  const screen = await browser.windows.getCurrent();
  const screenWidth = screen.width || 1920;
  const screenHeight = screen.height || 1080;
  
  const popupWidth = 500;
  const popupHeight = 420;

  await browser.windows.create({
    url: browser.runtime.getURL('popup/popup.html'),
    type: 'popup',
    width: popupWidth,
    height: popupHeight,
    left: Math.round((screenWidth - popupWidth) / 2),
    top: Math.round((screenHeight - popupHeight) / 2),
  });
});