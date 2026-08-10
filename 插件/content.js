// 抖音网页版弹幕过滤脚本（Manifest V3 content script）
// 功能：
//   1. 通过固定类名 danMuText 定位弹幕容器，按正则隐藏匹配的弹幕
//   2. 使用 MutationObserver 监听动态新增的弹幕，实现实时过滤
//   3. 记录过滤统计，供 popup 状态栏展示
//   3. 记录过滤统计与最近弹幕文本，供 popup 状态栏和效果预览展示

"use strict";

const CONFIG_KEY = "douyinFilterConfig";

// ---------------- 配置 ----------------

const DEFAULT_CONFIG = {
  enabled: true,
  danmuEnabled: true,
  danmuRegex: "",
};

// 当前生效配置，包含编译好的 RegExp 与原始字符串
const config = {
  enabled: true,
  danmuEnabled: true,
  danmuRegex: "",
  danmuPattern: null,
};

// 为了在无限滚动中不反复扫描同一元素，用 WeakSet 记录已处理弹幕
let processedDanmu = new WeakSet();

// 统计当前页面实际过滤的弹幕数量，供 popup 展示
let filterStats = { danmu: 0 };

// 供 popup 实时预览用的最近弹幕文本（去重并限制数量）
const MAX_PREVIEW_DANMU = 200;
let danmuTexts = [];
let danmuTextSet = new Set();

// WeakSet 没有 clear()，需要重置时直接换新集合
function resetProcessedSets() {
  processedDanmu = new WeakSet();
}

// 记录一条页面弹幕文本，供 popup 展示过滤效果
function rememberDanmu(text) {
  const clean = String(text || "").trim();
  if (!clean || danmuTextSet.has(clean)) {
    return;
  }
  danmuTextSet.add(clean);
  danmuTexts.push(clean);
  if (danmuTexts.length > MAX_PREVIEW_DANMU) {
    const removed = danmuTexts.shift();
    danmuTextSet.delete(removed);
  }
}

// MutationObserver 的观察者实例
let bodyObserver = null;

// 待处理的新增节点与防抖定时器
let pendingRoots = new Set();
let debounceTimer = null;

// ---------------- 正则工具 ----------------

// 把用户输入编译为正则：
// 普通文本（如 "广告"）   -> /广告/i
// 完整写法（如 "/广告/g"）-> /广告/g，保留用户指定的 flags
// 空输入 -> null；格式错误返回一个永不匹配的正则（避免干扰其他过滤项）
function compileRegex(text) {
  const source = String(text || "").trim();
  if (!source) {
    return null;
  }

  // 识别 /pattern/flags 完整写法
  if (source.startsWith("/")) {
    const lastSlash = source.lastIndexOf("/");
    if (lastSlash > 0) {
      const pattern = source.slice(1, lastSlash);
      const flags = source.slice(lastSlash + 1);
      if (/^[dgimsuvy]*$/.test(flags)) {
        try {
          return new RegExp(pattern, flags);
        } catch (err) {
          return NEVER_MATCH;
        }
      }
    }
  }

  try {
    return new RegExp(source, "i");
  } catch (err) {
    return NEVER_MATCH;
  }
}

// 永远不会匹配的正则，用于兜底非法输入
const NEVER_MATCH = /(?!)/;

// 安全执行 test：带 g/y 标志的正则 lastIndex 会残留，测试前先复位
function testRegex(regex, text) {
  if (!regex) {
    return false;
  }
  if (regex.global || regex.sticky) {
    regex.lastIndex = 0;
  }
  return regex.test(text);
}

// ---------------- 弹幕过滤 ----------------

// 弹幕容器的固定类名：danMuText
// 实际 DOM 结构：<div class="pCpu7utj danMuText"><span>文本</span></div>
const DANMU_SELECTOR = '[class*="danMuText"]';

// 判断元素自身是否匹配选择器（document 等非元素节点直接返回 false）
function matchesSelector(node, selector) {
  return (
    node instanceof Element &&
    typeof node.matches === "function" &&
    node.matches(selector)
  );
}

