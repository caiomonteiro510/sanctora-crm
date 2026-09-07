/**
 * ════════════════════════════════════════════════════════════════
 *  CRM SANCTORA — Backend de sincronização (Google Apps Script)
 *  Guarda os leads numa planilha do Google para que os dois sócios
 *  trabalhem na mesma base, cada um do seu computador.
 *
 *  Como publicar: veja README.md
 * ════════════════════════════════════════════════════════════════
 */

// ⚠️ TROQUE por uma senha só de vocês dois. Precisa ser idêntica à
//    que vocês colocarem em Ajustes → Token compartilhado, no CRM.
var TOKEN = 'TROQUE-ESTE-TOKEN-AGORA';

var ABA = 'leads';

// Colunas de leitura fácil na planilha. A coluna "json" é a fonte da
// verdade — as demais são espelho. Não edite a planilha à mão.
var COLUNAS = ['id','sync','atualizadoEm','atualizadoPor','empresa','contato','telefone',
               'etapa','responsavel','produto','valorSetup','valorMensal',
               'proximaAcao','proximaData','excluido','json'];

/* ─────────────────────────── Entradas ─────────────────────────── */

function doPost(e) { return processar(e); }

function doGet(e)  { return processar(e); }

function processar(e) {
  try {
    var corpo = {};
    if (e && e.postData && e.postData.contents) {
      corpo = JSON.parse(e.postData.contents);
    } else if (e && e.parameter) {
      corpo = e.parameter;
    }

    if (String(corpo.token || '') !== TOKEN) {
      return responder({ ok: false, erro: 'Token inválido' });
    }
    if (corpo.acao === 'ping') {
      return responder({ ok: true, mensagem: 'Backend do CRM Sanctora no ar', servidorEm: new Date().toISOString() });
    }

    var trava = LockService.getScriptLock();
    trava.waitLock(25000);
    try {
      return responder(sincronizar(corpo));
    } finally {
      trava.releaseLock();
    }
  } catch (err) {
    return responder({ ok: false, erro: String(err && err.message || err) });
  }
}

function responder(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/* ────────────────────────── Sincronização ────────────────────────── */

function sincronizar(corpo) {
  var aba = obterAba();
  var registros = lerTudo(aba);          // { id: {linha, dados, sync} }
  var carimbo = new Date().toISOString();
  var mudancas = corpo.mudancas || [];
  var escrever = [];

  mudancas.forEach(function (novo) {
    if (!novo || !novo.id) return;
    var atual = registros[novo.id];

    if (atual) {
      // Notas e histórico são append-only: unimos sempre, para que uma
      // edição simultânea nunca apague o registro do outro sócio.
      novo.notas     = unir(atual.dados.notas,     novo.notas);
      novo.historico = unir(atual.dados.historico, novo.historico);

      // Quem editou por último vence nos campos simples.
      if (String(atual.dados.atualizadoEm || '') > String(novo.atualizadoEm || '')) {
        var mantido = atual.dados;
        mantido.notas = novo.notas;
        mantido.historico = novo.historico;
        novo = mantido;
      }
    }
    novo.sync = carimbo;
    registros[novo.id] = { linha: atual ? atual.linha : 0, dados: novo, sync: carimbo };
    escrever.push(novo);
  });

  if (escrever.length) gravar(aba, registros, escrever);

  var desde = String(corpo.desde || '');
  var retorno = [];
  Object.keys(registros).forEach(function (id) {
    if (String(registros[id].sync || '') > desde) retorno.push(registros[id].dados);
  });

  return {
    ok: true,
    // 1 ms para trás evita perder gravações concorrentes no mesmo instante
    servidorEm: new Date(new Date(carimbo).getTime() - 1).toISOString(),
    recebidos: escrever.length,
    leads: retorno
  };
}

function unir(a, b) {
  var vistos = {}, saida = [];
  [].concat(a || [], b || []).forEach(function (x) {
    if (!x) return;
    var chave = x.id || (String(x.data) + String(x.texto || x.txt));
    if (vistos[chave]) return;
    vistos[chave] = true;
    saida.push(x);
  });
  saida.sort(function (x, y) { return String(x.data || '').localeCompare(String(y.data || '')); });
  return saida;
}

/* ──────────────────────────── Planilha ──────────────────────────── */

function obterAba() {
  var planilha = SpreadsheetApp.getActiveSpreadsheet();
  var aba = planilha.getSheetByName(ABA);
  if (!aba) {
    aba = planilha.insertSheet(ABA);
    aba.appendRow(COLUNAS);
    aba.setFrozenRows(1);
    aba.getRange(1, 1, 1, COLUNAS.length).setFontWeight('bold');
  }
  return aba;
}

function lerTudo(aba) {
  var registros = {};
  var ultima = aba.getLastRow();
  if (ultima < 2) return registros;

  var valores = aba.getRange(2, 1, ultima - 1, COLUNAS.length).getValues();
  for (var i = 0; i < valores.length; i++) {
    var id = String(valores[i][0] || '');
    if (!id) continue;
    var dados;
    try { dados = JSON.parse(valores[i][COLUNAS.indexOf('json')] || '{}'); }
    catch (err) { dados = {}; }
    dados.id = id;
    registros[id] = {
      linha: i + 2,
      sync: String(valores[i][COLUNAS.indexOf('sync')] || ''),
      dados: dados
    };
  }
  return registros;
}

function gravar(aba, registros, alterados) {
  var novos = [];
  alterados.forEach(function (lead) {
    var linha = montarLinha(lead);
    var alvo = registros[lead.id].linha;
    if (alvo > 1) {
      aba.getRange(alvo, 1, 1, COLUNAS.length).setValues([linha]);
    } else {
      novos.push(linha);
    }
  });
  if (novos.length) {
    var inicio = aba.getLastRow() + 1;
    aba.getRange(inicio, 1, novos.length, COLUNAS.length).setValues(novos);
    novos.forEach(function (linha, i) { registros[linha[0]].linha = inicio + i; });
  }
}

function montarLinha(lead) {
  var copia = {};
  Object.keys(lead).forEach(function (k) { if (k.charAt(0) !== '_') copia[k] = lead[k]; });
  return [
    lead.id,
    lead.sync || '',
    lead.atualizadoEm || '',
    lead.atualizadoPor || '',
    lead.empresa || '',
    lead.contato || '',
    lead.telefone || '',
    lead.etapa || '',
    lead.responsavel || '',
    lead.produto || '',
    Number(lead.valorSetup) || 0,
    Number(lead.valorMensal) || 0,
    lead.proximaAcao || '',
    lead.proximaData || '',
    lead.excluido ? 'sim' : '',
    JSON.stringify(copia)
  ];
}

/* ─────────────── Rode uma vez no editor para conferir ─────────────── */

function testarInstalacao() {
  var aba = obterAba();
  var total = Math.max(0, aba.getLastRow() - 1);
  Logger.log('Aba "%s" pronta. Registros guardados: %s', ABA, total);
  if (TOKEN === 'TROQUE-ESTE-TOKEN-AGORA') {
    Logger.log('⚠️  ATENÇÃO: troque a variável TOKEN antes de publicar.');
  }
  return total;
}
