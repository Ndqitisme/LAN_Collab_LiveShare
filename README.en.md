<img src="media/icon.png" alt="LAN Collab" width="96" align="right">

# LAN Collab

[Tiếng Việt](README.md) | English

LAN Collab is a VS Code extension and a synchronization hub for local networks that lets several people edit one project in real time. Unlike session-sharing tools, every machine keeps a real copy of all project files. Each person can therefore run the program, use the debugger and use their own AI tools, while changes stay synchronized across all machines.

The hub is a dependency-free Node.js process. It runs on your own server (Windows, Linux or macOS) and needs no Internet access or third-party service.

The extension user interface is currently available in Vietnamese only.

## Contents

- [Features](#features)
- [Comparison](#comparison)
- [Architecture](#architecture)
- [Requirements](#requirements)
- [Installing the hub](#installing-the-hub)
- [Installing the extension](#installing-the-extension)
- [Building release packages](#building-release-packages)
- [Joining a project](#joining-a-project)
- [Usage](#usage)
- [Configuration reference](#configuration-reference)
- [Working with Git](#working-with-git)
- [Synchronization behavior](#synchronization-behavior)
- [Security](#security)
- [Known limitations](#known-limitations)
- [Troubleshooting](#troubleshooting)
- [Development](#development)
- [License](#license)

## Features

- **Real-time concurrent editing.** Every edit reaches the other machines immediately. Several people editing the same file converge on the same content, using Operational Transformation (OT).
- **Real files on every machine.** Every machine can run, debug and use its own AI tools. Changes written directly to disk by AI assistants, scripts or other tools are detected, merged with unsaved edits and synchronized.
- **Team awareness:**
  - remote cursors and selections in per-user colors, with names;
  - a member list showing each person's file and line, active debug session and status;
  - an activity log: join or leave, edit, create, delete, start or stop debugging;
  - a follow mode that tracks one member's position.
- **Built-in chat:**
  - `@name` mentions, with a notification for the person mentioned;
  - clickable `file:line` references;
  - unread counters;
  - chat history stored on the hub.
- **VS Code account identity.** The GitHub or Microsoft account already signed in to VS Code is used as the display name. The hub can restrict which accounts may join.
- **Invite codes.** Paste a code to join; the whole project is downloaded into an empty folder with no configuration.
- **Connection resilience:**
  - editing continues while offline; on reconnection, both sides are merged three-way;
  - edits made while the extension was not running (VS Code closed) are recognized on the next connection;
  - for a file changed on both sides, the user chooses which version to keep.
- **History and backups.** The hub keeps periodic snapshots of every file and a copy before each delete or overwrite. Clients back up local files before replacing them.

## Comparison

| | Live Share | Open Collaboration Tools | LAN Collab |
|---|---|---|---|
| Relay server | Microsoft service | Self-hostable | Self-hosted on the LAN |
| Files on guest machines | Virtual file system | Virtual file system | Real files |
| Guests run and debug on their own machine | No (they use the host's debug session) | No | Yes |
| Command-line tools on guest machines can read project files | No | No | Yes |
| Host must keep VS Code open | Yes | Yes | No (the hub runs on its own) |

## Architecture

```
 Machine A: VS Code + extension ─┐
 Machine B: VS Code + extension ─┼── TCP (default 8200) ── Hub (Node.js) ── Shared copy of the project
 Machine C: VS Code + extension ─┘                                        + history, chat
```

- **The hub** holds the shared copy of every file and orders and transforms concurrent changes. It then writes the files to disk and stores history and chat. The protocol is newline-delimited JSON over TCP.
- **The extension** keeps a local copy of the project folder and connects it to the hub:
  - for open files, it binds the editor to the OT layer;
  - for files that are not open, it reads and writes them directly on disk;
  - it watches the disk for external changes.

## Requirements

| Component | Requirement |
|---|---|
| Hub | Node.js 18 or later; Windows, Linux or macOS; one TCP port reachable on the LAN |
| Clients | VS Code 1.80 or later. Using the VS Code account as display name requires a VS Code version with the `authentication.getAccounts` API; older versions fall back to the machine name |
| Building the extension | Node.js 18 or later and access to the npm registry (for `@vscode/vsce`) |

## Installing the hub

### Windows

1. Put the hub code on the server in one of two ways:
   - extract `lan-collab-hub-<version>.zip`, taken from the Releases page or built yourself (see [Building release packages](#building-release-packages)), for example to `D:\lan-collab\`;
   - or copy the repository's `hub` and `lib` folders, keeping their structure.

   The hub needs both the `hub` and `lib` folders.
2. Edit the first three settings of `hub\start-hub.bat`:
   ```bat
   set "PROJECT=MyProject"
   set "ROOT=D:\lan-collab\workspaces\MyProject"
   set "PORT=8200"
   ```
   `ROOT` is the folder that holds the shared copy of the project. It may be empty; the first client that joins will then upload the project.
3. Open the port in the firewall (PowerShell as Administrator):
   ```powershell
   New-NetFirewallRule -DisplayName "LAN Collab 8200" -Direction Inbound -Protocol TCP -LocalPort 8200 -Action Allow
   ```
4. Run `hub\start-hub.bat`. The window prints the token and one invite code per IPv4 address of the server:
   ```
   Token         : 5f0c...
   ... LAN Collab hub — dự án "MyProject" — thư mục D:\lan-collab\workspaces\MyProject — cổng 8200 — 0 file
   ... Mã mời (192.168.1.10): LC-AcCoAQog...
   ```
   Closing the window stops the hub. Pending changes are written to disk before it exits.

### Linux and macOS

```bash
chmod +x hub/start-hub.sh
PROJECT=MyProject ROOT=/srv/lan-collab/MyProject PORT=8200 ./hub/start-hub.sh
```

### Running directly

```bash
node hub/hub.js --root <folder> [--port 8200] [--host 0.0.0.0] [--project <name>] [--token <token>] \
                [--allow-file <file>] [--history <folder>] [--exclude "pattern1,pattern2"]
```

| Option | Default | Meaning |
|---|---|---|
| `--root` | (required) | Folder holding the shared copy of the project |
| `--port` | `8200` | TCP port |
| `--host` | `0.0.0.0` | Listen address |
| `--project` | name of the `--root` folder | Project name; clients must use the same name |
| `--token` | environment variable `LAN_COLLAB_TOKEN` | Token required to connect; empty disables the check |
| `--allow-file` | (none) | File listing the accounts allowed to join |
| `--history` | `<root>/.lan-collab/history` | Folder for history and chat |
| `--exclude` | (none) | Additional glob patterns that are never synchronized, comma-separated |

### Running as a service

Windows, with [NSSM](https://nssm.cc/):

```powershell
nssm install LanCollab "C:\Program Files\nodejs\node.exe"
nssm set LanCollab AppParameters "D:\lan-collab\hub\hub.js --root D:\lan-collab\workspaces\MyProject --port 8200 --project MyProject --allow-file D:\lan-collab\hub\allowed-accounts-MyProject.txt"
nssm set LanCollab AppEnvironmentExtra LAN_COLLAB_TOKEN=<token>
nssm start LanCollab
```

Linux, with systemd (`/etc/systemd/system/lan-collab.service`):

```ini
[Unit]
Description=LAN Collab hub
After=network.target

[Service]
ExecStart=/usr/bin/node /opt/lan-collab/hub/hub.js --root /srv/lan-collab/MyProject --port 8200 --project MyProject --allow-file /opt/lan-collab/hub/allowed-accounts-MyProject.txt
Environment=LAN_COLLAB_TOKEN=<token>
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

### Files created by the hub

| File | Content |
|---|---|
| `hub/token-<PROJECT>.txt` | The token, generated once by the launcher. Delete it to rotate the token; all existing invite codes become invalid |
| `hub/allowed-accounts-<PROJECT>.txt` | Accounts allowed to join (see [Security](#security)) |
| `<root>/.lan-collab/hub.json` | Identifier of the shared copy. Do not delete it: clients use it to recognize the hub |
| `<root>/.lan-collab/history/` | Per-file snapshots, at most one every 10 minutes, plus a copy before each delete or overwrite; `chat.jsonl` holds the chat history |

The `.lan-collab` folder is never synchronized to clients.

## Installing the extension

Download `lan-collab-<version>.vsix` from the repository's Releases page, or build it as described in [Building release packages](#building-release-packages).

Install it in VS Code in either of two ways:

```bash
code --install-extension dist/lan-collab-0.1.0.vsix
```

or in VS Code: **Extensions** → `···` → **Install from VSIX…**

After installation, the activity bar shows a **LAN Collab** icon with two views: **Đồng đội** (members) and **Chat**.

To upgrade, install the newer `.vsix` the same way; VS Code replaces the previous version.

## Building release packages

A release consists of two files, both created in `dist/`:

| File | For | Content |
|---|---|---|
| `lan-collab-<version>.vsix` | Client machines | The VS Code extension |
| `lan-collab-hub-<version>.zip` | The server | `hub/` (`hub.js`, `start-hub.bat`, `start-hub.sh`), `lib/` and `LICENSE`, under a top-level `lan-collab-hub/` folder |

`<version>` is taken from the `version` field of `package.json`.

### Requirements

- Node.js 18 or later (with npm).
- Access to the npm registry when building the `.vsix`. `npx` downloads `@vscode/vsce` on first use and keeps it in the npm cache.
- The hub `.zip` is produced with Node.js built-in modules; no external archiver is needed.

### Steps

1. Get the source:
   ```bash
   git clone https://github.com/Ndqitisme/LAN_Collab_LiveShare.git
   cd LAN_Collab_LiveShare
   ```
2. Run the tests (recommended before every release):
   ```bash
   npm test
   ```
3. Build:

   | Command | Output |
   |---|---|
   | `npm run package` | `dist/lan-collab-<version>.vsix` |
   | `npm run package:hub` | `dist/lan-collab-hub-<version>.zip` |
   | `npm run package:all` | Both files |

   Example output of `npm run package:all`:
   ```
   DONE  Packaged: dist\lan-collab-0.1.0.vsix (14 files, 109 KB)
   Created dist\lan-collab-hub-0.1.0.zip (8 files)
   ```
4. Quick check:
   - extension: `code --install-extension dist/lan-collab-<version>.vsix`, reload VS Code and confirm that the LAN Collab icon appears;
   - hub: extract the `.zip` into a temporary folder and run `node lan-collab-hub/hub/hub.js --root <empty folder> --port 8200`; the hub prints its startup line and invite codes.

### Publishing on GitHub

1. Increase `version` in `package.json` following [Semantic Versioning](https://semver.org/) and commit the change.
2. Run `npm run package:all`.
3. Create and push a tag:
   ```bash
   git tag v0.1.0
   git push origin v0.1.0
   ```
4. On GitHub: **Releases** → **Draft a new release**, select the tag, attach both files from `dist/`, describe the changes and click **Publish release**.

The `dist/` folder is listed in `.gitignore`. Packages are distributed through Releases only and are not committed to the repository.

## Joining a project

### With an invite code

An invite code looks like `LC-...`. It contains the hub address, port, project name and token.

1. Get a code from either place:
   - the hub window: pick the line whose IP address is on the clients' subnet;
   - any machine already in the room: status-bar menu → **Sao chép mã mời** (copy invite code).
2. On the new machine: `Ctrl+Shift+P` → **LAN Collab: Tham gia bằng mã** (join with code), then paste the code.
3. The extension checks the code with the hub before changing any file.
4. Select or create an empty folder. VS Code opens it, connects and downloads the whole project, with a progress indicator.

A folder joined with a code remembers its hub on that machine and reconnects automatically when reopened.

### Manual configuration

Add to the project's `.vscode/settings.json`:

```jsonc
{
  "lanCollab.server": "192.168.1.10:8200",
  "lanCollab.project": "MyProject",
  "files.saveConflictResolution": "overwriteFileOnDisk"
}
```

Put the token in User settings (`Preferences: Open User Settings (JSON)`) so that it is not committed to the repository:

```jsonc
{ "lanCollab.token": "<token>" }
```

The extension merges external disk changes into the editor before saving. Setting `files.saveConflictResolution` to `overwriteFileOnDisk` is therefore safe for synchronized files. It also prevents VS Code's "file on disk is newer" dialog when a tool writes a file that still has unsaved changes.

### First connection

When a folder connects to a hub for the first time and the sync would change local files, the extension asks for confirmation. The dialog lists how many files will be:

- downloaded;
- overwritten;
- uploaded;
- deleted.

No dialog appears when the connection only downloads files into an empty folder. Every overwritten or deleted file is backed up to `.lan-collab/backup/<timestamp>/`.

## Usage

| Element | Purpose |
|---|---|
| Status bar | Number of people in the room, unread messages, connection state. Click it to open the menu |
| **Đồng đội** view | Each member with `file:line`, debug session and status. Click a name to jump to that position; hover to see the account. **Hoạt động gần đây** is the room's activity log |
| **Chat** view | Enter sends, Shift+Enter inserts a line break. The `@name` buttons insert a mention; `@all` mentions everyone. The **Vị trí** button inserts the `file:line` of the active editor. Any `path/file.ext:line` text is clickable |
| Editor | Other people's cursors and selections in their colors, with the name at the end of the line |

### Commands

| Command | Description |
|---|---|
| `LAN Collab: Tham gia bằng mã` | Join a room with an invite code |
| `LAN Collab: Sao chép mã mời` | Copy the current room's invite code to the clipboard |
| `LAN Collab: Kết nối` / `Ngắt kết nối` | Connect or disconnect the current folder |
| `LAN Collab: Đi theo một người` / `Thôi đi theo` | Follow or stop following a member's position |
| `LAN Collab: Đặt trạng thái (đang làm gì)` | Set a status line visible to the room |
| `LAN Collab: Dùng tài khoản VS Code (GitHub/Microsoft)` | Choose the signed-in VS Code account used as display name |
| `LAN Collab: Mở chat` | Open the Chat view |
| `LAN Collab: Xem nhật ký` | Open the extension's Output channel |
| `LAN Collab: Menu` | Combined menu (also opened from the status bar) |

## Configuration reference

| Setting | Default | Description |
|---|---|---|
| `lanCollab.server` | `""` | Hub address as `IP:port`. Not needed for folders joined with an invite code |
| `lanCollab.project` | `""` | Project name on the hub. The hub rejects a mismatching name |
| `lanCollab.token` | `""` | Hub token. Recommended in User settings |
| `lanCollab.name` | `""` | Display name. Empty: the VS Code account name, otherwise `os-user@hostname`. User settings only |
| `lanCollab.autoConnect` | `true` | Connect automatically when a folder linked to a hub is opened |
| `lanCollab.autoSave` | `true` | Save open files about 0.4 s after each change, so every machine's disk stays current |
| `lanCollab.exclude` | `[]` | Additional glob patterns that are never synchronized, for example `["output.csv", "build/**"]` |

Never synchronized by default: `.git`, `.lan-collab`, `.venv`, `venv`, `node_modules`, `__pycache__`, `*.pyc`, `~$*` (Microsoft Office lock files), `.DS_Store`, `Thumbs.db`. Patterns without `/` match at any depth. Exclude files that each machine generates when it runs the program (run output, build folders), so that the machines do not overwrite each other's results.

## Working with Git

The `.git` folder is not synchronized. Since all machines share the same working tree, one person performs the commit:

1. The committer runs `git add`, `git commit` and `git push` as usual.
2. The other machines run `git fetch` and then `git reset origin/<branch>`, without `--hard`. This moves HEAD and the index to the new commit; the working tree already matches that commit.

Operations that change many files, such as `git checkout`, `git pull` or `git stash`, on one machine are synchronized to every machine. To work privately on another branch, disconnect first. On reconnection, files changed only on that machine are uploaded; files changed on both sides require a choice.

## Synchronization behavior

| Data | Behavior |
|---|---|
| Text files (UTF-8, up to 1 MB) | Per edit, using OT, with the hub as the ordering authority |
| Binary files or files larger than 1 MB | Whole file replaced on save; the later save is kept, the earlier version remains in the hub history |
| Disk changes from external tools | Detected by the file watcher and merged three-way with the current content |
| Line endings | Each file uses one style (CRLF or LF, whichever is more common). Lines with a different style are converted |
| UTF-8 BOM | Preserved |
| Connection lost while VS Code stays open | Both sides are merged three-way on reconnection |
| Changes made while the extension was not running | On the next connection, files changed only locally are uploaded, files changed only on the hub are downloaded, and files changed on both sides require a choice |
| File deleted while another person edits it | The file is recreated, so the edits are not lost |
| Renames | Handled as delete plus create, including case-only renames |

## Security

- **Scope.** Traffic between clients and the hub is **not encrypted**. Use it only on a trusted local network or over a VPN.
- **Token.** The token is the primary access control. Invite codes contain the token, so share them only with members of the team.
- **Account list.** Each line of `allowed-accounts-<PROJECT>.txt` is one account allowed to join:
  - format: `github:<name>`, `microsoft:<email>`, or just `<name>`;
  - lines starting with `#` are comments;
  - changes apply from the next join, without restarting the hub;
  - a file with only comments lets any client with the token join.
- **Limits of the account list.** The hub does not verify accounts with GitHub or Microsoft: it needs no Internet access, and sign-in tokens are never sent over the network. The list therefore prevents accidental access, but not a token holder who deliberately claims a false account name.
- **Data sent.** Apart from file contents, the extension sends only:
  - the display name;
  - the account name (if any);
  - cursor positions;
  - status and chat messages.
- **Chat view safety.** Chat messages are rendered as plain text and never interpreted as HTML.

## Known limitations

- Undo (Ctrl+Z) follows each machine's local editor history, so it can also undo a change just received from another person at the same position.
- Each VS Code window synchronizes only the first root folder of the workspace.
- The hub writes changes to disk every 0.5 s. A sudden power loss on the server can lose the changes made in that interval. A normal shutdown of the hub loses nothing.
- The user interface is in Vietnamese only.

## Troubleshooting

| Symptom | Action |
|---|---|
| Status bar shows "mất kết nối" (disconnected) | From the client run `Test-NetConnection <IP> -Port 8200` (Windows) or `nc -vz <IP> 8200`. If it fails, check that the hub is running and the firewall allows the port |
| "Sai lanCollab.token." (wrong token) | The token differs from `hub/token-<PROJECT>.txt`. Get a new invite code or correct `lanCollab.token` |
| "Hub này phục vụ dự án …" (project mismatch) | `lanCollab.project` does not match the hub's `--project` |
| "Tài khoản … chưa được phép vào." (account not allowed) | Add the line suggested in the message to the account list |
| No account offered in the account picker | Sign in with GitHub or Microsoft from the VS Code Accounts menu, then run the account command again |
| More detail needed | `LAN Collab: Xem nhật ký`. The hub window also logs every connection, rejection and error |

## Development

```bash
npm test             # OT, chat and account list, three-client simulation (concurrent edits, external disk writes, dropped connections)
npm run test:vscode  # runs inside a real VS Code with a temporary profile (opens a VS Code window for about a minute)
npm run package:all  # builds the extension and hub packages in dist/ (see Building release packages)
```

Set the environment variable `LAN_COLLAB_DEBUG=1` before starting VS Code to make the extension log to the extension host console.

| Path | Content |
|---|---|
| `lib/ot.js` | Operational Transformation (retain/insert/delete, compose, transform) and Myers diff |
| `lib/client-core.js` | Hub connection, client-side OT state, initial sync, reconnection, disk watching |
| `lib/editor-binding.js` | Binding between the OT layer and the VS Code editor |
| `lib/common.js` | Protocol framing, exclusion rules, invite codes, shared utilities |
| `extension/extension.js` | VS Code user interface: cursors, member list, status bar, accounts, invite codes |
| `extension/chat-view.js` | Chat view |
| `hub/hub.js` | The hub |
| `hub/start-hub.bat`, `hub/start-hub.sh` | Hub launchers |
| `tools/package-hub.js` | Builds the hub `.zip` |
| `test/` | Automated tests |

## License

Released under the [MIT](LICENSE) license.