// 过滤一棵子树里的弹幕（text 优先用容器内的第一个 span）
function applyDanmuToSubtree(root) {
  const danmuNodes = [];

  // 新增节点自身可能就是一条弹幕
  if (matchesSelector(root, DANMU_SELECTOR)) {
    danmuNodes.push(root);
  }
  danmuNodes.push(...root.querySelectorAll(DANMU_SELECTOR));

  for (const node of danmuNodes) {
    if (processedDanmu.has(node)) {
      continue;
    }

    const textNode = node.querySelector("span");
    const text = (textNode ? textNode.textContent : node.textContent) || "";

    // 无论开关状态都先收集文本，保证 popup 预览有真实弹幕可用
    rememberDanmu(text);

    const shouldHide =
      config.enabled && config.danmuEnabled && testRegex(config.danmuPattern, text);

    // 隐藏后用 !important 覆盖抖音自己的样式；恢复时直接清空
    node.style.setProperty("display", shouldHide ? "none" : "", "important");
    if (shouldHide) {
      filterStats.danmu += 1;
    }
    processedDanmu.add(node);
  }
}

// ---------------- 设置更新 ----------------

// 把存储里的配置写入 config，并编译正则
function applyConfigFromStorage(stored) {
  const cfg = Object.assign({}, DEFAULT_CONFIG, stored || {});
  config.enabled = !!cfg.enabled;
  config.danmuEnabled = cfg.danmuEnabled !== false;
  config.danmuRegex = String(cfg.danmuRegex || "");
  config.danmuPattern = compileRegex(config.danmuRegex);
}

// ---------------- 生命周期 ----------------

// 处理一棵子树：只处理弹幕
function processSubtree(root) {
  applyDanmuToSubtree(root);
}


// 全量应用过滤：
// force = true 时清空已处理标记、统计与预览文本，立即重扫
function applyFilters(force) {
  if (force) {
    filterStats = { danmu: 0 };
    danmuTexts = [];
    danmuTextSet = new Set();
    resetProcessedSets();
  }

  // 扫描全页：隐藏逻辑按当前开关状态执行，同时重新收集弹幕文本供预览
  applyDanmuToSubtree(document);
}

// 监听新增节点：body 子树变化，只关注 childList
function startObserver() {
  if (bodyObserver) {
    return;
  }

  bodyObserver = new MutationObserver((mutations) => {
    // 合并多次回调里的新增节点，统一处理后能减少重复扫描
    for (const mutation of mutations) {
      if (mutation.type !== "childList") {
        continue;
      }
      for (const node of mutation.addedNodes) {
        if (node instanceof Element) {
          pendingRoots.add(node);
        }
      }
    }

    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      for (const root of pendingRoots) {
        processSubtree(root);
      }
      pendingRoots.clear();
    }, 30);
  });

  bodyObserver.observe(document.body, { childList: true, subtree: true });
}

// 抖音是单页应用，切换页面时 location.href 会变但 document 不重新加载，需要重建观察
let lastUrl = location.href;
function watchUrlChange() {
  setInterval(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      if (bodyObserver) {
        clearTimeout(debounceTimer);
        pendingRoots.clear();
        bodyObserver.disconnect();
        bodyObserver = null;
      }
      applyFilters(true);
      startObserver();
    }
  }, 1000);
}

// 接收 popup 发来的消息：查询统计或重新加载设置
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message && message.action === "getStats") {
    sendResponse({
      action: "stats",
      stats: Object.assign({}, filterStats),
      danmuTexts: danmuTexts.slice(),
    });
    return;
  }

  if (message && message.action === "reloadSettings") {
    chrome.storage.sync.get(CONFIG_KEY, (result) => {
      applyConfigFromStorage(result && result[CONFIG_KEY]);
      applyFilters(true);
    });
  }
});

// 其他标签页/设备修改设置时也会自动同步
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "sync" && changes[CONFIG_KEY]) {
    applyConfigFromStorage(changes[CONFIG_KEY].newValue);
    applyFilters(true);
  }
});

// 初始化：读取设置 -> 全量过滤 -> 开始监听
function init() {
  chrome.storage.sync.get(CONFIG_KEY, (result) => {
    applyConfigFromStorage(result && result[CONFIG_KEY]);
    applyFilters(true);
    startObserver();
    watchUrlChange();
  });
}

// document_idle 时 body 一定存在，此处只做一道保险
if (document.body) {
  init();
} else {
  document.addEventListener("DOMContentLoaded", init, { once: true });
}
