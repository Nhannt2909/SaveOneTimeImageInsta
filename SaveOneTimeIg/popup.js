(() => {
  const SELECTORS = {
    countBadge: "#count-badge",
    mediaGrid: "#media-grid",
    overlay: "#overlay",
    refreshButtons: "#refresh-page-btn, #header-refresh-btn",
    scanDescription: "#scan-description",
    scanDot: "#scan-dot",
    scanLabel: "#scan-label",
    sourceLabel: "#source-label",
    themeButton: "#theme-btn",
    toast: "#toast",
    toastMessage: "#toast-msg",
    version: "#app-version",
    zipButton: "#zip-btn",
  };

  const STATUS = {
    paused: "paused",
    scanning: "scanning",
  };

  const DM_URL_PATTERN = /instagram\.com\/direct\/t\//i;
  const MEDIA_URL_PATTERN = /https:\/\/[^"'\\\s]+?\.(?:jpe?g|png|gif|webp|mp4|webm)(?:\?[^"'\\\s]*)?/gi;
  const LEGACY_VIDEO_PATTERN = /https:\/\/video[^",\s]+/gi;
  const ALLOWED_MEDIA_HOST_PATTERN = /(?:fbcdn\.net|cdninstagram\.com)$/i;
  const STRONG_EPHEMERAL_MARKERS = [
    "view_mode",
    "is_view_once",
    "is_replayable",
    "raven_media",
    "visual_message",
    "direct_visual_message",
    "ephemeral_media",
  ];
  const SOFT_EPHEMERAL_MARKERS = [
    "view_once",
    "one_time",
    "ephemeral",
    "expiring",
    "replay_expiring",
    "disappearing_mode",
    "message_type",
    "visual_media",
  ];
  const EXCLUDED_CONTEXT_MARKERS = [
    "profile_pic_url",
    "avatar_url",
    "story_share",
    "broadcast",
    "preview_url",
    "thumbnail_src",
    "display_url",
  ];

  const elements = Object.fromEntries(
    Object.entries(SELECTORS).map(([key, selector]) => [key, document.querySelector(selector)])
  );

  const params = new URLSearchParams(window.location.search);
  const state = {
    activeTabId: null,
    desktopMode: params.get("desktop") === "1",
    media: new Map(),
    onDmPage: false,
    scanTimer: null,
    sourceTabId: Number(params.get("tabId")) || null,
    status: STATUS.scanning,
    toastTimer: null,
  };

  function escapeHtml(value) {
    return value.replace(/[&<>"']/g, (character) => {
      const entities = {
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      };
      return entities[character];
    });
  }

  function showToast(message, type = "success") {
    elements.toastMessage.textContent = message;
    elements.toast.classList.toggle("is-error", type === "error");
    elements.toast.classList.add("is-visible");

    clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(() => {
      elements.toast.classList.remove("is-visible");
    }, 2400);
  }

  function setStatus(status, description) {
    state.status = status;
    const isScanning = status === STATUS.scanning;

    elements.scanDot.className = `status-chip__dot ${isScanning ? "is-scanning" : "is-paused"}`;
    elements.scanLabel.textContent = isScanning ? "Scanning DM thread" : "Waiting for Instagram DM";
    elements.scanDescription.textContent = description;
  }

  function normalizeText(value) {
    return value.replace(/\\\\/g, "").replace(/\\\//g, "/").replace(/\/+$/g, "").trim();
  }

  function isSupportedMediaUrl(url) {
    try {
      return ALLOWED_MEDIA_HOST_PATTERN.test(new URL(url).hostname);
    } catch (_error) {
      return false;
    }
  }

  function getContextWindow(source, index, length, radius = 420) {
    const start = Math.max(0, index - radius);
    const end = Math.min(source.length, index + length + radius);
    return source.slice(start, end);
  }

  function countMatches(patterns, text) {
    const lowerText = text.toLowerCase();
    return patterns.reduce((count, pattern) => count + Number(lowerText.includes(pattern.toLowerCase())), 0);
  }

  function isEphemeralMediaCandidate(url, context) {
    if (!isSupportedMediaUrl(url)) {
      return false;
    }

    const lowerContext = context.toLowerCase();
    if (EXCLUDED_CONTEXT_MARKERS.some((marker) => lowerContext.includes(marker.toLowerCase()))) {
      return false;
    }

    const strongSignals = countMatches(STRONG_EPHEMERAL_MARKERS, context);
    if (strongSignals >= 1) {
      return true;
    }

    const softSignals = countMatches(SOFT_EPHEMERAL_MARKERS, context);
    return softSignals >= 2;
  }

  function getEphemeralWindows(html) {
    const windows = [];
    const normalizedMarkers = [...STRONG_EPHEMERAL_MARKERS, ...SOFT_EPHEMERAL_MARKERS];

    for (const marker of normalizedMarkers) {
      let fromIndex = 0;
      const lowerHtml = html.toLowerCase();
      const lowerMarker = marker.toLowerCase();

      while (fromIndex < lowerHtml.length) {
        const markerIndex = lowerHtml.indexOf(lowerMarker, fromIndex);
        if (markerIndex === -1) {
          break;
        }

        windows.push(getContextWindow(html, markerIndex, lowerMarker.length, 2800));
        fromIndex = markerIndex + lowerMarker.length;
      }
    }

    return windows;
  }

  function collectEphemeralMediaUrls(html) {
    const candidateUrls = new Set();
    const windows = getEphemeralWindows(html);

    for (const windowText of windows) {
      MEDIA_URL_PATTERN.lastIndex = 0;
      let match = null;

      while ((match = MEDIA_URL_PATTERN.exec(windowText)) !== null) {
        const url = match[0].replace(/\\+$/g, "");
        const localContext = getContextWindow(windowText, match.index, match[0].length, 240);

        if (isEphemeralMediaCandidate(url, localContext)) {
          candidateUrls.add(url);
        }
      }
    }

    if (!candidateUrls.size) {
      LEGACY_VIDEO_PATTERN.lastIndex = 0;
      let legacyMatch = null;

      while ((legacyMatch = LEGACY_VIDEO_PATTERN.exec(html)) !== null) {
        candidateUrls.add(legacyMatch[0].replace(/\\+$/g, ""));
      }
    }

    return candidateUrls;
  }

  function getFileExtension(url) {
    const cleanedUrl = url.split("?")[0].toLowerCase();
    if (cleanedUrl.endsWith(".mp4") || cleanedUrl.endsWith(".webm")) {
      return "video";
    }
    return "image";
  }

  function getFilenameFromUrl(url) {
    const lastSegment = url.split("/").pop()?.split("?")[0] || "instagram-media";
    let filename = lastSegment;

    try {
      filename = decodeURIComponent(lastSegment);
    } catch (_error) {
      filename = lastSegment;
    }

    if (/\.(jpg|jpeg|png|gif|webp|mp4|webm)$/i.test(filename)) {
      return filename;
    }

    return `${filename}.${getFileExtension(url) === "video" ? "mp4" : "jpeg"}`;
  }

  async function loadPreviewMedia(url, target) {
    try {
      const response = await fetch(url);
      const blob = await response.blob();
      target.src = URL.createObjectURL(blob);
    } catch (_error) {
      target.src = url;
    }
  }

  function updateHeaderState() {
    const mediaCount = state.media.size;
    elements.countBadge.textContent = `${mediaCount} item${mediaCount === 1 ? "" : "s"}`;
    elements.sourceLabel.textContent = state.onDmPage ? "Instagram DM" : "Unsupported page";
  }

  function createMediaCard(name, entry) {
    const card = document.createElement("article");
    const preview = document.createElement(entry.type === "video" ? "video" : "img");

    card.className = "media-card";
    card.dataset.name = name;

    preview.draggable = false;
    preview.oncontextmenu = () => false;

    if (entry.type === "video") {
      preview.muted = true;
      preview.autoplay = true;
      preview.loop = true;
      preview.playsInline = true;
    } else {
      preview.alt = name;
      preview.loading = "lazy";
    }

    loadPreviewMedia(entry.url, preview);
    card.appendChild(preview);

    card.insertAdjacentHTML(
      "beforeend",
      `
        <div class="media-card__overlay">
          <div class="media-card__meta">
            <span class="media-card__badge">${entry.type}</span>
            <div class="media-card__name">${escapeHtml(name)}</div>
          </div>
          <button class="download-button" type="button" title="Download media" aria-label="Download media">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M12 3v12"></path>
              <path d="m7 10 5 5 5-5"></path>
              <path d="M5 21h14"></path>
            </svg>
          </button>
        </div>
      `
    );

    return card;
  }

  function renderScanningState() {
    elements.mediaGrid.innerHTML = `
      <section class="scan-state">
        <div class="scan-state__icon" aria-hidden="true">
          <div class="scan-state__spinner"></div>
        </div>
        <h3>Scanning the conversation</h3>
        <p>Keep the Instagram DM thread open. SaveOneTime will keep checking for view-once media every few seconds.</p>
      </section>
    `;
  }

  function renderEmptyState() {
    elements.mediaGrid.innerHTML = `
      <section class="empty-state">
        <div class="empty-state__icon" aria-hidden="true">!</div>
        <h3>Open a DM thread first</h3>
        <p>This popup only works on Instagram direct message threads. Open a conversation that contains one-time media, then rescan.</p>
        <button id="empty-refresh-btn" class="empty-action" type="button">Reload current tab</button>
      </section>
    `;
  }

  function renderMediaGrid() {
    if (!state.onDmPage) {
      renderEmptyState();
      return;
    }

    if (!state.media.size) {
      renderScanningState();
      return;
    }

    const fragment = document.createDocumentFragment();
    const orderedEntries = Array.from(state.media.entries()).reverse();

    for (const [name, entry] of orderedEntries) {
      fragment.appendChild(createMediaCard(name, entry));
    }

    elements.mediaGrid.innerHTML = "";
    elements.mediaGrid.appendChild(fragment);
  }

  async function getTargetTab() {
    if (state.sourceTabId) {
      return chrome.tabs.get(state.sourceTabId).catch(() => null);
    }

    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return activeTab ?? null;
  }

  async function scanActiveTab() {
    try {
      const tab = await getTargetTab();
      if (!tab?.id) {
        setStatus(STATUS.paused, "Unable to locate the source tab.");
        renderMediaGrid();
        return;
      }

      state.activeTabId = tab.id;
      state.onDmPage = DM_URL_PATTERN.test(tab.url || "");

      if (!state.onDmPage) {
        setStatus(STATUS.paused, "Open an Instagram DM thread to detect one-time media.");
        updateHeaderState();
        renderMediaGrid();
        return;
      }

      setStatus(STATUS.scanning, "Looking for one-time Instagram media in the active tab.");

      const [{ result: pageHtml }] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => document.documentElement.outerHTML,
      });

      const normalizedHtml = pageHtml
        .split("\n")
        .filter(Boolean)
        .map(normalizeText)
        .join("\n");

      const existingUrls = new Set(Array.from(state.media.values(), (entry) => entry.url));
      const ephemeralUrls = collectEphemeralMediaUrls(normalizedHtml);
      let foundNewMedia = false;

      for (const url of ephemeralUrls) {
        if (existingUrls.has(url)) {
          continue;
        }

        const filename = getFilenameFromUrl(url);
        if (state.media.has(filename)) {
          continue;
        }

        state.media.set(filename, {
          type: getFileExtension(url),
          url,
        });
        existingUrls.add(url);
        foundNewMedia = true;
      }

      if (foundNewMedia) {
        showToast("New media found");
      }

      updateHeaderState();
      renderMediaGrid();
    } catch (_error) {
      setStatus(STATUS.paused, "Unable to scan the current page.");
      showToast("Unable to scan this page", "error");
      updateHeaderState();
      renderMediaGrid();
    }
  }

  async function requestDownload(url, filename) {
    showToast(`Downloading media...`);
    try {
      const response = await fetch(url);
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);

      chrome.downloads.download({
        url: objectUrl,
        filename: filename,
        saveAs: false,
      }, (downloadId) => {
        if (chrome.runtime.lastError || !downloadId) {
          showToast("Download failed", "error");
        } else {
          showToast("Download started");
        }
      });
    } catch (_error) {
      showToast("Download failed", "error");
    }
  }

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
        toUint16(20), toUint16(0), toUint16(0),
        toUint16(dosTime), toUint16(dosDate),
        toUint32(checksum), toUint32(entry.bytes.length), toUint32(entry.bytes.length),
        toUint16(nameBytes.length), toUint16(0),
        nameBytes,
      ]);

      localChunks.push(localHeader, entry.bytes);

      const centralHeader = concatUint8Arrays([
        toUint32(ZIP_SIGNATURES.centralDirectory),
        toUint16(20), toUint16(20), toUint16(0), toUint16(0),
        toUint16(dosTime), toUint16(dosDate),
        toUint32(checksum), toUint32(entry.bytes.length), toUint32(entry.bytes.length),
        toUint16(nameBytes.length), toUint16(0), toUint16(0), toUint16(0), toUint16(0),
        toUint32(0), toUint32(currentOffset),
        nameBytes,
      ]);

      centralChunks.push(centralHeader);
      currentOffset += localHeader.length + entry.bytes.length;
    }

    const localDirectory = concatUint8Arrays(localChunks);
    const centralDirectory = concatUint8Arrays(centralChunks);
    const endRecord = concatUint8Arrays([
      toUint32(ZIP_SIGNATURES.endOfCentralDirectory),
      toUint16(0), toUint16(0),
      toUint16(entries.length), toUint16(entries.length),
      toUint32(centralDirectory.length), toUint32(localDirectory.length),
      toUint16(0),
    ]);

    return new Blob([localDirectory, centralDirectory, endRecord], { type: "application/zip" });
  }

  async function requestZipDownload() {
    if (!state.media.size) {
      showToast("No media available to zip", "error");
      return;
    }

    const files = Array.from(state.media.entries(), ([filename, entry]) => ({
      filename,
      url: entry.url,
    }));

    showToast("Preparing ZIP (keep popup open)...");

    try {
      const entries = [];
      for (const file of files) {
        try {
          const response = await fetch(file.url);
          const buffer = await response.arrayBuffer();
          entries.push({
            bytes: new Uint8Array(buffer),
            filename: file.filename,
          });
          showToast("push to array success");
        } catch (_error) {
          showToast("push to array fail");
          chrome.extension.getBackgroundPage().console.log("fail push");
          await delay(5000);
        }
      }

      if (!entries.length) {
        throw new Error("No files available for ZIP export");
      }
      const zipBlob = buildStoredZip(entries);
      const url = URL.createObjectURL(zipBlob);

      chrome.downloads.download({
        url: url,
        filename: `SaveOneTime_${Date.now()}.zip`,
        saveAs: true,
      }, () => {
        if (chrome.runtime.lastError) {
          showToast("ZIP download failed", "error");
        } else {
          showToast("ZIP download started");
        }
      });
    } catch (error) {
      chrome.extension.getBackgroundPage().console.log("fail biuld");
      showToast("ZIP download failed", "error");
    }
    showToast("ZIP download success");
  }

  function openOverlay(cardName) {
    const entry = state.media.get(cardName);
    if (!entry) {
      return;
    }

    const preview = document.createElement(entry.type === "video" ? "video" : "img");
    const wrapper = document.createElement("div");

    wrapper.className = "overlay__panel";
    preview.draggable = false;
    preview.oncontextmenu = (event) => {
      event.preventDefault();
      return false;
    };

    if (entry.type === "video") {
      preview.controls = true;
      preview.autoplay = true;
      preview.muted = false;
      preview.loop = false;
      preview.playsInline = true;
    } else {
      preview.alt = cardName;
    }

    loadPreviewMedia(entry.url, preview);
    wrapper.appendChild(preview);

    const downloadBtn = document.createElement("button");
    downloadBtn.type = "button";
    downloadBtn.title = "Download media";
    downloadBtn.innerHTML = `
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M12 3v12"></path>
        <path d="m7 10 5 5 5-5"></path>
        <path d="M5 21h14"></path>
      </svg>
      <span>Download</span>
    `;
    downloadBtn.style.cssText = "position: absolute; bottom: 24px; right: 24px; background: rgba(0, 0, 0, 0.75); color: #fff; border: 1px solid rgba(255, 255, 255, 0.2); border-radius: 8px; padding: 8px 16px; display: flex; align-items: center; gap: 8px; font-weight: 500; font-family: inherit; font-size: 14px; cursor: pointer; backdrop-filter: blur(8px); z-index: 1000;";

    downloadBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      requestDownload(entry.url, getFilenameFromUrl(entry.url));
    });

    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.title = "Close preview";
    closeBtn.innerHTML = `
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M18 6L6 18"></path>
        <path d="M6 6l12 12"></path>
      </svg>
    `;
    closeBtn.style.cssText = "position: absolute; top: 24px; right: 24px; background: rgba(0, 0, 0, 0.75); color: #fff; border: 1px solid rgba(255, 255, 255, 0.2); border-radius: 50%; width: 40px; height: 40px; display: flex; align-items: center; justify-content: center; cursor: pointer; backdrop-filter: blur(8px); z-index: 1000;";

    closeBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      closeOverlay();
    });

    elements.overlay.innerHTML = "";
    elements.overlay.appendChild(wrapper);
    elements.overlay.appendChild(downloadBtn);
    elements.overlay.appendChild(closeBtn);
    elements.overlay.classList.add("is-active");
    elements.overlay.setAttribute("aria-hidden", "false");
  }

  function closeOverlay() {
    elements.overlay.classList.remove("is-active");
    elements.overlay.setAttribute("aria-hidden", "true");

    window.setTimeout(() => {
      if (!elements.overlay.classList.contains("is-active")) {
        elements.overlay.innerHTML = "";
      }
    }, 180);
  }

  function reloadActiveTab() {
    if (!state.activeTabId) {
      return;
    }

    chrome.tabs.reload(state.activeTabId);
    showToast("Reloading current tab");
  }

  function applyTheme() {
    const savedTheme = localStorage.getItem("theme") || "dark";
    document.body.classList.toggle("light", savedTheme === "light");
  }

  function toggleTheme() {
    const nextTheme = document.body.classList.contains("light") ? "dark" : "light";
    localStorage.setItem("theme", nextTheme);
    applyTheme();
  }

  function bindEvents() {
    document.addEventListener("contextmenu", (event) => {
      if (event.target.closest(".media-card") || event.target.closest(".overlay")) {
        event.preventDefault();
      }
    });

    document.addEventListener("dragstart", (event) => {
      if (event.target.closest(".media-card")) {
        event.preventDefault();
      }
    });

    document.addEventListener("click", (event) => {
      const downloadButton = event.target.closest(".download-button");
      if (downloadButton) {
        event.stopPropagation();
        const card = downloadButton.closest(".media-card");
        const entry = card ? state.media.get(card.dataset.name) : null;
        if (entry) {
          requestDownload(entry.url, getFilenameFromUrl(entry.url));
        }
        return;
      }

      const clickedCard = event.target.closest(".media-card");
      if (clickedCard) {
        openOverlay(clickedCard.dataset.name);
        return;
      }

      if (event.target === elements.overlay) {
        closeOverlay();
        return;
      }

      if (event.target.closest(SELECTORS.refreshButtons)) {
        reloadActiveTab();
        return;
      }

      if (event.target.id === "empty-refresh-btn") {
        reloadActiveTab();
      }
    });

    elements.themeButton.addEventListener("click", toggleTheme);
    elements.zipButton.addEventListener("click", requestZipDownload);

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        closeOverlay();
      }
    });
  }

  async function init() {
    applyTheme();

    if (state.desktopMode) {
      document.body.classList.add("desktop");
    }

    elements.version.textContent = "v1.0";
    updateHeaderState();
    bindEvents();
    renderMediaGrid();
    await scanActiveTab();
    state.scanTimer = window.setInterval(scanActiveTab, 3000);
  }

  window.addEventListener("unload", () => {
    if (state.scanTimer) {
      window.clearInterval(state.scanTimer);
    }
  });

  init();
})();
