// 元素截图工具 - 页面内脚本
let selectionModeActive = false;
let hoverHighlightDiv = null;
let currentHoverElement = null;
let popupMenu = null;
let isMenuOpen = false;
let selectedElement = null; // 存储当前选中的元素
console.log("=== 元素截图工具 content script 开始加载 ===");

// 通知 background script 脚本已就绪
try {
  chrome.runtime.sendMessage({
    action: "contentScriptReady",
    ready: true
  }).catch(err => console.log("发送就绪消息失败:", err));
} catch (e) {
  console.log("发送就绪消息异常:", e);
}

// 创建高亮遮罩层
function createHighlightDiv() {
  console.log("创建高亮层");
  if (hoverHighlightDiv && hoverHighlightDiv.isConnected) {
    return hoverHighlightDiv;
  }
  const div = document.createElement("div");
  div.id = "element-screenshot-highlight";
  div.style.cssText = `
    position: fixed;
    z-index: 999999;
    pointer-events: none;
    border: 2px solid #3b82f6;
    background-color: rgba(59, 130, 246, 0.15);
    box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.3);
    transition: all 0.08s ease;
    display: none;
    border-radius: 4px;
  `;
  document.body.appendChild(div);
  hoverHighlightDiv = div;
  return div;
}

// 更新高亮位置【修复：fixed直接使用视口坐标，不再叠加scrollX/Y】
function updateHighlight(element) {
  if (!hoverHighlightDiv || !element) return;
  // 即使菜单打开，只要选中了元素就显示高亮
  if (isMenuOpen && element === selectedElement) {
    // 菜单打开时仍然显示高亮
  }
  const rect = element.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) {
    hoverHighlightDiv.style.display = "none";
    return;
  }
  hoverHighlightDiv.style.display = "block";
  hoverHighlightDiv.style.left = rect.left + "px";
  hoverHighlightDiv.style.top = rect.top + "px";
  hoverHighlightDiv.style.width = rect.width + "px";
  hoverHighlightDiv.style.height = rect.height + "px";
}

// 隐藏高亮
function hideHighlight() {
  if (hoverHighlightDiv) {
    hoverHighlightDiv.style.display = "none";
  }
}

// 临时隐藏高亮框（用于截图时）
function temporarilyHideHighlight() {
  if (hoverHighlightDiv && hoverHighlightDiv.style.display !== "none") {
    hoverHighlightDiv.setAttribute('data-was-visible', 'true');
    hoverHighlightDiv.style.display = "none";
    return true;
  }
  return false;
}

// 恢复高亮框（截图完成后）
function restoreHighlight() {
  if (hoverHighlightDiv && hoverHighlightDiv.getAttribute('data-was-visible') === 'true') {
    hoverHighlightDiv.style.display = "block";
    hoverHighlightDiv.removeAttribute('data-was-visible');
  }
}

// 将 dataURL 转换为 Blob
function dataURLToBlob(dataURL) {
  return new Promise((resolve, reject) => {
    try {
      const arr = dataURL.split(',');
      const mime = arr[0].match(/:(.*?);/)[1];
      const bstr = atob(arr[1]);
      let n = bstr.length;
      const u8arr = new Uint8Array(n);
      while (n--) {
        u8arr[n] = bstr.charCodeAt(n);
      }
      resolve(new Blob([u8arr], { type: mime }));
    } catch (error) {
      reject(error);
    }
  });
}

// 元素截图
async function captureElementAsBlob(element) {
  try {
    // 临时隐藏高亮框
    const wasHighlightVisible = temporarilyHideHighlight();

    const rect = element.getBoundingClientRect();
    const scrollX = window.scrollX || window.pageXOffset;
    const scrollY = window.scrollY || window.pageYOffset;

    const elementRect = {
      left: rect.left + scrollX,
      top: rect.top + scrollY,
      right: rect.right + scrollX,
      bottom: rect.bottom + scrollY,
      width: rect.width,
      height: rect.height,
      viewportHeight: window.innerHeight
    };

    const viewportRect = {
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height
    };

    const response = await chrome.runtime.sendMessage({
      action: "captureElement",
      rect: viewportRect,
      elementRect: elementRect,
      dpr: window.devicePixelRatio || 1
    });

    // 恢复高亮框
    if (wasHighlightVisible) {
      restoreHighlight();
    }

    if (!response.success) {
      throw new Error(response.error);
    }

    const blob = await dataURLToBlob(response.imageData);
    return blob;

  } catch (error) {
    // 出错时也要恢复高亮框
    restoreHighlight();
    console.error("截图失败:", error);
    showToast("截图失败: " + error.message, 2000);
    return null;
  }
}

