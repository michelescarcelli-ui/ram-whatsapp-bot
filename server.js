/**
 * RAM Elettronica â WhatsApp AI Assistant v4.2 MULTI-BRAND + ARTICOLI + DOCS
 * Assistente conversazionale AI per inverter/drive di QUALSIASI produttore
 *
 * PRODUTTORI SUPPORTATI:
 *   Danfoss (VLT, VACON, iC), ABB (ACS), Siemens (SINAMICS, MICROMASTER),
 *   Schneider Electric (Altivar), Yaskawa (GA/A1000/V1000), WEG (CFW),
 *   Mitsubishi (FR), Lenze (i-series), SEW-Eurodrive (MOVITRAC/MOVIDRIVE),
 *   Fuji (FRENIC), Parker (AC/DC drives), Rockwell/Allen-Bradley (PowerFlex),
 *   Eaton, Nidec, Hitachi, Delta, Emerson (Control Techniques)
 *
 * FUNZIONALITÃ:
 *   - Conversazione libera â come parlare con un tecnico esperto senior
 *   - Database allarmi Danfoss integrato per risposte istantanee
 *   - AI Anthropic per tutto: diagnostica, collegamenti, parametri, manuali, dimensionamento
 *   - Supporto multi-produttore via AI (qualsiasi marca di inverter)
 *   - Memoria conversazione (ultimi messaggi per contesto)
 *   - Registrazione utente semplice (nome + azienda)
 *   - Google Sheet + log locale
 *   - WhatsApp Cloud API
 *
 * Variabili d'ambiente:
 *   WHATSAPP_TOKEN       = Token di accesso WhatsApp Cloud API
 *   WHATSAPP_VERIFY      = Token di verifica webhook (scegli tu)
 *   PHONE_NUMBER_ID      = ID numero telefono WhatsApp Business
 *   ANTHROPIC_API_KEY    = Chiave API Anthropic (NECESSARIA per conversazione)
 *   GOOGLE_WEBHOOK_URL   = URL Google Apps Script (opzionale)
 *   PORT                 = Porta server (default 3000)
 */

const express = require('express');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json({ limit: '10mb' }));

// ââ Config ââ
const WHATSAPP_TOKEN   = process.env.WHATSAPP_TOKEN;
const WHATSAPP_VERIFY  = process.env.WHATSAPP_VERIFY || 'ram_verify_2024';
const PHONE_NUMBER_ID  = process.env.PHONE_NUMBER_ID;
const ANTHROPIC_KEY    = process.env.ANTHROPIC_API_KEY || '';
const GOOGLE_WEBHOOK   = process.env.GOOGLE_WEBHOOK_URL || '';
const PORT             = process.env.PORT || 3000;
const MAX_HISTORY      = 20; // Messaggi di contesto per AI

if (!WHATSAPP_TOKEN || !PHONE_NUMBER_ID) {
  console.error('â WHATSAPP_TOKEN o PHONE_NUMBER_ID non configurati!');
  process.exit(1);
}
if (!ANTHROPIC_KEY) {
  console.warn('â ï¸  ANTHROPIC_API_KEY non configurata â il bot funzionerÃ  solo con il database allarmi locale.');
}

// ââ Persistenza utenti ââ
const USERS_FILE = path.join(__dirname, 'users.json');
let knownUsers = {};
try {
  knownUsers = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
} catch(e) {}

function saveUsers() {
  fs.writeFileSync(USERS_FILE, JSON.stringify(knownUsers, null, 2));
}

// ââ Storico richieste ââ
const HISTORY_FILE = path.join(__dirname, 'history.json');
let requestHistory = [];
try {
  requestHistory = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
} catch(e) {}

function saveHistory() {
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(requestHistory, null, 2));
}

function addToHistory(phone, s, userMsg, botReply) {
  requestHistory.push({
    ts: new Date().toISOString(),
    data: new Date().toLocaleDateString('it-IT'),
    ora: new Date().toLocaleTimeString('it-IT', {hour:'2-digit',minute:'2-digit'}),
    phone,
    nome: s.nome || '',
    azienda: s.azienda || '',
    telefono: phone || '',
    problema: userMsg,
    valutazione: botReply.substring(0, 500)
  });
  if (requestHistory.length > 5000) requestHistory = requestHistory.slice(-5000);
  saveHistory();
}

// ââ Health check ââ
app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    service: 'RAM Elettronica AI Assistant v4.2 MULTI-BRAND + DOCS',
    ai: ANTHROPIC_KEY ? 'Claude attivo' : 'solo DB locale',
    google_sheet: GOOGLE_WEBHOOK ? 'attivo' : 'non configurato',
    utenti: Object.keys(knownUsers).length,
    sessioni: Object.keys(sessions).length
  });
});
app.listen(PORT, () => console.log(`   Health check: http://localhost:${PORT}`));


// ââââââââââââââââââââââââââââââââââââââââââââââââââ
// ââ DATABASE ALLARMI DANFOSS ââ
// ââââââââââââââââââââââââââââââââââââââââââââââââââ
const ALLARMI = {
  1:  {n:'Sovracorrente (10V bassa)',c:'Segnale sul morsetto 53 inferiore al 50% del range. Cavo sensore rotto o trasduttore guasto.',
       a:['Verificare collegamento morsetto 53','Controllare trasduttore/sensore','Verificare Par. 6-10','Misurare tensione con multimetro'],p:['Par. 6-10: Terminal 53 Low Voltage','Par. 6-11: Terminal 53 High Voltage'],int:'DA VERIFICARE',sic:'Scollegare alimentazione prima di verificare.'},
  2:  {n:'Live Zero Error',c:'Segnale sul morsetto 54 inferiore al 50% del range.',a:['Verificare collegamento morsetto 54','Controllare trasduttore'],p:['Par. 6-20: Terminal 54 Low Voltage'],int:'DA VERIFICARE',sic:'Scollegare alimentazione.'},
  4:  {n:'Perdita fase alimentazione',c:'Manca una fase in ingresso. Fusibile bruciato, raddrizzatore guasto o contattore difettoso.',
       a:['Verificare tensione su tutte e 3 le fasi','Controllare fusibili ingresso','Verificare contattore principale','Controllare Par. 14-12'],p:['Par. 14-12: Mains Unbalance','Par. 1-20: Motor Power'],int:'SI',sic:'â¡ ALTA TENSIONE. Attendere scarica condensatori (4 min).'},
  5:  {n:'Sovratensione DC Link',c:'Tensione DC bus troppo alta. Decelerazione troppo rapida, tensione rete alta, o resistenza frenatura assente.',
       a:['Allungare rampa decelerazione (Par. 3-42)','Verificare tensione di rete','Attivare OVC (Par. 2-17)','Verificare resistenza frenatura'],p:['Par. 3-42: Ramp Down Time','Par. 2-17: Over-voltage Control','Par. 2-10: Brake Function'],int:'NO â Risolvibile via parametri',sic:'Non toccare morsetti DC bus. Tensione fino a 800VDC.'},
  7:  {n:'Sovratensione DC Bus (HW)',c:'Tensione DC bus oltre limite protezione hardware.',a:['Come allarme 5','Verificare picchi sulla rete','Considerare filtro di rete'],p:['Par. 3-42','Par. 2-17','Par. 14-50: RFI Filter'],int:'DA VERIFICARE',sic:'â¡ ALTA TENSIONE.'},
  8:  {n:'Sottotensione DC Bus',c:'Tensione DC bus sotto il minimo. Caduta tensione rete, fase mancante o fusibile bruciato.',
       a:['Verificare tensione alimentazione','Controllare fusibili','Verificare contattore','Controllare Par. 14-10'],p:['Par. 14-10: Mains Failure','Par. 14-12: Mains Unbalance'],int:'SI',sic:'Verificare alimentazione stabile.'},
  9:  {n:'Sovraccarico inverter',c:'Corrente oltre il 100% nominale per troppo tempo. Motore sovraccarico, bloccato o inverter sottodimensionato.',
       a:['Verificare che il motore non sia bloccato','Controllare taglia inverter vs motore','Verificare dati targa motore (Par. 1-2*)','Ridurre carico o aumentare taglia','Verificare ventilazione inverter'],p:['Par. 1-20: Motor Power','Par. 1-24: Motor Current','Par. 4-18: Current Limit'],int:'SI â Verificare dimensionamento e carico',sic:'Non riavviare senza identificare la causa.'},
  10: {n:'Sovratemperatura motore (ETR)',c:'Il modello termico indica surriscaldamento motore.',a:['Verificare carico meccanico','Controllare ventilazione motore','Verificare dati motore','Controllare Par. 1-90'],p:['Par. 1-90: Motor Thermal Protection','Par. 1-24: Motor Current'],int:'SI',sic:'ð¥ Motore caldo. Utilizzare DPI.'},
  11: {n:'Sovratemperatura termistore',c:'Termistore PTC/KTY rileva temperatura eccessiva o collegamento interrotto.',a:['Verificare temperatura motore','Controllare collegamento termistore','Verificare Par. 1-90 e 1-93','Misurare resistenza termistore'],p:['Par. 1-90: Motor Thermal Protection','Par. 1-93: Thermistor Source'],int:'SI',sic:'ð¥ Motore molto caldo.'},
  12: {n:'Coppia limite',c:'Coppia oltre il valore impostato.',a:['Verificare carico meccanico','Aumentare limiti coppia se appropriato','Verificare motore non bloccato'],p:['Par. 4-16: Torque Limit Motor','Par. 4-17: Torque Limit Generator'],int:'DA VERIFICARE',sic:'Verificare ostruzioni meccaniche.'},
  13: {n:'Sovracorrente (Over Current)',c:'Picco corrente oltre ~200% nominale. Cortocircuito motore/cavi, guasto IGBT, transitorio improvviso.',
       a:['Misurare isolamento motore e cavi con megger','Verificare resistenza cavi fase per fase','Controllare umiditÃ  nei morsetti','Controllare filtro uscita se presente'],p:['Par. 1-20 a 1-25: Dati motore','Par. 4-18: Current Limit'],int:'SI â Possibile guasto HW.',sic:'â PERICOLO. Non riavviare senza verifica isolamento.'},
  14: {n:'Guasto a terra (Earth Fault)',c:'Dispersione a terra. Isolamento motore o cavi compromesso.',
       a:['Scollegare motore, misurare isolamento con megger (>1MÎ©)','Verificare cavi per danni','Controllare umiditÃ  morsetti','Provare avvio senza motore'],p:['Par. 14-22: Earth Fault Check','Par. 1-30: Stator Resistance'],int:'SI â Non riavviare.',sic:'â PERICOLO. Possibile contatto a terra.'},
  16: {n:'Cortocircuito',c:'Cortocircuito cavi motore o avvolgimenti. IGBT possibilmente danneggiati.',
       a:['Scollegare SUBITO motore da U/V/W','Misurare resistenza tra fasi','Misurare isolamento con megger','Se persiste senza motore: IGBT guasti'],p:['Par. 1-30: Stator Resistance'],int:'SI â Urgente.',sic:'â PERICOLO ELEVATO.'},
  17: {n:'Control Word Timeout',c:'Nessuna comunicazione dal bus/seriale entro il timeout.',a:['Verificare cavo comunicazione','Controllare PLC/master','Verificare Par. 8-04'],p:['Par. 8-03: Timeout Time','Par. 8-04: Timeout Function'],int:'NO',sic:'Nessun rischio.'},
  22: {n:'Freno meccanico (Hoist)',c:'Errore sequenza freno di sollevamento.',a:['Verificare configurazione freno','Controllare Par. 2-20 a 2-28','Verificare contattore freno'],p:['Par. 2-20: Release Brake Current'],int:'SI',sic:'â PERICOLO. Verificare carico in sicurezza.'},
  23: {n:'Guasto ventola interna',c:'Ventola raffreddamento non funziona.',a:['Verificare ventola visivamente','Pulire ventola e griglie','Sostituire se difettosa'],p:['Par. 14-53: Fan Control'],int:'SI',sic:'Scollegare alimentazione.'},
  27: {n:'Freno Chopper',c:'Chopper in cortocircuito o resistenza frenatura guasta.',a:['Misurare resistenza frenatura (scollegata)','Verificare cablaggio'],p:['Par. 2-10: Brake Function','Par. 2-11: Brake Resistor'],int:'SI',sic:'ð¥ Resistenza frenatura molto calda.'},
  29: {n:'Sovratemperatura dissipatore',c:'Temperatura dissipatore oltre il limite.',a:['Verificare temp. ambiente (max 40-50Â°C)','Pulire alette dissipatore','Verificare ventola','Ridurre freq. commutazione'],p:['Par. 14-01: Switching Frequency','Par. 14-52: Fan Control'],int:'SI',sic:'ð¥ Dissipatore molto caldo.'},
  30: {n:'Perdita fase motore U',c:'Fase U disconnessa.',a:['Verificare morsetto U','Controllare cavo fase U','Misurare avvolgimenti U-V, U-W, V-W'],p:['Par. 1-30: Stator Resistance'],int:'SI',sic:'Scollegare alimentazione.'},
  31: {n:'Perdita fase motore V',c:'Come allarme 30 per fase V.',a:['Verificare morsetto V','Misurare avvolgimenti'],p:['Par. 1-30: Stator Resistance'],int:'SI',sic:'Scollegare alimentazione.'},
  32: {n:'Perdita fase motore W',c:'Come allarme 30 per fase W.',a:['Verificare morsetto W','Misurare avvolgimenti'],p:['Par. 1-30: Stator Resistance'],int:'SI',sic:'Scollegare alimentazione.'},
  33: {n:'Inrush Fault',c:'Troppe accensioni/spegnimenti ravvicinati.',a:['Attendere 1-2 minuti prima di riaccendere'],p:['Par. 14-10: Mains Failure'],int:'NO',sic:'Non accendere/spegnere ripetutamente.'},
  38: {n:'Guasto interno',c:'Errore firmware o scheda controllo.',a:['Power cycle completo','Se persiste, reset valori fabbrica','Annotare sotto-codice errore','Contattare RAM'],p:['Par. 14-22: Operation Mode','Par. 15-30: Fault Log'],int:'SI â Contattare RAM.',sic:'Non tentare riparazioni interne.'},
  46: {n:'Power Card Supply',c:'Alimentazione power card fuori range.',a:['Verificare tensione ingresso','Power cycle completo'],p:['Par. 15-30: Fault Log'],int:'SI â Possibile guasto HW.',sic:'Scollegare alimentazione.'},
  48: {n:'Errore AMA',c:'Procedura AMA fallita. Dati motore errati o motore non collegato.',a:['Verificare motore collegato e fermo','Controllare dati targa (Par. 1-20 a 1-25)','Ripetere AMA: Par. 1-29 = [1]'],p:['Par. 1-29: AMA','Par. 1-20 a 1-25: Dati motore'],int:'NO',sic:'Motore fermo durante AMA.'},
  65: {n:'Sovratemp. scheda controllo',c:'Temperatura oltre 75Â°C.',a:['Verificare temp. ambiente','Pulire prese aria','Verificare ventola'],p:['Par. 14-52: Fan Control'],int:'SI',sic:'Drive caldo.'},
  68: {n:'Safe Stop attivato',c:'STO attivato tramite morsetto 37.',a:['Verificare segnale su morsetto 37','Controllare circuito sicurezza'],p:['Par. 5-19: Safe Stop Function'],int:'NO',sic:'â Funzione sicurezza. Non bypassare.'},
  69: {n:'Sovratemp. power card',c:'Temperatura power card eccessiva.',a:['Verificare ventilazione','Pulire dissipatore'],p:['Par. 14-01: Switching Frequency'],int:'SI',sic:'ð¥ Superfici calde.'},
  80: {n:'Reset valori fabbrica',c:'Parametri resettati.',a:['Riprogrammare tutti i parametri','Ricaricare backup se disponibile'],p:['Par. 14-22: Operation Mode'],int:'NO',sic:'Non avviare senza riprogrammazione.'},
  92: {n:'Portata zero (No Flow)',c:'Assenza flusso rilevata.',a:['Verificare valvole aperte','Controllare livello fluido','Verificare pompa'],p:['Par. 22-20: No Flow Detection'],int:'SI',sic:'Verificare pressioni.'},
  93: {n:'Pompa a secco',c:'Funzionamento a secco rilevato.',a:['Verificare livello fluido','Controllare valvola aspirazione','Spegnere pompa fino a ripristino'],p:['Par. 22-24: Dry Pump Detection'],int:'SI â Non riavviare.',sic:'â Funzionamento a secco distrugge la pompa.'}
};


