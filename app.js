// pdf.js global
pdfjsLib.GlobalWorkerOptions.workerSrc =
  "https://unpkg.com/pdfjs-dist@3.11.174/build/pdf.worker.min.js";

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const state = {
  files: {
    sabika_kaydi: null,
    diploma: null,
    saglik_raporu: null,
    biyometrik_foto: null,
  },
  outputs: {
    sabika_kaydi: null, // { blob, url, filename }
    diploma: null,
    saglik_raporu: null,
    biyometrik_foto: null,
  }
};

function sanitizeNamePart(s) {
  return (s || "")
    .trim()
    .replace(/\s+/g, "_")
    .replace(/[^a-zA-Z0-9_\-çğıöşüÇĞİÖŞÜ]/g, "");
}

function canConvert() {
  return Object.values(state.files).some(Boolean);
}

function updateTopButtons() {
  $("#btnConvert").disabled = !canConvert();
  const anyOut = Object.values(state.outputs).some(Boolean);
  $("#btnDownloadAll").disabled = !anyOut;
}

function formatBytes(bytes) {
  if (!bytes && bytes !== 0) return "";
  const units = ["B", "KB", "MB", "GB"];
  let v = bytes, i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

// ===================== PDF -> JPEG =====================
async function renderPdfFirstPageToJpegBlob(file, quality = 0.92, scale = 2.0) {
  const ab = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: ab }).promise;
  const page = await pdf.getPage(1);

  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { alpha: false });

  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);

  await page.render({ canvasContext: ctx, viewport }).promise;

  const blob = await new Promise((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", quality)
  );

  canvas.width = 0; canvas.height = 0;
  return blob;
}

// ===================== BIOMETRIC HELPERS =====================
function mmToPx(mm, dpi = 300) {
  return Math.round((mm / 25.4) * dpi);
}

function getBioTarget(sizeStr) {
  if (sizeStr === "50x60") return { w: mmToPx(50), h: mmToPx(60), label: "50x60" };
  return { w: mmToPx(35), h: mmToPx(45), label: "35x45" };
}

async function imageFileToCanvas(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; });

    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d", { alpha: false });
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    ctx.drawImage(img, 0, 0);

    return { canvas, ctx };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * MediaPipe segmentation ile arka planı beyaza çeker.
 * - İnsan bölgesi korunur
 * - Arka plan saf beyaz olur
 *
 * Gereksinim: index.html içinde SelfieSegmentation script'i yüklü olmalı.
 */
async function whitenBackgroundWithSegmentation(srcCanvas) {
  if (typeof SelfieSegmentation === "undefined") {
    throw new Error("SelfieSegmentation yüklenmedi. index.html'e mediapipe script'i ekle.");
  }

  return new Promise((resolve, reject) => {
    const segmentation = new SelfieSegmentation({
      locateFile: (file) =>
        `https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation/${file}`
    });

    segmentation.setOptions({ modelSelection: 1 });

    segmentation.onResults((results) => {
      try {
        const w = srcCanvas.width;
        const h = srcCanvas.height;

        const outCanvas = document.createElement("canvas");
        outCanvas.width = w;
        outCanvas.height = h;
        const ctx = outCanvas.getContext("2d");

        // 1) Orijinal resmi çiz
        ctx.drawImage(srcCanvas, 0, 0);

        // 2) Maskeyle arka planı kes (sadece insan kalsın)
        ctx.globalCompositeOperation = "destination-in";
        ctx.drawImage(results.segmentationMask, 0, 0, w, h);

        // 3) Arkaya beyaz bas
        ctx.globalCompositeOperation = "destination-over";
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, w, h);

        // 4) normale dön
        ctx.globalCompositeOperation = "source-over";

        resolve(outCanvas);
      } catch (e) {
        reject(e);
      }
    });

    segmentation.send({ image: srcCanvas }).catch(reject);
  });
}

