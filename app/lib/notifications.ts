// lib/notifications.ts
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';

// uid별 키
const k = (base: string, uid: string) => `${base}_${uid}`;
const NOTI_IDS_KEY_BASE = 'routineNotiIdsV1';

type RoutineNoti = { id: string; planId: string };

/* ──────────────────────────────
 * 권한 보장 (원래 네 함수)
 * ────────────────────────────── */
export async function ensurePermission() {
  if (!Device.isDevice) return false;
  const { status } = await Notifications.getPermissionsAsync();
  if (status !== 'granted') {
    const req = await Notifications.requestPermissionsAsync();
    return req.status === 'granted';
  }
  return true;
}

/** "HH:MM" → 오늘/내일 Date 객체 */
export function buildTodayOrNextTime(hhmm: string) {
  const [h, m] = hhmm.split(':').map((n) => parseInt(n, 10));
  const now = new Date();
  const d = new Date();
  d.setHours(h || 0, m || 0, 0, 0);
  if (d.getTime() <= now.getTime()) d.setDate(d.getDate() + 1);
  return d;
}

/** 예약된 알림 확인용 */
export async function listScheduled() {
  return Notifications.getAllScheduledNotificationsAsync();
}

/* ──────────────────────────────
 * 단발 예약 (특정 날짜/시간)
 * ────────────────────────────── */
export async function scheduleOneShotAt(
  uid: string,
  planId: string,
  when: Date,
  title: string,
  body: string
) {
  const ok = await ensurePermission();
  if (!ok) throw new Error('알림 권한이 없습니다.');

  const trigger = {
    // Expo Date trigger
    date: when,
  } as Notifications.DateTriggerInput;

  const id = await Notifications.scheduleNotificationAsync({
    content: { title, body, sound: 'default' },
    trigger,
  });

  await saveId(uid, { id, planId });
  return id;
}

/* ──────────────────────────────
 * 매주 반복 예약 (weekdayKo: 1=월 ~ 7=일)
 * ────────────────────────────── */
export async function scheduleWeekly(
  uid: string,
  planId: string,
  weekdayKo: number,
  hour: number,
  minute: number,
  title: string,
  body: string
) {
  const ok = await ensurePermission();
  if (!ok) throw new Error('알림 권한이 없습니다.');

  const expoWeekday = mapWeekday(weekdayKo); // Expo: 1=일 ~ 7=토
  const trigger = {
    repeats: true,
    weekday: expoWeekday as 1 | 2 | 3 | 4 | 5 | 6 | 7,
    hour,
    minute,
  } as Notifications.CalendarTriggerInput;

  const id = await Notifications.scheduleNotificationAsync({
    content: { title, body, sound: 'default' },
    trigger,
  });

  await saveId(uid, { id, planId });
  return id;
}

/* ──────────────────────────────
 * 요일 변환: 1=월 → Expo는 1=일
 * ────────────────────────────── */
function mapWeekday(weekdayKo: number) {
  const map: Record<number, number> = { 1: 2, 2: 3, 3: 4, 4: 5, 5: 6, 6: 7, 7: 1 };
  return map[weekdayKo] ?? 2;
}

/* ──────────────────────────────
 * 저장소 관련
 * ────────────────────────────── */
async function saveId(uid: string, item: RoutineNoti) {
  const key = k(NOTI_IDS_KEY_BASE, uid);
  const raw = (await AsyncStorage.getItem(key)) || '[]';
  const arr: RoutineNoti[] = JSON.parse(raw);
  arr.push(item);
  await AsyncStorage.setItem(key, JSON.stringify(arr));
}

export async function cancelByPlanId(uid: string, planId: string) {
  const key = k(NOTI_IDS_KEY_BASE, uid);
  const raw = (await AsyncStorage.getItem(key)) || '[]';
  const arr: RoutineNoti[] = JSON.parse(raw);

  const keep: RoutineNoti[] = [];
  for (const it of arr) {
    if (it.planId === planId) {
      try {
        await Notifications.cancelScheduledNotificationAsync(it.id);
      } catch {}
    } else {
      keep.push(it);
    }
  }
  await AsyncStorage.setItem(key, JSON.stringify(keep));
}

export async function cancelAll(uid: string) {
  await Notifications.cancelAllScheduledNotificationsAsync();
  await AsyncStorage.setItem(k(NOTI_IDS_KEY_BASE, uid), JSON.stringify([]));
}

/* ──────────────────────────────
 * 🔁 호환용 래퍼 (planner.tsx가 기대하는 이름)
 *  - import를 바꾸지 않아도 되도록 동일 이름을 export
 * ────────────────────────────── */

/** 기존 ensureNotificationSetup 대신 사용 가능 */
export async function ensureNotificationSetup() {
  const ok = await ensurePermission();
  return ok ? { ok: true as const } : { ok: false as const, reason: 'permission-denied' as const };
}

/**
 * 기존 scheduleNextOccurrence(weekday: 0=일~6=토) 호환
 * → "다음 해당 요일/시:분"에 **한 번만** 울리도록 단발 예약
 */
export async function scheduleNextOccurrence(opts: {
  uid: string;
  planId: string;
  title: string;
  body: string;
  weekday: number; // 0(Sun) ~ 6(Sat)
  hour: number;
  minute: number;
}) {
  const { uid, planId, title, body, weekday, hour, minute } = opts;

  // 지금 시각 기준으로 다음 해당 요일 구하기
  const now = new Date();
  const next = new Date(now);
  const diff = (weekday - now.getDay() + 7) % 7;
  next.setDate(now.getDate() + diff);
  next.setHours(hour, minute, 0, 0);
  if (diff === 0 && next.getTime() <= now.getTime()) {
    next.setDate(next.getDate() + 7);
  }

  return scheduleOneShotAt(uid, planId, next, title, body);
}

/** 기존 cancelScheduledByPlanId 이름 호환 */
export async function cancelScheduledByPlanId(uid: string, planId: string) {
  return cancelByPlanId(uid, planId);
}