// ââââââââââââââââââââââââââââââââââââââââââââââââââ
// ââ DATABASE ARTICOLI / CODICI ORDINE MULTI-BRAND ââ
// ââââââââââââââââââââââââââââââââââââââââââââââââââ

// URL schede prodotto ufficiali per produttore
const BRAND_PRODUCT_URLS = {
  'Danfoss': {
    baseSearch: 'https://www.danfoss.com/it-it/search/?query=',
    productPage: 'https://www.danfoss.com/it-it/search/?query={code}&filter=type%3Aproduct',
    catalog: 'https://store.danfoss.com/it-it/search?q={code}'
  },
  'ABB': {
    baseSearch: 'https://new.abb.com/products/search?q=',
    productPage: 'https://new.abb.com/drives/search?q={code}',
    catalog: 'https://new.abb.com/products/search?q={code}'
  },
  'Siemens': {
    baseSearch: 'https://mall.industry.siemens.com/mall/it/it/Catalog/Search?searchTerm=',
    productPage: 'https://mall.industry.siemens.com/mall/it/it/Catalog/Search?searchTerm={code}',
    catalog: 'https://mall.industry.siemens.com/mall/it/it/Catalog/Search?searchTerm={code}'
  },
  'Schneider': {
    baseSearch: 'https://www.se.com/it/it/search/?q=',
    productPage: 'https://www.se.com/it/it/product/{code}/',
    catalog: 'https://www.se.com/it/it/search/?q={code}'
  },
  'Yaskawa': {
    baseSearch: 'https://www.yaskawa.eu.com/search?q=',
    productPage: 'https://www.yaskawa.eu.com/search?q={code}',
    catalog: 'https://www.yaskawa.eu.com/search?q={code}'
  },
  'WEG': {
    baseSearch: 'https://www.weg.net/catalog/weg/IT/it/search?q=',
    productPage: 'https://www.weg.net/catalog/weg/IT/it/search?q={code}',
    catalog: 'https://www.weg.net/catalog/weg/IT/it/search?q={code}'
  },
  'Mitsubishi': {
    baseSearch: 'https://www.mitsubishielectric.com/fa/products/drv/search.html?q=',
    productPage: 'https://www.mitsubishielectric.com/fa/products/drv/search.html?q={code}',
    catalog: 'https://www.mitsubishielectric.com/fa/products/drv/search.html?q={code}'
  },
  'Lenze': {
    baseSearch: 'https://www.lenze.com/en/search/?q=',
    productPage: 'https://www.lenze.com/en/search/?q={code}',
    catalog: 'https://www.lenze.com/en/search/?q={code}'
  },
  'SEW': {
    baseSearch: 'https://www.sew-eurodrive.it/prodotti/ricerca-prodotto.html?q=',
    productPage: 'https://www.sew-eurodrive.it/prodotti/ricerca-prodotto.html?q={code}',
    catalog: 'https://www.sew-eurodrive.it/prodotti/ricerca-prodotto.html?q={code}'
  },
  'Fuji': {
    baseSearch: 'https://www.fujielectric.com/products/search/?q=',
    productPage: 'https://www.fujielectric.com/products/search/?q={code}',
    catalog: 'https://www.fujielectric.com/products/search/?q={code}'
  },
  'Parker': {
    baseSearch: 'https://www.parker.com/search?q=',
    productPage: 'https://www.parker.com/search?q={code}',
    catalog: 'https://www.parker.com/search?q={code}'
  },
  'Rockwell/Allen-Bradley': {
    baseSearch: 'https://www.rockwellautomation.com/search?q=',
    productPage: 'https://www.rockwellautomation.com/search?q={code}',
    catalog: 'https://www.rockwellautomation.com/search?q={code}'
  },
  'Eaton': {
    baseSearch: 'https://www.eaton.com/it/it-it/search.html?q=',
    productPage: 'https://www.eaton.com/it/it-it/search.html?q={code}',
    catalog: 'https://www.eaton.com/it/it-it/search.html?q={code}'
  },
  'Nidec': {
    baseSearch: 'https://www.controltechniques.com/search?q=',
    productPage: 'https://www.controltechniques.com/search?q={code}',
    catalog: 'https://www.controltechniques.com/search?q={code}'
  },
  'Hitachi': {
    baseSearch: 'https://www.hitachi-industrial.eu/search?q=',
    productPage: 'https://www.hitachi-industrial.eu/search?q={code}',
    catalog: 'https://www.hitachi-industrial.eu/search?q={code}'
  },
  'Delta': {
    baseSearch: 'https://www.deltaww.com/en-US/search?q=',
    productPage: 'https://www.deltaww.com/en-US/search?q={code}',
    catalog: 'https://www.deltaww.com/en-US/search?q={code}'
  }
};