// Merkezden kırp + hedef boyuta ölçekle + opsiyonel arka plan beyaz
async function makeBiometricJpeg(file, sizeStr, doWhiten) {
  const { canvas: srcCanvas } = await imageFileToCanvas(file);

  let baseCanvas = srcCanvas;
  if (doWhiten) {
    baseCanvas = await whitenBackgroundWithSegmentation(srcCanvas);
  }

  const target = getBioTarget(sizeStr);
  const tw = target.w, th = target.h;

  const targetRatio = tw / th;
  const sw = baseCanvas.width;
  const sh = baseCanvas.height;
  const srcRatio = sw / sh;

  let cropW, cropH;
  if (srcRatio > targetRatio) {
    cropH = sh;
    cropW = Math.round(sh * targetRatio);
  } else {
    cropW = sw;
    cropH = Math.round(sw / targetRatio);
  }

  const cropX = Math.round((sw - cropW) / 2);
  const cropY = Math.round((sh - cropH) / 2);

  const outCanvas = document.createElement("canvas");
  outCanvas.width = tw;
  outCanvas.height = th;

  const outCtx = outCanvas.getContext("2d", { alpha: false });
  outCtx.imageSmoothingEnabled = true;
  outCtx.imageSmoothingQuality = "high";

  outCtx.drawImage(baseCanvas, cropX, cropY, cropW, cropH, 0, 0, tw, th);

  const blob = await new Promise((resolve) =>
    outCanvas.toBlob(resolve, "image/jpeg", 0.92)
  );

  return blob;
}

