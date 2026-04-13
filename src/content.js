// 元素截图工具 - 页面内脚本（带调试日志）
let selectionModeActive = false;
let hoverHighlightDiv = null;
let currentHoverElement = null;
let popupMenu = null;
let isMenuOpen = false;

console.log("=== [DEBUG] 元素截图工具 content script 开始加载 ===");
console.log("[DEBUG] 当前页面URL:", window.location.href);
console.log("[DEBUG] 页面尺寸:", window.innerWidth, "x", window.innerHeight);

// 通知 background script 脚本已就绪
try {
  chrome.runtime.sendMessage({ 
    action: "contentScriptReady", 
    ready: true,
    url: window.location.href
  }).catch(err => console.log("[DEBUG] 发送就绪消息失败:", err));
  console.log("[DEBUG] 已发送就绪消息到 background");
} catch(e) {
  console.log("[DEBUG] 发送就绪消息异常:", e);
}

// ========== 获取元素的实际滚动容器 ==========
function getScrollContainer(element) {
  console.log("[DEBUG] getScrollContainer 被调用，元素:", element.tagName, element.className);
  let parent = element.parentElement;
  let depth = 0;
  while (parent && parent !== document.body && parent !== document.documentElement && depth < 20) {
    const style = getComputedStyle(parent);
    const overflow = style.overflow + style.overflowY + style.overflowX;
    console.log(`[DEBUG] 检查父元素 ${depth}:`, parent.tagName, parent.className, "overflow:", overflow);
    if (/(auto|scroll)/.test(overflow)) {
      console.log("[DEBUG] 找到滚动容器:", parent.tagName, parent.className);
      return parent;
    }
    parent = parent.parentElement;
    depth++;
  }
  console.log("[DEBUG] 未找到滚动容器，使用 window");
  return window;
}

// ========== 获取元素相对于滚动容器的位置 ==========
function getPositionRelativeToScrollContainer(element) {
  console.log("[DEBUG] getPositionRelativeToScrollContainer 被调用");
  const scrollContainer = getScrollContainer(element);
  const rect = element.getBoundingClientRect();
  console.log("[DEBUG] 元素 getBoundingClientRect:", {
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
    right: rect.right,
    bottom: rect.bottom
  });
  
  if (scrollContainer === window) {
    const result = {
      left: rect.left + window.scrollX,
      top: rect.top + window.scrollY,
      width: rect.width,
      height: rect.height,
      scrollContainer: 'window',
      scrollTop: window.scrollY,
      clientTop: 0,
      containerInfo: 'window'
    };
    console.log("[DEBUG] 使用 window 滚动，结果:", result);
    return result;
  } else {
    const containerRect = scrollContainer.getBoundingClientRect();
    console.log("[DEBUG] 滚动容器 getBoundingClientRect:", {
      left: containerRect.left,
      top: containerRect.top,
      width: containerRect.width,
      height: containerRect.height
    });
    console.log("[DEBUG] 滚动容器 scrollTop:", scrollContainer.scrollTop);
    console.log("[DEBUG] 滚动容器 scrollLeft:", scrollContainer.scrollLeft);
    
    const result = {
      left: rect.left + scrollContainer.scrollLeft - containerRect.left,
      top: rect.top + scrollContainer.scrollTop - containerRect.top,
      width: rect.width,
      height: rect.height,
      scrollContainer: 'element',
      scrollTop: scrollContainer.scrollTop,
      clientTop: containerRect.top,
      containerId: scrollContainer.id || '',
      containerClass: scrollContainer.className || '',
      containerTag: scrollContainer.tagName
    };
    console.log("[DEBUG] 使用元素滚动容器，结果:", result);
    return result;
  }
}