// ââââââââââââââââââââââââââââââââââââââââââââââââââ
// ââ DATABASE DOCUMENTAZIONE UFFICIALE PER BRAND ââ
// ââââââââââââââââââââââââââââââââââââââââââââââââââ
const BRAND_DOCS = {
  'Danfoss': {
    manuals: 'https://www.danfoss.com/en/service-and-support/downloads/dds/',
    faultCodes: 'https://www.danfoss.com/en/service-and-support/fix-and-troubleshooting/drives-support/',
    knowledgeBase: 'https://www.danfoss.com/en/service-and-support/fix-and-troubleshooting/drives-support/',
    configurator: 'https://mydriveselect.danfoss.com/',
    software: 'MCT-10 Studio, MyDrive Suite, MyDrive Insight, VACON Live, VACON NCDrive',
    directPdf: 'https://files.danfoss.com/download/Drives/',
    vaconManuals: 'https://files.danfoss.com/download/Drives/',
    supportPhone: '+39 0883 553719 (RAM Elettronica â DrivePro Service Partner)'
  },
  'ABB': {
    manuals: 'https://library.abb.com/',
    faultCodes: 'https://library.abb.com/',
    knowledgeBase: 'https://new.abb.com/drives/documents/technical-guides',
    configurator: 'https://selector.drivesmotors.abb.com/',
    software: 'Drive Composer, DriveStudio, DriveSize',
    directPdf: 'https://library.abb.com/',
    supportPhone: 'ABB Service: +800 222 78378'
  },
  'Siemens': {
    manuals: 'https://support.industry.siemens.com/cs/start?lc=en-WW',
    faultCodes: 'https://support.industry.siemens.com/cs/start?lc=en-WW',
    knowledgeBase: 'https://support.industry.siemens.com/cs/start?lc=en-WW',
    configurator: 'https://mall.industry.siemens.com/',
    software: 'SINAMICS Startdrive (TIA Portal), STARTER',
    directPdf: 'https://cache.industry.siemens.com/dl/files/',
    supportPhone: 'Siemens Support: +39 02 243 62 243'
  },
  'Schneider': {
    manuals: 'https://www.se.com/it/it/download/',
    faultCodes: 'https://www.se.com/it/it/faqs/',
    knowledgeBase: 'https://www.se.com/it/it/faqs/',
    configurator: 'https://www.se.com/it/it/work/products/product-range-selector/',
    software: 'SoMove, EcoStruxure Machine Expert',
    directPdf: 'https://download.schneider-electric.com/',
    supportPhone: 'Schneider: +39 02 2487 1'
  },
  'Yaskawa': {
    manuals: 'https://www.yaskawa.eu.com/downloads/documents-downloads',
    faultCodes: 'https://www.yaskawa.eu.com/downloads/documents-downloads',
    knowledgeBase: 'https://www.yaskawa.eu.com/service-support',
    configurator: 'https://www.yaskawa.eu.com/products/drives/product-selector',
    software: 'DriveWizard Industrial, YASKAWA DOL',
    directPdf: 'https://www.yaskawa.eu.com/downloads/',
    supportPhone: 'Yaskawa Europe: +49 6196 569 300'
  },
  'WEG': {
    manuals: 'https://www.weg.net/catalog/weg/IT/it/',
    faultCodes: 'https://www.weg.net/catalog/weg/IT/it/',
    knowledgeBase: 'https://www.weg.net/institutional/IT/it/support/technical-support',
    configurator: 'https://www.weg.net/catalog/weg/IT/it/',
    software: 'WEG WPS, SuperDrive G2',
    directPdf: 'https://static.weg.net/medias/downloadcenter/',
    supportPhone: 'WEG Italia: +39 02 575 0711'
  },
  'Mitsubishi': {
    manuals: 'https://www.mitsubishielectric.com/fa/download/search.page?kisyu=/inv&mode=manual',
    faultCodes: 'https://www.mitsubishielectric.com/fa/download/search.page?kisyu=/inv&mode=manual',
    knowledgeBase: 'https://www.mitsubishielectric.com/fa/products/drv/inv/',
    configurator: 'https://www.mitsubishielectric.com/fa/products/drv/inv/smerit/fr_config/index.html',
    software: 'FR Configurator2, GX Works3',
    directPdf: 'https://dl.mitsubishielectric.com/dl/fa/document/manual/inv/',
    supportPhone: 'Mitsubishi FA Italia: +39 039 6053 1'
  },
  'Lenze': {
    manuals: 'https://www.lenze.com/en/services/knowledge-base/product-related-documentation',
    faultCodes: 'https://www.lenze.com/en/services/knowledge-base/',
    knowledgeBase: 'https://www.lenze.com/en/services/knowledge-base/',
    configurator: 'https://systemdesigner.lenze.com/',
    software: 'Engineer (L-force), Easy Explorer, DSD',
    directPdf: 'https://www.lenze.com/en/services/knowledge-base/product-related-documentation',
    supportPhone: 'Lenze: +49 5154 82-0'
  },
  'SEW': {
    manuals: 'https://www.sew-eurodrive.it/supporto-documentazione/',
    faultCodes: 'https://download.sew-eurodrive.com/download/html/',
    knowledgeBase: 'https://www.sew-eurodrive.it/supporto-documentazione/',
    configurator: 'https://www.sew-eurodrive.it/os/catalog/',
    software: 'MOVITOOLS MotionStudio, Workbench',
    directPdf: 'https://download.sew-eurodrive.com/',
    supportPhone: 'SEW Italia: +39 02 96980 1'
  },
  'Fuji': {
    manuals: 'https://felib.fujielectric.co.jp/en',
    faultCodes: 'https://felib.fujielectric.co.jp/en',
    knowledgeBase: 'https://www.fujielectric.com/products/drives_inverters/',
    configurator: null,
    software: 'FRENIC Loader, Multi-Loader',
    directPdf: 'https://felib.fujielectric.co.jp/en',
    supportPhone: 'Fuji Electric: +44 1onal'
  },
  'Parker': {
    manuals: 'https://www.parker.com/literature/',
    faultCodes: 'https://community.parker.com/technologies/electromechanical-group/w/electromechanical-knowledge-base/',
    knowledgeBase: 'https://community.parker.com/',
    configurator: null,
    software: 'DSE Lite, Parker SSD Drive Tool',
    directPdf: 'https://www.parker.com/literature/',
    supportPhone: 'Parker: +39 02 4520 81'
  },
  'Rockwell/Allen-Bradley': {
    manuals: 'https://www.rockwellautomation.com/en-us/support/documentation/literature-library.html',
    faultCodes: 'https://support.rockwellautomation.com/',
    knowledgeBase: 'https://support.rockwellautomation.com/',
    configurator: 'https://configurator.rockwellautomation.com/',
    software: 'Connected Components Workbench, Studio 5000',
    directPdf: 'https://literature.rockwellautomation.com/',
    supportPhone: 'Rockwell: +1 440-646-3434'
  },
  'Eaton': {
    manuals: 'https://www.eaton.com/it/it-it/support/technical-support.html',
    faultCodes: 'https://knowledgehub.eaton.com/',
    knowledgeBase: 'https://knowledgehub.eaton.com/',
    configurator: null,
    software: 'drivesConnect, PowerXL Xpress',
    directPdf: 'https://www.eaton.com/content/dam/eaton/products/',
    supportPhone: 'Eaton Italia: +39 02 955 91'
  },
  'Nidec': {
    manuals: 'https://acim.nidec.com/en-US/drives/control-techniques/Downloads/User-Guides-and-Software',
    faultCodes: 'https://acim.nidec.com/en-US/drives/control-techniques/Service-and-Support/Technical-Documentation/Troubleshooting-Guides/Troubleshooting-Guides-Downloads',
    knowledgeBase: 'https://controltechniquesfaqhelp.zendesk.com/',
    configurator: null,
    software: 'PowerTools Pro, Connect',
    directPdf: 'https://acim.nidec.com/en-US/drives/control-techniques/Downloads/',
    supportPhone: 'Nidec/CT: +44 1onal'
  },
  'Hitachi': {
    manuals: 'https://www.hitachi-iesa.com/ac-drives-inverters/support',
    faultCodes: 'https://www.hitachi-iesa.com/ac-drives-inverters/support',
    knowledgeBase: 'https://www.hitachi-iesa.com/ac-drives-inverters/support',
    configurator: null,
    software: 'ProDriveNext',
    directPdf: 'https://www.hitachi-iesa.com/sites/default/files/',
    supportPhone: 'Hitachi IESA: +1 914-524-6300'
  },
  'Delta': {
    manuals: 'https://deltaacdrives.com/',
    faultCodes: 'https://deltaacdrives.com/',
    knowledgeBase: 'https://support.deltaacdrives.com/',
    configurator: null,
    software: 'DIAStudio, VFDSoft, TPEditor',
    directPdf: 'https://deltaacdrives.com/',
    supportPhone: 'Delta EMEA: +31 40-8003800'
  }
};

// Funzione helper: ottieni link documentazione per brand
function getBrandDocsLinks(brand) {
  const docs = BRAND_DOCS[brand];
  if (!docs) return '';
  let links = '';
  if (docs.manuals) links += `\nð *Manuali:* ${docs.manuals}`;
  if (docs.faultCodes) links += `\nâ ï¸ *Fault codes/Troubleshooting:* ${docs.faultCodes}`;
  if (docs.knowledgeBase) links += `\nð *Knowledge Base:* ${docs.knowledgeBase}`;
  if (docs.configurator) links += `\nð§ *Configuratore:* ${docs.configurator}`;
  if (docs.software) links += `\nð» *Software:* ${docs.software}`;
  return links;
}

