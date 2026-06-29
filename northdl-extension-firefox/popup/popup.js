let currentUrl = '';

browser.storage.local.get('pendingDownload').then(({ pendingDownload }) => {
  if (!pendingDownload) {
    document.getElementById('filename').textContent = 'No download info found.';
    return;
  }
  currentUrl = pendingDownload.url;
  document.getElementById('filename').textContent = pendingDownload.filename;
});

document.getElementById('btn-northdl').addEventListener('click', async () => {
  if (!currentUrl) return;

  const status = document.getElementById('status');

  try {
    await browser.runtime.sendNativeMessage('com.northdl.host', { url: currentUrl });
    await browser.storage.local.remove('pendingDownload');
    window.close();
  } catch (err) {
    status.textContent = 'NorthDL host not found.';
    console.error(err);
  }
});

document.getElementById('btn-firefox').addEventListener('click', async () => {
  if (!currentUrl) { window.close(); return; }

  await browser.runtime.sendMessage({ type: 'passthrough', url: currentUrl });
  await browser.downloads.download({ url: currentUrl });
  await browser.storage.local.remove('pendingDownload');
  window.close();
});