// ========== 滚动到指定位置 ==========
async function scrollToPosition(scrollContainer, targetScrollTop) {
  console.log("[DEBUG] scrollToPosition 被调用, targetScrollTop:", targetScrollTop);
  console.log("[DEBUG] scrollContainer 类型:", scrollContainer);
  
  return new Promise((resolve) => {
    if (scrollContainer === 'window' || scrollContainer === window) {
      console.log("[DEBUG] 滚动 window 到:", targetScrollTop);
      window.scrollTo({
        top: targetScrollTop,
        behavior: 'instant'
      });
      console.log("[DEBUG] window 滚动后 scrollY:", window.scrollY);
    } else {
      // 通过选择器找到容器
      let container = null;
      if (scrollContainer.id) {
        container = document.getElementById(scrollContainer.id);
        console.log("[DEBUG] 通过 ID 查找容器:", scrollContainer.id, "找到:", !!container);
      } else if (scrollContainer.className) {
        const className = scrollContainer.className.split(' ')[0];
        container = document.querySelector('.' + className);
        console.log("[DEBUG] 通过 class 查找容器:", className, "找到:", !!container);
      } else if (scrollContainer.containerTag) {
        container = document.querySelector(scrollContainer.containerTag);
        console.log("[DEBUG] 通过 tag 查找容器:", scrollContainer.containerTag, "找到:", !!container);
      }
      
      if (container) {
        console.log("[DEBUG] 滚动前 container.scrollTop:", container.scrollTop);
        container.scrollTop = targetScrollTop;
        console.log("[DEBUG] 滚动后 container.scrollTop:", container.scrollTop);
      } else {
        console.log("[DEBUG] 未找到滚动容器，回退到 window 滚动");
        window.scrollTo({
          top: targetScrollTop,
          behavior: 'instant'
        });
      }
    }
    setTimeout(() => {
      console.log("[DEBUG] 滚动完成，等待 100ms");
      resolve();
    }, 100);
  });
}

// 获取页面固定导航条高度
// 获取页面固定/粘性元素的总高度
function getFixedElementsHeight() {
  let maxBottom = 0;
  const elements = document.querySelectorAll('*');
  
  for (let el of elements) {
    const style = getComputedStyle(el);
    if (style.position === 'fixed' || style.position === 'sticky') {
      const rect = el.getBoundingClientRect();
      // 检测所有在视口顶部的元素（top <= 200px），高度 < 200px
      if (rect.top <= 200 && rect.bottom > 0 && rect.height > 0 && rect.height < 200) {
        maxBottom = Math.max(maxBottom, rect.bottom);
      }
    }
  }
  
  if (maxBottom > window.innerHeight / 2) {
    maxBottom = 0;
  }
  
  console.log("[DEBUG] 固定导航条总高度:", maxBottom);
  return maxBottom;
}