// Pattern codici articolo / order code per ogni produttore
const ARTICLE_PATTERNS = [
  // DANFOSS â 131Bxxxx, 132Bxxxx, 134Bxxxx, 131Fxxxx, 134Fxxxx, 175Gxxxx, 131Nxxxx ecc.
  { brand: 'Danfoss', regex: /\b(1(?:31|32|34|75|76|77|78)[A-Z]\d{4,6})\b/i,
    describe: (code) => {
      const prefix = code.substring(0, 3);
      const series = { '131': 'VLT/VACON Drive', '132': 'VLT/FC Series Drive', '134': 'VLT/FC Series (alta potenza)', '175': 'VLT Accessorio/Opzione', '176': 'VLT Opzione', '177': 'Opzione/Filtro', '178': 'Accessorio' };
      return series[prefix] || 'Prodotto Danfoss';
    }
  },
  { brand: 'Danfoss', regex: /\b(MCD\s?\d{3}[\w-]*)\b/i,
    describe: () => 'Soft Starter Danfoss MCD Series'
  },
  // ABB â ACS580-01-xxxA-x, 3AUA0000xxxxxx
  { brand: 'ABB', regex: /\b(ACS\d{3}[-]\d{2}[-]\d{2,4}[A-Z]?\d?[-][24])\b/i,
    describe: (code) => {
      const series = code.match(/ACS(\d{3})/i);
      if (!series) return 'Inverter ABB ACS Series';
      const s = series[1];
      const names = { '150': 'ACS150 â Micro Drive', '310': 'ACS310 â Drives per pompe e ventilatori', '355': 'ACS355 â General Purpose Drive', '380': 'ACS380 â Machinery Drive', '480': 'ACS480 â General Purpose Drive', '580': 'ACS580 â General Purpose Drive', '880': 'ACS880 â Industrial Drive', '800': 'ACS800 â Industrial Drive' };
      return names[s] || `Inverter ABB ACS${s}`;
    }
  },
  { brand: 'ABB', regex: /\b(3AUA\d{10,14})\b/i,
    describe: () => 'Prodotto ABB Drives (codice materiale)'
  },
  // SIEMENS SINAMICS â 6SL3210-xBE-xxxxx
  { brand: 'Siemens', regex: /\b(6SL3\d{3}[-]\d[A-Z]{2}\d{2}[-]\d[A-Z]\w{1,3})\b/i,
    describe: (code) => {
      if (code.match(/6SL321[01]/i)) return 'SINAMICS Power Module';
      if (code.match(/6SL322/i)) return 'SINAMICS G120 Power Module';
      if (code.match(/6SL324/i)) return 'SINAMICS Control Unit';
      return 'SINAMICS Component';
    }
  },
  { brand: 'Siemens', regex: /\b(6SE6[4]\d{2}[-]\d[A-Z]{2}\d{2}[-]\d[A-Z]\w{1,3})\b/i,
    describe: () => 'MICROMASTER Drive'
  },
  // SCHNEIDER Altivar â ATV320U15N4B
  { brand: 'Schneider', regex: /\b(ATV\d{2,3}[A-Z]\d{2,4}[A-Z]\d[A-Z]?)\b/i,
    describe: (code) => {
      const series = code.match(/ATV(\d{2,3})/i);
      if (!series) return 'Altivar Drive Schneider';
      const s = series[1];
      const names = { '12': 'Altivar 12 â Drive compatto monofase', '212': 'Altivar 212 â Drive per HVAC', '310': 'Altivar Machine ATV310', '320': 'Altivar Machine ATV320 â Drive compatto', '340': 'Altivar Machine ATV340 â Drive ad alte prestazioni', '600': 'Altivar Process ATV600', '630': 'Altivar Process ATV630 â Drive per processo', '900': 'Altivar Process ATV900', '930': 'Altivar Process ATV930 â Drive per processo avanzato' };
      return names[s] || `Altivar ATV${s}`;
    }
  },
  // YASKAWA â CIMR-xxxxx
  { brand: 'Yaskawa', regex: /\b(CIMR[-]?\w{5,12})\b/i,
    describe: (code) => {
      if (code.match(/CIMR[-]?A/i)) return 'Yaskawa A1000 â High Performance Drive';
      if (code.match(/CIMR[-]?V/i)) return 'Yaskawa V1000 â Compact Vector Drive';
      if (code.match(/CIMR[-]?J/i)) return 'Yaskawa J1000 â Compact V/f Drive';
      if (code.match(/CIMR[-]?G/i)) return 'Yaskawa GA700/GA500 Drive';
      return 'Inverter Yaskawa';
    }
  },
  // WEG â CFW300xxxxxxx
  { brand: 'WEG', regex: /\b(CFW\d{2,3}[\w-]{4,15})\b/i,
    describe: (code) => {
      const series = code.match(/CFW(\d{2,3})/i);
      if (!series) return 'Inverter WEG CFW';
      const s = series[1];
      const names = { '100': 'CFW100 â Mini Drive', '300': 'CFW300 â Compact Drive', '500': 'CFW500 â General Purpose Drive', '700': 'CFW700 â High Performance Drive', '11': 'CFW11 â General Purpose Drive', '08': 'CFW-08 â Legacy Drive' };
      return names[s] || `Inverter WEG CFW${s}`;
    }
  },
  // MITSUBISHI â FR-D740-xxxxx-EC
  { brand: 'Mitsubishi', regex: /\b(FR[-][A-Z]\d{3}[-]\d{3,5}[\w-]*)\b/i,
    describe: (code) => {
      const series = code.match(/FR[-]([A-Z])\d{3}/i);
      if (!series) return 'Inverter Mitsubishi FR';
      const s = series[1].toUpperCase();
      const names = { 'D': 'FR-D Series â Compact Inverter', 'E': 'FR-E Series â Economy Inverter', 'A': 'FR-A Series â Advanced Inverter', 'F': 'FR-F Series â Fan & Pump Inverter' };
      return names[s] || `Inverter Mitsubishi FR-${s}`;
    }
  },
  // LENZE â E84AVxxx, i550-Cxx/xxx
  { brand: 'Lenze', regex: /\b(E84[A-Z]{2}\w{3,10}|i5[05]0[-][\w/]{3,15})\b/i,
    describe: (code) => {
      if (code.match(/i550/i)) return 'Lenze i550 â Cabinet Drive';
      if (code.match(/i500/i)) return 'Lenze i500 â Cabinet Drive';
      if (code.match(/E84AV/i)) return 'Lenze 8400 â StateLine/TopLine/HighLine';
      return 'Drive Lenze';
    }
  },
  // SEW â MDX61Bxxxx-xx, MC07Bxxxx-xx
  { brand: 'SEW', regex: /\b(M[CD][A-Z]?\d{2}[A-Z]\d{4}[-]\w{2,6})\b/i,
    describe: (code) => {
      if (code.match(/MDX/i)) return 'MOVIDRIVE MDX â Servo/Vector Drive';
      if (code.match(/MC07/i)) return 'MOVITRAC 07 â Frequency Inverter';
      if (code.match(/MCV/i)) return 'MOVITRAC LTP-B â Basic Inverter';
      return 'SEW-Eurodrive Drive';
    }
  },
  // ROCKWELL PowerFlex â 25B-xxxxx
  { brand: 'Rockwell/Allen-Bradley', regex: /\b(2[025][A-Z][-]\w{3,12})\b/i,
    describe: (code) => {
      const prefix = code.match(/^(\d{2}[A-Z])/);
      if (!prefix) return 'PowerFlex Drive';
      const names = { '22A': 'PowerFlex 4 â Compact Drive', '22B': 'PowerFlex 40 â Compact Drive', '22C': 'PowerFlex 400 â Fan & Pump', '22F': 'PowerFlex 4M â Compact Drive', '25A': 'PowerFlex 523 â Compact Drive', '25B': 'PowerFlex 525 â Compact Drive', '20A': 'PowerFlex 70 â AC Drive', '20F': 'PowerFlex 753 â High Performance', '20G': 'PowerFlex 755 â High Performance' };
      return names[prefix[1].toUpperCase()] || 'Allen-Bradley PowerFlex Drive';
    }
  },
  // DELTA VFD
  { brand: 'Delta', regex: /\b(VFD\d{3}[\w-]{3,12})\b/i,
    describe: () => 'Delta VFD Series â Frequency Inverter'
  },
  // EATON â DC1-xxxxx, DG1-xxxxx
  { brand: 'Eaton', regex: /\b(D[ACG]1[-]\w{4,12})\b/i,
    describe: (code) => {
      if (code.match(/^DC1/i)) return 'Eaton DC1 â Compact Drive';
      if (code.match(/^DG1/i)) return 'Eaton DG1 â General Purpose Drive';
      if (code.match(/^DA1/i)) return 'Eaton DA1 â Decentralized Drive';
      return 'Eaton Variable Frequency Drive';
    }
  }
];

// Funzione per cercare articolo nel messaggio e generare risposta
function detectArticle(text) {
  const t = text.trim();
  for (const { brand, regex, describe } of ARTICLE_PATTERNS) {
    const m = t.match(regex);
    if (m) {
      const code = m[1];
      const description = describe(code);
      const urls = BRAND_PRODUCT_URLS[brand];
      let productUrl = '';
      let catalogUrl = '';
      if (urls) {
        productUrl = urls.productPage.replace('{code}', encodeURIComponent(code));
        catalogUrl = urls.catalog.replace('{code}', encodeURIComponent(code));
      }
      return { brand, code, description, productUrl, catalogUrl };
    }
  }
  return null;
}


