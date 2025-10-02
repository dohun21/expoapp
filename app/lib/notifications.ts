// lib/notifications.ts
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';

const k = (base: string, uid: string) => `${base}_${uid}`;
const NOTI_IDS_KEY_BASE = 'routineNotiIdsV1';

type RoutineNoti = { id: string; planId: string };

/* ───────── 권한 보장 ───────── */
export async function ensurePermission() {
  if (!Device.isDevice) return false;
  const { status } = await Notifications.getPermissionsAsync();
  if (status !== 'granted') {
    const req = await Notifications.requestPermissionsAsync();
    if (req.status !== 'granted') return false;
  }
  // ANDROID: 채널 보장
  try {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'Default',
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  } catch {}
  return true;
}

/* ───────── 유틸 ───────── */
const pad2 = (n: number) => String(n).padStart(2, '0');

/** 우리 요일(1=월..7=일) → Expo(1=일..7=토) */
function mapWeekday(weekdayKo: number) {
  const map: Record<number, number> = { 1: 2, 2: 3, 3: 4, 4: 5, 5: 6, 6: 7, 7: 1 };
  return (map[weekdayKo] ?? 2) as 1 | 2 | 3 | 4 | 5 | 6 | 7;
}

/** 오늘/해당 요일/시간이 ‘이미 지남’인지 판단해서, 지났다면 다음주로 간주하도록 flag 반환 */
function shouldSkipThisWeek(hhmm: string, weekdayKo: number) {
  const [h, m] = hhmm.split(':').map((n) => parseInt(n, 10));
  const now = new Date();
  const jsToday = now.getDay(); // 0=일..6=토
  const jsTarget = weekdayKo === 7 ? 0 : weekdayKo; // 7(일)→0

  const isToday = jsToday === jsTarget;
  if (!isToday) return false;

  // 오늘이고, 이미 지난 시각(= now >= HH:MM:00)이면 이번 주는 스킵(→ 자동으로 다음 주에 울림)
  if (now.getHours() > h) return true;
  if (now.getHours() === h && now.getMinutes() >= m) return true;
  return false;
}

/* ───────── 예약 조회/저장 ───────── */
async function loadIds(uid: string): Promise<RoutineNoti[]> {
  const raw = (await AsyncStorage.getItem(k(NOTI_IDS_KEY_BASE, uid))) || '[]';
  try { return JSON.parse(raw) as RoutineNoti[]; } catch { return []; }
}
async function saveIds(uid: string, arr: RoutineNoti[]) {
  await AsyncStorage.setItem(k(NOTI_IDS_KEY_BASE, uid), JSON.stringify(arr));
}

/* ───────── 단발 예약 ───────── */
export async function scheduleOneShotAt(
  uid: string,
  planId: string,
  when: Date,
  title: string,
  body: string
) {
  const ok = await ensurePermission();
  if (!ok) throw new Error('알림 권한이 없습니다.');

  const id = await Notifications.scheduleNotificationAsync({
    content: { title, body, sound: 'default', data: { planId } },
    trigger: { date: when } as Notifications.DateTriggerInput,
  });

  const prev = await loadIds(uid);
  prev.push({ id, planId });
  await saveIds(uid, prev);
  return id;
}

/* ───────── 주간 반복(단일 요일) ───────── */
export async function scheduleWeekly(
  uid: string,
  planId: string,
  weekdayKo: number, // 1=월..7=일
  hour: number,
  minute: number,
  title: string,
  body: string
) {
  const ok = await ensurePermission();
  if (!ok) throw new Error('알림 권한이 없습니다.');

  // 중복 방지
  await cancelByPlanId(uid, planId);

  const expoWeekday = mapWeekday(weekdayKo);
  const hhmm = `${pad2(hour)}:${pad2(minute)}`;
  const skipThisWeek = shouldSkipThisWeek(hhmm, weekdayKo);

  const id = await Notifications.scheduleNotificationAsync({
    content: { title, body, sound: 'default', data: { planId } },
    trigger: {
      repeats: true,
      // 반복 트리거는 “다음 해당 요일/시간”을 향합니다.
      // 오늘이고 이미 지난 시각이면 자동으로 다음 주에 울리도록 second만 0으로 고정.
      weekday: expoWeekday,
      hour,
      minute,
      second: 0,
      // startDate는 사용하지 않음(타입 호환 이슈 회피)
      // iOS/Android 모두: 이미 지난 시간으로 등록해도 '즉시 발사'가 아니라 다음 occurrence로 이동합니다.
    } as Notifications.CalendarTriggerInput,
  });

  const prev = await loadIds(uid);
  prev.push({ id, planId });
  await saveIds(uid, prev);

  return { id, skippedThisWeek: skipThisWeek };
}

