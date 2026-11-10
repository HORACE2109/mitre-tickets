// ==================== GLOBAL APP STATE ====================
let currentConfig = null;
let currentTemplateImg = new Image();
let html5QrCode = null;
let isCameraRunning = false;
let isScanningPaused = false;
let lastAdminScanCode = '';
let lastAdminScanTime = 0;

// Current batch of generated tickets in memory (with their dataURLs)
let currentBatchTickets = [];

// Audio Context for Beeps
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

function playSound(type) {
  try {
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);

    if (type === 'success') {
      osc.frequency.setValueAtTime(880, audioCtx.currentTime);
      osc.frequency.setValueAtTime(1174.66, audioCtx.currentTime + 0.08);
      gain.gain.setValueAtTime(0.3, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.35);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.35);
    } else {
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(160, audioCtx.currentTime);
      gain.gain.setValueAtTime(0.4, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.5);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.5);
    }
  } catch (e) {}
}

// ==================== INIT ====================
document.addEventListener('DOMContentLoaded', async () => {
  setupTabs();
  setupTypeRadios();
  setupSliders();
  await loadConfig();
  await loadTickets();

  // Generator actions
  document.getElementById('btnGenerate').addEventListener('click', generateTickets);
  document.getElementById('btnDownloadPreview').addEventListener('click', downloadCurrentPreview);
  document.getElementById('btnShareBatchWhatsApp').addEventListener('click', shareBatchWhatsApp);
  document.getElementById('btnDownloadBatchZip').addEventListener('click', downloadBatchZip);

  // Scanner actions
  document.getElementById('btnToggleCamera').addEventListener('click', toggleCamera);
  document.getElementById('inputScanFile').addEventListener('change', handleScanFile);
  document.getElementById('btnValidateManual').addEventListener('click', () => {
    const val = document.getElementById('inputManualCode').value;
    if (val) validateCode(val);
  });
  document.getElementById('inputManualCode').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      const val = document.getElementById('inputManualCode').value;
      if (val) validateCode(val);
    }
  });

  // Dashboard actions
  document.getElementById('btnRefreshTickets').addEventListener('click', loadTickets);
  document.getElementById('btnResetAll').addEventListener('click', resetAllTickets);
  document.getElementById('btnRestoreDefault').addEventListener('click', restoreDefaultTemplate);
  document.getElementById('fileTemplate').addEventListener('change', uploadCustomTemplate);
  document.getElementById('searchTickets').addEventListener('input', filterTicketsList);
  document.getElementById('chkTransparent').addEventListener('change', () => drawPreview());
});

// ==================== TAB NAVIGATION ====================
function setupTabs() {
  const tabs = document.querySelectorAll('.tab-btn');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));

      tab.classList.add('active');
      const target = document.getElementById(tab.dataset.tab);
      if (target) target.classList.add('active');

      if (tab.dataset.tab === 'tab-dashboard') {
        loadTickets();
      }
    });
  });
}

// ==================== TYPE RADIOS ====================
function setupTypeRadios() {
  const radios = document.querySelectorAll('input[name="ticketType"]');
  radios.forEach(r => {
    r.addEventListener('change', () => {
      document.querySelectorAll('.radio-card').forEach(card => card.classList.remove('selected'));
      r.closest('.radio-card').classList.add('selected');

      const isAbono = r.value === 'abono';
      document.getElementById('groupMatchCount').style.display = isAbono ? 'block' : 'none';
      document.getElementById('groupMatchSelect').style.display = isAbono ? 'none' : 'block';

      const labelBen = document.getElementById('labelBeneficiary');
      const inputBen = document.getElementById('inputBeneficiary');

      if (isAbono) {
        labelBen.textContent = 'Titular del Abono / Referencia:';
        inputBen.placeholder = 'Ej: Abono Platea #1, Juan Pérez...';
      } else if (r.value === 'invitacion') {
        labelBen.textContent = 'Destinatario / Sponsor / Invitado:';
        inputBen.placeholder = 'Ej: Sponsor Banco Macro, Prensa...';
      } else {
        labelBen.textContent = 'Nombre del Comprador / Referencia:';
        inputBen.placeholder = 'Ej: Entrada Popular / Platea';
      }
      drawPreview();
    });
  });
}

