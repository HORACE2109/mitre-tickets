// Database Service with Cloud Firestore + Realtime WebSockets
const dbService = {
  db: null,

  init() {
    if (typeof firebase !== 'undefined') {
      this.db = firebase.firestore();
      // Enable offline persistence
      try {
        this.db.enablePersistence({ synchronizeTabs: true });
      } catch (err) {
        // Persistence already enabled or not supported in this tab
      }
    }
  },

  // Seed default matches if collection is empty
  async seedInitialData() {
    if (!this.db) return;
    const snap = await this.db.collection('matches').get();
    if (snap.empty) {
      const defaultMatches = [
        {
          id: "match-1",
          name: "Bartolomé Mitre vs Sportivo Suardi",
          date: "Miércoles 11/11",
          time: "21:30 HS",
          stadium: "Estadio Bartolomé Mitre",
          tournament: "Liga Argentina",
          active: true
        },
        {
          id: "match-2",
          name: "Bartolomé Mitre vs Deportivo Norte",
          date: "Domingo 15/11",
          time: "20:00 HS",
          stadium: "Estadio Bartolomé Mitre",
          tournament: "Liga Argentina",
          active: false
        }
      ];
      for (const m of defaultMatches) {
        await this.db.collection('matches').doc(m.id).set(m);
      }
      await this.db.collection('config').doc('app').set({
        activeMatchId: 'match-1',
        currentTemplate: 'template_default.jpg'
      });
    }
  },

  // Get Config
  async getConfig() {
    if (!this.db) return { activeMatchId: 'match-1', matches: [], currentTemplate: 'template_default.jpg' };
    const doc = await this.db.collection('config').doc('app').get();
    const configData = doc.exists ? doc.data() : { activeMatchId: 'match-1', currentTemplate: 'template_default.jpg' };

    const matchesSnap = await this.db.collection('matches').get();
    const matches = [];
    matchesSnap.forEach(d => matches.push(d.data()));

    return {
      activeMatchId: configData.activeMatchId || 'match-1',
      currentTemplate: configData.currentTemplate || 'template_default.jpg',
      matches
    };
  },

  // Real-time listener for tickets
  subscribeTickets(callback) {
    if (!this.db) return () => {};
    return this.db.collection('tickets').orderBy('createdAt', 'desc').onSnapshot(snap => {
      const tickets = [];
      snap.forEach(doc => tickets.push(doc.data()));
      callback(tickets);
    }, err => {
      console.warn("Tickets subscription error", err);
    });
  },

  // Generate batch
  async generateTickets({ type = 'invitacion', beneficiary = '', count = 1, matchCount = 10, matchId = 'match-1' }) {
    if (!this.db) return [];
    const qty = Math.max(1, parseInt(count, 10) || 1);
    const totalMatches = type === 'abono' ? Math.max(1, parseInt(matchCount, 10) || 10) : 1;
    const isAbono = type === 'abono';
    const prefix = isAbono ? 'ABONO' : (type === 'invitacion' ? 'INV' : 'ENT');

    const created = [];
    const batch = this.db.batch();

    for (let i = 1; i <= qty; i++) {
      const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
      let rand = '';
      for (let j = 0; j < 6; j++) rand += chars.charAt(Math.floor(Math.random() * chars.length));
      const id = `${prefix}-${rand}`;

      let finalBeneficiary = beneficiary.trim();
      if (!finalBeneficiary) {
        finalBeneficiary = isAbono ? `Abono ${totalMatches} Partidos` : 'Invitado Especial';
      }
      if (qty > 1) {
        finalBeneficiary += ` (${i}/${qty})`;
      }

      const ticket = {
        id,
        type,
        beneficiary: finalBeneficiary,
        matchId: isAbono ? 'MULTI_MATCH' : matchId,
        maxUses: totalMatches,
        remainingUses: totalMatches,
        status: 'active',
        createdAt: new Date().toISOString(),
        entries: []
      };

      const ref = this.db.collection('tickets').doc(id);
      batch.set(ref, ticket);
      created.push(ticket);
    }

    await batch.commit();
    return created;
  },

  // Validate Ticket at Door
  async validateTicket(code, matchId, gate = 'Puerta Principal') {
    if (!this.db) return { valid: false, message: "Base de datos no disponible" };

    code = (code || '').trim();
    if (code.includes('/ticket/')) {
      code = code.split('/ticket/')[1].split('?')[0].trim();
    }
    code = code.toUpperCase();

    const doc = await this.db.collection('tickets').doc(code).get();
    if (!doc.exists) {
      return {
        valid: false,
        status: 'INVALID',
        message: '❌ CÓDIGO INEXISTENTE',
        detail: `El código "${code}" no pertenece a este evento.`
      };
    }

    const ticket = doc.data();

    // 1. Single Use Ticket
    if (ticket.type === 'invitacion' || ticket.type === 'general') {
      if (ticket.status === 'used' || ticket.remainingUses <= 0 || (ticket.entries && ticket.entries.length > 0)) {
        const first = ticket.entries[0] || {};
        const hora = first.timestamp ? new Date(first.timestamp).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }) : 'Hora previa';
        return {
          valid: false,
          status: 'ALREADY_USED',
          message: '🛑 ENTRADA YA UTILIZADA',
          detail: `Ya ingresó a las ${hora} hs. No se permite reingreso.`,
          ticket
        };
      }

      const newEntry = {
        matchId,
        timestamp: new Date().toISOString(),
        gate
      };

      await doc.ref.update({
        remainingUses: 0,
        status: 'used',
        entries: firebase.firestore.FieldValue.arrayUnion(newEntry)
      });

      return {
        valid: true,
        status: 'GRANTED',
        message: '✅ ACCESO PERMITIDO',
        typeLabel: ticket.type === 'invitacion' ? 'INVITACIÓN ESPECIAL' : 'ENTRADA GENERAL',
        detail: ticket.beneficiary,
        ticket
      };
    }

    // 2. Multi-match Abono
    if (ticket.type === 'abono') {
      if (ticket.remainingUses <= 0) {
        return {
          valid: false,
          status: 'EXHAUSTED',
          message: '🛑 ABONO AGOTADO',
          detail: `Ya consumió todos sus ${ticket.maxUses} partidos habilitados.`,
          ticket
        };
      }

      const alreadyEntered = ticket.entries && ticket.entries.some(e => e.matchId === matchId);
      if (alreadyEntered) {
        const last = ticket.entries.find(e => e.matchId === matchId) || {};
        const hora = last.timestamp ? new Date(last.timestamp).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }) : 'Hora previa';
        return {
          valid: false,
          status: 'ALREADY_USED_TODAY',
          message: '🛑 YA INGRESÓ A ESTE PARTIDO',
          detail: `Este abono ya ingresó hoy a las ${hora} hs para esta fecha.`,
          ticket
        };
      }

      const newRemaining = ticket.remainingUses - 1;
      const matchNum = ticket.maxUses - newRemaining;
      const newStatus = newRemaining === 0 ? 'exhausted' : 'active';
      const newEntry = {
        matchId,
        matchNumber: matchNum,
        timestamp: new Date().toISOString(),
        gate
      };

      await doc.ref.update({
        remainingUses: newRemaining,
        status: newStatus,
        entries: firebase.firestore.FieldValue.arrayUnion(newEntry)
      });

      return {
        valid: true,
        status: 'GRANTED_ABONO',
        message: '✅ ABONO VÁLIDO',
        typeLabel: `ABONO (${ticket.maxUses} PARTIDOS)`,
        detail: ticket.beneficiary,
        ticket,
        matchNumber: matchNum,
        remaining: newRemaining,
        progressText: `Partido ${matchNum} de ${ticket.maxUses} registrado (Quedan ${newRemaining})`
      };
    }

    return { valid: false, message: "Tipo no reconocido" };
  },

  // Reset ticket
  async resetTicket(id) {
    if (!this.db) return;
    const doc = await this.db.collection('tickets').doc(id).get();
    if (doc.exists) {
      const t = doc.data();
      await doc.ref.update({
        status: 'active',
        remainingUses: t.maxUses || 1,
        entries: []
      });
    }
  },

  // Reset all
  async resetAllTickets() {
    if (!this.db) return;
    const snap = await this.db.collection('tickets').get();
    const batch = this.db.batch();
    snap.forEach(doc => {
      const t = doc.data();
      batch.update(doc.ref, {
        status: 'active',
        remainingUses: t.maxUses || 1,
        entries: []
      });
    });
    await batch.commit();
  },

  // Delete ticket
  async deleteTicket(id) {
    if (!this.db) return;
    await this.db.collection('tickets').doc(id).delete();
  },

  // Get single ticket for digital pass
  async getTicket(id) {
    if (!this.db) return null;
    const doc = await this.db.collection('tickets').doc(id).get();
    return doc.exists ? doc.data() : null;
  }
};
