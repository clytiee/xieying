// 后台服务：处理插件图标点击和截图
let activeTabId = null;
let isSelecting = false;

// 确保 content script 注入成功
async function ensureContentScript(tabId) {
  try {
    // 先尝试发送测试消息
    await chrome.tabs.sendMessage(tabId, { action: "ping" });
    return true;
  } catch (error) {
    console.log("Content script 未响应，尝试注入...");
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tabId },
        files: ["content.js"]
      });
      // 等待脚本初始化
      await new Promise(resolve => setTimeout(resolve, 300));
      // 再次测试
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
  
  // 确保 content script 已注入
  const ready = await ensureContentScript(tab.id);
  
  if (!ready) {
    console.error("无法与页面通信，请刷新页面后重试");
    chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        alert("请刷新页面后重试");
      }
    });
    return;
  }
  
  try {
    // 发送切换选择模式的消息
    await chrome.tabs.sendMessage(tab.id, { action: "toggleSelectionMode" });
    console.log("消息发送成功");
  } catch (error) {
    console.error("发送消息失败:", error);
  }
});

// 监听来自 content script 的截图请求
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "captureElement") {
    console.log("收到截图请求");
    captureElementWithChromeAPI(sender.tab, request.rect, request.elementRect)
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
    hideUIElements(sender.tab.id).then(() => {
      sendResponse({ success: true });
    }).catch(error => {
      sendResponse({ success: false, error: error.message });
    });
    return true;
  }
  
  if (request.action === "showUIElements") {
    showUIElements(sender.tab.id).then(() => {
      sendResponse({ success: true });
    }).catch(error => {
      sendResponse({ success: false, error: error.message });
    });
    return true;
  }
  
  if (request.action === "ping") {
    sendResponse({ pong: true });
    return true;
  }
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

/* v1.3 20260831 */
// =====新增：临时隐藏 .header-wrap sticky头部=====
async function hideStickyHeader(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tabId },
      func: () => {
        const header = document.querySelector('.header-wrap');
        if (!header) return { exist: false };
        // 保存原来的样式
        const original = {
          visibility: header.style.visibility,
          position: header.style.position
        };
        header.dataset._origVisibility = original.visibility;
        header.dataset._origPosition = original.position;
        // 隐藏：visibility保留占位，不打乱页面布局
        header.style.visibility = 'hidden';
        return { exist: true };
      }
    });
  } catch (e) {
    console.log("hideStickyHeader 异常", e);
  }
}

async function restoreStickyHeader(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tabId },
      func: () => {
        const header = document.querySelector('.header-wrap');
        if (!header) return;
        // 恢复原始样式
        if (header.dataset._origVisibility !== undefined) {
          header.style.visibility = header.dataset._origVisibility;
        }
        if (header.dataset._origPosition !== undefined) {
          header.style.position = header.dataset._origPosition;
        }
        // 清理dataset标记
        delete header.dataset._origVisibility;
        delete header.dataset._origPosition;
      }
    });
  } catch (e) {
    console.log("restoreStickyHeader 异常", e);
  }
}

/* v1.3 end */

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function captureElementWithChromeAPI(tab, viewportRect, elementRect) {
  try {
    const window = await chrome.windows.getCurrent();
    const windowId = window.id;
    
    console.log("使用窗口ID:", windowId);
    
    await hideUIElements(tab.id);
//    await delay(50);
// =========新增：截图前隐藏 sticky header-wrap=========
    await hideStickyHeader(tab.id);
    await delay(80); // 给一点渲染时间
    
    const scrollPosition = await getScrollPosition(tab.id);
    
    try {
      // 获取当前页面的视口尺寸
      const viewportSize = await getViewportSize(tab.id);
      
      if (elementRect.top >= 0 && elementRect.bottom <= (elementRect.viewportHeight || window.innerHeight)) {
        const dataUrl = await chrome.tabs.captureVisibleTab(windowId, {
          format: "png"
        });
        // 传递视口尺寸信息
        return await cropImageHighQualityWithViewport(dataUrl, viewportRect, viewportSize);
      }
      
      return await captureScrollingElement(tab.id, elementRect, windowId, viewportSize);
      
    } finally {
      await restoreScrollPosition(tab.id, scrollPosition);
// =========新增：恢复sticky头部，在showUIElements之前=========
      await restoreStickyHeader(tab.id); 
      await showUIElements(tab.id);
    }
    
  } catch (error) {
    console.error("截图失败:", error);
 // 异常分支也要保证恢复头部！防止页面永久看不见头部
    await restoreStickyHeader(tab.id);
	await showUIElements(tab.id);
    throw error;
  }
}

