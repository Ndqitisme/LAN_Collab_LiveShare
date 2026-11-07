'use strict';

// Tokens live in SecretStorage, the OS credential store, under lanCollab.token:<folder key>. 0.1 kept them in plain
// text: in the globalState joins records and in the lanCollab.token setting. migrateTokens moves both and is safe
// to run on every activation: an old copy is deleted only after the secret reads back equal, so a crash in
// between leaves the old copy and the next run finishes the move.
const joins = require('./joins');

const secretKey = (folderKey) => `lanCollab.token:${folderKey}`;

// '' when the folder has no stored token, undefined when none was ever stored.
async function getToken(secrets, folderKey) {
  return secrets.get(secretKey(folderKey));
}

async function setToken(secrets, folderKey, token) {
  await secrets.store(secretKey(folderKey), token);
}

async function storeVerified(secrets, folderKey, token) {
  await setToken(secrets, folderKey, token);
  return (await getToken(secrets, folderKey)) === token;
}

// setting: {value, clear()} for lanCollab.token as the open folder sees it, value '' when unset. It is moved only
// when the open folder takes its hub from the settings, because only then is it that folder's token.
async function migrateTokens({ globalState, secrets, workspaceKey, setting, log }) {
  let moved = 0;
  for (const [key, r] of Object.entries(joins.all(globalState))) {
    if (r.v === 2) continue;
    if (!(await storeVerified(secrets, key, typeof r.token === 'string' ? r.token : ''))) {
      log(`Không chuyển được token của ${key} vào kho bí mật: đọc lại không khớp. Giữ bản cũ.`);
      continue;
    }
    await joins.put(globalState, key, joins.fromV1(r));
    moved += 1;
    log(`Đã chuyển token của ${key} từ lanCollab.joins vào kho bí mật.`);
  }
  if (workspaceKey && !joins.get(globalState, workspaceKey) && setting.value) {
    if (await storeVerified(secrets, workspaceKey, setting.value)) {
      await setting.clear();
      moved += 1;
      log(`Đã chuyển lanCollab.token vào kho bí mật cho ${workspaceKey} và xoá khỏi cài đặt.`);
    } else {
      log(`Không chuyển được lanCollab.token vào kho bí mật: đọc lại không khớp. Giữ bản cũ.`);
    }
  }
  return moved;
}

module.exports = { secretKey, getToken, setToken, migrateTokens };