/* ───────── 주간 반복(여러 요일) ───────── */
export async function scheduleWeeklyMulti(params: {
  uid: string;
  planId: string;
  weekdaysKo: number[]; // 1=월..7=일
  hhmm: string;         // "HH:MM"
  title: string;
  body?: string;
}) {
  const { uid, planId, weekdaysKo, hhmm, title } = params;
  const body = params.body ?? '설정한 루틴을 실행할 시간이에요.';
  const ok = await ensurePermission();
  if (!ok) throw new Error('알림 권한이 없습니다.');

  // 중복 방지: 같은 planId로 잡힌 예약 제거
  await cancelByPlanId(uid, planId);

  const [hour, minute] = hhmm.split(':').map((n) => parseInt(n, 10));
  const created: RoutineNoti[] = [];

  for (const w of weekdaysKo) {
    const expoWeekday = mapWeekday(w);

    // 오늘·과거시간이면 이번 주는 자동 skip(→다음 주 첫 울림)
    // 별도 startDate 없이도 반복 트리거는 다음 occurrence를 향합니다.
    const id = await Notifications.scheduleNotificationAsync({
      content: { title, body, sound: 'default', data: { planId } },
      trigger: {
        repeats: true,
        weekday: expoWeekday,
        hour,
        minute,
        second: 0,
      } as Notifications.CalendarTriggerInput,
    });

    created.push({ id, planId });
  }

  const prev = await loadIds(uid);
  await saveIds(uid, [...prev, ...created]);
  return created.map((c) => c.id);
}

/* ───────── 취소 ───────── */
export async function cancelByPlanId(uid: string, planId: string) {
  const arr = await loadIds(uid);
  const keep: RoutineNoti[] = [];
  for (const it of arr) {
    if (it.planId === planId) {
      try { await Notifications.cancelScheduledNotificationAsync(it.id); } catch {}
    } else {
      keep.push(it);
    }
  }
  await saveIds(uid, keep);
}
export async function cancelAll(uid: string) {
  await Notifications.cancelAllScheduledNotificationsAsync();
  await saveIds(uid, []);
}

/* ───────── 호환 래퍼 ───────── */
export async function ensureNotificationSetup() {
  const ok = await ensurePermission();
  return ok ? { ok: true as const } : { ok: false as const, reason: 'permission-denied' as const };
}

export async function scheduleNextOccurrence(opts: {
  uid: string;
  planId: string;
  title: string;
  body: string;
  weekday: number; // 0=일..6=토
  hour: number;
  minute: number;
}) {
  const { uid, planId, title, body, weekday, hour, minute } = opts;

  const now = new Date();
  const next = new Date(now);
  const diff = (weekday - now.getDay() + 7) % 7;
  next.setDate(now.getDate() + diff);
  next.setHours(hour, minute, 0, 0);
  if (diff === 0 && next.getTime() <= now.getTime()) next.setDate(next.getDate() + 7);

  return scheduleOneShotAt(uid, planId, next, title, body);
}

export async function cancelScheduledByPlanId(uid: string, planId: string) {
  return cancelByPlanId(uid, planId);
}

/* ───────── 참고: 디버그용 ───────── */
export async function listScheduled() {
  return Notifications.getAllScheduledNotificationsAsync();
}