// 复制图片到剪贴板
async function copyImageToClipboard(blob) {
  try {
    await navigator.clipboard.write([
      new ClipboardItem({
        [blob.type]: blob
      })
    ]);
    showToast("✅ 截图已复制到剪贴板", 1500);
    return true;
  } catch (err) {
    console.error("复制失败:", err);
    showToast("❌ 复制失败，请检查权限", 2000);
    return false;
  }
}

// 下载图片
function downloadImage(blob, filename = "screenshot.png") {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast("💾 截图已保存", 1500);
}

// 显示提示
let toastTimeout = null;
function showToast(message, duration = 1500) {
  const existingToast = document.getElementById("element-screenshot-toast");
  if (existingToast) {
    existingToast.remove();
    if (toastTimeout) clearTimeout(toastTimeout);
  }
  const toast = document.createElement("div");
  toast.id = "element-screenshot-toast";
  toast.textContent = message;
  toast.style.cssText = `
    position: fixed;
    bottom: 20px;
    left: 50%;
    transform: translateX(-50%);
    background-color: #1e293b;
    color: #f1f5f9;
    padding: 10px 20px;
    border-radius: 40px;
    font-size: 14px;
    font-weight: 500;
    z-index: 10000000;
    box-shadow: 0 4px 12px rgba(0,0,0,0.2);
    font-family: system-ui, -apple-system, sans-serif;
    white-space: nowrap;
    pointer-events: none;
  `;
  document.body.appendChild(toast);
  toastTimeout = setTimeout(() => {
    if (toast && toast.isConnected) toast.remove();
    toastTimeout = null;
  }, duration);
}

// 关闭菜单并退出选择模式
function closeMenuAndExit() {
  if (popupMenu && popupMenu.isConnected) {
    popupMenu.remove();
    popupMenu = null;
  }
  isMenuOpen = false;
  deactivateSelectionMode();
}

// 获取元素的简单路径描述
function getElementPath(element) {
  if (!element || element === document.body || element === document.documentElement) {
    return null;
  }

  const tagName = element.tagName.toLowerCase();
  if (element.id) {
    return `${tagName}#${element.id}`;
  }
  if (element.className && typeof element.className === 'string') {
    const classes = element.className.split(' ').slice(0, 2).join('.');
    if (classes) {
      return `${tagName}.${classes}`;
    }
  }
  return tagName;
}