// ==================== QR SLIDERS ====================
function setupSliders() {
  const sX = document.getElementById('sliderX');
  const sY = document.getElementById('sliderY');
  const sSize = document.getElementById('sliderSize');

  const update = () => {
    document.getElementById('valX').textContent = sX.value;
    document.getElementById('valY').textContent = sY.value;
    document.getElementById('valSize').textContent = sSize.value;
    drawPreview();
  };

  sX.addEventListener('input', update);
  sY.addEventListener('input', update);
  sSize.addEventListener('input', update);
}

// ==================== LOAD CONFIG & TEMPLATE ====================
async function loadConfig() {
  try {
    const res = await fetch('/api/config');
    currentConfig = await res.json();

    const selGen = document.getElementById('selectMatch');
    const selScan = document.getElementById('scannerMatchSelect');
    selGen.innerHTML = '';
    selScan.innerHTML = '';

    currentConfig.matches.forEach(m => {
      const opt1 = new Option(`${m.name} (${m.date})`, m.id);
      const opt2 = new Option(`${m.name} (${m.date})`, m.id);
      selGen.add(opt1);
      selScan.add(opt2);
    });

    selScan.value = currentConfig.activeMatchId;
    loadTemplateImage(currentConfig.currentTemplate || 'template_default.jpg');
  } catch (e) {
    console.error("Error loading config", e);
  }
}

function loadTemplateImage(filename) {
  currentTemplateImg = new Image();
  currentTemplateImg.crossOrigin = 'anonymous';
  currentTemplateImg.src = `/uploads/${filename}?t=${Date.now()}`;
  currentTemplateImg.onload = () => {
    const w = currentTemplateImg.naturalWidth || 768;
    const h = currentTemplateImg.naturalHeight || 1024;

    const canvas = document.getElementById('previewCanvas');
    canvas.width = w;
    canvas.height = h;

    const sX = document.getElementById('sliderX');
    const sY = document.getElementById('sliderY');
    const sSize = document.getElementById('sliderSize');

    sX.max = w;
    sY.max = h;
    sSize.max = Math.round(w * 0.45);

    let defaultSize, defaultX, defaultY;
    if (w >= 1000) {
      defaultSize = 215;
      defaultX = Math.round(w * 0.5 - defaultSize / 2);
      defaultY = 1056;
    } else {
      defaultSize = 150;
      defaultX = Math.round(w * 0.5 - defaultSize / 2);
      defaultY = 765;
    }

    sX.value = defaultX;
    sY.value = defaultY;
    sSize.value = defaultSize;

    document.getElementById('valX').textContent = defaultX;
    document.getElementById('valY').textContent = defaultY;
    document.getElementById('valSize').textContent = defaultSize;

    drawPreview();
  };
}

// ==================== CANVAS PREVIEW ====================
function drawPreview(sampleCode = 'MITRE-INV-SAMPLE-01') {
  const canvas = document.getElementById('previewCanvas');
  const ctx = canvas.getContext('2d');

  if (!currentTemplateImg.complete || !currentTemplateImg.naturalWidth) {
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    return;
  }

  ctx.drawImage(currentTemplateImg, 0, 0, canvas.width, canvas.height);

  const qrX = parseInt(document.getElementById('sliderX').value, 10);
  const qrY = parseInt(document.getElementById('sliderY').value, 10);
  const qrSize = parseInt(document.getElementById('sliderSize').value, 10);
  const isTransparent = document.getElementById('chkTransparent').checked;

  const qrImg = new Image();
  qrImg.crossOrigin = 'anonymous';
  const qrUrl = `${window.location.origin}/ticket/${sampleCode}`;
  qrImg.src = `/api/qr-image?text=${encodeURIComponent(qrUrl)}&size=${qrSize * 2}&transparent=${isTransparent}`;
  
  qrImg.onload = () => {
    if (!isTransparent) {
      ctx.save();
      ctx.fillStyle = '#ffffff';
      if (ctx.roundRect) {
        ctx.beginPath();
        ctx.roundRect(qrX - 8, qrY - 8, qrSize + 16, qrSize + 16, 14);
        ctx.fill();
      } else {
        ctx.fillRect(qrX - 8, qrY - 8, qrSize + 16, qrSize + 16);
      }
      ctx.restore();
    }
    ctx.drawImage(qrImg, qrX, qrY, qrSize, qrSize);
  };
}

