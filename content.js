(() => {
  const DEFAULTS = {
    enabled: true,
    offsetMs: 0,
    fps: 45
  };

  let settings = { ...DEFAULTS };

  let lockedVideo = null;

  let canvas = null;
  let ctx = null;
  let labelOverlay = null;
  let infoBox = null;

  let hoverPanel = null;
  let hoverSlider = null;
  let hoverValue = null;
  let hoverEnabled = null;
  let hoverHideTimer = null;
  let hoverFpsSlider = null;
  let hoverFpsValue = null;

  let rafId = null;

  const frameQueue = [];
  const maxQueueMs = 1200;
  let lastCaptureTime = 0;
  let captureIntervalMs = 1000 / 45;

  let isUiMode = false;
  let uiModeTimer = null;
  const uiModeHoldMs = 1800;
  const controlBarHeight = 64;

  let audioCtx = null;
  let delayNode = null;
  let audioSource = null;
  let dryGain = null;
  let wetGain = null;
  let audioVideo = null;
  let audioInitialized = false;

  let videoResetHandler = null;

  function getOffsetMs() {
    return Number(settings.offsetMs || 0);
  }

  function getFps() {
    return Number(settings.fps || 45);
  }

  function updateCaptureInterval() {
    const fps = getFps();
    captureIntervalMs = 1000 / fps;
  }

  async function saveSettings(partial) {
    settings = { ...settings, ...partial };
    await chrome.storage.local.set(partial);
    if (partial.fps) {
      updateCaptureInterval();
    }
  }

  async function loadSettings() {
    settings = await chrome.storage.local.get(DEFAULTS);
    settings.offsetMs = Number(settings.offsetMs || 0);
    settings.enabled = !!settings.enabled;
  }

  function createInfoBox() {
    if (infoBox) return;

    infoBox = document.createElement("div");
    infoBox.style.position = "fixed";
    infoBox.style.left = "200px";
    infoBox.style.top = "16px";
    infoBox.style.zIndex = "1000000";
    infoBox.style.background = "rgba(0,0,0,0.3)";
    infoBox.style.color = "white";
    infoBox.style.padding = "10px 14px";
    infoBox.style.fontSize = "14px";
    infoBox.style.borderRadius = "8px";
    infoBox.style.fontFamily = "sans-serif";
    infoBox.style.pointerEvents = "none";
    document.body.appendChild(infoBox);
  }

  function setInfo(text) {
    createInfoBox();
    infoBox.textContent = text;
  }

  function hideInfo() {
    if (infoBox) {
      infoBox.textContent = "";
    }
  }

  function ensureLabelOverlay() {
    if (!lockedVideo || !settings.enabled) return false;

    if (!labelOverlay) {
      labelOverlay = document.createElement("div");
      labelOverlay.id = "yt-bt-sync-label";
      labelOverlay.style.position = "fixed";
      labelOverlay.style.left = "0px";
      labelOverlay.style.top = "0px";
      labelOverlay.style.zIndex = "20";
      labelOverlay.style.pointerEvents = "auto";
      labelOverlay.style.cursor = "pointer";
      labelOverlay.style.background = "rgba(255, 0, 0, 0.35)";
      labelOverlay.style.color = "yellow";
      labelOverlay.style.font = "bold 28px sans-serif";
      labelOverlay.style.padding = "10px 16px";
      labelOverlay.style.boxSizing = "border-box";
      labelOverlay.style.height = "52px";
      labelOverlay.style.lineHeight = "32px";
      labelOverlay.style.whiteSpace = "nowrap";

      labelOverlay.addEventListener("mouseenter", () => {
        showHoverPanel();
      });

      labelOverlay.addEventListener("mouseleave", () => {
        scheduleHideHoverPanel();
      });

      document.body.appendChild(labelOverlay);
    }

    return true;
  }

  function syncLabelToVideo() {
    if (!lockedVideo || !labelOverlay || !settings.enabled) return;

    const r = lockedVideo.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return;

    labelOverlay.style.left = `${Math.round(r.left)}px`;
    labelOverlay.style.top = `${Math.round(r.top)}px`;
    labelOverlay.style.width = `${Math.round(r.width)}px`;
    labelOverlay.style.display = "block";
  }

  function updateLabel() {
    if (!labelOverlay || !settings.enabled) return;
    const ms = getOffsetMs();
    const sign = ms > 0 ? "+" : "";
    labelOverlay.textContent = `DELAY ${sign}${ms} ms`;
  }

  function hideLabel() {
    if (labelOverlay) {
      labelOverlay.style.display = "none";
    }
  }

  function ensureHoverPanel() {
    if (hoverPanel) return;

    hoverPanel = document.createElement("div");
    hoverPanel.id = "yt-bt-sync-hover-panel";
    hoverPanel.style.position = "fixed";
    hoverPanel.style.zIndex = "1000001";
    hoverPanel.style.background = "rgba(0,0,0,0.92)";
    hoverPanel.style.color = "white";
    hoverPanel.style.padding = "12px";
    hoverPanel.style.borderRadius = "10px";
    hoverPanel.style.fontFamily = "sans-serif";
    hoverPanel.style.fontSize = "13px";
    hoverPanel.style.width = "300px";
    hoverPanel.style.boxShadow = "0 6px 20px rgba(0,0,0,0.35)";
    hoverPanel.style.display = "none";
    hoverPanel.style.pointerEvents = "auto";

    const title = document.createElement("div");
    title.textContent = "DELAY調整";
    title.style.fontWeight = "bold";
    title.style.marginBottom = "10px";

    const enabledRow = document.createElement("label");
    enabledRow.style.display = "flex";
    enabledRow.style.alignItems = "center";
    enabledRow.style.gap = "8px";
    enabledRow.style.marginBottom = "10px";
    enabledRow.style.cursor = "pointer";

    hoverEnabled = document.createElement("input");
    hoverEnabled.type = "checkbox";

    const enabledText = document.createElement("span");
    enabledText.textContent = "補正を有効化";

    enabledRow.appendChild(hoverEnabled);
    enabledRow.appendChild(enabledText);

    hoverValue = document.createElement("div");
    hoverValue.style.marginBottom = "8px";
    hoverValue.style.color = "yellow";
    hoverValue.style.fontWeight = "bold";

    hoverSlider = document.createElement("input");
    hoverSlider.type = "range";
    hoverSlider.min = "-300";
    hoverSlider.max = "300";
    hoverSlider.step = "10";
    hoverSlider.value = "0";
    hoverSlider.style.width = "100%";
    hoverSlider.setAttribute("list", "yt-bt-sync-ticks");

    const tickList = document.createElement("datalist");
    tickList.id = "yt-bt-sync-ticks";

    [-300, -200, -100, 0, 100, 200, 300].forEach(v => {
      const opt = document.createElement("option");
      opt.value = String(v);
      tickList.appendChild(opt);
    });

    const scaleRow = document.createElement("div");
    scaleRow.style.display = "flex";
    scaleRow.style.justifyContent = "space-between";
    scaleRow.style.marginTop = "6px";
    scaleRow.style.fontSize = "11px";
    scaleRow.style.color = "#ccc";

    [-300, -200, -100, 0, 100, 200, 300].forEach(v => {
      const s = document.createElement("span");
      s.textContent = String(v);
      scaleRow.appendChild(s);
    });

    hoverEnabled.addEventListener("change", async () => {
      const enabled = hoverEnabled.checked;
      await saveSettings({ enabled });

      if (!enabled) {
        disableAllEffects();
        hideLabel();
        hideHoverPanelImmediate();
        // ここで音声対象を壊さず、まず元音へ戻す
        if (audioVideo) {
          audioVideo.muted = false;
        }
        lockedVideo = null;
        setInfo("補正を無効化しました / 再開は Alt+クリックで動画を再選択");
      }
    });

    hoverSlider.addEventListener("input", async () => {
      const offsetMs = Number(hoverSlider.value);
      hoverValue.textContent = `${offsetMs} ms`;
      await saveSettings({ offsetMs });

      updateLabel();
      applyMode();
    });

    const fpsRow = document.createElement("div");
    fpsRow.style.marginTop = "12px";
    fpsRow.style.paddingTop = "10px";
    fpsRow.style.borderTop = "1px solid rgba(255,255,255,0.2)";

    const fpsLabel = document.createElement("div");
    fpsLabel.style.marginBottom = "8px";
    fpsLabel.textContent = "フレームレート";
    fpsLabel.style.fontWeight = "bold";
    fpsLabel.style.fontSize = "12px";

    hoverFpsValue = document.createElement("div");
    hoverFpsValue.style.marginBottom = "8px";
    hoverFpsValue.style.color = "#ffff99";
    hoverFpsValue.style.fontWeight = "bold";

    hoverFpsSlider = document.createElement("input");
    hoverFpsSlider.type = "range";
    hoverFpsSlider.min = "15";
    hoverFpsSlider.max = "60";
    hoverFpsSlider.step = "1";
    hoverFpsSlider.value = "45";
    hoverFpsSlider.style.width = "100%";
    hoverFpsSlider.setAttribute("list", "yt-bt-sync-fps-ticks");

    const fpsTicks = document.createElement("datalist");
    fpsTicks.id = "yt-bt-sync-fps-ticks";
    [15, 30, 45, 60].forEach(v => {
      const opt = document.createElement("option");
      opt.value = String(v);
      fpsTicks.appendChild(opt);
    });

    const fpsScaleRow = document.createElement("div");
    fpsScaleRow.style.display = "flex";
    fpsScaleRow.style.justifyContent = "space-between";
    fpsScaleRow.style.marginTop = "6px";
    fpsScaleRow.style.fontSize = "11px";
    fpsScaleRow.style.color = "#ccc";

    [15, 30, 45, 60].forEach(v => {
      const s = document.createElement("span");
      s.textContent = String(v);
      fpsScaleRow.appendChild(s);
    });

    hoverFpsSlider.addEventListener("input", async () => {
      const fps = Number(hoverFpsSlider.value);
      hoverFpsValue.textContent = `${fps} FPS`;
      await saveSettings({ fps });
    });

    fpsRow.appendChild(fpsLabel);
    fpsRow.appendChild(hoverFpsValue);
    fpsRow.appendChild(hoverFpsSlider);
    fpsRow.appendChild(fpsTicks);
    fpsRow.appendChild(fpsScaleRow);

    hoverPanel.addEventListener("mouseenter", () => {
      if (hoverHideTimer) {
        clearTimeout(hoverHideTimer);
        hoverHideTimer = null;
      }
    });

    hoverPanel.addEventListener("mouseleave", () => {
      scheduleHideHoverPanel();
    });

    hoverPanel.appendChild(title);
    hoverPanel.appendChild(enabledRow);
    hoverPanel.appendChild(hoverValue);
    hoverPanel.appendChild(hoverSlider);
    hoverPanel.appendChild(tickList);
    hoverPanel.appendChild(scaleRow);
    hoverPanel.appendChild(fpsRow);

    document.body.appendChild(hoverPanel);
  }

  function updateHoverPanelValue() {
    if (!hoverPanel) return;
    hoverEnabled.checked = !!settings.enabled;
    hoverSlider.value = String(getOffsetMs());
    hoverValue.textContent = `${getOffsetMs()} ms`;
    if (hoverFpsSlider) {
      hoverFpsSlider.value = String(getFps());
      hoverFpsValue.textContent = `${getFps()} FPS`;
    }
  }

  function showHoverPanel() {
    if (!labelOverlay || !settings.enabled) return;

    ensureHoverPanel();
    updateHoverPanelValue();

    const r = labelOverlay.getBoundingClientRect();
    hoverPanel.style.left = `${Math.round(r.left)}px`;
    hoverPanel.style.top = `${Math.round(r.bottom + 8)}px`;
    hoverPanel.style.display = "block";

    if (hoverHideTimer) {
      clearTimeout(hoverHideTimer);
      hoverHideTimer = null;
    }
  }

  function scheduleHideHoverPanel() {
    if (hoverHideTimer) {
      clearTimeout(hoverHideTimer);
    }

    hoverHideTimer = setTimeout(() => {
      if (hoverPanel) {
        hoverPanel.style.display = "none";
      }
    }, 250);
  }

  function hideHoverPanelImmediate() {
    if (hoverHideTimer) {
      clearTimeout(hoverHideTimer);
      hoverHideTimer = null;
    }
    if (hoverPanel) {
      hoverPanel.style.display = "none";
    }
  }

  function enterUiMode() {
    isUiMode = true;

    if (uiModeTimer) {
      clearTimeout(uiModeTimer);
    }

    uiModeTimer = setTimeout(() => {
      isUiMode = false;
    }, uiModeHoldMs);
  }

  function clearFrames() {
    while (frameQueue.length > 0) {
      const f = frameQueue.shift();
      if (f.bmp?.close) {
        try {
          f.bmp.close();
        } catch {}
      }
    }
  }

  function resetOriginalVideoStyle() {
    if (!lockedVideo) return;
    lockedVideo.style.opacity = "";
    lockedVideo.style.clipPath = "";
  }

  function ensureAudioContextRunning() {
    if (audioCtx && audioCtx.state === "suspended") {
      audioCtx.resume().catch((e) => {
        console.warn("[YT-BT-SYNC] AudioContext resume failed", e);
      });
    }
  }

  function setupAudioDelayForVideo(video) {
    if (!video) return false;

    if (
      audioInitialized &&
      audioVideo === video &&
      audioCtx &&
      audioSource &&
      delayNode &&
      dryGain &&
      wetGain
    ) {
      return true;
    }

    teardownAudioDelay();

    try {
      audioCtx = new AudioContext();
      audioSource = audioCtx.createMediaElementSource(video);

      delayNode = audioCtx.createDelay(5.0);
      dryGain = audioCtx.createGain();
      wetGain = audioCtx.createGain();

      delayNode.delayTime.value = 0;
      dryGain.gain.value = 1.0;
      wetGain.gain.value = 0.0;

      audioSource.connect(dryGain).connect(audioCtx.destination);
      audioSource.connect(delayNode).connect(wetGain).connect(audioCtx.destination);

      video.muted = false;

      audioVideo = video;
      audioInitialized = true;

      console.log("[YT-BT-SYNC] Audio delay pipeline connected");
      return true;
    } catch (e) {
      console.error("[YT-BT-SYNC] Error initializing audio:", e);
      teardownAudioDelay();
      return false;
    }
  }

  function setAudioDelayMs(offsetMs) {
    if (!delayNode || !dryGain || !wetGain) return false;

    const sec = Math.max(0, Math.min(5, Math.abs(offsetMs) / 1000));
    delayNode.delayTime.value = sec;

    if (offsetMs < 0) {
      dryGain.gain.value = 0.0;
      wetGain.gain.value = 1.0;
    } else {
      dryGain.gain.value = 1.0;
      wetGain.gain.value = 0.0;
    }

    console.log(`[YT-BT-SYNC] Audio delay set to ${sec} sec`);
    return true;
  }

  function applyNegativeOffset() {
    if (!lockedVideo) return;

    const ok = setupAudioDelayForVideo(lockedVideo);
    if (!ok) return;

    ensureAudioContextRunning();
    setAudioDelayMs(getOffsetMs());

    console.log(
      "[AUDIO STATE]",
      audioCtx?.state,
      !!delayNode,
      !!dryGain,
      !!wetGain,
      audioVideo === lockedVideo
    );
  }

  function disableNegativeOffset() {
    if (dryGain && wetGain) {
      dryGain.gain.value = 1.0;
      wetGain.gain.value = 0.0;
    }

    if (lockedVideo) {
      lockedVideo.muted = false;
    }

    if (audioVideo) {
      audioVideo.muted = false;
    }
  }

  function teardownAudioDelay() {
    try {
      if (audioSource) audioSource.disconnect();
    } catch {}

    try {
      if (delayNode) delayNode.disconnect();
    } catch {}

    try {
      if (dryGain) dryGain.disconnect();
    } catch {}

    try {
      if (wetGain) wetGain.disconnect();
    } catch {}

    try {
      if (audioCtx) audioCtx.close();
    } catch {}

    if (audioVideo) {
      try {
        audioVideo.muted = false;
      } catch {}
    }

    audioCtx = null;
    audioSource = null;
    delayNode = null;
    dryGain = null;
    wetGain = null;
    audioVideo = null;
    audioInitialized = false;
  }

  function ensureCanvas() {
    if (!lockedVideo) return false;

    if (!canvas) {
      canvas = document.createElement("canvas");
      canvas.id = "yt-bt-sync-canvas";
      canvas.style.position = "fixed";
      canvas.style.left = "0px";
      canvas.style.top = "0px";
      canvas.style.zIndex = "10";
      canvas.style.pointerEvents = "none";
      canvas.style.background = "transparent";
      document.body.appendChild(canvas);
      ctx = canvas.getContext("2d");
    }

    return true;
  }

  function syncCanvasToVideo() {
    if (!lockedVideo || !canvas || !ctx) return null;

    const r = lockedVideo.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return null;

    canvas.style.left = `${Math.round(r.left)}px`;
    canvas.style.top = `${Math.round(r.top)}px`;
    canvas.style.width = `${Math.round(r.width)}px`;
    canvas.style.height = `${Math.round(r.height)}px`;

    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(r.width * dpr));
    const h = Math.max(1, Math.round(r.height * dpr));

    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);

    return r;
  }

  async function captureFrameIfNeeded() {
    const offsetMs = getOffsetMs();

    if (offsetMs <= 0) return;
    if (!lockedVideo || lockedVideo.readyState < 2) return;
    if (lockedVideo.paused || lockedVideo.ended) return;

    const now = performance.now();
    if (now - lastCaptureTime < captureIntervalMs) return;
    lastCaptureTime = now;

    try {
      const bmp = await createImageBitmap(lockedVideo);
      frameQueue.push({
        t: now,
        bmp
      });

      const cutoff = now - maxQueueMs;
      while (frameQueue.length > 0 && frameQueue[0].t < cutoff) {
        const old = frameQueue.shift();
        if (old.bmp?.close) {
          try {
            old.bmp.close();
          } catch {}
        }
      }
    } catch (e) {
      console.log("[YT-BT-SYNC] captureFrame failed", e);
    }
  }

  function getDelayedFrame() {
    const target = performance.now() - getOffsetMs();

    for (let i = frameQueue.length - 1; i >= 0; i--) {
      if (frameQueue[i].t <= target) {
        return frameQueue[i];
      }
    }

    return frameQueue.length > 0 ? frameQueue[0] : null;
  }

  function disableAllEffects() {
    // 音は「元に戻す」だけで、ここでは壊さない
    disableNegativeOffset();

    resetOriginalVideoStyle();

    if (canvas) {
      canvas.style.display = "none";
      canvas.style.clipPath = "";
    }

    clearFrames();
  }

  function applyMode() {
    if (!lockedVideo) return;

    const offsetMs = getOffsetMs();

    if (!settings.enabled) {
      disableAllEffects();
      return;
    }

    if (offsetMs < 0) {
      resetOriginalVideoStyle();

      if (canvas) {
        canvas.style.display = "none";
        canvas.style.clipPath = "";
      }

      applyNegativeOffset();
      return;
    }

    if (offsetMs === 0) {
      disableNegativeOffset();
      resetOriginalVideoStyle();

      if (canvas) {
        canvas.style.display = "none";
        canvas.style.clipPath = "";
      }
      return;
    }

    disableNegativeOffset();

    if (canvas) {
      canvas.style.display = "block";
    }
  }

  async function draw() {
    if (!lockedVideo || !settings.enabled) return;

    ensureLabelOverlay();
    syncLabelToVideo();
    updateLabel();

    const offsetMs = getOffsetMs();

    if (offsetMs <= 0) {
      resetOriginalVideoStyle();

      if (canvas) {
        canvas.style.display = "none";
        canvas.style.clipPath = "";
      }
      return;
    }

    if (!ensureCanvas()) return;

    const r = syncCanvasToVideo();
    if (!r) return;

    canvas.style.display = "block";

    if (isUiMode) {
      canvas.style.clipPath = `inset(0px 0px ${controlBarHeight}px 0px)`;
    } else {
      canvas.style.clipPath = "";
    }

    await captureFrameIfNeeded();

    ctx.clearRect(0, 0, r.width, r.height);

    const frame = getDelayedFrame();
    if (frame?.bmp) {
      try {
        ctx.drawImage(frame.bmp, 0, 0, r.width, r.height);
        lockedVideo.style.opacity = "0";
        lockedVideo.style.clipPath = "";
      } catch (e) {
        resetOriginalVideoStyle();
        console.log("[YT-BT-SYNC] draw delayed frame failed", e);
      }
    } else {
      resetOriginalVideoStyle();
    }
  }

  async function loop() {
    await draw();
    rafId = requestAnimationFrame(loop);
  }

  function pickVideoFromClick(clientX, clientY) {
    const els = document.elementsFromPoint(clientX, clientY);
    const directVideo = els.find(el => el.tagName === "VIDEO");
    if (directVideo) return directVideo;

    const allVideos = Array.from(document.querySelectorAll("video"));
    if (allVideos.length === 0) return null;

    let best = null;
    let bestScore = Infinity;

    for (const v of allVideos) {
      const r = v.getBoundingClientRect();
      if (r.width < 50 || r.height < 50) continue;

      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const dx = cx - clientX;
      const dy = cy - clientY;
      const dist2 = dx * dx + dy * dy;

      if (dist2 < bestScore) {
        bestScore = dist2;
        best = v;
      }
    }

    return best;
  }

  function detachVideoEvents(video) {
    if (!video || !videoResetHandler) return;

    video.removeEventListener("seeking", videoResetHandler);
    video.removeEventListener("seeked", videoResetHandler);
    video.removeEventListener("emptied", videoResetHandler);
    video.removeEventListener("loadeddata", videoResetHandler);
  }

  function attachVideoEvents(video) {
    if (!video) return;

    videoResetHandler = () => {
      clearFrames();
      lastCaptureTime = 0;
    };

    video.addEventListener("seeking", videoResetHandler);
    video.addEventListener("seeked", videoResetHandler);
    video.addEventListener("emptied", videoResetHandler);
    video.addEventListener("loadeddata", videoResetHandler);
  }

  async function lockVideo(v) {
    if (!v) {
      setInfo("video が見つかりません");
      return;
    }

    if (lockedVideo && lockedVideo !== v) {
      detachVideoEvents(lockedVideo);
      teardownAudioDelay();
    }

    clearFrames();
    resetOriginalVideoStyle();

    lockedVideo = v;
    attachVideoEvents(lockedVideo);

    ensureLabelOverlay();
    syncLabelToVideo();
    updateLabel();
    ensureHoverPanel();
    updateHoverPanelValue();

    if (!settings.enabled) {
      await saveSettings({ enabled: true });
    }

    setInfo(`動画選択済み / Alt+クリックで再選択 / ${getOffsetMs()} ms`);

    applyMode();

    if (!rafId) {
      loop();
    }
  }

  function cleanupAll() {
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }

    if (uiModeTimer) {
      clearTimeout(uiModeTimer);
      uiModeTimer = null;
    }

    if (hoverHideTimer) {
      clearTimeout(hoverHideTimer);
      hoverHideTimer = null;
    }

    isUiMode = false;

    detachVideoEvents(lockedVideo);

    teardownAudioDelay();
    resetOriginalVideoStyle();

    if (canvas) {
      canvas.style.clipPath = "";
    }

    if (canvas?.parentElement) {
      canvas.parentElement.removeChild(canvas);
    }
    if (labelOverlay?.parentElement) {
      labelOverlay.parentElement.removeChild(labelOverlay);
    }
    if (hoverPanel?.parentElement) {
      hoverPanel.parentElement.removeChild(hoverPanel);
    }
    if (infoBox?.parentElement) {
      infoBox.parentElement.removeChild(infoBox);
    }

    clearFrames();

    canvas = null;
    ctx = null;
    labelOverlay = null;
    hoverPanel = null;
    hoverSlider = null;
    hoverValue = null;
    hoverEnabled = null;
    infoBox = null;
    lockedVideo = null;
    lastCaptureTime = 0;
  }

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local") return;

    if (changes.enabled) {
      settings.enabled = !!changes.enabled.newValue;
    }
    if (changes.offsetMs) {
      settings.offsetMs = Number(changes.offsetMs.newValue || 0);
    }

    updateHoverPanelValue();

    if (!settings.enabled) {
      hideLabel();
      hideHoverPanelImmediate();
      disableAllEffects();
      if (audioVideo) {
        audioVideo.muted = false;
      }
      lockedVideo = null;
      setInfo("補正を無効化しました / 再開は Alt+クリックで動画を再選択");
      return;
    }

    if (lockedVideo) {
      ensureLabelOverlay();
      updateLabel();
      applyMode();
      setInfo(`動画選択済み / Alt+クリックで再選択 / ${getOffsetMs()} ms`);
    }
  });

  document.addEventListener(
    "mousemove",
    (e) => {
      if (!lockedVideo || !settings.enabled) return;
      if (getOffsetMs() <= 0) return;

      const r = lockedVideo.getBoundingClientRect();
      const inside =
        e.clientX >= r.left &&
        e.clientX <= r.right &&
        e.clientY >= r.top &&
        e.clientY <= r.bottom;

      if (inside) {
        enterUiMode();
      }
    },
    true
  );

  document.addEventListener(
    "click",
    (e) => {
      if (e.altKey) {
        const v = pickVideoFromClick(e.clientX, e.clientY);
        lockVideo(v);
        e.preventDefault();
        e.stopPropagation();
      } else {
        ensureAudioContextRunning();
      }
    },
    true
  );

  async function init() {
    await loadSettings();
    createInfoBox();

    if (settings.enabled) {
      setInfo("Alt を押しながら動画部分をクリック");
    } else {
      setInfo("補正は無効です / Alt+クリックで動画を選択すると再開");
    }
  }

  init();

  window.addEventListener("beforeunload", () => {
    cleanupAll();
  });
})();