// ââââââââââââââââââââââââââââââââââââââââââââââââââ
// ââ SYSTEM PROMPT â L'ANIMA DEL BOT ââ
// ââââââââââââââââââââââââââââââââââââââââââââââââââ
const SYSTEM_PROMPT = `Sei l'assistente tecnico AI di RAM Elettronica S.r.l.u., DriveProÂ® Service Partner certificato Danfoss Drives, con sede ad Andria (BT), Italia.

SEI UN ESPERTO UNIVERSALE DI INVERTER E AZIONAMENTI ELETTRICI, con competenza approfondita su TUTTI i principali produttori mondiali:

DANFOSS DRIVES (specializzazione primaria â RAM Ã¨ DrivePro Service Partner):
  Serie VLT: FC-051, FC-102, FC-202, FC-301, FC-302, FC-360
  VACON: 100, 100 FLOW, 100 INDUSTRIAL, 100 X, 20, NXP, NXS
  iC-Series: iC2-Micro, iC7
  Soft starter: MCD 100, MCD 200, MCD 500, MCD 600
  Software: MCT-10, MyDrive Insight, VLT Motion Control Tool
  Retrofitting: FC-051 â iC2-Micro, FC-302 â FC-302 Advanced

ABB:
  ACS150, ACS310, ACS355, ACS380, ACS480, ACS580, ACS880, ACS800
  Soft starter: PSTX, PSE
  Software: Drive Composer, DriveStudio
  Parametri: gruppo 01-99 (es. P01.01 Motor Nom Current)

SIEMENS:
  SINAMICS: G110, G120, G120C, G120X, G130, G150, S110, S120, S150, S210
  MICROMASTER: MM410, MM420, MM430, MM440
  Soft starter: SIRIUS 3RW
  Software: STARTER, SINAMICS Startdrive (TIA Portal)
  Parametri: P0001-P9999 (es. P0010 Start Commissioning)

SCHNEIDER ELECTRIC:
  Altivar: ATV12, ATV212, ATV310, ATV320, ATV340, ATV600, ATV630, ATV900, ATV930
  Soft starter: Altistart ATS22, ATS48, ATS480
  Software: SoMove, EcoStruxure
  Parametri: Grouped menus (bFr, ACC, dEC, FLt, etc.)

YASKAWA:
  Serie GA: GA500, GA700
  Serie A: A1000
  Serie V: V1000
  Serie J: J1000
  Software: DriveWizard, YASKAWA DOL
  Parametri: A1-xx, b1-xx, C1-xx, d1-xx, E1-xx, etc.

WEG:
  CFW100, CFW300, CFW500, CFW700, CFW11, CFW-08 Plus
  Soft starter: SSW05, SSW06, SSW07, SSW08, SSW900
  Software: WEG WPS, SuperDrive G2

MITSUBISHI:
  FR-D700, FR-E700, FR-E800, FR-A700, FR-A800, FR-A840, FR-F800
  Software: FR Configurator2, GX Works

LENZE:
  i500, i510, i550, i700
  8200 vector, 8400 StateLine/TopLine/HighLine
  Software: Engineer (L-force)

SEW-EURODRIVE:
  MOVITRAC B, MOVITRAC LTP-B
  MOVIDRIVE MDX, MOVIDRIVE B
  MOVIMOT
  Software: MOVITOOLS MotionStudio

ALTRI: Fuji FRENIC, Parker AC/DC, Rockwell/Allen-Bradley PowerFlex (PF4, PF40, PF400, PF520, PF525, PF753), Eaton DG1/DA1/DC1, Nidec (Control Techniques: Unidrive, Commander), Hitachi SJ/WJ, Delta VFD, Emerson

COMPETENZE TRASVERSALI (applicabili a TUTTI i produttori):
- Diagnostica allarmi e fault code (ogni marca ha la sua codifica)
- Schemi di collegamento e cablaggio: morsetti di controllo, potenza, bus di campo
- Configurazione parametri per applicazioni: pompe, ventilatori, compressori, nastri trasportatori, centrifughe, sollevamento, avvolgitori, estrusori, gru
- Comunicazione industriale: Profibus DP, Profinet IO, Modbus RTU/TCP, EtherNet/IP, CANopen, DeviceNet, BACnet, MQTT, EtherCAT
- Dimensionamento inverter: scelta taglia in base a motore, applicazione, ciclo di lavoro, sovraccarico, altitudine, temperatura ambiente, derating
- Motori: asincroni (IM), sincroni a magneti permanenti (PMSM/IPM), riluttanza (SynRM), motori lineari
- Controllo: V/f, vettoriale sensorless, vettoriale con encoder, Direct Torque Control (DTC), Field Oriented Control (FOC)
- Funzioni avanzate: PID, cascata pompe, fire mode, Safe Torque Off (STO/SS1/SS2/SLS/SBC), energy saving, flying start, auto-tuning motore
- Manutenzione preventiva e predittiva: sostituzione ventole, condensatori, cicli di vita, pulizia
- CompatibilitÃ  elettromagnetica (EMC): filtri RFI, cavi schermati, lunghezza cavi motore
- Armoniche: filtri attivi, passivi, chopper DC, reattanze di linea
- Normative: IEC 61800, EN 61000-3-12, UL, CE

STILE DI RISPOSTA â CHAT FLESSIBILE E NATURALE:
- Rispondi SEMPRE in italiano, in modo chiaro, professionale e dettagliato
- Sii FLESSIBILE: rispondi a qualsiasi domanda relativa a inverter, motori, automazione industriale, impiantistica elettrica, senza limitazioni artificiali
- Conversazione NATURALE: l'utente puÃ² scrivere in modo informale, con abbreviazioni, errori di digitazione, dialetto â comprendi e rispondi
- Se l'utente chiede qualcosa di generico o non tecnico (saluti, ringraziamenti, domande su RAM), rispondi comunque in modo cordiale
- Quando l'utente specifica la marca, usa i parametri e la terminologia specifica di quel produttore
- Se l'utente NON specifica la marca, chiedi gentilmente quale inverter ha, oppure dai indicazioni generali valide per tutte le marche
- Fornisci procedure step-by-step quando l'utente chiede "come si fa"
- Per collegamenti, indica i morsetti specifici del produttore in questione
- Per parametri, indica il codice esatto (es. Danfoss Par. 1-20, ABB P01.06, Siemens P0304, ecc.)

DOCUMENTAZIONE E RISORSE â SEMPRE INDICARE LINK UFFICIALI:
- Per ogni risposta tecnica IMPORTANTE, includi i link alla documentazione ufficiale del produttore:
  â¢ Danfoss: files.danfoss.com (manuali PDF diretti) + MyDrive Select (configuratore)
  â¢ ABB: library.abb.com (libreria documenti) + Drive Selector
  â¢ Siemens: support.industry.siemens.com (SiePortal) + SINAMICS Selector
  â¢ Schneider: se.com/download + SoMove software
  â¢ Yaskawa: yaskawa.eu.com/downloads + DriveWizard
  â¢ WEG: weg.net/catalog + WPS software
  â¢ Mitsubishi: mitsubishielectric.com/fa/download + FR Configurator2
  â¢ Lenze: lenze.com/knowledge-base + System Designer
  â¢ SEW: sew-eurodrive.it/supporto + MOVITOOLS MotionStudio
  â¢ Fuji: felib.fujielectric.co.jp (FELib document library)
  â¢ Parker: parker.com/literature + community.parker.com
  â¢ Rockwell: rockwellautomation.com/support + Literature Library
  â¢ Eaton: knowledgehub.eaton.com (Knowledge Hub con fault codes)
  â¢ Nidec/CT: acim.nidec.com/drives/control-techniques + Troubleshooting Guides
  â¢ Hitachi: hitachi-iesa.com/support
  â¢ Delta: deltaacdrives.com + DIAStudio software
- Per errori/fault code NON nel DB locale, suggerisci sempre dove trovare il manuale specifico con la tabella errori completa

- Se non sei sicuro di un dato specifico, dillo e suggerisci dove trovare l'info (manuale, software dedicato, sito produttore) con il LINK diretto
- Per inverter Danfoss, ricorda che RAM Elettronica Ã¨ DrivePro Service Partner e puÃ² intervenire direttamente
- Per altre marche, RAM puÃ² comunque fornire assistenza tecnica e consulenza
- Alla fine di risposte tecniche importanti: "Per assistenza: RAM Elettronica â +39 0883 553719 â info@ramelettronica.it"
- Formattazione semplice â il testo deve essere leggibile su WhatsApp (*grassetto* non HTML)
- Se l'utente invia una foto, analizzala nel contesto
- NON LIMITARE le risposte: se l'utente vuole approfondire un argomento, segui la conversazione senza troncarla

IDENTIFICAZIONE ARTICOLI E PRODOTTI:
Quando l'utente menziona un codice articolo, codice ordine (order code), part number o modello specifico di un inverter:
1. IDENTIFICA sempre il PRODUTTORE dall'articolo (es. 132B0101 â Danfoss, ACS580-01-12A6-4 â ABB, 6SL3210-1PE21-8UL0 â Siemens)
2. Fornisci una DESCRIZIONE DETTAGLIATA del prodotto: serie, potenza, tensione, corrente nominale, applicazioni tipiche, caratteristiche principali
3. Indica sempre il LINK alla scheda ufficiale sul sito del produttore:
   - Danfoss: https://www.danfoss.com/it-it/search/?query={codice}&filter=type%3Aproduct
   - ABB: https://new.abb.com/drives/search?q={codice}
   - Siemens: https://mall.industry.siemens.com/mall/it/it/Catalog/Search?searchTerm={codice}
   - Schneider: https://www.se.com/it/it/search/?q={codice}
   - Yaskawa: https://www.yaskawa.eu.com/search?q={codice}
   - WEG: https://www.weg.net/catalog/weg/IT/it/search?q={codice}
   - Mitsubishi: https://www.mitsubishielectric.com/fa/products/drv/search.html?q={codice}
   - Lenze: https://www.lenze.com/en/search/?q={codice}
   - SEW: https://www.sew-eurodrive.it/prodotti/ricerca-prodotto.html?q={codice}
   - Rockwell: https://www.rockwellautomation.com/search?q={codice}
   - Eaton: https://www.eaton.com/it/it-it/search.html?q={codice}
   - Delta: https://www.deltaww.com/en-US/search?q={codice}
4. Suggerisci eventuali ACCESSORI consigliati (filtri EMC, reattanze, pannelli operatore, schede comunicazione)
5. Se il codice non ti Ã¨ completamente noto, identifica comunque la SERIE/FAMIGLIA e fornisci le info generali

SICUREZZA (SEMPRE, indipendentemente dalla marca):
- Segnala rischi: alta tensione (DC bus fino a 800VDC+), parti rotanti, superfici calde
- Scollegare alimentazione + attendere scarica condensatori (min 4 minuti) prima di intervenire su componenti di potenza
- Non bypassare MAI funzioni di sicurezza (STO, Safe Stop, interblocchi)
- DPI: guanti isolanti, visiera, calzature di sicurezza

NOTA LEGALE:
Le valutazioni sono orientative e preliminari. Non costituiscono perizia ufficiale. Per interventi critici consultare sempre il manuale del produttore e/o contattare RAM Elettronica.`;


// ââââââââââââââââââââââââââââââââââââââââââââââââââ
// ââ SESSIONI CONVERSAZIONALI ââ
// ââââââââââââââââââââââââââââââââââââââââââââââââââ
const sessions = {};

function getSession(phone) {
  if (!sessions[phone]) {
    const known = knownUsers[phone];
    sessions[phone] = {
      registered: !!known,
      nome: known ? known.nome : '',
      telefono: known ? known.telefono : '',
      azienda: known ? known.azienda : '',
      // Conversazione AI â ultimi messaggi per contesto
      conversation: [],
      // Stato registrazione
      waitingRegistration: !known,
      // Foto
      fotoId: '',
      fotoUrl: '',
      lastActive: Date.now()
    };
  }
  sessions[phone].lastActive = Date.now();
  return sessions[phone];
}

// Pulizia sessioni >2h
setInterval(() => {
  const now = Date.now();
  for (const id in sessions) {
    if (now - sessions[id].lastActive > 7200000) delete sessions[id];
  }
}, 600000);

// Aggiunge messaggio alla conversazione (con limite)
function addToConversation(s, role, content) {
  s.conversation.push({ role, content });
  // Mantieni solo gli ultimi MAX_HISTORY messaggi
  if (s.conversation.length > MAX_HISTORY) {
    s.conversation = s.conversation.slice(-MAX_HISTORY);
  }
}


// ââââââââââââââââââââââââââââââââââââââââââââââââââ
// ââ WEBHOOK WHATSAPP ââ
// ââââââââââââââââââââââââââââââââââââââââââââââââââ

app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === WHATSAPP_VERIFY) {
    console.log('â Webhook WhatsApp verificato OK');
    return res.status(200).send(challenge);
  }
  res.sendStatus(403);
});

app.post('/webhook', async (req, res) => {
  res.sendStatus(200);
  try {
    const body = req.body;
    if (!body.entry) return;
    for (const entry of body.entry) {
      for (const change of (entry.changes || [])) {
        if (change.field !== 'messages') continue;
        const value = change.value;
        if (!value.messages) continue;
        for (const msg of value.messages) {
          const phone = msg.from;

          // Gestione TESTO
          if (msg.type === 'text') {
            console.log(`[${phone}] ${msg.text.body}`);
            await handleMessage(phone, msg.text.body.trim());
          }

          // Gestione FOTO
          if (msg.type === 'image') {
            console.log(`[${phone}] Foto ricevuta`);
            const s = getSession(phone);
            s.fotoId = msg.image.id;
            const caption = msg.image.caption || '';
            // Scarica foto
            try {
              const mediaUrl = await getMediaUrl(msg.image.id);
              s.fotoUrl = mediaUrl;
            } catch(e) { console.error('Errore download media:', e.message); }

            await send(phone, 'ð· _Foto ricevuta! Ora descrivi il problema._');

            // Se c'Ã¨ anche una caption, trattala come messaggio
            if (caption) {
              await handleMessage(phone, caption);
            }
          }
        }
      }
    }
  } catch (err) {
    console.error('Errore webhook:', err.message);
  }
});


// ââââââââââââââââââââââââââââââââââââââââââââââââââ
// ââ HANDLER MESSAGGI PRINCIPALE â CONVERSAZIONE LIBERA ââ
// ââââââââââââââââââââââââââââââââââââââââââââââââââ