function downloadCurrentPreview() {
  const canvas = document.getElementById('previewCanvas');
  const link = document.createElement('a');
  link.download = 'muestra-invitacion-mitre.png';
  link.href = canvas.toDataURL('image/png');
  link.click();
}

// ==================== RENDER TICKET CANVAS (HELPER) ====================
async function renderTicketCanvas(ticket) {
  const w = currentTemplateImg.naturalWidth || 768;
  const h = currentTemplateImg.naturalHeight || 1024;
  const offCanvas = document.createElement('canvas');
  offCanvas.width = w;
  offCanvas.height = h;
  const ctx = offCanvas.getContext('2d');
  ctx.drawImage(currentTemplateImg, 0, 0, w, h);

  const qrX = parseInt(document.getElementById('sliderX').value, 10);
  const qrY = parseInt(document.getElementById('sliderY').value, 10);
  const qrSize = parseInt(document.getElementById('sliderSize').value, 10);
  const isTransparent = document.getElementById('chkTransparent').checked;

  const qrUrl = `${window.location.origin}/ticket/${ticket.id}`;
  const qrImg = new Image();
  qrImg.crossOrigin = 'anonymous';
  qrImg.src = `/api/qr-image?text=${encodeURIComponent(qrUrl)}&size=${qrSize * 2}&transparent=${isTransparent}`;

  await new Promise((resolve) => {
    qrImg.onload = () => {
      if (!isTransparent) {
        ctx.save();
        ctx.fillStyle = '#ffffff';
        if (ctx.roundRect) {
          ctx.beginPath();
          ctx.roundRect(qrX - 8, qrY - 8, qrSize + 16, qrSize + 16, 14);
          ctx.fill();
        } else {
          ctx.fillRect(qrX - 8, qrY - 8, qrSize + 16, qrSize + 16);
        }
        ctx.restore();
      }
      ctx.drawImage(qrImg, qrX, qrY, qrSize, qrSize);
      resolve();
    };
    qrImg.onerror = () => resolve();
  });

  return offCanvas.toDataURL('image/png');
}

// ==================== GENERATE TICKETS ====================
async function generateTickets() {
  const type = document.querySelector('input[name="ticketType"]:checked').value;
  const beneficiary = document.getElementById('inputBeneficiary').value.trim();
  const count = parseInt(document.getElementById('inputCount').value, 10) || 1;
  const matchCount = parseInt(document.getElementById('inputMatchCount').value, 10) || 10;
  const matchId = document.getElementById('selectMatch').value;

  const btn = document.getElementById('btnGenerate');
  btn.disabled = true;
  btn.textContent = '⏳ Generando...';

  try {
    const res = await fetch('/api/tickets/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, beneficiary, count, matchCount, matchId })
    });

    const data = await res.json();
    if (data.success && data.tickets) {
      await renderBatchGallery(data.tickets, beneficiary || 'Lote');
      showToast(`¡Se generaron ${data.tickets.length} entradas con éxito!`);
      loadTickets();
    }
  } catch (e) {
    console.error("Error generating tickets", e);
    alert("Error al generar las entradas.");
  } finally {
    btn.disabled = false;
    btn.textContent = '⚡ Generar Entradas y Estampar QR';
  }
}

