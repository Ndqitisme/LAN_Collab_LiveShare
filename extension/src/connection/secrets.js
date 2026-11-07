'use strict';

// Tokens live in SecretStorage, the OS credential store, under lanCollab.token:<folder key>. 0.1 kept them in plain
// text: in the globalState joins records and in the lanCollab.token setting. migrateTokens moves both and is safe
// to run on every activation: an old copy is deleted only after the secret reads back equal, so a crash in
// between leaves the old copy and the next run finishes the move.
const joins = require('./joins');

// A user-level lanCollab.token served every folder configured through the settings, so it moves to one shared
// secret those folders fall back to. A folder key is an absolute path and never equals it.
const SETTINGS_KEY = 'settings';

const secretKey = (folderKey) => `lanCollab.token:${folderKey}`;

// undefined when none was ever stored.
async function getToken(secrets, folderKey) {
  return secrets.get(secretKey(folderKey));
}

async function setToken(secrets, folderKey, token) {
  await secrets.store(secretKey(folderKey), token);
}

async function deleteToken(secrets, folderKey) {
  await secrets.delete(secretKey(folderKey));
}

async function storeVerified(secrets, folderKey, token) {
  await setToken(secrets, folderKey, token);
  return (await getToken(secrets, folderKey)) === token;
}

// setting: {global, workspace, clearGlobal(), clearWorkspace()} for lanCollab.token, '' where unset.
// settingsFolderKey: the open folder's key when it takes its hub from the settings, else null; only then is the
// workspace-level value that folder's token.
async function migrateTokens({ globalState, secrets, settingsFolderKey, setting, log }) {
  let moved = 0;
  const move = async (key, token, clear, what) => {
    if (!(await storeVerified(secrets, key, token))) {
      log(`Không chuyển được ${what} vào kho bí mật: đọc lại không khớp. Giữ bản cũ.`);
      return;
    }
    await clear();
    moved += 1;
    log(`Đã chuyển ${what} vào kho bí mật (${secretKey(key)}).`);
  };
  for (const [key, r] of Object.entries(joins.all(globalState))) {
    if (r.v === 2) continue;
    await move(key, typeof r.token === 'string' ? r.token : '', () => joins.put(globalState, key, joins.fromV1(r)), `lanCollab.joins[${key}].token`);
  }
  if (setting.global) await move(SETTINGS_KEY, setting.global, setting.clearGlobal, 'lanCollab.token (user)');
  if (settingsFolderKey && setting.workspace) await move(settingsFolderKey, setting.workspace, setting.clearWorkspace, `lanCollab.token (workspace ${settingsFolderKey})`);
  return moved;
}

module.exports = { SETTINGS_KEY, secretKey, getToken, setToken, deleteToken, migrateTokens };
