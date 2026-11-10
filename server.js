const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const QRCodeLib = require('qrcode');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: true, limit: '15mb' }));

// Directories
const UPLOADS_DIR = path.join(__dirname, 'uploads');
const DB_FILE = path.join(__dirname, 'database.json');
const PUBLIC_DIR = path.join(__dirname, 'public');

if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// Configure Multer for template uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.jpg';
    cb(null, `template_custom_${Date.now()}${ext}`);
  }
});
const upload = multer({ storage });

// Database initialization
function initDB() {
  if (!fs.existsSync(DB_FILE)) {
    const initialData = {
      activeMatchId: "match-1",
      matches: [
        {
          id: "match-1",
          name: "Bartolomé Mitre vs Sportivo Suardi",
          date: "Miércoles 11/11",
          time: "21:30 HS",
          stadium: "Estadio Bartolomé Mitre",
          tournament: "Liga Argentina"
        },
        {
          id: "match-2",
          name: "Bartolomé Mitre vs Deportivo Norte",
          date: "Domingo 15/11",
          time: "20:00 HS",
          stadium: "Estadio Bartolomé Mitre",
          tournament: "Liga Argentina"
        },
        {
          id: "match-3",
          name: "Bartolomé Mitre vs Barrio Parque",
          date: "Viernes 20/11",
          time: "21:00 HS",
          stadium: "Estadio Bartolomé Mitre",
          tournament: "Liga Argentina"
        }
      ],
      tickets: [],
      currentTemplate: "template_default.jpg"
    };
    fs.writeFileSync(DB_FILE, JSON.stringify(initialData, null, 2), 'utf-8');
    return initialData;
  }
  try {
    return JSON.parse(fs.readFileSync(DB_FILE, 'utf-8'));
  } catch (e) {
    console.error("Error reading database:", e);
    return { activeMatchId: "match-1", matches: [], tickets: [], currentTemplate: "template_default.jpg" };
  }
}