// RENDER BATCH GALLERY WITH MASTER SHARING
async function renderBatchGallery(tickets, batchName) {
  const gallery = document.getElementById('batchTicketsList');
  gallery.innerHTML = '';
  currentBatchTickets = [];

  const masterSection = document.getElementById('recentBatchSection');
  masterSection.style.display = 'block';

  document.getElementById('masterBatchTitle').textContent = batchName;
  document.getElementById('masterBatchCount').textContent = `${tickets.length} entrada/s con códigos únicos`;

  for (const t of tickets) {
    const dataUrl = await renderTicketCanvas(t);
    t.renderedDataUrl = dataUrl;
    currentBatchTickets.push(t);

    const card = document.createElement('div');
    card.className = 'ticket-item-card';

    const badgeClass = t.type === 'abono' ? 'badge-abono' : (t.type === 'invitacion' ? 'badge-invitacion' : 'badge-general');
    const typeLabel = t.type === 'abono' ? `🏀 Abono ${t.maxUses} Partidos` : (t.type === 'invitacion' ? '✨ Invitación Especial' : '🎫 General');

    card.innerHTML = `
      <img src="${dataUrl}" class="ticket-item-thumb" alt="Entrada">
      <div class="ticket-item-body">
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <span class="ticket-badge ${badgeClass}">${typeLabel}</span>
          <span style="font-family: monospace; font-size: 0.75rem; color: #94a3b8;">${t.id}</span>
        </div>
        <strong style="color: #fff; font-size: 0.95rem;">${t.beneficiary}</strong>
        <div style="display: flex; flex-direction: column; gap: 0.4rem; margin-top: 0.5rem;">
          <button class="btn btn-success btn-block btn-share-wa" style="font-size: 0.8rem; padding: 0.5rem; font-weight: 700;">
            📲 Enviar Foto por WhatsApp
          </button>
          <div style="display: flex; gap: 0.4rem;">
            <a href="${dataUrl}" download="Entrada-Mitre-${t.id}.png" class="btn btn-primary btn-block" style="font-size: 0.8rem; padding: 0.45rem;">
              ⬇️ Descargar
            </a>
            <a href="/ticket/${t.id}" target="_blank" class="btn btn-secondary" style="font-size: 0.8rem; padding: 0.45rem;" title="Pase digital">
              🔗
            </a>
          </div>
        </div>
      </div>
    `;

    card.querySelector('.btn-share-wa').addEventListener('click', () => {
      shareSingleTicketWhatsApp(t.id, t.beneficiary, typeLabel, dataUrl);
    });

    gallery.appendChild(card);
  }

  masterSection.scrollIntoView({ behavior: 'smooth' });
}

// ==================== BATCH ACTIONS (SEND ALL TOGETHER & ZIP) ====================
async function shareBatchWhatsApp() {
  if (!currentBatchTickets || currentBatchTickets.length === 0) return;

  try {
    const files = [];
    for (const t of currentBatchTickets) {
      const res = await fetch(t.renderedDataUrl);
      const blob = await res.blob();
      files.push(new File([blob], `Entrada-Mitre-${t.id}.png`, { type: 'image/png' }));
    }

    // Try multi-file native share (Android / iOS attaches ALL images at once into WhatsApp!)
    if (navigator.canShare && navigator.canShare({ files })) {
      await navigator.share({
        files,
        title: `Entradas Mitre (${files.length})`,
        text: `🏀 *Club Bartolomé Mitre*\n🎟️ Adjuntamos las ${files.length} entradas solicitadas.`
      });
      return;
    }

    // Fallback if desktop or multi-file not supported
    alert("En navegadores de escritorio no es posible enviar múltiples archivos juntos a la vez. Descargá el archivo .ZIP con el botón de al lado para compartir todas las fotos.");
  } catch (err) {
    if (err.name !== 'AbortError') {
      console.error(err);
    }
  }
}

async function downloadBatchZip() {
  if (!currentBatchTickets || currentBatchTickets.length === 0) return;

  const zip = new JSZip();
  const folder = zip.folder("Entradas-Mitre");

  currentBatchTickets.forEach(t => {
    const base64Data = t.renderedDataUrl.split(',')[1];
    folder.file(`Entrada-${t.id}-${t.beneficiary.replace(/[^a-zA-Z0-9]/g, '_')}.png`, base64Data, { base64: true });
  });

  const content = await zip.generateAsync({ type: "blob" });
  const link = document.createElement('a');
  link.download = `Lote-Entradas-Mitre-${Date.now()}.zip`;
  link.href = URL.createObjectURL(content);
  link.click();
  showToast("📦 Archivo ZIP descargado con todas las fotos.");
}

