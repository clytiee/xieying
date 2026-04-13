// 后台服务：处理插件图标点击和截图
let activeTabId = null;
let isSelecting = false;

async function ensureContentScript(tabId) {
  try {
    await chrome.tabs.sendMessage(tabId, { action: "ping" });
    return true;
  } catch (error) {
    console.log("Content script 未响应，尝试注入...");
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tabId },
        files: ["content.js"]
      });
      await new Promise(resolve => setTimeout(resolve, 300));
      await chrome.tabs.sendMessage(tabId, { action: "ping" });
      return true;
    } catch (injectError) {
      console.error("注入失败:", injectError);
      return false;
    }
  }
}

chrome.action.onClicked.addListener(async (tab) => {
  console.log("插件图标被点击, tabId:", tab.id);
  if (!tab.id) return;
  
  activeTabId = tab.id;
  const ready = await ensureContentScript(tab.id);
  
  if (!ready) {
    console.error("无法与页面通信，请刷新页面后重试");
    chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => alert("请刷新页面后重试")
    });
    return;
  }
  
  try {
    await chrome.tabs.sendMessage(tab.id, { action: "toggleSelectionMode" });
    console.log("消息发送成功");
  } catch (error) {
    console.error("发送消息失败:", error);
  }
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log("[DEBUG] background 收到消息:", request.action);
  
  if (request.action === "captureElement") {
    console.log("收到截图请求");
    captureElementWithChromeAPI(sender.tab, request.rect, request.elementRect, request.isFullyVisible)
      .then(imageData => {
        console.log("截图成功");
        sendResponse({ success: true, imageData });
      })
      .catch(error => {
        console.error("截图失败:", error);
        sendResponse({ success: false, error: error.message });
      });
    return true;
  }
  
  if (request.action === "selectionModeStatus") {
    isSelecting = request.active;
    console.log("选择模式状态:", isSelecting);
    sendResponse({ received: true });
  }
  
  if (request.action === "hideUIElements") {
    hideUIElements(sender.tab.id).then(() => sendResponse({ success: true })).catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }
  
  if (request.action === "showUIElements") {
    showUIElements(sender.tab.id).then(() => sendResponse({ success: true })).catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }
  
  if (request.action === "ping") {
    sendResponse({ pong: true });
    return true;
  }
  
  if (request.action === "contentScriptReady") {
    console.log("content script 已就绪:", request.url);
    sendResponse({ received: true });
  }
  
  return true;
});

async function hideUIElements(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tabId },
      func: () => {
        const menu = document.getElementById("element-screenshot-menu");
        if (menu) menu.style.display = "none";
        const highlight = document.getElementById("element-screenshot-highlight");
        if (highlight) highlight.style.display = "none";
      }
    });
  } catch (error) {
    console.error("隐藏UI元素失败:", error);
  }
}

async function showUIElements(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tabId },
      func: () => {
        const menu = document.getElementById("element-screenshot-menu");
        if (menu) menu.style.display = "";
        const highlight = document.getElementById("element-screenshot-highlight");
        if (highlight) highlight.style.display = "";
      }
    });
  } catch (error) {
    console.error("显示UI元素失败:", error);
  }
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function captureElementWithChromeAPI(tab, viewportRect, elementRect, isFullyVisible) {
  try {
    const windowObj = await chrome.windows.getCurrent();
    const windowId = windowObj.id;
    
    console.log("使用窗口ID:", windowId);
    console.log("是否完全可见:", isFullyVisible);
    
    await hideUIElements(tab.id);
    await delay(50);
    
    const scrollPosition = await getScrollPosition(tab.id);
    
    try {
      const viewportSize = await getViewportSize(tab.id);
      
      if (isFullyVisible) {
        const dataUrl = await chrome.tabs.captureVisibleTab(windowId, { format: "png" });
        return await cropImageWithViewport(dataUrl, viewportRect, viewportSize);
      }
      
      return await captureScrollingElement(tab.id, elementRect, windowId, viewportSize);
      
    } finally {
      await restoreScrollPosition(tab.id, scrollPosition);
      await showUIElements(tab.id);
    }
    
  } catch (error) {
    console.error("截图失败:", error);
    await showUIElements(tab.id);
    throw error;
  }
}

async function getViewportSize(tabId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId: tabId },
      func: () => ({ width: window.innerWidth, height: window.innerHeight })
    });
    return result[0].result;
  } catch (error) {
    return { width: window.innerWidth, height: window.innerHeight };
  }
}

async function getScrollPosition(tabId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId: tabId },
      func: () => ({ x: window.scrollX, y: window.scrollY })
    });
    return result[0].result;
  } catch (error) {
    return { x: 0, y: 0 };
  }
}

async function restoreScrollPosition(tabId, position) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tabId },
      func: (x, y) => window.scrollTo(x, y),
      args: [position.x, position.y]
    });
    await delay(100);
  } catch (error) {}
}