// ===================== PDF CARD LOGIC =====================
function attachCardLogic(card) {
  const docKey = card.dataset.doc;

  // biyometrik kart bu fonksiyona girmesin
  if (docKey === "biyometrik_foto") return;

  const fileInput = $(".fileInput", card);
  const dropzone = $(".dropzone", card);
  const meta = $(".fileMeta", card);
  const dzInner = $(".dz-inner", card);

  const btnAdd = $(".btnAdd", card);
  const btnClear = $(".btnClear", card);

  const result = $(".result", card);
  const thumbWrap = $(".thumbWrap", card);
  const thumb = $(".thumb", card);
  const btnDownload = $(".btnDownload", card);

  // ✅ Null koruması (sayfa çökmesin)
  if (!fileInput || !dropzone || !meta || !dzInner || !btnAdd || !btnClear || !result || !thumbWrap || !thumb || !btnDownload) {
    console.error("PDF kartında eksik element var:", docKey, {
      fileInput, dropzone, meta, dzInner, btnAdd, btnClear, result, thumbWrap, thumb, btnDownload
    });
    return;
  }

  // Durum satırı
  let statusHost = $(".statusRow", card);
  if (!statusHost) {
    statusHost = document.createElement("div");
    statusHost.className = "statusRow";
    statusHost.innerHTML = `
      <span class="badge">Henüz PDF yüklenmedi</span>
      <span class="mono"></span>
    `;
    card.appendChild(statusHost);
  }
  const statusBadge = statusHost.querySelector("span");
  const statusInfo = statusHost.querySelectorAll("span")[1];

  // Download kilitli
  btnDownload.classList.add("is-disabled");
  btnDownload.setAttribute("aria-disabled", "true");
  btnDownload.removeAttribute("href");
  btnDownload.removeAttribute("download");

  btnDownload.addEventListener("click", (e) => {
    const out = state.outputs[docKey];
    if (!out?.url) {
      e.preventDefault();
      alert("Önce 🔄 Dönüştür işlemini yapmalısın. Dönüşüm sonrası JPEG indir aktif olur.");
    }
  });

  function showPdfPlaceholder(file) {
    result.classList.remove("hidden");
    result.style.display = "block";

    thumbWrap.classList.add("show", "placeholder");
    thumb.removeAttribute("src");

    thumbWrap.innerHTML = `
      <div class="pdfHolder">
        <div class="pdfIcon">📄</div>
        <div class="pdfName" title="${file.name}">${file.name}</div>
        <div class="pdfHint">Dönüştürmek için üstten 🔄 Dönüştür</div>
      </div>
    `;
  }

  function showJpegPreview(out) {
    result.classList.remove("hidden");
    result.style.display = "block";

    thumbWrap.classList.add("show");
    thumbWrap.classList.remove("placeholder");
    thumbWrap.innerHTML = "";
    thumbWrap.appendChild(thumb);

    thumb.removeAttribute("src");
    thumb.src = out.url;
  }

  function showFileMeta(file) {
    dzInner.classList.add("hidden");
    meta.classList.remove("hidden");
    meta.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:4px;min-width:0">
        <div style="font-weight:750;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
          ${file.name}
        </div>
        <div class="badge">${formatBytes(file.size)} • PDF</div>
      </div>
      <div class="badge">Hazır</div>
    `;

    statusBadge.className = "badge badge-ready";
    statusBadge.textContent = "PDF yüklü (hazır) 📄";
    statusInfo.textContent = file.name;

    showPdfPlaceholder(file);
  }

  function resetDownloadLocked() {
    btnDownload.classList.add("is-disabled");
    btnDownload.setAttribute("aria-disabled", "true");
    btnDownload.removeAttribute("href");
    btnDownload.removeAttribute("download");
  }

  function clearAll() {
    state.files[docKey] = null;
    if (state.outputs[docKey]?.url) URL.revokeObjectURL(state.outputs[docKey].url);
    state.outputs[docKey] = null;

    fileInput.value = "";
    meta.innerHTML = "";
    meta.classList.add("hidden");
    dzInner.classList.remove("hidden");

    result.classList.add("hidden");
    thumbWrap.classList.remove("show", "placeholder");
    thumbWrap.innerHTML = "";
    thumb.removeAttribute("src");

    btnClear.disabled = true;

    statusBadge.className = "badge";
    statusBadge.textContent = "Henüz PDF yüklenmedi";
    statusInfo.textContent = "";

    resetDownloadLocked();
    updateTopButtons();
  }

  async function setFile(file) {
    if (!file) return;
    if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
      alert("Lütfen sadece PDF dosyası yükleyin.");
      return;
    }

    if (state.outputs[docKey]?.url) {
      URL.revokeObjectURL(state.outputs[docKey].url);
      state.outputs[docKey] = null;
    }

    state.files[docKey] = file;
    btnClear.disabled = false;

    resetDownloadLocked();
    showFileMeta(file);

    updateTopButtons();
  }

  btnAdd.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", (e) => setFile(e.target.files?.[0]));
  btnClear.addEventListener("click", clearAll);

  dropzone.addEventListener("click", () => fileInput.click());
  dropzone.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") fileInput.click();
  });

  ["dragenter", "dragover"].forEach(evt => {
    dropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropzone.classList.add("dragover");
    });
  });
  ["dragleave", "drop"].forEach(evt => {
    dropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropzone.classList.remove("dragover");
    });
  });
  dropzone.addEventListener("drop", (e) => {
    const file = e.dataTransfer?.files?.[0];
    setFile(file);
  });

  card.__setOutput = (out) => {
    if (!out) return;

    showJpegPreview(out);

    btnDownload.href = out.url;
    btnDownload.setAttribute("download", out.filename);
    btnDownload.classList.remove("is-disabled");
    btnDownload.setAttribute("aria-disabled", "false");

    statusBadge.className = "badge badge-ok";
    statusBadge.textContent = "Dönüştürüldü ✅";
    statusInfo.textContent = out.filename;

    updateTopButtons();
  };

  card.__getKey = () => docKey;
  card.__clear = clearAll;
}

// ===================== BIO CARD LOGIC =====================
function attachBioLogic(card) {
  const docKey = "biyometrik_foto";

  const imgInput = $(".imgInput", card);
  const btnAdd = $(".btnAddImg", card);
  const btnClear = $(".btnClearImg", card);

  const dropzone = $(".bio-drop", card);
  const meta = $(".fileMeta", card);
  const dzInner = $(".dz-inner", card);

  const result = $(".result", card);
  const thumbWrap = $(".thumbWrap", card);
  const btnDownload = $(".btnDownloadBio", card);

  // ✅ Null koruması
  if (!imgInput || !btnAdd || !btnClear || !dropzone || !meta || !dzInner || !result || !thumbWrap || !btnDownload) {
    console.error("Biyometrik kartında eksik element var:", { imgInput, btnAdd, btnClear, dropzone, meta, dzInner, result, thumbWrap, btnDownload });
    return;
  }

  // Durum satırı
  let statusHost = $(".statusRow", card);
  if (!statusHost) {
    statusHost = document.createElement("div");
    statusHost.className = "statusRow";
    statusHost.innerHTML = `
      <span class="badge">Henüz fotoğraf yüklenmedi</span>
      <span class="mono"></span>
    `;
    card.appendChild(statusHost);
  }
  const statusBadge = statusHost.querySelector("span");
  const statusInfo = statusHost.querySelectorAll("span")[1];

  function lockDownload() {
    btnDownload.classList.add("is-disabled");
    btnDownload.setAttribute("aria-disabled", "true");
    btnDownload.removeAttribute("href");
    btnDownload.removeAttribute("download");
  }

  function unlockDownload(out) {
    btnDownload.classList.remove("is-disabled");
    btnDownload.setAttribute("aria-disabled", "false");
    btnDownload.href = out.url;
    btnDownload.download = out.filename;
  }

  lockDownload();

  btnDownload.addEventListener("click", (e) => {
    const out = state.outputs[docKey];
    if (!out?.url) {
      e.preventDefault();
      alert("Önce 🔄 Dönüştür ile biyometrik JPEG oluşturmalısın.");
    }
  });

  function showPhotoPlaceholder(nameText) {
    result.classList.remove("hidden");
    result.style.display = "block";

    thumbWrap.classList.add("show", "placeholder");
    thumbWrap.innerHTML = `
      <div class="pdfHolder">
        <div class="pdfIcon">📷</div>
        <div class="pdfName" title="${nameText || ""}">${nameText || "Fotoğraf yüklendi"}</div>
        <div class="pdfHint">Biyometrik JPEG için üstten 🔄 Dönüştür</div>
      </div>
    `;
  }

  function showFileMeta(file) {
    dzInner.classList.add("hidden");
    meta.classList.remove("hidden");
    meta.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:4px;min-width:0">
        <div style="font-weight:750;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
          ${file.name}
        </div>
        <div class="badge">${formatBytes(file.size)} • FOTO</div>
      </div>
      <div class="badge">Hazır</div>
    `;

    statusBadge.className = "badge badge-ready";
    statusBadge.textContent = "Fotoğraf yüklü (hazır) 📷";
    statusInfo.textContent = file.name;

    showPhotoPlaceholder(file.name);
  }

  async function setFile(file) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      alert("Lütfen sadece fotoğraf dosyası yükleyin (JPG/PNG).");
      return;
    }

    if (state.outputs[docKey]?.url) {
      URL.revokeObjectURL(state.outputs[docKey].url);
      state.outputs[docKey] = null;
    }

    state.files[docKey] = file;
    btnClear.disabled = false;

    lockDownload();
    showFileMeta(file);

    updateTopButtons();
  }

  function clearAll() {
    state.files[docKey] = null;
    if (state.outputs[docKey]?.url) URL.revokeObjectURL(state.outputs[docKey].url);
    state.outputs[docKey] = null;

    imgInput.value = "";
    meta.innerHTML = "";
    meta.classList.add("hidden");
    dzInner.classList.remove("hidden");

    btnClear.disabled = true;
    lockDownload();

    result.classList.add("hidden");
    thumbWrap.classList.remove("show", "placeholder");
    thumbWrap.innerHTML = "";

    statusBadge.className = "badge";
    statusBadge.textContent = "Henüz fotoğraf yüklenmedi";
    statusInfo.textContent = "";

    updateTopButtons();
  }

  ["dragenter", "dragover"].forEach(evt => {
    dropzone.addEventListener(evt, (e) => {
      e.preventDefault(); e.stopPropagation();
      dropzone.classList.add("dragover");
    });
  });
  ["dragleave", "drop"].forEach(evt => {
    dropzone.addEventListener(evt, (e) => {
      e.preventDefault(); e.stopPropagation();
      dropzone.classList.remove("dragover");
    });
  });
  dropzone.addEventListener("drop", (e) => {
    const file = e.dataTransfer?.files?.[0];
    setFile(file);
  });

  dropzone.addEventListener("click", () => imgInput.click());
  dropzone.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") imgInput.click();
  });

  btnAdd.addEventListener("click", () => imgInput.click());
  imgInput.addEventListener("change", (e) => setFile(e.target.files?.[0]));
  btnClear.addEventListener("click", clearAll);

  card.__getKey = () => docKey;
  card.__setOutput = (out) => {
    if (!out) return;

    result.classList.remove("hidden");
    result.style.display = "block";

    thumbWrap.classList.add("show");
    thumbWrap.classList.remove("placeholder");
    thumbWrap.innerHTML = "";

    const img = document.createElement("img");
    img.className = "thumb";
    img.alt = "Biyometrik önizleme";
    img.src = out.url;
    thumbWrap.appendChild(img);

    unlockDownload(out);

    statusBadge.className = "badge badge-ok";
    statusBadge.textContent = "Dönüştürüldü ✅";
    statusInfo.textContent = out.filename;

    updateTopButtons();
  };

  card.__clear = clearAll;
};

