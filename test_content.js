// 临时冒烟测试: 用 Node VM 加载 content.js, 验证弹幕过滤逻辑
'use strict';
const fs = require('fs');
const vm = require('vm');

// 与 sandbox 中 content.js 使用的 Element 保持同一个构造函数
class FakeElement {}
const Element = FakeElement;

function makeElement({ tagName = 'div', className = '', text = '' } = {}) {
  const spans = [];
  const subEls = [];
  const el = Object.assign(Object.create(Element.prototype), {
    nodeType: 1,
    tagName: tagName.toUpperCase(),
    className,
    parent: null,
    _text: text,
    _spans: spans,
    _subEls: subEls,
    style: { _map: {} },
    _isBody: false,
  });
  el._test = (selector) => {
    if (selector === 'span') return el.tagName === 'SPAN';
    if (selector.includes('danMuText')) return el.className.includes('danMuText');
    return false;
  };
  Object.defineProperty(el, 'textContent', {
    get() {
      const parts = [el._text];
      for (const s of el._spans) parts.push(s.textContent);
      for (const s of el._subEls) parts.push(s.textContent);
      return parts.join('');
    },
    set(v) { el._text = v; },
  });
  el.matches = (selector) => el._test(selector);
  el.querySelector = (selector) => el._spans.find((s) => s._test(selector)) || null;
  el.querySelectorAll = (selector) => {
    const hits = [];
    if (el._isBody) {
      body._flat.forEach((n) => {
        if (n._test(selector)) hits.push(n);
      });
    } else {
      for (const n of el._spans) if (n._test(selector)) hits.push(n);
      for (const n of el._subEls) hits.push(...n.querySelectorAll(selector));
    }
    return hits;
  };
  el.closest = (selector) => {
    let cur = el;
    while (cur) {
      if (cur._test && cur._test(selector)) return cur;
      cur = cur.parent;
    }
    return null;
  };
  el.style.setProperty = (name, value) => { el.style._map[name] = value; };
  el.style.removeProperty = (name) => { delete el.style._map[name]; };
  el.appendChild = (child) => {
    child.parent = el;
    (child.tagName === 'SPAN' ? el._spans : el._subEls).push(child);
  };
  return el;
}

function makeSpan(text) {
  const s = makeElement({ tagName: 'span', text });
  s.textContent = text;
  return s;
}

// 构造 body + 弹幕
const body = makeElement({ tagName: 'body' });
body._isBody = true;
body._flat = [];

const danmu1 = makeElement({ className: 'pCpu7utj danMuText' });
danmu1.appendChild(makeSpan('爆破装置已部署'));
const danmu2 = makeElement({ className: 'pCpu7utj danMuText' });
danmu2.appendChild(makeSpan('拉链袋好直白的翻译'));
body.appendChild(danmu1);
body.appendChild(danmu2);

// 注册到 flat 列表中
function flatten(node) {
  body._flat.push(node);
  for (const c of [...node._spans, ...node._subEls]) flatten(c);
}
flatten(body);

// 捕获 MutationObserver / 消息 / 存储变更回调，用于模拟页面行为
let observerInstance = null;
let onMessageHandler = null;
let onChangedHandler = null;
const CONFIG_KEY = 'douyinFilterConfig';

// fake chrome API
const chrome = {
  storage: {
    sync: {
      get(key, cb) { cb({ [key]: { enabled: true, danmuEnabled: true, danmuRegex: '爆破装置' } }); },
    },
    onChanged: { addListener(fn) { onChangedHandler = fn; } },
  },
  runtime: { onMessage: { addListener(fn) { onMessageHandler = fn; } } },
};

const Observer = class {
  constructor(cb) { this.cb = cb; observerInstance = this; }
  observe() {}
  disconnect() {}
};

const sandbox = {
  chrome,
  Node: { ELEMENT_NODE: 1 },
  Element,
  MutationObserver: Observer,
  setInterval() {},
  setTimeout,
  clearTimeout,
  document: {
    body,
    querySelectorAll: (selector) => {
      const hits = [];
      for (const n of body._flat) if (n._test(selector)) hits.push(n);
      return hits;
    },
    addEventListener() {},
  },
  location: { href: 'https://www.douyin.com/' },
  console,
};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync('content.js', 'utf8'), sandbox);

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    console.error(`${message}: expected ${expected}, got ${actual}`);
    process.exit(1);
  }
}

function getStatsResponse() {
  let response = null;
  onMessageHandler({ action: 'getStats' }, null, (res) => { response = res; });
  return response;
}

function setConfig(overrides) {
  onChangedHandler({ [CONFIG_KEY]: { newValue: Object.assign({ enabled: true, danmuEnabled: true, danmuRegex: '爆破装置' }, overrides) } }, 'sync');
}

// 断言初始过滤结果
assertEqual(danmu1.style._map['display'], 'none', 'danmu1 should hide');
assertEqual(danmu2.style._map['display'], '', 'danmu2 should stay visible');
const initialResponse = getStatsResponse();
assertEqual(initialResponse.stats.danmu, 1, 'initial stats danmu count');
assertEqual(initialResponse.danmuTexts.length, 2, 'initial preview texts count');
assertEqual(initialResponse.danmuTexts.includes('爆破装置已部署'), true, 'initial preview text 1');
assertEqual(initialResponse.danmuTexts.includes('拉链袋好直白的翻译'), true, 'initial preview text 2');

// 模拟无限滚动：新增弹幕
const danmu3 = makeElement({ className: 'pCpu7utj danMuText' });
danmu3.appendChild(makeSpan('爆破装置再部署'));
body.appendChild(danmu3);
flatten(danmu3);

// 触发 MutationObserver，等待防抖后应处理“节点自身就是弹幕”的情况
observerInstance.cb([{ type: 'childList', addedNodes: [danmu3] }]);
setTimeout(() => {
  assertEqual(danmu3.style._map['display'], 'none', 'dynamic danmu should hide');
  const dynamicResponse = getStatsResponse();
  assertEqual(dynamicResponse.stats.danmu, 2, 'dynamic stats danmu count');
  assertEqual(dynamicResponse.danmuTexts.includes('爆破装置再部署'), true, 'dynamic preview text');
  assertEqual(dynamicResponse.danmuTexts.length, 3, 'dynamic preview texts count');

  // 关闭弹幕过滤：弹幕恢复，统计归零
  setConfig({ danmuEnabled: false });
  assertEqual(danmu1.style._map['display'], '', 'danmu toggle off should restore danmu1');
  assertEqual(danmu3.style._map['display'], '', 'danmu toggle off should restore danmu3');
  assertEqual(getStatsResponse().stats.danmu, 0, 'danmu toggle off resets stats');

  // 关闭总开关：所有弹幕保持可见
  setConfig({ enabled: false });
  assertEqual(danmu1.style._map['display'], '', 'master off should keep danmu1 visible');
  assertEqual(danmu3.style._map['display'], '', 'master off should keep danmu3 visible');

  console.log('FILTER_TEST_OK');
}, 60);
