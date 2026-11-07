'use strict';

const { PROTO_V2 } = require('../../../lib/common');
const { resolve, exchange, probeHello, probeProblem, problemText } = require('../../../lib/diagnostics');

// Checks a decoded invite against the hub before touching any folder, over every address it lists (and
// rediscovery when it carries an instanceId). Resolves {error} with the sentence to show, or {host, port,
// instanceId} of the hub that answered.
async function probe(inv, log) {
  let won;
  try {
    won = await resolve({ addresses: inv.hosts, lastGood: null, port: inv.port, instanceId: inv.instanceId, tlsFingerprint: inv.fingerprint });
  } catch (err) {
    log(`Kiểm tra mã mời: ${err.message}`);
    return { error: problemText(err.code, err.data) };
  }
  const where = { host: won.host, port: won.port, project: inv.project, proto: PROTO_V2 };
  try {
    const { msg } = await exchange(won.socket, probeHello({ project: inv.project, token: inv.token }));
    // Account rules are checked again with the real account.
    const problem = probeProblem(msg, true);
    if (!problem) return { host: won.host, port: won.port, instanceId: typeof msg.instanceId === 'string' ? msg.instanceId : null };
    log(`Kiểm tra ${won.host}:${won.port}: LAN Hub từ chối (${problem.code || problem.data.message}).`);
    return { error: problem.data.message || problemText(problem.code, { ...problem.data, ...where }) };
  } catch (err) {
    log(`Kiểm tra ${won.host}:${won.port}: ${err.message}`);
    return { error: problemText(err.code, where) };
  } finally {
    won.socket.destroy();
  }
}

module.exports = { probe };