// 获取视口尺寸
async function getViewportSize(tabId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId: tabId },
      func: () => ({
        width: window.innerWidth,
        height: window.innerHeight
      })
    });
    return result[0].result;
  } catch (error) {
    console.error("获取视口尺寸失败:", error);
    return { width: window.innerWidth, height: window.innerHeight };
  }
}

// 高质量裁剪（带视口信息）
async function cropImageHighQualityWithViewport(dataUrl, rect, viewportSize) {
  try {
    const response = await fetch(dataUrl);
    const blob = await response.blob();
    const imageBitmap = await createImageBitmap(blob);

    const scaleX = imageBitmap.width / viewportSize.width;
    const scaleY = imageBitmap.height / viewportSize.height;

    console.log("截图实际尺寸:", imageBitmap.width, "x", imageBitmap.height);
    console.log("逻辑视口尺寸:", viewportSize.width, "x", viewportSize.height);
    console.log("缩放比例:", scaleX, scaleY);

    // ✅关键点：画布创建为【物理像素尺寸】，rect.width * scaleX
    const outW = Math.round(rect.width * scaleX);
    const outH = Math.round(rect.height * scaleY);
    const canvas = new OffscreenCanvas(outW, outH);
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
      outW, outH   // ✅目标绘制尺寸使用物理像素，不要再用rect.width/height
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
    console.error("裁剪图片失败:", error);
    return cropImageFallback(dataUrl, rect, viewportSize);
  }
}


async function getScrollPosition(tabId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId: tabId },
      func: () => ({
        x: window.scrollX,
        y: window.scrollY
      })
    });
    return result[0].result;
  } catch (error) {
    console.error("获取滚动位置失败:", error);
    return { x: 0, y: 0 };
  }
}

async function restoreScrollPosition(tabId, position) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tabId },
      func: (x, y) => {
        window.scrollTo(x, y);
      },
      args: [position.x, position.y]
    });
    await delay(100);
  } catch (error) {
    console.error("恢复滚动位置失败:", error);
  }
}

