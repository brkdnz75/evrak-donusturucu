// pdf.js global
pdfjsLib.GlobalWorkerOptions.workerSrc =
  "https://unpkg.com/pdfjs-dist@3.11.174/build/pdf.worker.min.js";


const $ = (sel, root=document) => root.querySelector(sel);
const $$ = (sel, root=document) => Array.from(root.querySelectorAll(sel));

const state = {
  files: {
    sabika_kaydi: null,
    diploma: null,
    saglik_raporu: null,
  },
  outputs: {
    sabika_kaydi: null, // { blob, url, filename }
    diploma: null,
    saglik_raporu: null,
  }
};

function sanitizeNamePart(s){
  return (s || "")
    .trim()
    .replace(/\s+/g, "_")
    .replace(/[^a-zA-Z0-9_\-çğıöşüÇĞİÖŞÜ]/g, "");
}

function canConvert(){
  const fn = sanitizeNamePart($("#firstName").value);
  const ln = sanitizeNamePart($("#lastName").value);
  const anyPdf = Object.values(state.files).some(Boolean);
  return anyPdf;

}

function updateTopButtons(){
  $("#btnConvert").disabled = !canConvert();
  const anyOut = Object.values(state.outputs).some(Boolean);
  $("#btnDownloadAll").disabled = !anyOut;
}

function formatBytes(bytes){
  if (!bytes && bytes !== 0) return "";
  const units = ["B","KB","MB","GB"];
  let v = bytes, i = 0;
  while (v >= 1024 && i < units.length-1){ v /= 1024; i++; }
  return `${v.toFixed(i===0?0:1)} ${units[i]}`;
}

async function renderPdfFirstPageToJpegBlob(file, quality=0.92, scale=2.0){
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

  // temizlik
  canvas.width = 0; canvas.height = 0;

  return blob;
}