// ==================== WHATSAPP SINGLE SHARING ====================
async function shareSingleTicketWhatsApp(ticketId, beneficiary, typeLabel, dataUrl) {
  try {
    const res = await fetch(dataUrl);
    const blob = await res.blob();
    const file = new File([blob], `Entrada-Mitre-${ticketId}.png`, { type: 'image/png' });
    const caption = `🏀 *Club Bartolomé Mitre - Liga Argentina*\n🎟️ *${typeLabel}*\n👤 Para: *${beneficiary}*`;

    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({
        files: [file],
        title: `Entrada Mitre - ${beneficiary}`,
        text: caption
      });
      return;
    }

    // Desktop PC: Copy image to clipboard
    if (navigator.clipboard && window.ClipboardItem) {
      try {
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
        showToast("📋 ¡Imagen copiada! Abrí WhatsApp Web y presiona Ctrl+V para pegarla.");
        window.open('https://web.whatsapp.com', '_blank');
        return;
      } catch (e) {}
    }

    // Download fallback
    const link = document.createElement('a');
    link.download = `Entrada-Mitre-${ticketId}.png`;
    link.href = dataUrl;
    link.click();
    showToast("⬇️ Imagen descargada para adjuntar en WhatsApp.");
  } catch (err) {
    if (err.name !== 'AbortError') {
      console.error(err);
    }
  }
}

// ==================== DASHBOARD / TICKETS LIST ====================
let allLoadedTickets = [];

async function loadTickets() {
  try {
    const res = await fetch('/api/tickets');
    const data = await res.json();
    allLoadedTickets = data.tickets || [];
    renderTicketsList(allLoadedTickets);
    updateDashboardStats(allLoadedTickets);
  } catch (e) {
    console.error("Error loading tickets", e);
  }
}

function updateDashboardStats(tickets) {
  const activeMatchId = currentConfig ? currentConfig.activeMatchId : null;
  const total = tickets.length;
  const scannedToday = tickets.filter(t => t.entries && t.entries.some(e => e.matchId === activeMatchId)).length;
  const pending = Math.max(0, total - scannedToday);

  document.getElementById('statTotalTickets').textContent = total;
  document.getElementById('statScannedToday').textContent = scannedToday;
  document.getElementById('statPendingTickets').textContent = pending;
}

function renderTicketsList(tickets) {
  const container = document.getElementById('ticketsListContainer');
  container.innerHTML = '';

  if (tickets.length === 0) {
    container.innerHTML = `<div style="text-align: center; color: var(--text-muted); padding: 1.5rem; font-size: 0.85rem;">No hay entradas creadas todavía.</div>`;
    return;
  }

  tickets.forEach(t => {
    const card = document.createElement('div');
    card.className = 'ticket-row-card';

    let statusBadge = `<span class="ticket-badge badge-general">Activa</span>`;
    if (t.status === 'used' || t.status === 'exhausted' || t.remainingUses === 0) {
      statusBadge = `<span class="ticket-badge" style="background: rgba(239, 68, 68, 0.25); color: #f87171;">Usada</span>`;
    }

    const typeBadge = t.type === 'abono' 
      ? `<span class="ticket-badge badge-abono">Abono ${t.maxUses}</span>` 
      : (t.type === 'invitacion' ? `<span class="ticket-badge badge-invitacion">Invitación</span>` : `<span class="ticket-badge badge-general">General</span>`);

    let scanInfo = '';
    if (t.entries && t.entries.length > 0) {
      const last = t.entries[t.entries.length - 1];
      const time = new Date(last.timestamp).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
      scanInfo = `<span style="font-size: 0.75rem; color: #10b981;">Ingresó: ${time}</span>`;
    }

    card.innerHTML = `
      <div class="ticket-row-info">
        <div style="flex: 1;">
          <div style="display: flex; gap: 0.4rem; align-items: center; margin-bottom: 2px;">
            <strong style="color: var(--accent-gold); font-family: monospace; font-size: 0.85rem;">${t.id}</strong>
            ${typeBadge}
            ${statusBadge}
          </div>
          <strong style="color: #fff; font-size: 0.95rem;">${t.beneficiary}</strong>
          <div style="font-size: 0.75rem; color: var(--text-muted); display: flex; gap: 0.75rem; margin-top: 2px;">
            <span>Saldo: <strong style="color: #60a5fa;">${t.remainingUses}/${t.maxUses}</strong></span>
            ${scanInfo}
          </div>
        </div>
      </div>
      <div class="ticket-row-actions">
        <button class="btn btn-secondary btn-view-ticket" style="padding: 0.4rem 0.65rem; font-size: 0.8rem;" title="Ver y Enviar">
          👁️ Ver / Enviar
        </button>
        <button class="btn btn-secondary" style="padding: 0.4rem 0.6rem; font-size: 0.8rem;" onclick="resetSingleTicket('${t.id}')" title="Resetear">
          ↺
        </button>
        <button class="btn btn-danger" style="padding: 0.4rem 0.6rem; font-size: 0.8rem;" onclick="deleteTicket('${t.id}')" title="Eliminar">
          🗑️
        </button>
      </div>
    `;

    card.querySelector('.btn-view-ticket').addEventListener('click', () => {
      openTicketModal(t);
    });

    container.appendChild(card);
  });
}

