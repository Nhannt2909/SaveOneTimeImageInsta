# SaveOneTimeIg

**SaveOneTimeIg** is a browser extension that allows users to seamlessly view, capture, and download "one-time view" media (photos and videos) sent in Instagram Direct Messages, Facebook Messages, and Messenger before they disappear.

## Features

- **Media Detection:** Automatically scans active Instagram and Facebook DM threads for incoming media content.
- **One-Time Viewer:** Previews one-time view media directly in the extension's popup without notifying the sender or expiring the message.
- **Download Individual Media:** Gives you the ability to download any intercepted photo or video directly to your local machine.
- **Download All (ZIP Feature):** Download all detected media files from the chat simultaneously packaged conveniently into a single ZIP file.
- **Light/Dark Theme:** A slick, modern user interface that includes a toggleable light and dark mode.
- **Rescan Functionality:** Need to refresh or check for new media? The extension offers a convenient way to rescan the page instantly.

## How It Works

The extension operates by injecting content scripts and utilizing background service workers to capture media streams securely. It listens for web requests originating from Instagram and Facebook Direct Messages and saves the direct media URLs into your session so you can preview and download them using the popup UI.

## Installation (Developer Mode)

1. Clone or download this repository to your local machine.
2. Open your preferred Chromium-based browser (Google Chrome, Microsoft Edge, Brave, etc.).
3. Navigate to the extensions page (type `chrome://extensions/` or `edge://extensions/` in your address bar).
4. Enable **Developer mode** (usually a toggle switch located in the top right corner).
5. Click on **Load unpacked**.
6. Select the folder containing this project's code.
7. The extension icon will now appear in your browser toolbar!

## Usage

1. Go to [Instagram](https://www.instagram.com), [Facebook](https://www.facebook.com/messages/), or [Messenger](https://www.messenger.com) and open a Direct Message conversation containing one-time media.
2. Click the **SaveOneTimeIg** extension icon in your browser toolbar.
3. The popup will display all detected media from the chat.
4. Click on any media card to preview it.
5. Click the download icon on a specific card, or select the **Download ZIP** button from the header to save everything at once.

## Project Structure

- `manifest.json`: Configuration and metadata for the Chrome extension (Manifest V3).
- `background.js`: Service worker running in the background to handle interception logic and coordinate between components.
- `content.js`: Script injected into Instagram and Facebook's page context.
- `popup.html` / `popup.js` / `style.css`: The frontend UI of the extension popup.
- `icon.png`: Application icon.

## Permissions Required
- `activeTab` & `scripting`: Required to scan the DOM and communicate with the active Instagram tab.
- `downloads`: Necessary to download files to your local system and generate ZIP files.
- `storage`: Used to persist application state and settings (like the dark/light theme).
- `host_permissions`: Scoped to Instagram, Facebook, Messenger, and associated CDN domains to ensure accurate media interception.

## Disclaimer

This extension is meant for educational purposes. Please respect user privacy and do not distribute people's private media without their explicitly given consent.