async function captureScrollingElement(tabId, elementRect, windowId, viewportSize) {
  try {
    const elementHeight = elementRect.height;
    const viewportHeight = elementRect.viewportHeight || viewportSize.height;
    const elementTop = elementRect.top;
    
    console.log("[DEBUG] === 滚动截图参数 ===");
    console.log("[DEBUG] 元素文档顶部:", elementTop);
    console.log("[DEBUG] 元素高度:", elementHeight);
    console.log("[DEBUG] 视口高度:", viewportHeight);
    
    // 计算需要多少段（向上取整）
    const segments = Math.ceil(elementHeight / viewportHeight);
    
    // 计算每段高度（使用整数除法，最后一段补齐）
    const baseHeight = Math.floor(elementHeight / segments);
    let remaining = elementHeight - (baseHeight * segments);
    
    console.log("[DEBUG] 分段截图: 共", segments, "段, 基础高度:", baseHeight, "剩余:", remaining);
    
    let fullCanvas = new OffscreenCanvas(elementRect.width, elementHeight);
    const ctx = fullCanvas.getContext("2d");
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    
    let currentY = 0;
    
    for (let i = 0; i < segments; i++) {
      console.log(`正在截图第 ${i + 1}/${segments} 段...`);
      
      // 当前段高度（最后一段加上剩余像素）
      let currentHeight = baseHeight;
      if (remaining > 0) {
        currentHeight++;
        remaining--;
      }

      // 滚动位置：让这一段的内容对齐视口顶部
      const scrollY = elementTop + currentY;
      
      console.log(`[DEBUG] 段 ${i+1}: 滚动到 ${scrollY}, 高度 ${currentHeight}`);

      await chrome.scripting.executeScript({
        target: { tabId: tabId },
        func: (scrollY) => {
          window.scrollTo({ top: scrollY, behavior: 'instant' });
        },
        args: [scrollY]
      });
      
      await delay(200);
      
      // 每段截图前，隐藏所有导航条
      await chrome.scripting.executeScript({
        target: { tabId: tabId },
        func: () => {
          const selectors = [
            'header.sticky',
            '.navigation',
            '.tabsNavigation'
          ];
          
          let hiddenCount = 0;
          for (let selector of selectors) {
            const elements = document.querySelectorAll(selector);
            for (let el of elements) {
              if (el.style.display !== 'none') {
                el.style.display = 'none';
                el.style.visibility = 'hidden';
                hiddenCount++;
              }
            }
          }
          if (hiddenCount > 0) console.log("[DEBUG] 隐藏了", hiddenCount, "个导航元素");
        }
      });
      
      await delay(500);
      
      const dataUrl = await chrome.tabs.captureVisibleTab(windowId, { format: "png" });
            
      const cropRect = {
        left: elementRect.left,
        top: 0,
        width: elementRect.width,
        height: currentHeight
      };
      
      console.log(`[DEBUG] 段 ${i+1} 裁剪区域:`, cropRect, "起始位置:", currentY);
      
      const segmentImage = await cropImageWithViewport(dataUrl, cropRect, viewportSize);
      const segmentBlob = await dataURLToBlob(segmentImage);
      const segmentBitmap = await createImageBitmap(segmentBlob);
      
      ctx.drawImage(segmentBitmap, 0, currentY);
      
      currentY += currentHeight;
      console.log(`已完成第 ${i + 1} 段截图, 当前进度: ${currentY}/${elementHeight}`);
      
      if (i < segments - 1) await delay(600);
    }
    
    const finalBlob = await fullCanvas.convertToBlob({ type: "image/png", quality: 1.0 });
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.onerror = () => reject(new Error("转换失败"));
      reader.readAsDataURL(finalBlob);
    });
    
  } catch (error) {
    console.error("滚动截图失败:", error);
    throw error;
  }
}

async function cropImageWithViewport(dataUrl, rect, viewportSize) {
  try {
    const response = await fetch(dataUrl);
    const blob = await response.blob();
    const imageBitmap = await createImageBitmap(blob);
    
    const scaleX = imageBitmap.width / viewportSize.width;
    const scaleY = imageBitmap.height / viewportSize.height;
    
    const canvas = new OffscreenCanvas(rect.width, rect.height);
    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    
    ctx.drawImage(
      imageBitmap,
      rect.left * scaleX, rect.top * scaleY,
      rect.width * scaleX, rect.height * scaleY,
      0, 0, rect.width, rect.height
    );
    
    const croppedBlob = await canvas.convertToBlob({ type: "image/png", quality: 1.0 });
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.onerror = () => reject(new Error("转换失败"));
      reader.readAsDataURL(croppedBlob);
    });
  } catch (error) {
    throw error;
  }
}

function dataURLToBlob(dataURL) {
  return new Promise((resolve, reject) => {
    try {
      const arr = dataURL.split(',');
      const mime = arr[0].match(/:(.*?);/)[1];
      const bstr = atob(arr[1]);
      let n = bstr.length;
      const u8arr = new Uint8Array(n);
      while (n--) u8arr[n] = bstr.charCodeAt(n);
      resolve(new Blob([u8arr], { type: mime }));
    } catch (error) {
      reject(error);
    }
  });
}

console.log("Background script loaded");