async function captureScrollingElement(tabId, elementRect, windowId, viewportSize) {
  try {
    const elementHeight = elementRect.height;
    const viewportHeight = elementRect.viewportHeight || viewportSize.height;
    const elementStart = elementRect.top;

    const segments = Math.ceil(elementHeight / viewportHeight);
    const segmentHeight = Math.trunc(elementHeight / segments);

    let fullCanvas = null;
    let globalScaleX = 1;
    let globalScaleY = 1;

    for (let i = 0; i < segments; i++) {
      console.log(`正在截图第 ${i + 1}/${segments} 段...`);

      const scrollY = elementStart + (i * segmentHeight);

      await chrome.scripting.executeScript({
        target: { tabId: tabId },
        func: (scrollY) => {
          window.scrollTo({
            top: scrollY,
            behavior: 'instant'
          });
        },
        args: [scrollY]
      });

      await delay(200);

      const dataUrl = await chrome.tabs.captureVisibleTab(windowId, {
        format: "png",
        quality: 100,
        scale: 2
      });

      const currentHeight = Math.min(segmentHeight, elementHeight - (i * segmentHeight));

      const cropRect = {
        left: Math.round(elementRect.left),
        top: 0,
        width: Math.round(elementRect.width),
        height: Math.round(currentHeight)
      };

      const segmentImage = await cropImageWithViewport(dataUrl, cropRect, viewportSize);
      const segmentBlob = await dataURLToBlob(segmentImage);
      const segmentBitmap = await createImageBitmap(segmentBlob);

      // 第一次循环拿到真实缩放因子
      if (!fullCanvas) {
        globalScaleX = segmentBitmap.width / cropRect.width;
        globalScaleY = segmentBitmap.height / cropRect.height;
        // ✅ 使用物理像素尺寸创建总画布
        const totalW = Math.round(elementRect.width * globalScaleX);
        const totalH = Math.round(elementRect.height * globalScaleY);
        fullCanvas = new OffscreenCanvas(totalW, totalH);
      }

      const ctx = fullCanvas.getContext("2d");
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";

      // ✅绘制目标Y位置也要乘scale
      const destY = Math.round(i * segmentHeight * globalScaleY);
      ctx.drawImage(segmentBitmap, 0, destY);

      console.log(`已完成第 ${i + 1}/${segments} 段截图`);

      if (i < segments - 1) {
        await delay(600);
      }
    }

    const finalBlob = await fullCanvas.convertToBlob({
      type: "image/png",
      quality: 1.0
    });

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


// 带视口信息的裁剪
async function cropImageWithViewport(dataUrl, rect, viewportSize) {
  try {
    const response = await fetch(dataUrl);
    const blob = await response.blob();
    const imageBitmap = await createImageBitmap(blob);

    const scaleX = imageBitmap.width / viewportSize.width;
    const scaleY = imageBitmap.height / viewportSize.height;

    // ✅物理像素画布
    const outW = Math.round(rect.width * scaleX);
    const outH = Math.round(rect.height * scaleY);
    const canvas = new OffscreenCanvas(outW, outH);
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
      outW, outH
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
    console.error("裁剪失败:", error);
    throw error;
  }
}


// 高质量裁剪图片（修复坐标缩放问题）
async function cropImageHighQuality(dataUrl, rect) {
  try {
    const response = await fetch(dataUrl);
    const blob = await response.blob();
    const imageBitmap = await createImageBitmap(blob);
    
    // 获取原始图片的实际尺寸
    const originalWidth = imageBitmap.width;
    const originalHeight = imageBitmap.height;
    
    // 获取视口尺寸（截图时页面的实际尺寸）
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    
    // 计算缩放比例（截图实际尺寸 vs 逻辑尺寸）
    // 通常 captureVisibleTab 返回的是实际像素尺寸，可能受设备像素比影响
    const scaleX = originalWidth / viewportWidth;
    const scaleY = originalHeight / viewportHeight;
    
    console.log("截图尺寸:", originalWidth, "x", originalHeight);
    console.log("视口尺寸:", viewportWidth, "x", viewportHeight);
    console.log("缩放比例:", scaleX, scaleY);
    console.log("裁剪区域:", rect);
    
    // 创建目标 canvas
    const canvas = new OffscreenCanvas(rect.width, rect.height);
    const ctx = canvas.getContext("2d");
    
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    
    // 根据缩放比例调整裁剪坐标和尺寸
    ctx.drawImage(
      imageBitmap,
      rect.left * scaleX,      // 调整 X 坐标
      rect.top * scaleY,       // 调整 Y 坐标
      rect.width * scaleX,     // 调整宽度
      rect.height * scaleY,    // 调整高度
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
    console.error("裁剪图片失败:", error);
    return cropImageFallback(dataUrl, rect, viewportSize);
  }
}

async function cropImageFallback(dataUrl, rect, viewportSize = null) {
  try {
    const response = await fetch(dataUrl);
    const blob = await response.blob();
    const imageBitmap = await createImageBitmap(blob);

    let outW, outH;
    if (viewportSize) {
      const scaleX = imageBitmap.width / viewportSize.width;
      const scaleY = imageBitmap.height / viewportSize.height;
      outW = Math.round(rect.width * scaleX);
      outH = Math.round(rect.height * scaleY);
    } else {
      outW = Math.round(rect.width);
      outH = Math.round(rect.height);
    }

    const canvas = new OffscreenCanvas(outW, outH);
    const ctx = canvas.getContext("2d");

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";

    let srcX = rect.left;
    let srcY = rect.top;
    let srcW = rect.width;
    let srcH = rect.height;
    if(viewportSize){
      const scaleX = imageBitmap.width / viewportSize.width;
      const scaleY = imageBitmap.height / viewportSize.height;
      srcX = rect.left * scaleX;
      srcY = rect.top * scaleY;
      srcW = rect.width * scaleX;
      srcH = rect.height * scaleY;
    }

    ctx.drawImage(
      imageBitmap,
      srcX, srcY, srcW, srcH,
      0, 0, outW, outH
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
    console.error("备用裁剪也失败:", error);
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
      while (n--) {
        u8arr[n] = bstr.charCodeAt(n);
      }
      resolve(new Blob([u8arr], { type: mime }));
    } catch (error) {
      reject(error);
    }
  });
}

console.log("Background script loaded");