// ===================== FILENAME HELPERS =====================
function buildFilename(docKey) {
  const fn = sanitizeNamePart($("#firstName").value);
  const ln = sanitizeNamePart($("#lastName").value);
  return `${fn}_${ln}_${docKey}.jpeg`;
}

// ===================== CONVERT ALL =====================
async function convertAll() {
  const firstName = sanitizeNamePart($("#firstName").value);
  const lastName = sanitizeNamePart($("#lastName").value);

  if (!firstName || !lastName) {
    alert("Lütfen önce AD ve SOYAD bilgisini giriniz.");
    return;
  }

  const convertBtn = $("#btnConvert");
  convertBtn.disabled = true;
  convertBtn.textContent = "🔄 Dönüştürülüyor...";

  try {
    const cards = $$(".card");

    for (const card of cards) {
      if (!card.__getKey || !card.__setOutput) continue;

      const key = card.__getKey();
      const file = state.files[key];
      if (!file) continue;

      // Biyometrik
      if (key === "biyometrik_foto") {
        const sizeStr = $(".bio-size", card)?.value || "35x45";
        const doWhiten = ($(".bio-bg", card)?.value || "on") === "on";

        let jpegBlob = null;
        try {
          jpegBlob = await makeBiometricJpeg(file, sizeStr, doWhiten);
        } catch (e) {
          console.error(e);
          alert("Biyometrik beyazlatma için MediaPipe script'i ekli mi? (index.html)");
          continue;
        }

        const url = URL.createObjectURL(jpegBlob);
        const filename = `${firstName}_${lastName}_biyometrik_${sizeStr}.jpeg`;

        if (state.outputs[key]?.url) URL.revokeObjectURL(state.outputs[key].url);
        state.outputs[key] = { blob: jpegBlob, url, filename };

        card.__setOutput(state.outputs[key]);
        continue;
      }

      // PDF -> JPEG
      const jpegBlob = await renderPdfFirstPageToJpegBlob(file, 0.92, 2.0);
      if (!jpegBlob) {
        alert(`JPEG oluşturulamadı: ${key}`);
        continue;
      }

      const url = URL.createObjectURL(jpegBlob);
      const filename = buildFilename(key);

      if (state.outputs[key]?.url) URL.revokeObjectURL(state.outputs[key].url);
      state.outputs[key] = { blob: jpegBlob, url, filename };

      card.__setOutput(state.outputs[key]);
    }
  } catch (err) {
    console.error(err);
    alert("Dönüştürme sırasında bir hata oluştu. Konsolu (F12) kontrol edin.");
  } finally {
    convertBtn.textContent = "🔄 Dönüştür";
    updateTopButtons();
  }
}

// ===================== ZIP DOWNLOAD =====================
async function downloadAllZip() {
  const zip = new JSZip();
  let count = 0;

  for (const out of Object.values(state.outputs)) {
    if (!out?.blob) continue;
    zip.file(out.filename, out.blob);
    count++;
  }

  if (count === 0) return;

  const blob = await zip.generateAsync({ type: "blob" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;

  const fn = sanitizeNamePart($("#firstName").value);
  const ln = sanitizeNamePart($("#lastName").value);
  a.download = `${fn}_${ln}_evraklar.zip`;

  document.body.appendChild(a);
  a.click();
  a.remove();

  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

// ===================== WIRE UP =====================
function wireUp() {
  $$(".card").forEach((card) => {
    if (card.dataset.doc === "biyometrik_foto") attachBioLogic(card);
    else attachCardLogic(card);
  });

  ["input", "change"].forEach(evt => {
    $("#firstName").addEventListener(evt, updateTopButtons);
    $("#lastName").addEventListener(evt, updateTopButtons);
  });

  $("#btnConvert").addEventListener("click", convertAll);
  $("#btnDownloadAll").addEventListener("click", downloadAllZip);

  updateTopButtons();
}

wireUp();
