// 设置面板逻辑：读取、校验、保存设置，并通知 content.js 实时生效。
"use strict";

const CONFIG_KEY = "douyinFilterConfig";

// 与 content.js 保持一致的默认配置
const DEFAULT_CONFIG = {
  enabled: true,
  danmuEnabled: true,
  danmuRegex: "",
};

// 开关和输入框对应的配置字段名
const TOGGLE_FIELDS = [
  { id: "master-toggle", key: "enabled" },
  { id: "danmu-toggle", key: "danmuEnabled" },
];

const INPUT_FIELDS = [
  { id: "danmu-regex", key: "danmuRegex" },
];

// 匹配预览用的示例弹幕
// 没有页面数据时用于展示效果的示例弹幕
const DANMU_PREVIEWS = [
  "广告了解一下",
  "关注公众号领福利",
  "抽奖啦 快看",
  "扫码加微信",
  "主播唱得真好听",
  "哈哈哈哈哈太好笑了",
];

const statusBar = document.getElementById("status-bar");
const statusDot = document.getElementById("status-dot");
const statusText = document.getElementById("status-text");
const previewNote = document.getElementById("preview-note");
const previewTitle = document.getElementById("preview-title");
const previewList = document.getElementById("preview-list");
const previewEmpty = document.getElementById("preview-empty");

// 当前抖音页面返回的弹幕文本，供正则效果预览使用
let pageDanmu = [];

// 解析用户输入：
// "广告"        -> /广告/i
// "/广告/g"     -> /广告/g，保留用户指定的 flags
// 输入不合法时抛错，由调用方捕获
function parseRegexInput(input) {
  const text = String(input || "").trim();
  if (!text) {
    return null;
  }

  // 识别 /pattern/flags 这种完整写法；未写成 /.../ 的一律按普通文本处理
  if (text.startsWith("/") && text.lastIndexOf("/") > 0) {
    const lastSlash = text.lastIndexOf("/");
    const pattern = text.slice(1, lastSlash);
    const flags = text.slice(lastSlash + 1);
    if (!/^[dgimsuvy]*$/.test(flags)) {
      throw new Error("invalid flags");
    }
    return new RegExp(pattern, flags);
  }

  return new RegExp(text, "i");
}

// 安全执行 test：g/y 标志会残留 lastIndex，测试前先复位
function testPreview(pattern, text) {
  if (pattern.global || pattern.sticky) {
    pattern.lastIndex = 0;
  }
  return pattern.test(text);
}

// 创建一条预览项：命中时标红并显示“过滤”
function createPreviewItem(text, matched) {
  const item = document.createElement("div");
  item.className = "preview-item" + (matched ? " hit" : "");
  const textEl = document.createElement("span");
  textEl.className = "preview-text";
  textEl.textContent = text;
  const badge = document.createElement("span");
  badge.className = "preview-badge";
  badge.textContent = matched ? "过滤" : "保留";
  item.appendChild(textEl);
  item.appendChild(badge);
  return item;
}

// 渲染预览列表并清空空状态
function renderResults(results) {
  previewList.textContent = "";
  previewEmpty.hidden = true;
  results.forEach((item) => previewList.appendChild(item));
}

// 显示“没有命中”的空状态
function showPreviewEmpty(message) {
  previewList.textContent = "";
  previewEmpty.textContent = message;
  previewEmpty.hidden = false;
}

// 更新状态栏文案和开关状态
function showStatus(message, isOff) {
  statusText.textContent = message;
  statusBar.classList.toggle("off", Boolean(isOff));
  statusDot.classList.toggle("off", Boolean(isOff));
}

// 读取已保存的设置，回填表单
function loadSettings() {
  chrome.storage.sync.get(CONFIG_KEY, (result) => {
    const config = Object.assign({}, DEFAULT_CONFIG, (result && result[CONFIG_KEY]) || {});

    for (const field of TOGGLE_FIELDS) {
      document.getElementById(field.id).checked = !!config[field.key];
    }
    for (const field of INPUT_FIELDS) {
      const input = document.getElementById(field.id);
      input.value = config[field.key] || "";
      input.classList.remove("invalid");
    }
    updatePreview();
    refreshStats();
  });
}

// 把当前表单收集成配置对象；正则不合法时返回 null
function collectConfig() {
  const next = {};
  for (const field of TOGGLE_FIELDS) {
    next[field.key] = document.getElementById(field.id).checked;
  }

  let invalid = false;
  for (const field of INPUT_FIELDS) {
    const input = document.getElementById(field.id);
    try {
      parseRegexInput(input.value);
      input.classList.remove("invalid");
      next[field.key] = input.value.trim();
    } catch (err) {
      input.classList.add("invalid");
      invalid = true;
    }
  }
  return invalid ? null : next;
}

