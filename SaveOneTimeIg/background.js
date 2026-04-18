(() => {
  const ZIP_SIGNATURES = {
    centralDirectory: 0x02014b50,
    endOfCentralDirectory: 0x06054b50,
    localFileHeader: 0x04034b50,
  };

  const crcTable = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
    }
    crcTable[index] = value >>> 0;
  }

  function crc32(bytes) {
    let crc = 0xffffffff;

    for (const byte of bytes) {
      crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
    }

    return (crc ^ 0xffffffff) >>> 0;
  }

  function getDosDateTime(date = new Date()) {
    const safeYear = Math.max(1980, date.getFullYear());
    return {
      dosDate: ((safeYear - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
      dosTime: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    };
  }

  function toUint16(value) {
    const output = new Uint8Array(2);
    new DataView(output.buffer).setUint16(0, value, true);
    return output;
  }

  function toUint32(value) {
    const output = new Uint8Array(4);
    new DataView(output.buffer).setUint32(0, value, true);
    return output;
  }

  function concatUint8Arrays(chunks) {
    const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const output = new Uint8Array(totalLength);
    let offset = 0;

    for (const chunk of chunks) {
      output.set(chunk, offset);
      offset += chunk.length;
    }

    return output;
  }

  function sanitizeFilename(filename) {
    return filename.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_");
  }

  function buildStoredZip(entries) {
    const encoder = new TextEncoder();
    const localChunks = [];
    const centralChunks = [];
    const { dosDate, dosTime } = getDosDateTime();
    let currentOffset = 0;

    for (const entry of entries) {
      const nameBytes = encoder.encode(sanitizeFilename(entry.filename));
      const checksum = crc32(entry.bytes);

      const localHeader = concatUint8Arrays([
        toUint32(ZIP_SIGNATURES.localFileHeader),
        toUint16(20),
        toUint16(0),
        toUint16(0),
        toUint16(dosTime),
        toUint16(dosDate),
        toUint32(checksum),
        toUint32(entry.bytes.length),
        toUint32(entry.bytes.length),
        toUint16(nameBytes.length),
        toUint16(0),
        nameBytes,
      ]);

      localChunks.push(localHeader, entry.bytes);

      const centralHeader = concatUint8Arrays([
        toUint32(ZIP_SIGNATURES.centralDirectory),
        toUint16(20),
        toUint16(20),
        toUint16(0),
        toUint16(0),
        toUint16(dosTime),
        toUint16(dosDate),
        toUint32(checksum),
        toUint32(entry.bytes.length),
        toUint32(entry.bytes.length),
        toUint16(nameBytes.length),
        toUint16(0),
        toUint16(0),
        toUint16(0),
        toUint16(0),
        toUint32(0),
        toUint32(currentOffset),
        nameBytes,
      ]);

      centralChunks.push(centralHeader);
      currentOffset += localHeader.length + entry.bytes.length;
    }

    const localDirectory = concatUint8Arrays(localChunks);
    const centralDirectory = concatUint8Arrays(centralChunks);
    const endRecord = concatUint8Arrays([
      toUint32(ZIP_SIGNATURES.endOfCentralDirectory),
      toUint16(0),
      toUint16(0),
      toUint16(entries.length),
      toUint16(entries.length),
      toUint32(centralDirectory.length),
      toUint32(localDirectory.length),
      toUint16(0),
    ]);

    return new Blob([localDirectory, centralDirectory, endRecord], {
      type: "application/zip",
    });
  }

  async function createZipFromFiles(files) {
    const entries = [];

    for (const file of files) {
      try {
        const response = await fetch(file.url);
        const buffer = await response.arrayBuffer();
        entries.push({
          bytes: new Uint8Array(buffer),
          filename: file.filename,
        });
      } catch (_error) {
        // Skip files that are no longer reachable. ZIP export should still work
        // for any media that remains downloadable.
      }
    }

    if (!entries.length) {
      throw new Error("No files available for ZIP export");
    }

    const zipBlob = buildStoredZip(entries);
    const objectUrl = URL.createObjectURL(zipBlob);

    try {
      await chrome.downloads.download({
        url: objectUrl,
        filename: `SaveOneTimeIG_${Date.now()}.zip`,
        saveAs: true,
      });
    } finally {
      setTimeout(() => URL.revokeObjectURL(objectUrl), 10000);
    }
  }

  function openDesktopView(sendResponse) {
    chrome.tabs.query({ active: true, currentWindow: true })
      .then(([tab]) => {
        const sourceTabId = tab?.id;
        const popupUrl = chrome.runtime.getURL(`popup.html?desktop=1${sourceTabId ? `&tabId=${sourceTabId}` : ""}`);
        return chrome.tabs.create({ url: popupUrl });
      })
      .then(() => sendResponse({ success: true }))
      .catch((error) => sendResponse({ error: error.message, success: false }));
  }

  function downloadSingleFile(message, sendResponse) {
    chrome.downloads.download({
      url: message.url,
      filename: sanitizeFilename(message.filename),
      saveAs: false,
    })
      .then((downloadId) => sendResponse({ id: downloadId, success: true }))
      .catch((error) => sendResponse({ error: error.message, success: false }));
  }

  function handleMessage(message, _sender, sendResponse) {
    switch (message.action) {
      case "OPEN_DESKTOP_VIEW":
        openDesktopView(sendResponse);
        return true;
      case "DOWNLOAD_ZIP":
        createZipFromFiles(message.files)
          .then(() => sendResponse({ success: true }))
          .catch((error) => sendResponse({ error: error.message, success: false }));
        return true;
      case "DOWNLOAD_SINGLE":
        downloadSingleFile(message, sendResponse);
        return true;
      default:
        return false;
    }
  }

  chrome.runtime.onInstalled.addListener(() => {});
  chrome.runtime.onMessage.addListener(handleMessage);
})();
