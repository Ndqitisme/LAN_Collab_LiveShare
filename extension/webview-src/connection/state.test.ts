import { describe, expect, it } from 'vitest';
import {
  actionLabel,
  diagSummary,
  firewallPort,
  hubAddress,
  splitHostPort,
  stepActions,
  stepRows,
  STEPS,
  statusView,
  validateForm,
  type Conn,
  type Diagnosis,
  type Status,
  type StepResult,
} from './state';
import catalogJson from '../../i18n/vi.json?raw';

const catalog: Record<string, string> = JSON.parse(catalogJson);

// The webview's t() over the entries the host posts: an unknown id here would come back as the id in the panel.
function t(id: string, args?: Record<string, string | number>): string {
  const text = catalog[id];
  if (typeof text !== 'string') throw new Error(`no catalog entry ${id}`);
  return args ? text.replace(/\{(\w+)\}/g, (m, k: string) => (k in args ? String(args[k]) : m)) : text;
}

const result = (step: StepResult['step'], status: StepResult['status'], code: string | null = null, actions: string[] = [], data: Record<string, unknown> = {}): StepResult => ({
  step,
  status,
  code,
  data,
  remedy: code ? { text: `remedy ${code}`, actions } : null,
});

const diag = (results: StepResult[], running = false): Diagnosis => ({ running, results, at: 1 });

// Remedy action ids as lib/diagnostics.js remedyFor gives them (lib/connection-machine.js actionsFor without
// diagnose), with the step that reports each code.
const FIXTURE: [string, StepResult['step'], string[], Record<string, unknown>, string[]][] = [
  ['refused', 'network', ['reconnect'], { host: '10.0.0.1', port: 8201 }, ['retry', 'rediscover', 'firewall']],
  ['timeout', 'network', ['reconnect'], { host: '192.0.2.1', port: 8200 }, ['retry', 'rediscover', 'firewall']],
  ['unreachable', 'network', ['reconnect'], { host: '10.9.9.9', port: 8200 }, ['retry', 'rediscover']],
  ['failed', 'network', ['reconnect'], {}, ['retry', 'rediscover']],
  ['not_found', 'discovery', ['reconnect'], { discoveryPort: 8201 }, ['retry', 'rediscover', 'firewall']],
  ['token_invalid', 'handshake', ['paste_invite', 'enter_token'], {}, ['paste_invite', 'enter_token']],
  ['project_unknown', 'handshake', ['choose_project', 'paste_invite'], { projects: ['Demo'] }, ['choose_project', 'paste_invite']],
  ['project_unknown', 'handshake', ['paste_invite'], { projects: [] }, ['paste_invite']],
  ['account_required', 'handshake', ['sign_in'], {}, ['sign_in']],
  ['account_denied', 'handshake', ['copy_entry', 'switch_account'], { entry: 'github:an' }, ['copy_entry', 'switch_account']],
  ['tls_mismatch', 'tls', ['paste_invite'], {}, ['paste_invite']],
  ['protocol_version', 'handshake', ['update_extension'], { proto: 2, hubMin: 3 }, ['update_extension']],
  ['protocol_version', 'handshake', ['reconnect'], { proto: 2, hubMin: 1 }, ['retry']],
  ['unbound', 'config', ['join', 'open_settings'], {}, ['paste_invite', 'open_settings']],
  ['no_folder', 'config', ['join'], {}, ['paste_invite']],
  ['no_reply', 'handshake', ['reconnect'], {}, ['retry']],
  ['folder_readonly', 'folder', ['reconnect'], { path: 'C:/p' }, ['retry']],
  ['folder_other_project', 'folder', ['join'], { path: 'C:/p' }, ['paste_invite']],
];