// 保存设置，并通知已打开的抖音页面立即生效
function saveSettings() {
  const next = collectConfig();
  if (!next) {
    showStatus("正则格式不正确，请检查后重试", true);
    return;
  }

  const data = {};
  data[CONFIG_KEY] = next;

  chrome.storage.sync.set(data, () => {
    if (chrome.runtime.lastError) {
      showStatus("保存失败：" + chrome.runtime.lastError.message, true);
      return;
    }

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs && tabs.length > 0) {
        chrome.tabs.sendMessage(tabs[0].id, { action: "reloadSettings" }, () => {
          // 当前页面不是抖音时会产生 lastError，这里忽略即可
          void chrome.runtime.lastError;
        });
      }
    });

    showStatus("已保存，自动生效");
    setTimeout(refreshStats, 500);
  });
}

// 从抖音页面读取当前过滤统计并展示
function refreshStats() {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (!tabs || tabs.length === 0) {
      showStatus("未检测到页面", true);
      return;
    }

    chrome.tabs.sendMessage(tabs[0].id, { action: "getStats" }, (response) => {
      if (chrome.runtime.lastError || !response || !response.stats) {
        showStatus("当前页面不是抖音", true);
        return;
      }

      pageDanmu = Array.isArray(response.danmuTexts) ? response.danmuTexts.slice() : [];
      updatePreview();

      if (!document.getElementById("master-toggle").checked) {
        showStatus("已暂停 · 所有过滤已关闭", true);
        return;
      }

      const stats = response.stats;
      showStatus(`运行中 · 已过滤 ${stats.danmu} 条弹幕`);
    });
  });
}


// 根据当前输入实时展示“会过滤掉哪些弹幕”
function updatePreview() {
  const input = document.getElementById("danmu-regex");

  let pattern = null;
  let invalid = false;
  try {
    pattern = parseRegexInput(input.value);
  } catch (err) {
    invalid = true;
  }

  previewNote.classList.remove("error");

  if (invalid) {
    previewTitle.textContent = "示例预览";
    previewNote.textContent = "正则格式不正确";
    previewNote.classList.add("error");
    renderResults(DANMU_PREVIEWS.map((text) => createPreviewItem(text, false)));
    return;
  }

  if (!pattern) {
    previewTitle.textContent = "过滤效果预览";
    previewNote.textContent = "输入正则后展示将过滤的弹幕";
    renderResults(DANMU_PREVIEWS.map((text) => createPreviewItem(text, false)));
    return;
  }

  // 优先展示抖音页面上的真实弹幕
  if (pageDanmu.length > 0) {
    const matched = pageDanmu.filter((text) => testPreview(pattern, text));
    previewTitle.textContent = "将过滤的弹幕";
    if (matched.length === 0) {
      previewNote.textContent = `页面 ${pageDanmu.length} 条弹幕暂无命中`;
      showPreviewEmpty("当前页面没有会被过滤的弹幕");
    } else {
      previewNote.textContent = `页面 ${pageDanmu.length} 条弹幕中将过滤 ${matched.length} 条`;
      renderResults(matched.map((text) => createPreviewItem(text, true)));
    }
    return;
  }

  // 没有页面数据时使用示例弹幕展示过滤效果
  const results = DANMU_PREVIEWS.map((text) => ({
    text,
    matched: testPreview(pattern, text),
  }));
  const hitCount = results.filter((item) => item.matched).length;
  previewTitle.textContent = "示例预览";
  previewNote.textContent = `示例中将过滤 ${hitCount} / ${results.length} 条`;
  renderResults(results.map((item) => createPreviewItem(item.text, item.matched)));
}

// 重置：恢复默认配置并立即保存
function resetSettings() {
  for (const field of TOGGLE_FIELDS) {
    document.getElementById(field.id).checked = DEFAULT_CONFIG[field.key];
  }
  for (const field of INPUT_FIELDS) {
    const input = document.getElementById(field.id);
    input.value = DEFAULT_CONFIG[field.key] || "";
    input.classList.remove("invalid");
  }
  updatePreview();
  saveSettings();
}

// 监听生成器写入的设置，自动回填到输入框
chrome.storage.onChanged.addListener(function(changes, area) {
  if (area !== "sync" || !changes.douyinFilterConfig) return;
  var cfg = changes.douyinFilterConfig.newValue;
  if (!cfg || !cfg.danmuRegex) return;
  var input = document.getElementById("danmu-regex");
  if (!input) return;
  input.value = cfg.danmuRegex;
  input.classList.remove("invalid");
  updatePreview();
});

// 打开正则生成器页面
document.getElementById("btn-gen-regex").addEventListener("click", function() {
  chrome.tabs.create({ url: chrome.runtime.getURL("generator.html") });
});

document.getElementById("btn-save").addEventListener("click", saveSettings);
document.getElementById("btn-reset").addEventListener("click", resetSettings);
document.getElementById("danmu-regex").addEventListener("input", updatePreview);

loadSettings();