function attachCardLogic(card){
  const docKey = card.dataset.doc;
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
// Durum satırı
const statusHost = document.createElement("div");
statusHost.className = "statusRow";
statusHost.innerHTML = `
  <span class="badge">Henüz PDF yüklenmedi</span>
  <span class="mono"></span>
`;
card.appendChild(statusHost);
const statusBadge = statusHost.querySelector("span");
const statusInfo = statusHost.querySelectorAll("span")[1];

// Download başlangıçta kilitli olsun (a tag)
btnDownload.classList.add("is-disabled");
btnDownload.setAttribute("aria-disabled", "true");
btnDownload.removeAttribute("href");
btnDownload.removeAttribute("download");

// JPEG indir tıklanınca dönüşüm yoksa uyarı
btnDownload.addEventListener("click", (e) => {
  const out = state.outputs[docKey];
  if (!out?.url) {
    e.preventDefault();
    alert("Önce 🔄 Dönüştür işlemini yapmalısın. Dönüşüm sonrası JPEG indir aktif olur.");
  }
});

// PDF placeholder (JPEG yokken burada PDF bilgisi gösterilecek)
function showPdfPlaceholder(file){
  thumbWrap.classList.add("show");
  thumbWrap.classList.add("placeholder");
  // img gizle
  thumb.removeAttribute("src");

  thumbWrap.innerHTML = `
    <div class="pdfHolder">
      <div class="pdfIcon">📄</div>
      <div class="pdfName" title="${file.name}">${file.name}</div>
      <div class="pdfHint">Dönüştürmek için üstten 🔄 Dönüştür</div>
    </div>
  `;
}

// JPEG gelince placeholder'ı kaldırıp resmi geri koy
function showJpegPreview(out){
  thumbWrap.classList.add("show");
  thumbWrap.classList.remove("placeholder");
  thumbWrap.innerHTML = "";     // placeholder'ı temizle
  thumbWrap.appendChild(thumb); // img’i geri tak

  thumb.removeAttribute("src");
  thumb.src = out.url;
}


function showFileMeta(file){
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

  // ✅ DURUM: PDF yüklendi
  statusBadge.className = "badge badge-ready";
  statusBadge.textContent = "PDF yüklü (hazır) 📄";
  statusInfo.textContent = file.name;

  // ✅ JPEG yoksa placeholder göster
  showPdfPlaceholder(file);
}


  function clearAll(){
    // state temizle
    state.files[docKey] = null;
  
    if (state.outputs[docKey]?.url){
      URL.revokeObjectURL(state.outputs[docKey].url);
    }
    state.outputs[docKey] = null;
  
    // input sıfırla
    fileInput.value = "";
  
    // UI reset
    meta.innerHTML = "";
    meta.classList.add("hidden");
  
    dzInner.classList.remove("hidden");
    result.classList.add("hidden");
    thumbWrap.classList.remove("show");  // ✅ TEMİZLE'de preview kapanır

  
    thumb.src = "";
    btnDownload.removeAttribute("href");
    btnDownload.removeAttribute("download");
  
    btnClear.disabled = true;

    statusBadge.className = "badge";
statusBadge.textContent = "Henüz PDF yüklenmedi";
statusInfo.textContent = "";

btnDownload.classList.add("is-disabled");
btnDownload.setAttribute("aria-disabled", "true");
btnDownload.removeAttribute("href");
btnDownload.removeAttribute("download");

// preview alanını kapat
thumbWrap.classList.remove("show", "placeholder");
thumbWrap.innerHTML = "";

  
    updateTopButtons();
  }
  

  async function setFile(file){
    if (!file) return;
    if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")){
      alert("Lütfen sadece PDF dosyası yükleyin.");
      return;
    }
    // önceki output varsa temizle
    if (state.outputs[docKey]?.url){
      URL.revokeObjectURL(state.outputs[docKey].url);
      state.outputs[docKey] = null;
    }

    state.files[docKey] = file;
    showFileMeta(file);
    btnClear.disabled = false;

    // eğer daha önce dönüştürülmüş preview vardıysa kaldır
    result.classList.add("hidden");
    thumb.removeAttribute("src");

    updateTopButtons();
  }

  btnAdd.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", (e) => setFile(e.target.files?.[0]));

  btnClear.addEventListener("click", clearAll);

  // dropzone click = dosya seç
  dropzone.addEventListener("click", () => fileInput.click());
  dropzone.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") fileInput.click();
  });

  // drag & drop
  ["dragenter","dragover"].forEach(evt => {
    dropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropzone.classList.add("dragover");
    });
  });
  ["dragleave","drop"].forEach(evt => {
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

  // Dönüşüm sonrası UI doldurma (dışarıdan çağrılacak)
  card.__setOutput = (out) => {
    if (!out) return;
  
    result.classList.remove("hidden");
    result.style.display = "block";
  
    // JPEG preview göster
    showJpegPreview(out);
  
    // download aktif
    btnDownload.href = out.url;
    btnDownload.setAttribute("download", out.filename);
    btnDownload.classList.remove("is-disabled");
    btnDownload.setAttribute("aria-disabled", "false");
  
    // durum
    statusBadge.className = "badge badge-ok";
    statusBadge.textContent = "Dönüştürüldü ✅";
    statusInfo.textContent = out.filename;
  
    updateTopButtons();
  };
  
  
  

  card.__getKey = () => docKey;
  card.__clear = clearAll;
}

function buildFilename(docKey){
  const fn = sanitizeNamePart($("#firstName").value);
  const ln = sanitizeNamePart($("#lastName").value);
  return `${fn}_${ln}_${docKey}.jpeg`;
}

async function convertAll(){
  const firstName = sanitizeNamePart($("#firstName").value);
  const lastName = sanitizeNamePart($("#lastName").value);
  
  if (!firstName || !lastName) {
    alert("Lütfen önce AD ve SOYAD bilgisini giriniz.");
    return;
  }
  

  const convertBtn = $("#btnConvert");
  convertBtn.disabled = true;
  convertBtn.textContent = "🔄 Dönüştürülüyor...";

  try{
    const cards = $$(".card");
    for (const card of cards){
      const key = card.__getKey();
      const file = state.files[key];
      if (!file) continue;

      const jpegBlob = await renderPdfFirstPageToJpegBlob(file, 0.92, 2.0);
      if (!jpegBlob){
        alert(`JPEG oluşturulamadı: ${key}`);
        continue;
      }

      const url = URL.createObjectURL(jpegBlob);
      const filename = buildFilename(key);

      // eski url varsa temizle
      if (state.outputs[key]?.url) URL.revokeObjectURL(state.outputs[key].url);

      state.outputs[key] = { blob: jpegBlob, url, filename };
      card.__setOutput(state.outputs[key]);
    }
  }finally{
    convertBtn.textContent = "🔄 Dönüştür";
    updateTopButtons();
  }
}

async function downloadAllZip(){
  const zip = new JSZip();
  let count = 0;

  for (const [k, out] of Object.entries(state.outputs)){
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

function wireUp(){
  $$(".card").forEach(attachCardLogic);

  ["input","change"].forEach(evt => {
    $("#firstName").addEventListener(evt, updateTopButtons);
    $("#lastName").addEventListener(evt, updateTopButtons);
  });

  $("#btnConvert").addEventListener("click", convertAll);
  $("#btnDownloadAll").addEventListener("click", downloadAllZip);

  updateTopButtons();
}

wireUp();