describe('stepRows', () => {
  it('lists every step in order as waiting before a run', () => {
    const rows = stepRows(diag([]), t);
    expect(rows.map((r) => r.step)).toEqual([...STEPS]);
    expect(rows.every((r) => r.state === 'pending' && r.label === 'Chờ' && !r.actions.length && r.remedy === null)).toBe(true);
    expect(rows.map((r) => r.title)).toEqual([
      'Cấu hình thư mục',
      'Kết nối tới địa chỉ đã biết',
      'Tìm LAN Hub trong mạng LAN',
      'Đường mạng tới LAN Hub',
      'Vân tay TLS',
      'Phiên bản, dự án, token và tài khoản',
      'Thư mục dự án',
      'Độ trễ tới LAN Hub',
    ]);
  });

  it('marks the step after the last result as running while the run streams', () => {
    const rows = stepRows(diag([result('config', 'ok'), result('addresses', 'ok', null, [], { host: '10.0.0.1', port: 8200 })], true), t);
    expect(rows.map((r) => r.state)).toEqual(['ok', 'ok', 'running', 'pending', 'pending', 'pending', 'pending', 'pending']);
    expect(rows[2].label).toBe('Đang kiểm tra');
    expect(rows[2].tone).toBe('accent');
    expect(rows[1].remedy).toBe('LAN Hub trả lời tại 10.0.0.1:8200.');
  });

  it('renders each status with its label, tone, guidance and actions', () => {
    const rows = stepRows(diag([
      result('config', 'ok'),
      result('addresses', 'failed', 'refused', ['reconnect'], { host: '10.0.0.1', port: 8200 }),
      result('discovery', 'fixed', null, [], { host: '10.0.0.7', port: 8200 }),
      result('network', 'ok'),
      result('tls', 'skipped'),
      result('handshake', 'failed', 'token_invalid', ['paste_invite', 'enter_token']),
      result('folder', 'skipped'),
      result('rtt', 'skipped'),
    ]), t);
    const by = Object.fromEntries(rows.map((r) => [r.step, r]));
    expect([by.config.label, by.config.tone, by.config.remedy]).toEqual(['Đạt', 'ok', null]);
    expect([by.discovery.label, by.discovery.tone, by.discovery.remedy]).toEqual(['Đã tự khắc phục', 'warn', 'Đã tìm thấy LAN Hub tại địa chỉ mới 10.0.0.7:8200 và lưu địa chỉ này.']);
    expect([by.handshake.label, by.handshake.tone, by.handshake.remedy]).toEqual(['Không đạt', 'danger', 'remedy token_invalid']);
    expect(by.handshake.actions).toEqual([{ id: 'paste_invite', label: 'Dán mã mời mới' }, { id: 'enter_token', label: 'Nhập token' }]);
    expect([by.tls.label, by.tls.tone, by.tls.actions]).toEqual(['Bỏ qua', 'muted', []]);
    expect([by.addresses.remedy, by.addresses.actions]).toEqual(['remedy refused', []]);
  });

  it('puts the actions on the failure that stopped the run and shows repeated guidance once', () => {
    const rows = stepRows(diag([
      result('config', 'ok'),
      result('addresses', 'failed', 'refused', ['reconnect'], { host: '10.0.0.1', port: 8200 }),
      result('discovery', 'failed', 'not_found', ['reconnect'], { discoveryPort: 8201 }),
      result('network', 'failed', 'refused', ['reconnect'], { host: '10.0.0.1', port: 8200 }),
      result('tls', 'skipped'),
    ]), t);
    const by = Object.fromEntries(rows.map((r) => [r.step, r]));
    expect([by.addresses.remedy, by.addresses.actions]).toEqual([null, []]);
    expect([by.discovery.remedy, by.discovery.actions]).toEqual(['remedy not_found', []]);
    expect(by.network.remedy).toBe('remedy refused');
    expect(by.network.actions.map((a) => a.label)).toEqual(['Thử lại', 'Tìm lại LAN Hub', 'Hướng dẫn mở tường lửa']);
    expect(diagSummary(diag([result('addresses', 'failed', 'refused', ['reconnect']), result('network', 'failed', 'refused', ['reconnect'])]), t)).toBe('Bước "Đường mạng tới LAN Hub" không đạt.');
  });

  it('shows the guidance of a skipped step that carries a code, without actions', () => {
    const [row] = stepRows(diag([result('discovery', 'skipped', 'no_instance', ['paste_invite'])]), t).filter((r) => r.step === 'discovery');
    expect(row.remedy).toBe('remedy no_instance');
    expect(row.actions).toEqual([]);
  });

  it('shows the round trip of the last step', () => {
    const rows = stepRows(diag([result('rtt', 'ok', null, [], { ms: 3, source: 'live' })]), t);
    expect(rows.find((r) => r.step === 'rtt')?.remedy).toBe('3 ms');
  });
});

describe('stepActions per error code', () => {
  it.each(FIXTURE)('%s at step %s: remedy %j becomes the panel actions', (code, step, remedy, data, want) => {
    expect(stepActions(result(step, 'failed', code, remedy, data))).toEqual(want);
  });

  it('gives every panel action its own caption', () => {
    const ids = new Set(FIXTURE.flatMap((f) => f[4]));
    const labels = [...ids].map((id) => actionLabel(id, t));
    expect(labels).not.toContain('Chẩn đoán');
    expect(new Set(labels).size).toBe(ids.size);
    expect(actionLabel('retry', t)).toBe('Thử lại');
    expect(actionLabel('rediscover', t)).toBe('Tìm lại LAN Hub');
    expect(actionLabel('firewall', t)).toBe('Hướng dẫn mở tường lửa');
    expect(actionLabel('sign_in', t)).toBe('Đăng nhập');
    expect(actionLabel('choose_project', t)).toBe('Chọn dự án');
    expect(actionLabel('paste_invite', t)).toBe('Dán mã mời mới');
  });

  it('offers nothing for a step that passed', () => {
    expect(stepActions(result('network', 'ok'))).toEqual([]);
  });
});

