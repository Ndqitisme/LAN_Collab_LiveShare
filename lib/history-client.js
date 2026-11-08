'use strict';

const EventEmitter = require('events');
const { lineTokens, tokenSteps } = require('./ot');

const BLOB_CACHE = 50;

// The edit-run history of the project (docs/protocol.md section 12) over one connected CollabClient: run lists,
// stored contents with a small cache (contents are named by their SHA-256, so an entry never goes stale), and
// `changed(path)` when the runs of a file change.
class HistoryClient extends EventEmitter {
  constructor(core) {
    super();
    this.core = core;
    this.blobs = new Map(); // sha256 -> {kind, text | b64}, most recently used last
    this.runs = new Map(); // run id -> latest record seen in a list
    this.onChanged = (rel) => this.emit('changed', rel);
    core.on('history-changed', this.onChanged);
  }

  available() {
    return this.core.hasHistory();
  }

  // Resolves {runs, more}. `rel` null lists the whole project; `before` is the id of the last run already shown.
  async list(rel, before = null, limit = undefined) {
    const page = await this.core.historyList(rel, before, limit);
    for (const r of page.runs) this.runs.set(r.id, r);
    return page;
  }

  run(id) {
    return this.runs.get(id) || null;
  }

  // Resolves {kind: 'text', text} or {kind: 'blob', b64}, or null when retention removed it.
  async blob(hash) {
    const hit = this.blobs.get(hash);
    if (hit) {
      this.blobs.delete(hash);
      this.blobs.set(hash, hit);
      return hit;
    }
    const v = await this.core.historyBlob(hash);
    if (v) {
      this.blobs.set(hash, v);
      if (this.blobs.size > BLOB_CACHE) this.blobs.delete(this.blobs.keys().next().value);
    }
    return v;
  }

  checkpoints() {
    return this.core.checkpointList();
  }

  createCheckpoint(name) {
    return this.core.checkpointCreate(name);
  }

  dispose() {
    this.core.removeListener('history-changed', this.onChanged);
  }
}

const MAX_LINE_EDITS = 3000;

// Changed line blocks turning `base` into `other`: [{from, to, lines}] in base line indices, `lines` replacing
// base lines from..to-1. Past MAX_LINE_EDITS the whole text is one block.
function lineHunks(base, other) {
  const steps = tokenSteps(base, other, MAX_LINE_EDITS);
  if (!steps) return [{ from: 0, to: base.length, lines: other }];
  const hunks = [];
  let i = 0;
  let j = 0;
  let cur = null;
  for (const s of steps) {
    if (s === 'e') {
      cur = null;
      i++;
      j++;
      continue;
    }
    if (!cur) {
      cur = { from: i, to: i, lines: [] };
      hunks.push(cur);
    }
    if (s === 'd') cur.to = ++i;
    else cur.lines.push(other[j++]);
  }
  return hunks;
}

// Two blocks touch the same lines. A pure insertion conflicts only strictly inside the other block: next to it,
// both changes apply.
function overlaps(a, b) {
  if (a.from === a.to && b.from === b.to) return false;
  if (a.from === a.to) return b.from < a.from && a.from < b.to;
  if (b.from === b.to) return a.from < b.from && b.from < a.to;
  return a.from < b.to && b.from < a.to;
}

// Undoes one run in today's text, like `git revert`: a three-way merge by lines with base = the file after the
// run, theirs = the file before it, ours = the current text. Each block the run changed goes back to what it was
// before the run, unless an edit made after the run (by anyone) touches the same lines: that block keeps today's
// text and counts as a conflict, so nothing written after the run is lost. A block already back to its old text
// is neither. Returns {text, conflicts}.
function revertRun(start, end, current) {
  const base = lineTokens(end);
  const ours = lineHunks(base, lineTokens(current));
  const theirs = lineHunks(base, lineTokens(start));
  const same = (h, o) => h.from === o.from && h.to === o.to && h.lines.join('') === o.lines.join('');
  const undone = theirs.filter((h) => ours.some((o) => same(h, o)));
  const kept = theirs.filter((h) => !undone.includes(h) && !ours.some((o) => overlaps(h, o)));
  // At one position insertions come first, the lines the run removed before later ones, then a replaced block.
  const blocks = [...ours, ...kept.map((h) => ({ ...h, run: true }))]
    .sort((a, b) => a.from - b.from || (a.to - a.from) - (b.to - b.from) || (b.run ? 1 : 0) - (a.run ? 1 : 0));
  const out = [];
  let i = 0;
  for (const h of blocks) {
    for (; i < h.from; i++) out.push(base[i]);
    out.push(...h.lines);
    i = Math.max(i, h.to);
  }
  for (; i < base.length; i++) out.push(base[i]);
  return { text: out.join(''), conflicts: theirs.length - kept.length - undone.length };
}

function bufferOf(content) {
  if (!content) return null;
  return content.kind === 'text' ? Buffer.from(content.text, 'utf8') : Buffer.from(content.b64, 'base64');
}

module.exports = { HistoryClient, revertRun, bufferOf, BLOB_CACHE };
