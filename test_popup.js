// 临时冒烟测试: 用 Node VM 加载 popup.js, 验证正则过滤效果预览
'use strict';
const fs = require('fs');
const vm = require('vm');

function makeClassList() {
  const set = new Set();
  return {
    add(c) { set.add(c); },
    remove(c) { set.delete(c); },
    toggle(c, on) { if (on) set.add(c); else set.delete(c); },
    contains(c) { return set.has(c); },
  };
}

class FakeElement {
  constructor(tagName = 'div') {
    this.tagName = String(tagName || 'div').toUpperCase();
    this.children = [];
    this._text = '';
    this.className = '';
    this.classList = makeClassList();
    this.dataset = {};
    this.hidden = false;
  }
  get textContent() {
    return this._text;
  }
  set textContent(value) {
    this._text = value;
    if (value === '') {
      this.children = [];
    }
  }
  appendChild(child) {
    this.children.push(child);
    return child;
  }
  addEventListener() {}
  removeEventListener() {}
  querySelectorAll(selector) {
    if (selector === '.preview-item') {
      return this.children.filter((child) => child.className.split(' ').includes('preview-item'));
    }
    return [];
  }
}

const elements = {};
function register(id, extra = {}) {
  const el = Object.assign(new FakeElement('div'), extra);
  elements[id] = el;
  return el;
}

register('status-bar');
register('status-dot');
register('status-text');
register('preview-note');
register('preview-title');
register('preview-list');
register('preview-empty', { hidden: true });
register('master-toggle', { checked: true });
register('danmu-toggle', { checked: true });
register('danmu-regex');
register('btn-save');
register('btn-reset');
register('btn-gen-regex');

const document = {
  getElementById(id) { return elements[id]; },
  createElement(tagName) { return new FakeElement(tagName); },
  querySelectorAll() { return []; },
};

let activeTab = null;
const CONFIG_KEY = 'douyinFilterConfig';
const REAL_DANMU = ['广告了解一下', '扫码加微信', '主播唱得真好听'];

const chrome = {
  storage: {
    sync: {
      get(key, cb) { cb({ [key]: { enabled: true, danmuEnabled: true, danmuRegex: '广告' } }); },
      set(data, cb) { cb(); },
    },
    onChanged: { addListener() {} },
  },
  tabs: {
    query(query, cb) { cb(activeTab ? [{ id: 1 }] : []); },
    sendMessage(tabId, message, cb) {
      if (message.action === 'getStats') {
        cb({ action: 'stats', stats: { danmu: 1 }, danmuTexts: REAL_DANMU.slice() });
      } else {
        cb();
      }
    },
  },
  runtime: { lastError: null, onMessage: { addListener() {} } },
};

const sandbox = {
  chrome,
  document,
  console,
  setTimeout,
  clearTimeout,
};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync('popup.js', 'utf8'), sandbox);

const updatePreview = sandbox.updatePreview;
const refreshStats = sandbox.refreshStats;
const input = elements['danmu-regex'];
const note = elements['preview-note'];
const title = elements['preview-title'];
const list = elements['preview-list'];

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    console.error(`${message}: expected ${expected}, got ${actual}`);
    process.exit(1);
  }
}

function previewItemTexts() {
  return list.querySelectorAll('.preview-item').map((item) => item.children[0].textContent);
}

function previewBadges() {
  return list.querySelectorAll('.preview-item').map((item) => item.children[1].textContent);
}

// 初始加载：没有页面数据时使用示例弹幕，展示过滤效果而不是正则本身
assertEqual(input.value, '广告', 'load should fill input');
assertEqual(note.textContent, '示例中将过滤 1 / 6 条', 'fallback preview should show effect count');
assertEqual(note.textContent.includes('/广告/i'), false, 'preview note should not show regex');
assertEqual(title.textContent, '示例预览', 'fallback preview title');
assertEqual(list.querySelectorAll('.preview-item').length, 6, 'fallback preview item count');
assertEqual(previewItemTexts().includes('广告了解一下'), true, 'fallback sample rendered');
assertEqual(previewBadges().filter((badge) => badge === '过滤').length, 1, 'fallback hit badge count');

// 模拟从抖音页面拿到真实弹幕后的预览
activeTab = { id: 1 };
refreshStats();
assertEqual(note.textContent, '页面 3 条弹幕中将过滤 1 条', 'real preview effect count');
assertEqual(title.textContent, '将过滤的弹幕', 'real preview title');
assertEqual(previewItemTexts().length, 1, 'real preview shows only matched danmu');
assertEqual(previewItemTexts().includes('广告了解一下'), true, 'real preview matched text');
assertEqual(previewBadges().every((badge) => badge === '过滤'), true, 'real preview badges are all filtered');

// 修改正则后应实时更新命中的真实弹幕
input.value = '扫码|抽奖';
updatePreview();
assertEqual(note.textContent, '页面 3 条弹幕中将过滤 1 条', 'updated preview effect count');
assertEqual(previewItemTexts().join(','), '扫码加微信', 'updated preview matched text');

// 完整 /.../g 写法应原样保留，g 标志不会造成 lastIndex 残留
input.value = '/扫码/g';
updatePreview();
assertEqual(previewItemTexts().join(','), '扫码加微信', 'global regex should hit');
updatePreview();
assertEqual(previewItemTexts().join(','), '扫码加微信', 'global regex should hit again');

// 空输入：提示输入，示例全部标记为保留
input.value = '';
updatePreview();
assertEqual(note.textContent, '输入正则后展示将过滤的弹幕', 'empty input note');
assertEqual(previewBadges().every((badge) => badge === '保留'), true, 'empty input keeps samples');

// 非法正则：提示错误，所有示例标记为保留
input.value = '[';
updatePreview();
assertEqual(note.textContent, '正则格式不正确', 'invalid regex note');
assertEqual(note.classList.contains('error'), true, 'invalid note style');
assertEqual(previewBadges().every((badge) => badge === '保留'), true, 'invalid regex should not hit');

console.log('POPUP_TEST_OK');
