(() => {
  const BADGE_ID = "SaveOneTimeIG-inbox-badge";
  const INBOX_PATH = "/direct/inbox/";
  const THREAD_PATH = /^\/direct\/t\/[^/]+\/?$/;

  function isSupportedPath(pathname = window.location.pathname) {
    return pathname === INBOX_PATH || THREAD_PATH.test(pathname);
  }

  function removeBadge() {
    document.getElementById(BADGE_ID)?.remove();
  }

  function createBadge() {
    const badge = document.createElement("button");
    const icon = document.createElement("img");

    badge.id = BADGE_ID;
    badge.type = "button";
    badge.title = "Open SaveOneTimeIG desktop view";
    badge.setAttribute("aria-label", "Open SaveOneTimeIG desktop view");

    icon.src = chrome.runtime.getURL("icon.png");
    icon.alt = "SaveOneTimeIG";

    badge.appendChild(icon);
    badge.addEventListener("click", () => {
      chrome.runtime.sendMessage({ action: "OPEN_DESKTOP_VIEW" });
    });

    return badge;
  }

  function ensureBadge() {
    if (!isSupportedPath()) {
      removeBadge();
      return;
    }

    if (!document.getElementById(BADGE_ID)) {
      document.body.appendChild(createBadge());
    }
  }

  const style = document.createElement("style");
  style.textContent = `
    #${BADGE_ID} {
      position: fixed;
      left: 18px;
      bottom: 18px;
      width: 48px;
      height: 48px;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 0;
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 16px;
      background: rgba(0, 0, 0, 0.88);
      box-shadow: 0 18px 36px rgba(0, 0, 0, 0.28);
      backdrop-filter: blur(12px);
      cursor: pointer;
      z-index: 2147483647;
    }

    #${BADGE_ID}:hover {
      transform: translateY(-1px);
    }

    #${BADGE_ID} img {
      width: 24px;
      height: 24px;
      display: block;
      pointer-events: none;
    }
  `;

  document.documentElement.appendChild(style);

  let previousPath = window.location.pathname;
  setInterval(() => {
    if (window.location.pathname !== previousPath) {
      previousPath = window.location.pathname;
      ensureBadge();
    }
  }, 500);

  new MutationObserver(() => {
    ensureBadge();
  }).observe(document.documentElement, { childList: true, subtree: true });

  ensureBadge();
})();