function filterTicketsList() {
  const query = document.getElementById('searchTickets').value.toLowerCase();
  const cards = document.querySelectorAll('.ticket-row-card');
  cards.forEach(c => {
    const text = c.textContent.toLowerCase();
    c.style.display = text.includes(query) ? '' : 'none';
  });
}

// ==================== TICKET MODAL (VIEW & SHARE ANY TICKET) ====================
async function openTicketModal(ticket) {
  const modal = document.getElementById('ticketModal');
  const modalImg = document.getElementById('modalTicketImg');
  const modalLoading = document.getElementById('modalLoading');
  const modalActions = document.getElementById('modalActions');
  const modalTitle = document.getElementById('modalTicketTitle');

  modal.style.display = 'flex';
  modalImg.style.display = 'none';
  modalActions.style.display = 'none';
  modalLoading.style.display = 'block';
  modalTitle.textContent = `${ticket.id} - ${ticket.beneficiary}`;

  // Render high-res ticket
  const dataUrl = await renderTicketCanvas(ticket);
  modalImg.src = dataUrl;
  modalImg.style.display = 'block';
  modalLoading.style.display = 'none';
  modalActions.style.display = 'flex';

  document.getElementById('modalBtnDownload').href = dataUrl;
  document.getElementById('modalBtnDownload').download = `Entrada-Mitre-${ticket.id}.png`;
  document.getElementById('modalBtnLink').href = `/ticket/${ticket.id}`;

  const btnShare = document.getElementById('modalBtnShareWhatsApp');
  // Reattach listener cleanly
  const newBtn = btnShare.cloneNode(true);
  btnShare.parentNode.replaceChild(newBtn, btnShare);
  newBtn.addEventListener('click', () => {
    shareSingleTicketWhatsApp(ticket.id, ticket.beneficiary, ticket.type === 'abono' ? `Abono ${ticket.maxUses} Partidos` : 'Invitación', dataUrl);
  });
}

function closeTicketModal() {
  document.getElementById('ticketModal').style.display = 'none';
}

// ==================== RESET & DELETE ====================
async function resetSingleTicket(id) {
  try {
    await fetch(`/api/tickets/reset/${id}`, { method: 'POST' });
    showToast(`Entrada ${id} restablecida a activa.`);
    loadTickets();
  } catch (e) {
    console.error(e);
  }
}

async function resetAllTickets() {
  if (!confirm("¿Reiniciar todas las entradas a 'Sin Usar' para seguir haciendo pruebas?")) return;
  try {
    await fetch('/api/tickets/reset-all', { method: 'POST' });
    showToast("Todas las entradas fueron restablecidas a activas.");
    loadTickets();
  } catch (e) {
    console.error(e);
  }
}

async function deleteTicket(id) {
  if (!confirm(`¿Eliminar la entrada ${id}?`)) return;
  try {
    await fetch(`/api/tickets/${id}`, { method: 'DELETE' });
    loadTickets();
  } catch (e) {
    console.error(e);
  }
}

