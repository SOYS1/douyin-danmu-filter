# Douyin Purifier

A Chrome extension (Manifest V3) that filters danmaku comments on the Douyin web player using regular expressions. Filtered comments are hidden in real time, and changes take effect immediately after saving. Settings are synced across tabs and devices through `chrome.storage.sync`.

[中文](README.md)

## Features

- Real-time filtering: a `MutationObserver` watches newly added DOM nodes, so comments loaded during infinite scrolling are handled as soon as they appear
- Regex rules: plain text is matched case-insensitively, and full `/pattern/flags` syntax is also supported
- Preview: the popup shows which comments would be filtered — **full text with no truncation, duplicate comments merged**; it prefers real comments from the current page and falls back to sample comments when no page data is available
- Status and stats: shows how many comments have been filtered on the current page, with a master switch and a separate danmaku switch
- Settings sync: saved settings apply immediately, and sync automatically to other open Douyin tabs and other devices on the same account
- SPA support: the observer is recreated and the page rescanned when Douyin navigates to a new route
- **Regex Generator**: a built-in three-step tool that suggests shield words from your input danmaku, lets you confirm them with clicks, previews the regex live, and writes it straight into extension storage — supports both dark and light color schemes

## Files

| File | Description |
| --- | --- |
| `manifest.json` | Extension manifest with permissions and injection scope |
| `content.js` | Content script that filters danmaku, tracks stats, and observes dynamic content |
| `popup.html` | Settings popup UI (dark theme) |
| `popup.js` | Popup logic for loading, validating, and saving settings plus preview rendering |
| `generator.html` | Regex generator page (dark/light theme support) |
| `generator_app.js` | Generator UI interaction logic |
| `generator_styles.css` | Generator styles (dark theme) |
| `core.js` | Shared core logic (regex compilation, candidate suggestions, match testing) |

## Installation

1. Open `chrome://extensions` (or `edge://extensions` in Microsoft Edge)
2. Enable Developer Mode in the top-right corner
3. Click "Load unpacked"
4. Select this project directory
5. Open the Douyin web player at `https://www.douyin.com`

## Usage

### Basic Filtering

1. Click the Douyin Purifier icon in the browser toolbar
2. Enter a regular expression, for example `广告|推广|抽奖|扫码`
3. Click "Save Settings"; filtering takes effect immediately

### Regex Generator

1. Click the "生成正则" button in the popup
2. In the generator\'s "Input Danmaku" step, enter:
   - **Positive danmaku**: comments you want to block (one per line)
   - **Negative danmaku** (whitelist): comments that should always pass (one per line)
3. Click "Load Danmaku", then in the "Confirm Shield Words" step click characters to pick words; the tool also suggests common substrings
4. In the "Regex & Test" step preview the real-time match results
5. Click "Fill into Douyin Purifier Settings" to write the generated regex directly into extension storage
6. Close the generator tab and return to the popup to save

### Regex syntax

| Input | Meaning |
| --- | --- |
| `广告` | Matches comments containing "广告", case-insensitive |
| `广告\|推广` | Matches "广告" or "推广" |
| `/广告/g` | Full regex syntax with the flags you specify |

- Leave the field empty to disable danmaku filtering
- Supported flags in full syntax: `d`, `g`, `i`, `m`, `s`, `u`, `v`, `y`
- Invalid regular expressions never match anything and do not affect other filtering behavior


## Permissions

- `storage`: stores and syncs filter settings
- `activeTab`: sends settings updates and stats requests to the Douyin page in the current tab

The content script is injected only into `*.douyin.com/*` pages and does not run on any other website.