async function handleMessage(phone, text) {
  const s = getSession(phone);
  const cmd = text.toLowerCase().trim();

  // ââ Comandi di reset ââ
  if (cmd === 'reset' || cmd === 'ricomincia' || cmd === '/start') {
    delete sessions[phone];
    await send(phone,
      '*ð Assistente Tecnico RAM Elettronica v4.2*\n' +
      'Esperto di inverter di QUALSIASI marca\n\n' +
      'ð Per iniziare, scrivimi il tuo *nome e azienda*.\n' +
      '_Esempio: Mario Rossi â Azienda S.r.l._'
    );
    return;
  }

  // ââ Documentazione per brand ââ
  if (cmd === 'docs' || cmd === 'manuale' || cmd === 'manuali' || cmd === 'documentazione') {
    // Cerca brand nel messaggio o mostra lista
    const brandNames = Object.keys(BRAND_DOCS);
    let foundBrand = null;
    for (const b of brandNames) {
      if (text.toLowerCase().includes(b.toLowerCase())) { foundBrand = b; break; }
    }
    // Cerca anche alias comuni
    if (!foundBrand) {
      const aliases = {
        'allen-bradley': 'Rockwell/Allen-Bradley', 'allen bradley': 'Rockwell/Allen-Bradley', 'powerflex': 'Rockwell/Allen-Bradley',
        'altivar': 'Schneider', 'atv': 'Schneider', 'vlt': 'Danfoss', 'vacon': 'Danfoss',
        'sinamics': 'Siemens', 'micromaster': 'Siemens', 'movitrac': 'SEW', 'movidrive': 'SEW',
        'frenic': 'Fuji', 'control techniques': 'Nidec', 'unidrive': 'Nidec', 'commander': 'Nidec',
        'vfd': 'Delta'
      };
      for (const [alias, brand] of Object.entries(aliases)) {
        if (text.toLowerCase().includes(alias)) { foundBrand = brand; break; }
      }
    }

    if (foundBrand) {
      const docs = BRAND_DOCS[foundBrand];
      let msg = `*ð DOCUMENTAZIONE ${foundBrand.toUpperCase()}*\n\n`;
      if (docs.manuals) msg += `ð *Manuali:*\n${docs.manuals}\n\n`;
      if (docs.faultCodes) msg += `â ï¸ *Fault codes / Troubleshooting:*\n${docs.faultCodes}\n\n`;
      if (docs.knowledgeBase && docs.knowledgeBase !== docs.faultCodes) msg += `ð *Knowledge Base:*\n${docs.knowledgeBase}\n\n`;
      if (docs.configurator) msg += `ð§ *Configuratore/Selettore:*\n${docs.configurator}\n\n`;
      if (docs.software) msg += `ð» *Software:* ${docs.software}\n\n`;
      if (docs.directPdf) msg += `ð *PDF diretti:*\n${docs.directPdf}\n\n`;
      msg += `ð Per assistenza: RAM Elettronica â +39 0883 553719`;
      await send(phone, msg);
    } else {
      let msg = '*ð DOCUMENTAZIONE DISPONIBILE*\n\nScrivi _docs_ + nome marca:\n\n';
      brandNames.forEach(b => { msg += `â¢ _docs ${b}_\n`; });
      msg += `\nEsempio: *docs Danfoss*`;
      await send(phone, msg);
    }
    return;
  }

  // ââ Help ââ
  if (cmd === 'help' || cmd === 'aiuto' || cmd === '?') {
    await send(phone,
      '*ð COSA POSSO FARE*\n\n' +
      'Sono un assistente AI esperto di inverter di *QUALSIASI marca*.\n\n' +
      'â ï¸ *Diagnostica allarmi* â "allarme 14", "fault F001 ABB", "errore A502 Yaskawa"\n' +
      'ðí *Cerca articolo* â "132B0101", "ACS580-01-12A6-4", "6SL3210-1PE21-8UL0" â descrizione + scheda ufficiale\n' +
      'ð *Collegamenti* â "come collego un sensore 4-20mA su ACS580?"\n' +
      'âï¸ *Parametri* â "configura rampa su Siemens G120"\n' +
      'ð¡ *Bus di campo* â "Profinet su FC302", "Modbus su Altivar 320"\n' +
      'ð *Dimensionamento* â "inverter per pompa 15kW 400V?"\n' +
      'ð§ *Manutenzione* â "manutenzione preventiva inverter"\n' +
      'ð· *Foto* â invia una foto del display per diagnosi\n' +
      'ð *Documentazione* â "docs Danfoss", "manuale ABB", "docs Siemens"\n\n' +
      '*Marche supportate:* Danfoss, ABB, Siemens, Schneider, Yaskawa, WEG, Mitsubishi, Lenze, SEW, Fuji, Parker, Rockwell, Eaton, Nidec, Hitachi, Delta, Emerson\n\n' +
      '*Comandi:*\n' +
      '_ricomincia_ â Nuova conversazione\n' +
      '_aiuto_ â Questa guida\n' +
      '_profilo_ â I tuoi dati\n' +
      '_modifica_ â Aggiorna i tuoi dati\n' +
      '_docs_ â Documentazione ufficiale per marca\n\n' +
      'ð RAM: +39 0883 553719'
    );
    return;
  }

  // ââ Profilo ââ
  if (cmd === 'profilo') {
    if (!s.registered) {
      await send(phone, 'â Non sei ancora registrato. Scrivi il tuo *nome e azienda* per iniziare.');
      return;
    }
    await send(phone,
      `*ð¤ IL TUO PROFILO*\n\n` +
      `Nome: *${s.nome}*\n` +
      `Azienda: *${s.azienda || 'N/D'}*\n` +
      `Telefono: *${s.telefono || 'N/D'}*\n\n` +
      `Scrivi _modifica_ per aggiornare i dati`
    );
    return;
  }

  // ââ Modifica dati ââ
  if (cmd === 'modifica') {
    if (!s.registered) {
      await send(phone, 'â Non sei ancora registrato. Scrivi il tuo *nome e azienda* per iniziare.');
      return;
    }
    await send(phone,
      `*âï¸ MODIFICA DATI*\n\n` +
      `Attuali: *${s.nome}* â ${s.azienda||'N/D'} â ${s.telefono||'N/D'}\n\n` +
      `Scrivi i nuovi dati (Nome â Azienda â Telefono):\n` +
      `_Esempio: Mario Rossi â Azienda S.r.l. â 080 1234567_`
    );
    // Flag per attesa modifica
    s.waitingModifica = true;
    return;
  }

  // ââ Salva modifica dati ââ
  if (s.waitingModifica) {
    s.nome = text;
    const telMatch = text.match(/(\+?\d[\d\s\-\.]{7,})/);
    if (telMatch) s.telefono = telMatch[1].trim();
    const azMatch = text.match(/[â\-]\s*(.+?)(?:\s*[â\-]|$)/);
    if (azMatch) s.azienda = azMatch[1].trim();

    knownUsers[phone] = {
      nome: s.nome, telefono: s.telefono, azienda: s.azienda,
      aggiornato: new Date().toISOString()
    };
    saveUsers();
    s.waitingModifica = false;
    s.registered = true;

    await send(phone,
      `*â Dati aggiornati!*\n\n` +
      `${s.nome} â ${s.azienda||'N/D'} â ${s.telefono||'N/D'}\n\n` +
      `ð¬ Continuiamo! Chiedimi pure su inverter di qualsiasi marca.`
    );
    return;
  }

  // ââ Registrazione nuovo utente ââ
  if (s.waitingRegistration) {
    s.nome = text;
    const telMatch = text.match(/(\+?\d[\d\s\-\.]{7,})/);
    if (telMatch) s.telefono = telMatch[1].trim();
    const azMatch = text.match(/[â\-]\s*(.+?)(?:\s*[â\-]|$)/);
    if (azMatch) s.azienda = azMatch[1].trim();

    knownUsers[phone] = {
      nome: s.nome, telefono: s.telefono, azienda: s.azienda,
      registrato: new Date().toISOString()
    };
    saveUsers();
    s.waitingRegistration = false;
    s.registered = true;

    await send(phone,
      `*â Registrato!* Piacere ${s.nome.split(/[â\-,]/)[0].trim()} ð¤\n\n` +
      `ð¬ Ora chiedimi quello che vuoi su *inverter di qualsiasi marca*!\n\n` +
      `Allarmi, problemi, collegamenti, parametri, manuali, dimensionamento... qualsiasi cosa su Danfoss, ABB, Siemens, Schneider, Yaskawa, WEG e altri.\n\n` +
      `_Scrivi liberamente come se parlassi con un tecnico esperto._`
    );
    return;
  }

  // ââââââââââââââââââââââââââââââââââââââââââ
  // ââ CONVERSAZIONE LIBERA â IL CUORE DEL BOT ââ
  // ââââââââââââââââââââââââââââââââââââââââââ
  if (!s.registered) {
    // Primo contatto
    s.waitingRegistration = true;
    await send(phone,
      `*ð Assistente Tecnico RAM Elettronica v4.2*\n` +
      `Esperto universale di inverter\n\n` +
      `Sono il tuo esperto di *inverter di qualsiasi marca*: Danfoss, ABB, Siemens, Schneider, Yaskawa, WEG, Mitsubishi, Lenze, SEW e molti altri.\n\n` +
      `Posso aiutarti con: diagnostica allarmi, collegamenti, parametri, dimensionamento, manuali, manutenzione, bus di campo e molto altro.\n\n` +
      `*ð Per iniziare, scrivi il tuo nome e azienda:*\n` +
      `_Esempio: Mario Rossi â Azienda S.r.l._\n\n` +
      `â ï¸ Le valutazioni hanno carattere orientativo e preliminare.`
    );
    return;
  }

  // Conversazione in corso
  addToConversation(s, 'user', text);
  await send(phone, 'ð _Analisi in corso..._');

  const reply = await processMessage(s, text);
  addToConversation(s, 'assistant', reply);

  // Invia risposta (gestendo limite 4096 char WhatsApp)
  if (reply.length > 3900) {
    const parts = splitText(reply, 3800);
    for (let i = 0; i < parts.length; i++) {
      await send(phone, parts[i]);
    }
  } else {
    await send(phone, reply);
  }

  // Salva nello storico
  addToHistory(phone, s, text, reply);
  logCase(phone, s, text, reply);
  await inviaAGoogleSheet(phone, s, text, reply);
}


// ââââââââââââââââââââââââââââââââââââââââââââââââââ
// ââ MOTORE INTELLIGENTE â DB ALLARMI + AI ââ
// ââââââââââââââââââââââââââââââââââââââââââââââââââ