// 创建操作菜单
function showActionMenu(element, rect) {
  if (popupMenu && popupMenu.isConnected) {
    popupMenu.remove();
  }

  selectedElement = element; // 存储当前选中的元素

  isMenuOpen = true;

  const menu = document.createElement("div");
  menu.id = "element-screenshot-menu";
  menu.style.cssText = `
    position: fixed;
    background-color: white;
    border-radius: 12px;
    box-shadow: 0 10px 25px -5px rgba(0,0,0,0.2), 0 8px 10px -6px rgba(0,0,0,0.1);
    padding: 6px 0;
    z-index: 10000001;
    min-width: 140px;
    font-family: system-ui, -apple-system, sans-serif;
    font-size: 14px;
    border: 1px solid #e2e8f0;
    overflow: hidden;
  `;
  if (!document.querySelector('#screenshot-menu-style')) {
    const style = document.createElement('style');
    style.id = 'screenshot-menu-style';
    style.textContent = `
      @keyframes fadeIn {
        from {
          opacity: 0;
          transform: translateY(-5px);
        }
        to {
          opacity: 1;
          transform: translateY(0);
        }
      }
    `;
    document.head.appendChild(style);
  }
  menu.style.animation = "fadeIn 0.15s ease";
  // 显示元素路径的提示
  const pathDiv = document.createElement("div");
  pathDiv.id = "element-screenshot-path";
  const updatePathDisplay = () => {
    const path = getElementPath(selectedElement);
    if (path) {
      pathDiv.textContent = `当前: ${path}`;
      pathDiv.style.display = "block";
    } else {
      pathDiv.textContent = `当前: ${selectedElement.tagName.toLowerCase()}`;
      pathDiv.style.display = "block";
    }
  };
  pathDiv.style.cssText = `
    padding: 6px 20px;
    font-size: 11px;
    color: #64748b;
    border-bottom: 1px solid #e2e8f0;
    background-color: #f8fafc;
    font-family: monospace;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  `;
  updatePathDisplay();
  menu.appendChild(pathDiv);
  // 复制按钮
  const copyBtn = document.createElement("div");
  copyBtn.textContent = "📋 复制截图";
  copyBtn.style.cssText = `
    padding: 10px 20px;
    cursor: pointer;
    transition: background 0.1s;
    color: #334155;
    font-weight: 500;
    display: flex;
    align-items: center;
    gap: 8px;
  `;
  copyBtn.onmouseenter = () => (copyBtn.style.backgroundColor = "#f1f5f9");
  copyBtn.onmouseleave = () => (copyBtn.style.backgroundColor = "transparent");
  copyBtn.onclick = async (e) => {
    e.stopPropagation();
    const currentElement = selectedElement;
    if (!currentElement) {
      showToast("未选中任何元素", 1500);
      return;
    }
    const blob = await captureElementAsBlob(currentElement);
    if (blob) {
      await copyImageToClipboard(blob);
    }
    closeMenuAndExit();
  };
  // 下载按钮
  const downloadBtn = document.createElement("div");
  downloadBtn.textContent = "⬇️ 下载截图";
  downloadBtn.style.cssText = copyBtn.style.cssText;
  downloadBtn.onmouseenter = () => (downloadBtn.style.backgroundColor = "#f1f5f9");
  downloadBtn.onmouseleave = () => (downloadBtn.style.backgroundColor = "transparent");
  downloadBtn.onclick = async (e) => {
    e.stopPropagation();
    const currentElement = selectedElement;
    if (!currentElement) {
      showToast("未选中任何元素", 1500);
      return;
    }
    const blob = await captureElementAsBlob(currentElement);
    if (blob) {
      const tagName = currentElement.tagName.toLowerCase();
      const timestamp = Date.now();
      downloadImage(blob, `element_${tagName}_${timestamp}.png`);
    }
    closeMenuAndExit();
  };
  menu.appendChild(copyBtn);
  menu.appendChild(downloadBtn);
  // 菜单位置显示在光标下方
  const mouseX = window.lastClickX || rect.left + rect.width / 2;
  const mouseY = window.lastClickY || rect.top + rect.height / 2;

  let left = mouseX + 10;
  let top = mouseY + 10;

  const menuWidth = 140;
  const menuHeight = 90;
  const padding = 10;

  if (left + menuWidth > window.innerWidth) {
    left = mouseX - menuWidth - 10;
  }

  if (top + menuHeight > window.innerHeight) {
    top = mouseY - menuHeight - 10;
  }

  if (left < 0) {
    left = padding;
  }

  if (top < 0) {
    top = padding;
  }

  menu.style.left = left + "px";
  menu.style.top = top + "px";
  // 存储菜单和更新函数
  window.currentMenu = menu;
  window.updatePathDisplay = updatePathDisplay;
  document.body.appendChild(menu);
  popupMenu = menu;
  const closeHandler = (e) => {
    if (menu && menu.isConnected && !menu.contains(e.target)) {
      menu.remove();
      popupMenu = null;
      isMenuOpen = false;
      selectedElement = null;
      window.currentMenu = null;
      window.updatePathDisplay = null;
      document.removeEventListener("click", closeHandler);
      document.removeEventListener("contextmenu", closeHandler);
      deactivateSelectionMode();
    }
  };

  setTimeout(() => {
    document.addEventListener("click", closeHandler);
    document.addEventListener("contextmenu", closeHandler);
  }, 10);
}

// 选择父元素
function selectParentElement() {
  if (!selectedElement || !selectionModeActive) return;

  const parentElement = selectedElement.parentElement;
  if (!parentElement || parentElement === document.body || parentElement === document.documentElement) {
    showToast("已经是顶层元素，无法继续向上选择", 1000);
    return;
  }

  // 更新选中的元素
  selectedElement = parentElement;
  currentHoverElement = parentElement;

  // 更新高亮显示
  updateHighlight(parentElement);

  // 更新菜单中的元素路径显示
  if (window.updatePathDisplay) {
    window.updatePathDisplay();
  }

  showToast(`↑ 已选择上层元素: ${getElementPath(parentElement) || parentElement.tagName.toLowerCase()}`, 800);
}

// 鼠标移动处理
function onMouseMove(e) {
  if (!selectionModeActive || isMenuOpen) return;

  const elem = document.elementFromPoint(e.clientX, e.clientY);
  if (elem && elem !== currentHoverElement &&
    elem.id !== "element-screenshot-highlight" &&
    elem.id !== "element-screenshot-menu" &&
    !elem.closest("#element-screenshot-menu")) {
    currentHoverElement = elem;
    selectedElement = elem;
    updateHighlight(elem);
  }
}

