import { ensure } from '../domain/attendance.js';

// Browser day type: 1 = same day, 2 = next day. Previous-day input is unsupported.
export function timeParts(value: string) {
  ensure(/^\d{2}:\d{2}$/.test(value), '時刻の形式が不正です。');
  const [hour, minute] = value.split(':').map(Number);
  ensure(hour <= 47 && minute < 60, '時刻が範囲外です。');
  return { dayType: hour >= 24 ? '2' : '1', hour: String(hour % 24).padStart(2, '0'), minute: String(minute).padStart(2, '0') };
}
export function readTimeParts(dayType: string, hour: string, minute: string): string {
  ensure(dayType === '1' || dayType === '2', '前日または不明な時間タイプは自動処理できません。');
  if (!hour && !minute) return '';
  ensure(/^\d{1,2}$/.test(hour) && /^\d{1,2}$/.test(minute) && Number(hour) < 24 && Number(minute) < 60, '時分が未確定または範囲外です。');
  return `${String(Number(hour) + (dayType === '2' ? 24 : 0)).padStart(2, '0')}:${minute.padStart(2, '0')}`;
}
export function decimalParts(value: string) {
  ensure(/^\d{1,3}\.\d{2}$/.test(value), '休憩は小数時間2桁で指定してください。');
  const [hour, fraction] = value.split('.');
  return { hour, fraction };
}
export function readDecimalParts(hour: string, fraction: string): string {
  if (!hour && !fraction) return '';
  ensure(/^\d{1,3}$/.test(hour) && /^\d{2}$/.test(fraction), '小数時間の入力が未確定です。');
  return `${hour}.${fraction}`;
}
