/**
 * Client-side sync engine — extracted from index.html and genericized for this
 * write-up (business-specific field names replaced with generic placeholders).
 * This is the browser-side counterpart to apps-script/Codigo.gs: same merge
 * rule, implemented on both ends because either side may be the one applying
 * incoming changes.
 *
 * Design in one line: local-first (every action commits to localStorage
 * synchronously, the UI never blocks on the network), background sync
 * reconciles with the shared Google Sheet.
 */

const CHAVE = 'crm_state_v1';
let S = { records: [], config: {} };
let timerSync = null;
let syncEstado = { status: 'off', msg: '' };

/* ══════════════ PERSISTÊNCIA LOCAL ══════════════ */
function carregar() {
  try {
    const raw = localStorage.getItem(CHAVE);
    if (raw) {
      const d = JSON.parse(raw);
      S.records = d.records || [];
      S.config = Object.assign(S.config, d.config || {});
    }
  } catch (e) { console.warn('Falha ao ler dados locais', e); }
}

function salvar() {
  try { localStorage.setItem(CHAVE, JSON.stringify(S)); }
  catch (e) { toast('Não consegui salvar localmente', 'err'); }
}

/* ══════════════ SINCRONIZAÇÃO ══════════════ */
function agendarSync() {
  if (!S.config.syncUrl) return;
  clearTimeout(timerSync);
  timerSync = setTimeout(() => sincronizar(true), 2500);   // debounce de 2.5s
}

/**
 * Aplica um registro recebido do servidor ao estado local. Regra de merge:
 *  - notas/histórico: SEMPRE unidos (append-only, deduplicados por id) — nunca
 *    se perde uma anotação feita pelo outro lado.
 *  - campos simples: last-write-wins, comparado por `atualizadoEm`.
 * Espelha exatamente a lógica do backend (Codigo.gs) — os dois lados fazem o
 * mesmo merge porque qualquer um pode ser quem está reconciliando.
 */
function mesclarRemoto(remoto) {
  const i = S.records.findIndex(r => r.id === remoto.id);
  if (i < 0) { remoto._sujo = false; S.records.push(remoto); return; }
  const local = S.records[i];
  const unir = (a, b) => {
    const vistos = new Set(); const out = [];
    [...(a || []), ...(b || [])].forEach(x => { if (x && !vistos.has(x.id)) { vistos.add(x.id); out.push(x); } });
    return out.sort((x, y) => (x.data || '').localeCompare(y.data || ''));
  };
  const notas = unir(local.notas, remoto.notas);
  const hist = unir(local.historico, remoto.historico);
  if (local._sujo && (local.atualizadoEm || '') > (remoto.atualizadoEm || '')) {
    local.notas = notas; local.historico = hist;   // mantém o local, só agrega registros
  } else {
    S.records[i] = Object.assign(remoto, { notas, historico: hist, _sujo: false });
  }
}

async function sincronizar(silencioso) {
  const cfg = S.config;
  if (!cfg.syncUrl) { if (!silencioso) toast('Configure a sincronização em Ajustes'); return; }
  if (syncEstado.status === 'busy') return;
  syncEstado = { status: 'busy', msg: 'Sincronizando…' }; pintarSync();
  const pendentes = S.records.filter(r => r._sujo).map(r => { const c = { ...r }; delete c._sujo; return c; });
  try {
    const r = await fetch(cfg.syncUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },  // evita preflight CORS no Apps Script
      body: JSON.stringify({ token: cfg.syncToken || '', desde: cfg.ultimoSync || '', mudancas: pendentes })
    });
    const j = await r.json();
    if (!j.ok) throw new Error(j.erro || 'resposta inválida');
    pendentes.forEach(p => { const rec = S.records.find(x => x.id === p.id); if (rec && rec.atualizadoEm === p.atualizadoEm) rec._sujo = false; });
    (j.leads || []).forEach(mesclarRemoto);
    cfg.ultimoSync = j.servidorEm || cfg.ultimoSync;
    salvar();
    syncEstado = { status: 'on', msg: 'Sincronizado', quando: new Date().toISOString() };
    pintarSync();
    if (!silencioso) toast('Tudo sincronizado', 'ok');
  } catch (e) {
    syncEstado = { status: 'err', msg: 'Erro de sync' };
    pintarSync();
    if (!silencioso) toast('Falha ao sincronizar: ' + e.message, 'err');
  }
}

// periodic sync as a safety net, independent of the debounce above
setInterval(() => sincronizar(true), 60000);

function pintarSync() { /* atualiza o indicador visual de status — omitido aqui (UI) */ }
function toast() { /* notificação visual — omitido aqui (UI) */ }
