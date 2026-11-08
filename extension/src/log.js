'use strict';

// The only writer of the "LAN Collab" output channel: `<ISO time> [level] <message>`. Levels are debug, info, warn
// and error; debug lines are written only when LAN_COLLAB_DEBUG is set. lib/ modules take this function as their
// `log` option and mark a level with a leading [LỖI] or [CẢNH BÁO] tag instead of the second argument.
const LEVELS = new Set(['debug', 'info', 'warn', 'error']);
const TAGS = [[/^\[LỖI\] /, 'error'], [/^\[CẢNH BÁO\] /, 'warn']];

// A multi-line message, such as a stack trace, repeats the prefix on every line.
function formatLine(message, level = 'info', now = new Date()) {
  let text = String(message);
  let lvl = LEVELS.has(level) ? level : 'info';
  for (const [tag, tagged] of TAGS) {
    const m = tag.exec(text);
    if (m) {
      text = text.slice(m[0].length);
      lvl = tagged;
    }
  }
  const prefix = `${now.toISOString()} [${lvl}] `;
  return text.split(/\r?\n/).map((line) => prefix + line).join('\n');
}

function createLog(channel, env = process.env) {
  const debug = Boolean(env.LAN_COLLAB_DEBUG);
  return (message, level) => {
    if (level === 'debug' && !debug) return;
    channel.appendLine(formatLine(message, level));
  };
}

module.exports = { createLog, formatLine };