describe('diagSummary', () => {
  it('names the first failed step, or says every step passed', () => {
    expect(diagSummary(diag([]), t)).toBeNull();
    expect(diagSummary(diag([], true), t)).toBe('Đang chẩn đoán kết nối');
    expect(diagSummary(diag([result('config', 'ok'), result('network', 'failed', 'refused', ['reconnect'])]), t)).toBe('Bước "Đường mạng tới LAN Hub" không đạt.');
    expect(diagSummary(diag([result('config', 'ok'), result('discovery', 'fixed', null, [], { host: 'h', port: 1 })]), t)).toBe('Mọi bước đều đạt.');
  });
});

describe('statusView', () => {
  const status = (name: string, extra: Partial<Status> = {}): Status => ({ name, target: null, code: null, reason: null, nextAt: null, wasLive: false, rtt: null, members: null, ...extra });

  it('labels every machine state', () => {
    const labels = ['idle', 'resolving', 'connecting', 'handshaking', 'syncing', 'live', 'reconnecting', 'needs_action', 'stopped'].map((n) => {
      const v = statusView(status(n), t);
      return `${n}:${v.dot}:${v.label}`;
    });
    expect(labels).toEqual([
      'idle:idle:Chưa kết nối',
      'resolving:connecting:Đang tìm LAN Hub',
      'connecting:connecting:Đang kết nối',
      'handshaking:connecting:Đang kết nối',
      'syncing:connecting:Đang đồng bộ',
      'live:live:Đã kết nối',
      'reconnecting:error:Đang kết nối lại',
      'needs_action:error:Cần xử lý',
      'stopped:offline:Đã ngắt kết nối',
    ]);
  });

  it('gives the reason of needs_action and the next attempt of reconnecting', () => {
    expect(statusView(status('needs_action', { reason: 'LAN Hub từ chối token của máy này.' }), t).detail).toBe('LAN Hub từ chối token của máy này.');
    const at = new Date(2026, 10, 7, 9, 5, 30).getTime();
    expect(statusView(status('reconnecting', { nextAt: at }), t).detail).toBe(`Thử lại lúc ${new Date(at).toLocaleTimeString('vi-VN')}.`);
    expect(statusView(status('reconnecting'), t).detail).toBeNull();
  });
});

describe('forms and helpers', () => {
  it('validates the address, port and project', () => {
    expect(validateForm({ host: '192.168.1.10', port: '8200', project: 'Demo' }, t)).toEqual({});
    expect(validateForm({ host: ' ', port: '0', project: '' }, t)).toEqual({
      host: 'Nhập địa chỉ IP hoặc tên máy của LAN Hub.',
      port: 'Cổng là số từ 1 đến 65535.',
      project: 'Nhập tên dự án.',
    });
    expect(validateForm({ host: '10.0.0.1:8200', port: '65536', project: 'x' }, t)).toEqual({ host: 'Nhập địa chỉ IP hoặc tên máy của LAN Hub.', port: 'Cổng là số từ 1 đến 65535.' });
    expect(validateForm({ host: 'hub', port: '82a0', project: 'x' }, t).port).toBe('Cổng là số từ 1 đến 65535.');
  });

  it('splits a pasted address with its port', () => {
    expect(splitHostPort('192.168.1.10:8200')).toEqual({ host: '192.168.1.10', port: '8200' });
    expect(splitHostPort('192.168.1.10')).toEqual({ host: '192.168.1.10', port: null });
  });

  it('shows a hub by its LAN address before loopback', () => {
    const hub = { instanceId: 'I', hubName: 'h', port: 8200, tls: false, projects: [] };
    expect(hubAddress({ ...hub, hosts: ['127.0.0.1', '192.168.1.10'] })).toBe('192.168.1.10:8200');
    expect(hubAddress({ ...hub, hosts: ['127.0.0.1'] })).toBe('127.0.0.1:8200');
  });

  it('opens the port the failing step tried in the firewall guide, else the folder port', () => {
    const conn: Conn = { source: 'join', host: 'h', addresses: ['h'], port: 9000, project: 'p', fingerprint: null, instanceId: null, hasToken: true };
    expect(firewallPort(diag([result('network', 'failed', 'refused', ['reconnect'], { host: 'h', port: 8299 })]), conn)).toBe(8299);
    expect(firewallPort(diag([]), conn)).toBe(9000);
    expect(firewallPort(diag([]), null)).toBe(8200);
  });

  it('fills the PowerShell command with the real ports', () => {
    expect(t('connection.firewall.command', { port: 8299, discoveryPort: 8201 })).toBe(
      'New-NetFirewallRule -DisplayName "LAN Hub TCP 8299" -Direction Inbound -Protocol TCP -LocalPort 8299 -Action Allow\n'
      + 'New-NetFirewallRule -DisplayName "LAN Hub UDP 8201" -Direction Inbound -Protocol UDP -LocalPort 8201 -Action Allow',
    );
  });
});