// 创建高亮遮罩层
function createHighlightDiv() {
  console.log("[DEBUG] 创建高亮层");
  if (hoverHighlightDiv && hoverHighlightDiv.isConnected) {
    console.log("[DEBUG] 高亮层已存在");
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
  console.log("[DEBUG] 高亮层创建完成");
  return div;
}

// 更新高亮位置
// 更新高亮位置 - 使用视口坐标
function updateHighlight(element) {
  if (!hoverHighlightDiv || !element || isMenuOpen) return;

  const rect = element.getBoundingClientRect(); // 这已经是视口坐标
  if (rect.width === 0 || rect.height === 0) {
    hoverHighlightDiv.style.display = "none";
    return;
  }

  hoverHighlightDiv.style.display = "block";
  // 直接使用 rect 的坐标，不需要加 scrollX/scrollY
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

// 元素截图 - 支持自定义滚动容器
async function captureElementAsBlob(element) {
  console.log("[DEBUG] captureElementAsBlob 被调用");
  
  let hiddenElements = [];
  
  try {
    //showToast("正在截图，请稍候...", 800);
    
    // 先获取原始位置（用于判断是否需要滚动）
    const originalRect = element.getBoundingClientRect();
    const viewportSize = {
      width: window.innerWidth,
      height: window.innerHeight
    };
    
    const needScroll = originalRect.bottom > viewportSize.height;
    console.log("[DEBUG] 原始位置:", originalRect);
    console.log("[DEBUG] 是否需要滚动:", needScroll);
    
    // 隐藏页面上的所有导航条
    hiddenElements = hideFixedNavigation();
    await new Promise(resolve => setTimeout(resolve, 50));
    
    // 隐藏后重新获取元素位置（用于截图）
    const viewportRect = element.getBoundingClientRect();
    console.log("[DEBUG] 隐藏导航条后的位置:", viewportRect);
    
    const scrollX = window.scrollX || window.pageXOffset;
    const scrollY = window.scrollY || window.pageYOffset;
    
    let finalImageData;
    
    if (!needScroll) {
      // 不需要滚动，直接截图
      console.log("[DEBUG] 元素完全可见，直接截图");
      
      const response = await chrome.runtime.sendMessage({
        action: "captureElement",
        rect: viewportRect,
        isFullyVisible: true
      });
      
      if (!response.success) throw new Error(response.error);
      finalImageData = response.imageData;
      
    } else {
      // 需要滚动分段截图
      console.log("[DEBUG] 元素需要滚动，使用滚动分段截图");
      showToast("📸 元素较长，正在分段截图...", 800);
      await delay(800);

      
      const elementRect = {
        left: viewportRect.left + scrollX,
        top: viewportRect.top + scrollY,
        width: viewportRect.width,
        height: viewportRect.height,
        viewportHeight: viewportSize.height
      };
      
      console.log("[DEBUG] 文档坐标 elementRect:", elementRect);
      
      const response = await chrome.runtime.sendMessage({
        action: "captureElement",
        rect: viewportRect,
        elementRect: elementRect,
        isFullyVisible: false
      });
      
      if (!response.success) throw new Error(response.error);
      finalImageData = response.imageData;
    }
    
    const blob = await dataURLToBlob(finalImageData);
    console.log("[DEBUG] 截图成功，blob 大小:", blob.size);
    return blob;
    
  } catch (error) {
    console.error("[DEBUG] 截图失败:", error);
    showToast("截图失败: " + error.message, 2000);
    return null;
  } finally {
    restoreFixedNavigation(hiddenElements);
  }
}

// 带视口信息的裁剪（处理设备像素比）
async function cropImageWithViewport(dataUrl, rect, viewportSize) {
  try {
    const response = await fetch(dataUrl);
    const blob = await response.blob();
    const imageBitmap = await createImageBitmap(blob);
    
    const scaleX = imageBitmap.width / viewportSize.width;
    const scaleY = imageBitmap.height / viewportSize.height;
    
    console.log("[DEBUG] 裁剪参数:", { rect, scaleX, scaleY, imageSize: { w: imageBitmap.width, h: imageBitmap.height } });
    
    const canvas = new OffscreenCanvas(rect.width, rect.height);
    const ctx = canvas.getContext("2d");
    
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    
    ctx.drawImage(
      imageBitmap,
      rect.left * scaleX,
      rect.top * scaleY,
      rect.width * scaleX,
      rect.height * scaleY,
      0, 0,
      rect.width, rect.height
    );
    
    const croppedBlob = await canvas.convertToBlob({ 
      type: "image/png",
      quality: 1.0
    });
    
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.onerror = () => reject(new Error("转换失败"));
      reader.readAsDataURL(croppedBlob);
    });
    
  } catch (error) {
    console.error("[DEBUG] 裁剪图片失败:", error);
    throw error;
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
    console.error("[DEBUG] 复制失败:", err);
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

// 创建操作菜单
// 创建操作菜单
function showActionMenu(element, rect) {
  console.log("[DEBUG] showActionMenu 被调用");
  
  if (popupMenu && popupMenu.isConnected) {
    popupMenu.remove();
  }
  
  isMenuOpen = true;
  hideHighlight();

  const menu = document.createElement("div");
  menu.id = "element-screenshot-menu";
  menu.setAttribute('data-plugin-menu', 'true');  // 添加标记

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
    console.log("[DEBUG] 复制按钮被点击");
    const blob = await captureElementAsBlob(element);
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
    console.log("[DEBUG] 下载按钮被点击");
    const blob = await captureElementAsBlob(element);
    if (blob) {
      const tagName = element.tagName.toLowerCase();
      const timestamp = Date.now();
      downloadImage(blob, `element_${tagName}_${timestamp}.png`);
    }
    closeMenuAndExit();
  };

  menu.appendChild(copyBtn);
  menu.appendChild(downloadBtn);

  // 修复：菜单位置直接使用视口坐标，不需要再加 scrollX/scrollY
  const mouseX = window.lastClickX || rect.left + rect.width / 2;
  const mouseY = window.lastClickY || rect.top + rect.height / 2;
  
  let left = mouseX + 10;
  let top = mouseY + 10;
  
  const menuWidth = 140;
  const menuHeight = 90;
  const padding = 10;
  
  // 边界检查使用视口坐标
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
  
  console.log("[DEBUG] 菜单位置（视口坐标）:", { left, top });

  document.body.appendChild(menu);
  popupMenu = menu;

  const closeHandler = (e) => {
    if (menu && menu.isConnected && !menu.contains(e.target)) {
      menu.remove();
      popupMenu = null;
      isMenuOpen = false;
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

// 鼠标移动处理
function onMouseMove(e) {
  if (!selectionModeActive || isMenuOpen) return;
  
  const elem = document.elementFromPoint(e.clientX, e.clientY);
  if (elem && elem !== currentHoverElement && 
      elem.id !== "element-screenshot-highlight" && 
      elem.id !== "element-screenshot-menu" &&
      !elem.closest("#element-screenshot-menu")) {
    currentHoverElement = elem;
    updateHighlight(elem);
  }
}

// 点击处理
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
  
  // 修复：直接存储视口坐标（clientX/clientY），而不是文档坐标
  window.lastClickX = e.clientX;
  window.lastClickY = e.clientY;
  console.log("[DEBUG] 点击位置（视口坐标）:", { x: window.lastClickX, y: window.lastClickY });

  const targetElement = e.target;
  console.log("[DEBUG] 点击元素:", targetElement.tagName, targetElement.className, targetElement.id);
  
  if (targetElement && targetElement !== hoverHighlightDiv) {
    const rect = targetElement.getBoundingClientRect();
    console.log("[DEBUG] 点击元素位置（视口坐标）:", rect);
    showActionMenu(targetElement, rect);
  }
}

// 键盘处理
function onKeyDown(e) {
  if (selectionModeActive && e.key === "Escape") {
    console.log("[DEBUG] ESC 键被按下");
    if (isMenuOpen) {
      if (popupMenu && popupMenu.isConnected) {
        popupMenu.remove();
        popupMenu = null;
      }
      isMenuOpen = false;
    } else {
      deactivateSelectionMode();
      showToast("已退出选择模式", 1000);
    }
  }
}

// 激活选择模式
function activateSelectionMode() {
  console.log("=== [DEBUG] activateSelectionMode 被调用 ===");
  if (selectionModeActive) {
    console.log("[DEBUG] 选择模式已激活，跳过");
    return;
  }
  
  selectionModeActive = true;
  isMenuOpen = false;
  createHighlightDiv();
  
  document.addEventListener("mousemove", onMouseMove);
  document.addEventListener("click", onClickHandler, true);
  document.addEventListener("keydown", onKeyDown);
  
  document.body.style.cursor = "crosshair";
  console.log("[DEBUG] 鼠标样式已改为 crosshair");
  
  chrome.runtime.sendMessage({ 
    action: "selectionModeStatus", 
    active: true 
  }).catch(err => console.log("[DEBUG] 发送状态失败:", err));
  
  showToast("🔍 选择模式已开启，点击元素截图（ESC退出）", 2000);
  console.log("[DEBUG] 选择模式已激活，selectionModeActive =", selectionModeActive);
}

// 退出选择模式
function deactivateSelectionMode() {
  console.log("[DEBUG] deactivateSelectionMode 被调用");
  if (!selectionModeActive) return;
  
  selectionModeActive = false;
  isMenuOpen = false;
  
  document.removeEventListener("mousemove", onMouseMove);
  document.removeEventListener("click", onClickHandler, true);
  document.removeEventListener("keydown", onKeyDown);
  
  document.body.style.cursor = "";
  
  chrome.runtime.sendMessage({ 
    action: "selectionModeStatus", 
    active: false 
  }).catch(err => console.log("[DEBUG] 发送状态失败:", err));
  
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
  console.log("[DEBUG] 选择模式已退出");
}

// 监听来自 background 的消息
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log("[DEBUG] content script 收到消息:", message);
  
  if (message.action === "ping") {
    console.log("[DEBUG] 收到 ping，返回 pong");
    sendResponse({ pong: true });
    return true;
  }
  
  if (message.action === "toggleSelectionMode") {
    console.log("[DEBUG] 收到 toggleSelectionMode 消息，当前状态:", selectionModeActive);
    if (selectionModeActive) {
      deactivateSelectionMode();
      showToast("已退出选择模式", 1000);
    } else {
      activateSelectionMode();
    }
    sendResponse({ status: selectionModeActive ? "active" : "inactive" });
  }
  
  // 处理滚动请求
  if (message.action === "scrollTo") {
    console.log("[DEBUG] 收到 scrollTo 请求:", message);
    scrollToPosition(message.scrollContainer, message.targetScrollTop).then(() => {
      sendResponse({ success: true });
    });
    return true;
  }
  
  return true;
});

// 页面卸载时清理
window.addEventListener("beforeunload", () => {
  console.log("[DEBUG] 页面卸载，清理选择模式");
  deactivateSelectionMode();
});

console.log("=== [DEBUG] 元素截图工具 content script 加载完成，等待消息 ===");
console.log("[DEBUG] 当前页面可滚动容器检测...");
// 检测页面中所有可滚动元素
const allElements = document.querySelectorAll('*');
let scrollableCount = 0;
allElements.forEach(el => {
  const style = getComputedStyle(el);
  const overflow = style.overflow + style.overflowY + style.overflowX;
  if (/(auto|scroll)/.test(overflow)) {
    scrollableCount++;
    console.log(`[DEBUG] 发现可滚动元素: ${el.tagName}`, { 
      id: el.id, 
      class: el.className,
      overflow: overflow
    });
  }
});
console.log(`[DEBUG] 页面中共发现 ${scrollableCount} 个可滚动元素`);


// 隐藏所有导航条（通过 class 选择器
function hideFixedNavigation() {
  const hiddenElements = [];
  
  const selectors = [
    'header.sticky',
    'nav.cadaPl',
    '.navigation',
    '.tabsNavigation',
    '[data-position="fixed"]',
    '.sticky',
    '.fixedHeader'
    ];
  
  for (let selector of selectors) {
    const elements = document.querySelectorAll(selector);
    for (let el of elements) {
      if (el.style.display !== 'none') {
        const originalDisplay = el.style.display;
        const originalVisibility = el.style.visibility;
        
        el.style.display = 'none';
        //el.style.visibility = 'hidden';
        el.style.border = 'none';
        
        console.log("[DEBUG] 保存:", el.className, "display:", originalDisplay, "visibility:", originalVisibility);
        
        hiddenElements.push({
          element: el,
          originalDisplay: originalDisplay,
          originalVisibility: originalVisibility
        });
        
        console.log("[DEBUG] 隐藏:", selector, el.tagName, el.className);
      }
    }
  }
  
  console.log("[DEBUG] 共隐藏", hiddenElements.length, "个导航元素");
  return hiddenElements;
}


// 恢复导航条
function restoreFixedNavigation(hiddenElements) {
  for (let item of hiddenElements) {
    // 恢复 display
    if (item.originalDisplay === "") {
      item.element.style.removeProperty('display');
    } else {
      item.element.style.display = item.originalDisplay;
    }
    
    // 恢复 visibility
    /*
    if (item.originalVisibility === "") {
      item.element.style.removeProperty('visibility');
    } else {
      item.element.style.visibility = item.originalVisibility;
    }*/
  }
  console.log("[DEBUG] 已恢复", hiddenElements.length, "个导航元素");
}


// 恢复隐藏的导航条
function restoreFixedNavigation(hiddenElements) {
  for (let item of hiddenElements) {
    item.element.style.display = item.originalDisplay;
  }
  console.log("[DEBUG] 已恢复", hiddenElements.length, "个导航条");
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}