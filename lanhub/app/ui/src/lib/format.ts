import { num, t } from '../i18n';

/** "Vừa xong", "3 phút trước", "2 giờ trước", "4 ngày trước", or "Chưa có". */
export function ago(ms: number | null, now: number): string {
  if (!ms) return t('time.never');
  const minutes = Math.floor(Math.max(0, now - ms) / 60000);
  if (minutes < 1) return t('time.justNow');
  if (minutes < 60) return t('time.minutes', { n: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t('time.hours', { n: hours });
  return t('time.days', { n: Math.floor(hours / 24) });
}

const clockTime = new Intl.DateTimeFormat('vi-VN', { hour: '2-digit', minute: '2-digit' });
const dateTime = new Intl.DateTimeFormat('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' });

/** "14:05" today, "14:05 07/11" on another day. */
export function when(ms: number, now: number): string {
  const sameDay = new Date(ms).toDateString() === new Date(now).toDateString();
  return (sameDay ? clockTime : dateTime).format(ms);
}

/** "D:\…\clients\web-portal": the drive and the last two folders of a long path; the full path goes in a title. */
export function shortPath(p: string): string {
  const parts = p.split(/[\\/]/).filter(Boolean);
  if (parts.length <= 4) return p;
  const sep = p.includes('\\') ? '\\' : '/';
  return [parts[0], '…', ...parts.slice(-2)].join(sep);
}

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'];

/** "0 B", "512 KB", "1,4 MB": binary multiples, one decimal from MB up. */
export function bytes(n: number): string {
  let i = 0;
  while (n >= 1024 && i < UNITS.length - 1) {
    n /= 1024;
    i++;
  }
  return `${num(i >= 2 ? Math.round(n * 10) / 10 : Math.round(n))} ${UNITS[i]}`;
}