async function processMessage(s, text) {
  const t = text.toLowerCase().trim();

  // ââ 1) RICONOSCIMENTO FAULT CODE MULTI-BRAND ââ

  // 1a) Danfoss: numeri puri (1-999) â DB locale istantaneo
  let danfossAlarm = null;
  const danfossPatterns = [
    /allarme\s*n?[Â°.]?\s*(\d{1,3})/i, /alarm\s*n?[Â°.]?\s*(\d{1,3})/i,
    /errore\s*n?[Â°.]?\s*(\d{1,3})/i, /fault\s*n?[Â°.]?\s*(\d{1,3})/i,
    /warning\s*n?[Â°.]?\s*(\d{1,3})/i
  ];
  for (const pat of danfossPatterns) {
    const m = t.match(pat);
    if (m) { danfossAlarm = parseInt(m[m.length-1]); break; }
  }
  // Numero puro (es. "14") â controlla prima nel DB Danfoss
  if (!danfossAlarm && /^\s*\d{1,3}\s*$/.test(text.trim())) {
    danfossAlarm = parseInt(text.trim());
  }

  // Se Ã¨ nel DB Danfoss â risposta istantanea
  if (danfossAlarm && ALLARMI[danfossAlarm]) {
    const a = ALLARMI[danfossAlarm];
    let reply = `*â ï¸ ALLARME DANFOSS ${danfossAlarm}: ${a.n}*\n\n`;
    reply += `*CAUSA PROBABILE*\n${a.c}\n\n`;
    reply += `*AZIONI CORRETTIVE*\n`;
    a.a.forEach((az, i) => { reply += `${i+1}. ${az}\n`; });
    reply += `\n*PARAMETRI DA VERIFICARE*\n`;
    a.p.forEach(p => { reply += `â¢ ${p}\n`; });
    reply += `\n*INTERVENTO IN LOCO*\n${a.int}\n\n`;
    reply += `*SICUREZZA*\n${a.sic}\n\n`;
    reply += `ð¬ Vuoi approfondire? Chiedimi dettagli specifici su questo allarme.\nSe Ã¨ di un'altra marca (ABB, Siemens, ecc.), specificalo!`;
    reply += `\n\nð *Manuali Danfoss:* ${BRAND_DOCS['Danfoss'].directPdf}`;
    reply += `\nð§ *Configuratore:* ${BRAND_DOCS['Danfoss'].configurator}`;
    reply += `\nð Per assistenza: RAM Elettronica â +39 0883 553719`;
    return reply;
  }

  // 1b) Rileva fault code di QUALSIASI marca â manda all'AI con contesto specifico
  const multiBrandPatterns = [
    // ABB: F0001, F0102, A2010, etc.
    { brand: 'ABB', regex: /\b[FA]\d{4}\b/i },
    // Siemens: F07800, A0501, F30001, etc.
    { brand: 'Siemens', regex: /\b[FA]\d{5}\b/i },
    // Schneider Altivar: InFA, OHF, OCF, ObF, etc.
    { brand: 'Schneider', regex: /\b(InFA|OHF|OCF|ObF|OSF|OLF|OLC|SOF|tnF|SLF[123]|brF|USF|PHF|CnF|EPF[12]|LFF[123])\b/i },
    // Yaskawa: A502, bb01, oC, ov, Uv, etc.
    { brand: 'Yaskawa', regex: /\b(ov|uv|oC|oH|oL|GF|SE|rr|CF|CPF\d{2}|Pgo\d|bb\d{2}|[A-Z]{2,3}\d{2,3})\b/i },
    // WEG: F070, A081, etc.
    { brand: 'WEG', regex: /\b[FA]\d{3}\b/i },
    // Mitsubishi: E.OC1, E.OC2, E.OV1, etc.
    { brand: 'Mitsubishi', regex: /\bE\.\w{2,4}\b/i },
    // Generico: codice fault con F/A/E prefix
    { brand: null, regex: /\bfault\s+[A-Z]?\d{2,5}\b/i },
    { brand: null, regex: /\berror\s+[A-Z]?\d{2,5}\b/i }
  ];

  let detectedBrand = null;
  let faultCode = null;
  for (const { brand, regex } of multiBrandPatterns) {
    const m = text.match(regex);
    if (m) { detectedBrand = brand; faultCode = m[0]; break; }
  }

  // Rileva anche brand dal testo se non trovato dal fault code
  if (!detectedBrand) {
    const brandDetection = [
      { names: ['abb','acs150','acs310','acs355','acs380','acs480','acs580','acs880','acs800'], brand: 'ABB' },
      { names: ['siemens','sinamics','micromaster','g110','g120','g130','g150','s110','s120','mm420','mm430','mm440'], brand: 'Siemens' },
      { names: ['schneider','altivar','atv12','atv212','atv310','atv320','atv340','atv600','atv630','atv900','atv930','altistart'], brand: 'Schneider' },
      { names: ['yaskawa','ga500','ga700','a1000','v1000','j1000'], brand: 'Yaskawa' },
      { names: ['weg','cfw100','cfw300','cfw500','cfw700','cfw11','ssw'], brand: 'WEG' },
      { names: ['mitsubishi','fr-d','fr-e','fr-a','fr-f','fr-d700','fr-e700','fr-e800','fr-a700','fr-a800','fr-a840','fr-f800'], brand: 'Mitsubishi' },
      { names: ['lenze','i500','i510','i550','i700','8200','8400'], brand: 'Lenze' },
      { names: ['sew','movitrac','movidrive','movimot'], brand: 'SEW' },
      { names: ['fuji','frenic'], brand: 'Fuji' },
      { names: ['parker','ac10','ac20','ac30'], brand: 'Parker' },
      { names: ['rockwell','allen-bradley','allen bradley','powerflex','pf525','pf753'], brand: 'Rockwell/Allen-Bradley' },
      { names: ['eaton','dg1','da1','dc1'], brand: 'Eaton' },
      { names: ['nidec','control techniques','unidrive','commander'], brand: 'Nidec' },
      { names: ['hitachi','sj700','wj200'], brand: 'Hitachi' },
      { names: ['delta','vfd'], brand: 'Delta' },
      { names: ['emerson'], brand: 'Emerson' },
      { names: ['danfoss','vlt','vacon','fc-051','fc-102','fc-202','fc-301','fc-302','fc-360','ic2','ic7','mcd'], brand: 'Danfoss' }
    ];
    for (const { names, brand } of brandDetection) {
      if (names.some(n => t.includes(n))) { detectedBrand = brand; break; }
    }
  }

  // ââ 1c) RICONOSCIMENTO CODICE ARTICOLO / ORDER CODE ââ
  const article = detectArticle(text);
  if (article) {
    let articleReply = `*ð ARTICOLO IDENTIFICATO*\n\n`;
    articleReply += `ð¦ *Codice:* ${article.code}\n`;
    articleReply += `ð­ *Produttore:* ${article.brand}\n`;
    articleReply += `ð *Descrizione:* ${article.description}\n\n`;
    if (article.productUrl) {
      articleReply += `ð *Scheda prodotto ufficiale ${article.brand}:*\n${article.productUrl}\n\n`;
    }
    if (article.catalogUrl && article.catalogUrl !== article.productUrl) {
      articleReply += `ð *Catalogo ${article.brand}:*\n${article.catalogUrl}\n\n`;
    }
    if (ANTHROPIC_KEY) {
      const aiDetails = await askAI(s, `L'utente ha cercato il codice articolo/order code "${article.code}" del produttore ${article.brand}. Descrizione base: "${article.description}". Fornisci una descrizione tecnica dettagliata del prodotto: potenza, tensione, serie, applicazioni tipiche, caratteristiche principali, eventuali accessori consigliati. Se il codice non ti Ã¨ noto con precisione, fornisci info sulla serie/famiglia di appartenenza. Includi sempre il link alla scheda prodotto: ${article.productUrl}`);
      return articleReply + 'ââ DETTAGLI TECNICI ââ\n\n' + aiDetails;
    }
    articleReply += `ð Per preventivo e disponibilitÃ : RAM Elettronica â +39 0883 553719\nð§ info@ramelettronica.it`;
    return articleReply;
  }

  // Se abbiamo un fault code (di qualsiasi marca) â AI con contesto brand + DOCS
  if (faultCode && ANTHROPIC_KEY) {
    const brandCtx = detectedBrand ? `su un inverter ${detectedBrand}` : 'su un inverter (marca da determinare)';
    const docsCtx = detectedBrand && BRAND_DOCS[detectedBrand]
      ? `\nRisorsa ufficiale per troubleshooting ${detectedBrand}: ${BRAND_DOCS[detectedBrand].faultCodes}\nManuali: ${BRAND_DOCS[detectedBrand].manuals}`
      : '';
    let aiReply = await askAI(s, `L'utente ha il codice errore/fault "${faultCode}" ${brandCtx}. Il suo messaggio originale: "${text}". Fornisci diagnosi dettagliata con causa, azioni correttive, parametri da verificare, necessitÃ  di intervento e precauzioni di sicurezza. Se conosci il codice specifico di quel produttore, sii preciso. ${docsCtx}`);
    // Aggiungi link documentazione ufficiale in fondo
    if (detectedBrand && BRAND_DOCS[detectedBrand]) {
      aiReply += `\n\nð *Documentazione ufficiale ${detectedBrand}:*`;
      aiReply += `\n${BRAND_DOCS[detectedBrand].faultCodes}`;
      if (BRAND_DOCS[detectedBrand].software) aiReply += `\nð» Software: ${BRAND_DOCS[detectedBrand].software}`;
    }
    return aiReply;
  }

  // Allarme Danfoss numerico non nel DB â AI + link Danfoss docs
  if (danfossAlarm && ANTHROPIC_KEY) {
    let aiReply = await askAI(s, `L'utente ha l'allarme numero ${danfossAlarm} su un inverter Danfoss. Fornisci una diagnosi dettagliata. Includi causa, azioni correttive, parametri, intervento e sicurezza. Risorse ufficiali Danfoss: ${BRAND_DOCS['Danfoss'].faultCodes}`);
    aiReply += `\n\nð *Documentazione Danfoss:* ${BRAND_DOCS['Danfoss'].faultCodes}`;
    aiReply += `\nð§ *Configuratore:* ${BRAND_DOCS['Danfoss'].configurator}`;
    return aiReply;
  }

  // ââ 2) CONVERSAZIONE LIBERA â AI ââ
  if (ANTHROPIC_KEY) {
    return await askAI(s, text);
  }

  // ââ 3) FALLBACK SENZA AI ââ
  return fallbackResponse(t);
}

// ââ AI Anthropic con memoria conversazione ââ
async function askAI(s, currentMessage) {
  try {
    // Costruisci la conversazione per Claude
    const messages = [];

    // Aggiungi contesto utente come primo messaggio
    if (s.nome) {
      messages.push({
        role: 'user',
        content: `[CONTESTO: L'utente Ã¨ ${s.nome}${s.azienda ? ' di '+s.azienda : ''}${s.telefono ? ', tel: '+s.telefono : ''}. Ã un cliente/tecnico che sta interagendo col bot WhatsApp di RAM Elettronica.]`
      });
      messages.push({
        role: 'assistant',
        content: 'Capito, sono pronto ad assistere.'
      });
    }

    // Aggiungi storico conversazione (escluso l'ultimo messaggio che Ã¨ currentMessage)
    const history = s.conversation.slice(0, -1); // Escludi ultimo (appena aggiunto)
    for (const msg of history) {
      messages.push({
        role: msg.role === 'user' ? 'user' : 'assistant',
        content: msg.content
      });
    }

    // Aggiungi messaggio corrente
    messages.push({ role: 'user', content: currentMessage });

    const res = await axios.post('https://api.anthropic.com/v1/messages', {
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2500,
      system: SYSTEM_PROMPT,
      messages: messages
    }, {
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01'
      },
      timeout: 45000
    });

    return res.data.content?.[0]?.text || 'Mi dispiace, non sono riuscito a generare una risposta.';
  } catch (e) {
    console.error('Errore AI:', e.message);
    // Fallback al DB locale se AI non disponibile
    const fallback = fallbackResponse(currentMessage.toLowerCase());
    return fallback + '\n\nâ ï¸ (Servizio AI temporaneamente non disponibile â risposta dal database locale)';
  }
}