// 页面滚动处理：滚动时刷新高亮位置
function onPageScroll() {
  if (!selectionModeActive) return;
  if (currentHoverElement) {
    updateHighlight(currentHoverElement);
  }
}

// 点击处理
function onClickHandler(e) {
  if (!selectionModeActive) return;

  if (isMenuOpen) {
    return;
  }

  if (popupMenu && popupMenu.contains(e.target)) {
    return;
  }
  e.preventDefault();
  e.stopPropagation();

  //【修复】fixed菜单只保存视口坐标clientX/clientY，不再叠加scrollX/Y
  window.lastClickX = e.clientX;
  window.lastClickY = e.clientY;
  const targetElement = e.target;
  if (targetElement && targetElement !== hoverHighlightDiv) {
    const rect = targetElement.getBoundingClientRect();
    showActionMenu(targetElement, rect);
  }
}

// 键盘处理
function onKeyDown(e) {
  if (selectionModeActive) {
    // 上键选择父元素
    if (e.key === "ArrowUp") {
      e.preventDefault();
      e.stopPropagation();
      selectParentElement();
      return;
    }

    // ESC 退出
    if (e.key === "Escape") {
      e.preventDefault();
      if (isMenuOpen) {
        if (popupMenu && popupMenu.isConnected) {
          popupMenu.remove();
          popupMenu = null;
        }
        isMenuOpen = false;
        selectedElement = null;
        window.currentMenu = null;
        window.updatePathDisplay = null;
        hideHighlight();
      } else {
        deactivateSelectionMode();
        showToast("已退出选择模式", 1000);
      }
    }
  }
}

// 激活选择模式
function activateSelectionMode() {
  console.log("=== activateSelectionMode 被调用 ===");
  if (selectionModeActive) {
    console.log("选择模式已激活，跳过");
    return;
  }

  selectionModeActive = true;
  isMenuOpen = false;
  selectedElement = null;
  createHighlightDiv();

  document.addEventListener("mousemove", onMouseMove);
  document.addEventListener("click", onClickHandler, true);
  document.addEventListener("keydown", onKeyDown);
  window.addEventListener("scroll", onPageScroll, true); //注册滚动监听

  document.body.style.cursor = "crosshair";

  chrome.runtime.sendMessage({
    action: "selectionModeStatus",
    active: true
  }).catch(err => console.log("发送状态失败:", err));

  showToast("🔍 选择模式已开启，点击元素截图 | ↑ 键选择上级元素 | ESC 退出", 1500);
  console.log("选择模式已激活，鼠标样式已更改");
}

// 退出选择模式
function deactivateSelectionMode() {
  console.log("deactivateSelectionMode 被调用");
  if (!selectionModeActive) return;

  selectionModeActive = false;
  isMenuOpen = false;
  selectedElement = null;

  document.removeEventListener("mousemove", onMouseMove);
  document.removeEventListener("click", onClickHandler, true);
  document.removeEventListener("keydown", onKeyDown);
  window.removeEventListener("scroll", onPageScroll, true); //移除滚动监听

  document.body.style.cursor = "";

  chrome.runtime.sendMessage({
    action: "selectionModeStatus",
    active: false
  }).catch(err => console.log("发送状态失败:", err));

  hideHighlight();

  if (popupMenu && popupMenu.isConnected) {
    popupMenu.remove();
    popupMenu = null;
  }

  if (hoverHighlightDiv && hoverHighlightDiv.isConnected) {
    hoverHighlightDiv.remove();
    hoverHighlightDiv = null;
  }

  currentHoverElement = null;
  window.currentMenu = null;
  window.updatePathDisplay = null;
  console.log("选择模式已退出");
}

// 监听来自 background 的消息
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log("content script 收到消息:", message);

  if (message.action === "ping") {
    console.log("收到 ping，返回 pong");
    sendResponse({ pong: true });
    return true;
  }

  if (message.action === "toggleSelectionMode") {
    console.log("收到 toggleSelectionMode 消息，当前状态:", selectionModeActive);
    if (selectionModeActive) {
      deactivateSelectionMode();
      showToast("已退出选择模式", 1000);
    } else {
      activateSelectionMode();
    }
    sendResponse({ status: selectionModeActive ? "active" : "inactive" });
  }
  return true;
});

// 页面卸载时清理
window.addEventListener("beforeunload", () => {
  deactivateSelectionMode();
});
console.log("=== 元素截图工具 content script 加载完成，等待消息 ===");
