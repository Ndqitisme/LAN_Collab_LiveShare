'use strict';

const vscode = require('vscode');
const { t } = require('../../../lib/i18n');

const SCHEME = 'lancollab-history';
// The query of an open run's end: it has no stored content yet, so it shows today's text.
const CURRENT = 'current';
const PREVIEW = 'preview';

// lancollab-history:/<run id>/<start or end>/<path>?<sha256>. The hash makes the address self-contained, so an
// editor VS Code restores after a reload still finds its content.
function runUri(run, side) {
  const hash = side === 'start' ? run.start_blob : run.end_blob;
  return vscode.Uri.from({ scheme: SCHEME, path: `/${run.id}/${side}/${run.path}`, query: hash || CURRENT });
}

// Read-only documents with the stored content of run boundaries, and the texts of a revert preview.
class HistoryDocuments {
  constructor(app) {
    this.app = app;
    this.previews = new Map(); // uri -> text
    this.count = 0;
  }

  previewUri(rel, text) {
    const uri = vscode.Uri.from({ scheme: SCHEME, path: `/${PREVIEW}/${++this.count}/${rel}`, query: PREVIEW });
    this.previews.set(uri.toString(), text);
    return uri;
  }

  dropPreviews(...uris) {
    for (const uri of uris) this.previews.delete(uri.toString());
  }

  async provideTextDocumentContent(uri) {
    if (uri.query === PREVIEW) return this.previews.get(uri.toString()) ?? '';
    const rel = uri.path.split('/').slice(3).join('/');
    const core = this.app.controller.core;
    if (uri.query === CURRENT) {
      const e = core && core.entries.get(rel);
      if (!e || e.kind !== 'text') throw new Error(t('history.fileGone', { file: rel }));
      return shown(e.text);
    }
    const history = this.app.history;
    if (!history || !history.available()) throw new Error(t('history.unavailable'));
    const content = await history.blob(uri.query);
    if (!content) throw new Error(t('history.blobMissing'));
    return shown(content.kind === 'text' ? content.text : Buffer.from(content.b64, 'base64').toString('utf8'));
  }
}

// VS Code keeps a BOM as the file encoding, not as text.
function shown(text) {
  return text.replace(/^﻿/, '');
}

module.exports = { SCHEME, HistoryDocuments, runUri };