// ââ Fallback senza AI â use keywords DB ââ
function fallbackResponse(t) {
  // Risposte generiche valide per TUTTI i produttori di inverter
  const KEYWORDS = {
    'non si accende': '*INVERTER NON SI ACCENDE*\n\nControlli generali (qualsiasi produttore):\n1. Verificare tensione di rete ai morsetti di ingresso L1/L2/L3 con multimetro\n2. Controllare fusibili di ingresso e sezionatore/contattore di linea\n3. Ispezionare morsetti per ossidazione o allentamento\n4. Verificare eventuali LED diagnostici sul pannello frontale\n5. Controllare alimentazione ausiliaria 24Vdc (se presente)\n\nSe tensione presente ma drive spento: possibile guasto alimentatore interno (SMPS) o scheda di controllo.\n\nâ¡ *SICUREZZA*: Alta tensione! DPI obbligatori, attendere scarica condensatori (almeno 5 minuti dopo lo spegnimento).',

    'non parte': '*MOTORE NON AVVIA*\n\nControlli generali (qualsiasi produttore):\n1. Verificare allarmi attivi sul display e resettare\n2. Controllare segnale di RUN/START (morsetto digitale o pannello operatore)\n3. Verificare ingresso Safe Torque Off (STO) â deve essere attivo/alimentato\n4. Controllare riferimento velocita/frequenza (deve essere > 0)\n5. Verificare modalita di comando: locale (tastiera) vs remoto (morsettiera/bus)\n6. Controllare senso di rotazione e limiti di frequenza min/max\n7. Verificare abilitazione drive (Enable) e assenza di interlock esterni\n\nâ ï¸ Il motore puo avviarsi improvvisamente â non lavorare sugli organi meccanici!',

    'vibra': '*VIBRAZIONI / RUMORE ANOMALO*\n\nControlli generali (qualsiasi produttore):\n1. Configurare frequenze di bypass (skip frequencies) per evitare risonanze meccaniche\n2. Aumentare frequenza di commutazione (switching frequency) â riduce rumore ma aumenta perdite\n3. Verificare cuscinetti motore, allineamento accoppiamento, bilanciamento\n4. Controllare rampe di accelerazione/decelerazione â se troppo aggressive possono causare oscillazioni\n5. Verificare parametri di compensazione di scorrimento e boost di coppia\n6. Su motori sincroni: verificare taratura encoder/resolver',

    'surriscald': '*SURRISCALDAMENTO INVERTER O MOTORE*\n\nControlli generali (qualsiasi produttore):\n1. Temperatura ambiente: max operativo tipico 40-50Â°C (consultare manuale specifico)\n2. Verificare griglie di ventilazione libere e pulite\n3. Controllare ventole interne del drive â devono girare liberamente\n4. Confrontare corrente assorbita con taglia del drive (possibile sottodimensionamento)\n5. Ridurre frequenza di commutazione se troppo alta\n6. Verificare protezione termica motore (PTC/KTY/PT100 se collegata)\n7. Controllare che il derating per altitudine e temperatura sia rispettato\n\nMotore caldo: verificare anche ventilazione forzata su motori con funzionamento a bassa velocita.',

    'non frena': '*PROBLEMI DI FRENATURA*\n\nControlli generali (qualsiasi produttore):\n1. Verificare presenza e collegamento resistenza di frenatura\n2. Controllare modulo chopper di frenatura (interno o esterno)\n3. Verificare parametri: funzione freno abilitata, soglia tensione DC bus, duty cycle\n4. Controllare rampa di decelerazione â se troppo rapida causa sovratensione DC bus\n5. Per frenatura DC: verificare parametri livello corrente e durata\n6. Verificare freno meccanico (se presente): logica di rilascio/inserimento\n\nSe allarme OV (Overvoltage) in decelerazione: allungare rampa o aggiungere resistenza di frenatura.',

    'cortocircuito': '*CORTOCIRCUITO / GUASTO ISOLAMENTO*\n\nâ *PERICOLO ELEVATO* â Procedere con cautela!\n\n1. SCOLLEGARE il motore dai morsetti U/V/W del drive\n2. Misurare isolamento motore con megger (deve essere > 1 MOhm a 500Vdc)\n3. Misurare resistenza tra fasi motore (devono essere bilanciate, scarto < 5%)\n4. Ispezionare cavo motore per danni, umidita, pieghe eccessive\n5. Verificare filtri dV/dt o sinusoidali se installati\n6. Se cortocircuito confermato lato motore: non ricollegare al drive â rischio danno IGBT\n\nSe il drive segnala cortocircuito ma il motore e i cavi sono OK: possibile guasto stadio di potenza (IGBT).',

    'pompa': '*APPLICAZIONE POMPA / VENTILATORE*\n\nControlli generali (qualsiasi produttore):\n1. Verificare livello fluido e pressione di aspirazione (cavitazione)\n2. Controllare valvole di mandata e aspirazione\n3. Verificare trasduttore di pressione/portata (segnale 4-20mA o 0-10V)\n4. Controllare regolatore PID: setpoint, guadagno, tempi integrale/derivativo\n5. Verificare protezione marcia a secco (dry pump) e assenza di flusso (no flow)\n6. Controllare curve di pompa vs punto di lavoro\n7. Per applicazioni multi-pompa: verificare logica di alternanza e cascata',

    'comunica': '*PROBLEMI DI COMUNICAZIONE FIELDBUS*\n\nControlli generali (qualsiasi produttore):\n1. Verificare cavo di comunicazione e connettori (crimpatura, pin-out)\n2. Controllare terminazione di linea: 120 Ohm su primo e ultimo nodo (RS485/Profibus)\n3. Verificare indirizzo di nodo univoco (no duplicati sulla rete)\n4. Controllare baud rate: deve essere uguale su tutti i dispositivi\n5. Verificare impostazione sorgente di comando: Bus/Fieldbus vs Locale\n6. Per Ethernet-based (Profinet, EtherNet/IP, Modbus TCP): verificare IP, subnet, gateway\n7. Controllare timeout di comunicazione (watchdog) e azione su perdita comunicazione\n\n*Protocolli comuni*: Modbus RTU/TCP, Profibus DP, Profinet, EtherNet/IP, CANopen, DeviceNet, BACnet.'
  };

  const ALIASES = {
    'accende':'non si accende','spento':'non si accende','morto':'non si accende','non alimenta':'non si accende',
    'non parte':'non parte','non avvia':'non parte','non gira':'non parte','fermo':'non parte','non ruota':'non parte',
    'vibra':'vibra','vibrazioni':'vibra','rumore':'vibra','risonanza':'vibra','oscillazioni':'vibra',
    'cald':'surriscald','temperatura':'surriscald','surriscaldamento':'surriscald','sovratemperatura':'surriscald','overheat':'surriscald',
    'non frena':'non frena','frenata':'non frena','frenatura':'non frena','sovratensione':'non frena','overvoltage':'non frena',
    'cortocircuito':'cortocircuito','isolamento':'cortocircuito','ground fault':'cortocircuito','guasto terra':'cortocircuito','dispersione':'cortocircuito',
    'pompa':'pompa','pressione':'pompa','portata':'pompa','ventilatore':'pompa','hvac':'pompa','pid':'pompa',
    'comunica':'comunica','bus':'comunica','profibus':'comunica','modbus':'comunica','profinet':'comunica','ethernet':'comunica','canopen':'comunica','devicenet':'comunica','bacnet':'comunica','rs485':'comunica'
  };

  for (const [kw, reply] of Object.entries(KEYWORDS)) {
    if (t.includes(kw)) return reply + '\n\nð Per assistenza specializzata: RAM Elettronica â +39 0883 553719';
  }
  for (const [alias, target] of Object.entries(ALIASES)) {
    if (t.includes(alias) && KEYWORDS[target]) return KEYWORDS[target] + '\n\nð Per assistenza specializzata: RAM Elettronica â +39 0883 553719';
  }

  return 'Non ho trovato una risposta specifica nel database locale, ma posso aiutarti su qualsiasi inverter!\n\nProva a descrivere il problema in modo diverso, oppure contatta RAM Elettronica:\nð +39 0883 553719\nð§ info@ramelettronica.it\n\nSono esperto di: Danfoss, ABB, Siemens, Schneider, Yaskawa, WEG, Mitsubishi, Lenze, SEW, e molti altri produttori.';
}


// ââââââââââââââââââââââââââââââââââââââââââââââââââ
// ââ MEDIA WhatsApp (foto) ââ
// ââââââââââââââââââââââââââââââââââââââââââââââââââ

async function getMediaUrl(mediaId) {
  const res = await axios.get(`https://graph.facebook.com/v21.0/${mediaId}`, {
    headers: { 'Authorization': `Bearer ${WHATSAPP_TOKEN}` }
  });
  return res.data.url || '';
}


// ââââââââââââââââââââââââââââââââââââââââââââââââââ
// ââ GOOGLE SHEET + LOG ââ
// ââââââââââââââââââââââââââââââââââââââââââââââââââ

async function inviaAGoogleSheet(phone, s, userMsg, botReply) {
  if (!GOOGLE_WEBHOOK) return;
  try {
    await axios.post(GOOGLE_WEBHOOK, {
      id: 'wa_' + Date.now(),
      data: new Date().toLocaleDateString('it-IT'),
      ora: new Date().toLocaleTimeString('it-IT', {hour:'2-digit',minute:'2-digit'}),
      nome: s.nome,
      email: '',
      telefono: phone,
      azienda: s.azienda || '',
      messaggio: userMsg,
      foto_allegata: !!s.fotoId,
      valutazione: botReply.substring(0, 1000),
      fonte: 'WhatsApp'
    }, { timeout: 10000 });
  } catch(e) {
    console.error('â Google Sheet errore:', e.message);
  }
}

function logCase(phone, s, userMsg, botReply) {
  const record = {
    ts: new Date().toISOString(), phone, nome: s.nome,
    messaggio: userMsg, foto: !!s.fotoId, risposta: botReply.substring(0, 500)
  };
  fs.appendFileSync(path.join(__dirname, 'cases.log'), JSON.stringify(record) + '\n');
}


// ââââââââââââââââââââââââââââââââââââââââââââââââââ
// ââ WHATSAPP API â INVIO ââ
// ââââââââââââââââââââââââââââââââââââââââââââââââââ

async function send(phone, text) {
  try {
    await axios.post(`https://graph.facebook.com/v21.0/${PHONE_NUMBER_ID}/messages`, {
      messaging_product: 'whatsapp',
      to: phone,
      type: 'text',
      text: { body: text }
    }, {
      headers: { 'Authorization': `Bearer ${WHATSAPP_TOKEN}` }
    });
  } catch (e) {
    console.error(`Errore invio a ${phone}:`, e.message);
  }
}


// ââââââââââââââââââââââââââââââââââââââââââââââââââ
// ââ UTILITY ââ
// ââââââââââââââââââââââââââââââââââââââââââââââââââ

function splitText(text, maxLen) {
  const parts = [];
  let current = '';
  for (const line of text.split('\n')) {
    if ((current + '\n' + line).length > maxLen) {
      parts.push(current);
      current = line;
    } else {
      current += (current ? '\n' : '') + line;
    }
  }
  if (current) parts.push(current);
  return parts;
}


// ââ Startup info ââ
console.log('ð¤ RAM Elettronica â WhatsApp AI Assistant v4.2 MULTI-BRAND + DOCS avviato');
console.log(`   AI Anthropic: ${ANTHROPIC_KEY ? 'â ATTIVO (conversazione libera)' : 'â NON CONFIGURATA (solo DB locale)'}`);
console.log(`   Google Sheet: ${GOOGLE_WEBHOOK ? 'â attivo' : 'â non configurato'}`);
console.log(`   Utenti registrati: ${Object.keys(knownUsers).length}`);
console.log(`   Storico richieste: ${requestHistory.length}`);
console.log('   ð Pronto!\n');