function saveDB(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

// Generate random short distinct code
function generateTicketId(prefix = 'MITRE') {
  const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  let rand = '';
  for (let i = 0; i < 6; i++) {
    rand += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return `${prefix}-${rand}`;
}

// GET Dynamic High-Res QR with Transparent Background
app.get('/api/qr-image', async (req, res) => {
  try {
    const { text = 'SAMPLE', size = 140, transparent = 'true' } = req.query;
    const qrBuffer = await QRCodeLib.toBuffer(text, {
      margin: 1,
      width: Math.min(600, Math.max(50, parseInt(size, 10) || 140)),
      color: {
        dark: '#0a0f1d',
        light: transparent === 'true' ? '#00000000' : '#ffffff'
      }
    });
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=31536000');
    res.send(qrBuffer);
  } catch (err) {
    console.error("QR generation error:", err);
    res.status(500).send("Error generating QR");
  }
});

// GET Config & State
app.get('/api/config', (req, res) => {
  const db = initDB();
  const activeMatch = db.matches.find(m => m.id === db.activeMatchId) || db.matches[0];
  
  const total = db.tickets.length;
  const active = db.tickets.filter(t => t.status === 'active').length;
  
  const usedToday = db.tickets.filter(t => 
    t.entries && t.entries.some(e => e.matchId === db.activeMatchId)
  ).length;

  res.json({
    activeMatchId: db.activeMatchId,
    activeMatch,
    matches: db.matches,
    currentTemplate: db.currentTemplate || 'template_default.jpg',
    stats: {
      total,
      active,
      usedToday
    }
  });
});

// SET Active Match
app.post('/api/matches/active', (req, res) => {
  const { matchId } = req.body;
  const db = initDB();
  if (db.matches.some(m => m.id === matchId)) {
    db.activeMatchId = matchId;
    saveDB(db);
    return res.json({ success: true, activeMatchId: matchId });
  }
  res.status(404).json({ error: "Partido no encontrado" });
});

// CREATE Match
app.post('/api/matches', (req, res) => {
  const { name, date, time, stadium, tournament } = req.body;
  const db = initDB();
  const newMatch = {
    id: `match-${Date.now()}`,
    name: name || "Nuevo Partido",
    date: date || "A confirmar",
    time: time || "21:00 HS",
    stadium: stadium || "Estadio Bartolomé Mitre",
    tournament: tournament || "Liga Argentina"
  };
  db.matches.push(newMatch);
  if (!db.activeMatchId) db.activeMatchId = newMatch.id;
  saveDB(db);
  res.json({ success: true, match: newMatch });
});

// GET All Tickets
app.get('/api/tickets', (req, res) => {
  const db = initDB();
  res.json({ tickets: db.tickets });
});

// GET Single Ticket
app.get('/api/tickets/:id', (req, res) => {
  const db = initDB();
  const ticket = db.tickets.find(t => t.id === req.params.id);
  if (!ticket) return res.status(404).json({ error: "Ticket no encontrado" });
  res.json({ ticket });
});

// GENERATE Tickets (Flexible passes, single match, or customizable multi-match abonos)
app.post('/api/tickets/generate', (req, res) => {
  const {
    type = 'invitacion',       // 'invitacion' | 'abono' | 'general'
    beneficiary = '',           // e.g. "Sponsor Coca Cola" or "Abonado Platea"
    count = 1,                 // quantity to generate
    matchCount = 10,           // custom matches for abono (3, 5, 10, etc.)
    matchId = null,
    notes = ''
  } = req.body;

  const db = initDB();
  const targetMatchId = matchId || db.activeMatchId;
  const createdTickets = [];
  const qty = Math.max(1, parseInt(count, 10) || 1);
  const totalMatchesAllowed = type === 'abono' ? Math.max(1, parseInt(matchCount, 10) || 10) : 1;

  for (let i = 1; i <= qty; i++) {
    const isAbono = type === 'abono';
    const prefix = isAbono ? 'ABONO' : (type === 'invitacion' ? 'INV' : 'ENT');
    const id = generateTicketId(prefix);
    
    let finalBeneficiary = beneficiary.trim();
    if (!finalBeneficiary) {
      finalBeneficiary = isAbono ? `Abono ${totalMatchesAllowed} Partidos` : 'Invitado Especial';
    }
    if (qty > 1) {
      finalBeneficiary += ` (${i}/${qty})`;
    }

    const ticket = {
      id,
      type,
      beneficiary: finalBeneficiary,
      matchId: isAbono ? 'MULTI_MATCH' : targetMatchId,
      maxUses: totalMatchesAllowed,
      remainingUses: totalMatchesAllowed,
      status: 'active',
      createdAt: new Date().toISOString(),
      notes,
      batchTotal: qty,
      batchIndex: i,
      entries: []
    };

    db.tickets.unshift(ticket);
    createdTickets.push(ticket);
  }

  saveDB(db);
  res.json({
    success: true,
    count: createdTickets.length,
    tickets: createdTickets
  });
});

// VALIDATE QR Code (Door scanner engine)
app.post('/api/tickets/validate', (req, res) => {
  let { code, matchId, gate = 'Puerta Principal' } = req.body;
  if (!code) {
    return res.status(400).json({ valid: false, message: "Código QR vacío" });
  }

  code = code.trim();
  if (code.includes('/ticket/')) {
    code = code.split('/ticket/')[1].split('?')[0].trim();
  }

  const db = initDB();
  const currentMatchId = matchId || db.activeMatchId;
  const currentMatch = db.matches.find(m => m.id === currentMatchId) || { name: "Partido del Día" };

  const ticket = db.tickets.find(t => t.id.toUpperCase() === code.toUpperCase());

  if (!ticket) {
    return res.json({
      valid: false,
      status: 'INVALID',
      message: '❌ CÓDIGO INEXISTENTE',
      detail: `El código "${code}" no pertenece a este evento.`
    });
  }

  if (ticket.status === 'cancelled') {
    return res.json({
      valid: false,
      status: 'CANCELLED',
      message: '⛔ ENTRADA ANULADA',
      detail: 'Este pase fue dado de baja por la administración.',
      ticket
    });
  }

  // 1. Single Use Ticket (Invitación o General)
  if (ticket.type === 'invitacion' || ticket.type === 'general') {
    if (ticket.status === 'used' || ticket.remainingUses <= 0 || ticket.entries.length > 0) {
      const firstEntry = ticket.entries[0] || {};
      const hora = firstEntry.timestamp ? new Date(firstEntry.timestamp).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : 'Hora previa';
      return res.json({
        valid: false,
        status: 'ALREADY_USED',
        message: '🛑 ENTRADA YA UTILIZADA',
        detail: `Ya ingresó a las ${hora} hs. No se permite reingreso.`,
        ticket
      });
    }

    ticket.remainingUses = 0;
    ticket.status = 'used';
    ticket.entries.push({
      matchId: currentMatchId,
      matchName: currentMatch.name,
      timestamp: new Date().toISOString(),
      gate
    });
    saveDB(db);

    return res.json({
      valid: true,
      status: 'GRANTED',
      message: '✅ ACCESO PERMITIDO',
      typeLabel: ticket.type === 'invitacion' ? 'INVITACIÓN ESPECIAL' : 'ENTRADA GENERAL',
      detail: ticket.beneficiary,
      ticket
    });
  }

  // 2. Multi-Match Abono
  if (ticket.type === 'abono') {
    if (ticket.remainingUses <= 0) {
      return res.json({
        valid: false,
        status: 'EXHAUSTED',
        message: '🛑 ABONO AGOTADO',
        detail: `Ya consumió todos sus ${ticket.maxUses} partidos habilitados.`,
        ticket
      });
    }

    // Check if already scanned for THIS fixture/match
    const alreadyEnteredThisMatch = ticket.entries.find(e => e.matchId === currentMatchId);
    if (alreadyEnteredThisMatch) {
      const hora = new Date(alreadyEnteredThisMatch.timestamp).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
      return res.json({
        valid: false,
        status: 'ALREADY_USED_TODAY',
        message: '🛑 YA INGRESÓ A ESTE PARTIDO',
        detail: `Este abono ya ingresó hoy a las ${hora} hs para "${currentMatch.name}".`,
        ticket
      });
    }

    // Valid entry for this match
    ticket.remainingUses -= 1;
    const matchNumber = ticket.maxUses - ticket.remainingUses;
    if (ticket.remainingUses === 0) ticket.status = 'exhausted';

    ticket.entries.push({
      matchId: currentMatchId,
      matchName: currentMatch.name,
      matchNumber,
      timestamp: new Date().toISOString(),
      gate
    });
    saveDB(db);

    return res.json({
      valid: true,
      status: 'GRANTED_ABONO',
      message: '✅ ABONO VÁLIDO',
      typeLabel: `ABONO (${ticket.maxUses} PARTIDOS)`,
      detail: ticket.beneficiary,
      ticket,
      matchNumber,
      remaining: ticket.remainingUses,
      progressText: `Partido ${matchNumber} de ${ticket.maxUses} registrado (Quedan ${ticket.remainingUses})`
    });
  }

  res.json({ valid: false, message: "Tipo no reconocido" });
});

// RESET Single Ticket
app.post('/api/tickets/reset/:id', (req, res) => {
  const db = initDB();
  const ticket = db.tickets.find(t => t.id === req.params.id);
  if (!ticket) return res.status(404).json({ error: "Ticket no encontrado" });

  ticket.status = 'active';
  ticket.remainingUses = ticket.maxUses || 1;
  ticket.entries = [];
  saveDB(db);

  res.json({ success: true, ticket });
});

// RESET ALL
app.post('/api/tickets/reset-all', (req, res) => {
  const db = initDB();
  db.tickets.forEach(ticket => {
    ticket.status = 'active';
    ticket.remainingUses = ticket.maxUses || 1;
    ticket.entries = [];
  });
  saveDB(db);
  res.json({ success: true });
});

// DELETE
app.delete('/api/tickets/:id', (req, res) => {
  const db = initDB();
  db.tickets = db.tickets.filter(t => t.id !== req.params.id);
  saveDB(db);
  res.json({ success: true });
});

// TEMPLATE UPLOAD
app.post('/api/upload-template', upload.single('template'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Archivo requerido" });
  const db = initDB();
  db.currentTemplate = req.file.filename;
  saveDB(db);
  res.json({ success: true, filename: req.file.filename });
});

// RESTORE DEFAULT TEMPLATE
app.post('/api/template/restore-default', (req, res) => {
  const db = initDB();
  db.currentTemplate = 'template_default.jpg';
  saveDB(db);
  res.json({ success: true, template: 'template_default.jpg' });
});

// STATIC ASSETS
app.use(express.static(PUBLIC_DIR));
app.use('/uploads', express.static(UPLOADS_DIR));

// ISOLATED SCANNER FOR DOOR STAFF ONLY (No admin privileges)
app.get('/scanner', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'scanner.html'));
});

// TICKET VIEW FOR GUESTS
app.get('/ticket/:id', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'ticket.html'));
});

// START
app.listen(PORT, '0.0.0.0', () => {
  console.log(`=================================================`);
  console.log(`🎫 SISTEMA MITRE - ENTRADAS Y CONTROL DE ACCESO`);
  console.log(`🚀 Puerto: ${PORT}`);
  console.log(`💻 Panel Admin:   http://localhost:${PORT}`);
  console.log(`📱 Puerta Guardia: http://localhost:${PORT}/scanner`);
  console.log(`=================================================`);
});