// ==================== SCANNER TAB (ADMIN) ====================
async function toggleCamera() {
  const btn = document.getElementById('btnToggleCamera');
  const badge = document.getElementById('scannerStatusBadge');

  if (isCameraRunning) {
    if (html5QrCode) await html5QrCode.stop();
    html5QrCode = null;
    isCameraRunning = false;
    btn.textContent = '📷 Iniciar Cámara';
    badge.textContent = 'Detenido';
    return;
  }

  try {
    html5QrCode = new Html5Qrcode("reader");
    btn.textContent = '⏹️ Detener Cámara';
    badge.textContent = 'Escaneando...';

    await html5QrCode.start(
      { facingMode: "environment" },
      {
        fps: 20,
        qrbox: (w, h) => {
          const sz = Math.max(220, Math.floor(Math.min(w, h) * 0.72));
          return { width: sz, height: sz };
        },
        experimentalFeatures: { useBarCodeDetectorIfSupported: true }
      },
      onAdminScan
    );
    isCameraRunning = true;
  } catch (err) {
    alert("Error de cámara: " + err);
    isCameraRunning = false;
  }
}

async function onAdminScan(decodedText) {
  const now = Date.now();
  if (decodedText === lastAdminScanCode && (now - lastAdminScanTime) < 5000) return;
  if (isScanningPaused) return;

  isScanningPaused = true;
  lastAdminScanCode = decodedText;
  lastAdminScanTime = now;

  await validateCode(decodedText);
  setTimeout(() => { isScanningPaused = false; }, 2800);
}

async function handleScanFile(e) {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const scanner = html5QrCode || new Html5Qrcode("reader");
    const decoded = await scanner.scanFile(file, true);
    await validateCode(decoded);
  } catch (err) {
    alert("No se leyó el código QR de la foto.");
  } finally {
    e.target.value = '';
  }
}

async function validateCode(rawCode) {
  const matchId = document.getElementById('scannerMatchSelect').value;
  try {
    const res = await fetch('/api/tickets/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: rawCode, matchId, gate: 'Admin' })
    });
    const result = await res.json();
    displayScanResult(result);
    loadTickets();
  } catch (e) {
    console.error(e);
  }
}

function displayScanResult(res) {
  const card = document.getElementById('scanResultCard');
  const icon = document.getElementById('scanIcon');
  const title = document.getElementById('scanTitle');
  const desc = document.getElementById('scanDesc');
  const abonoBox = document.getElementById('scanAbonoProgress');

  card.className = 'scan-result-card';
  abonoBox.style.display = 'none';

  if (res.valid) {
    playSound('success');
    card.classList.add('success');
    icon.textContent = '✅';
    title.textContent = res.message;
    desc.innerHTML = `<strong>${res.detail}</strong><br><small>${res.typeLabel || ''}</small>`;
    if (res.status === 'GRANTED_ABONO') {
      abonoBox.style.display = 'block';
      abonoBox.innerHTML = `🏀 ${res.progressText}`;
    }
  } else {
    playSound('error');
    card.classList.add('danger');
    icon.textContent = '🛑';
    title.textContent = res.message;
    desc.textContent = res.detail;
  }
  document.getElementById('inputManualCode').value = '';
}

// ==================== TEMPLATE UPLOAD & RESTORE ====================
async function uploadCustomTemplate(e) {
  const file = e.target.files[0];
  if (!file) return;
  const formData = new FormData();
  formData.append('template', file);

  try {
    const res = await fetch('/api/upload-template', { method: 'POST', body: formData });
    const data = await res.json();
    if (data.success) {
      document.getElementById('templateInfo').textContent = `Usando: ${data.filename}`;
      loadTemplateImage(data.filename);
      showToast("Nueva plantilla subida con éxito.");
    }
  } catch (err) {
    alert("Error al subir la imagen");
  }
}

async function restoreDefaultTemplate() {
  try {
    await fetch('/api/template/restore-default', { method: 'POST' });
    document.getElementById('templateInfo').textContent = 'Usando: template_default.jpg';
    loadTemplateImage('template_default.jpg');
    showToast("Plantilla oficial restaurada.");
  } catch (err) {
    console.error(err);
  }
}

// ==================== TOAST ====================
function showToast(msg) {
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.innerHTML = `<span>✨</span> <div>${msg}</div>`;
  document.body.appendChild(toast);
  setTimeout(() => { toast.remove(); }, 3500);
}
