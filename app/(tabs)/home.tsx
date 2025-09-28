// app/home/index.tsx
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect } from '@react-navigation/native';
import { useRouter } from 'expo-router';
import { onAuthStateChanged } from 'firebase/auth';
import { collection, getDocs, query, where } from 'firebase/firestore';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  AppState,
  AppStateStatus,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { auth, db } from '../../firebaseConfig';

/* ----------------------------------------------------
 * 키 / 타입
 * --------------------------------------------------*/
const k = (base: string, uid: string) => `${base}_${uid}`;
const MEMO_KEY_BASE = 'todayMemo';
const PLANS_KEY_BASE = 'todayPlans';
const GOAL_KEY_BASE = 'todayGoalMinutes';
const START_NOW_KEY_BASE = 'startNow';
const RUN_EVENTS_KEY_BASE = 'routineRunEventsV2';
const LAST_SETUP_DATE_KEY_BASE = 'lastSetupLogicalDateKST';
const DAY_START_OFFSET_KEY_BASE = 'dayStartOffsetMin';
const WEEKLY_KEY_BASE = 'weeklyPlannerV1';
const ROUTINE_LIBRARY_KEY_BASE = 'routineLibraryV1';
const DAILY_STATUS_KEY_BASE = 'homeDailyStatusV1';

const LEGACY_MEMO_KEY = MEMO_KEY_BASE;
const LEGACY_PLANS_KEY = PLANS_KEY_BASE;
const LEGACY_GOAL_KEY = GOAL_KEY_BASE;

const DEFAULT_DAY_START_MIN = 240;

type Priority = '필수' | '중요' | '선택';
type Plan = { id: string; content: string; priority: Priority; done: boolean; createdAt: string };

type Step = { step: string; minutes: number };
type RoutinePreset = {
  id: string;
  title: string;
  steps: Step[];
  tags: string[];
  origin: 'preset' | 'user';
};
type RunEvent = { id?: string; title?: string; usedAt: string };
type Repeatable = RoutinePreset & { runCount: number; lastUsed?: string };

type WeeklyPlanItem = {
  planId: string;
  routineId: string;
  setCount?: number;
  note?: string;
  title?: string;
  steps?: Step[];
  tags?: string[];
  startAt?: string;
  done?: boolean;
  doneAt?: string;
  completedAt?: string;
  finishedAt?: string;
  doneYmd?: string;
  completedYmd?: string;
  lastRunAt?: string;
  doneSets?: number;
  progressCount?: number;
};

/* ----------------------------------------------------
 * KST 유틸
 * --------------------------------------------------*/
function getTodayKSTDate() {
  const now = new Date();
  const utcMs = now.getTime() + now.getTimezoneOffset() * 60000;
  return new Date(utcMs + 9 * 3600000);
}
function getTodayKSTDateString() {
  const kst = getTodayKSTDate();
  const y = kst.getFullYear();
  const m = String(kst.getMonth() + 1).padStart(2, '0');
  const d = String(kst.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
function getLogicalDateStringKST(offsetMin: number) {
  const kst = getTodayKSTDate();
  const shifted = new Date(kst.getTime() - (offsetMin || 0) * 60000);
  const y = shifted.getFullYear();
  const m = String(shifted.getMonth() + 1).padStart(2, '0');
  const d = String(shifted.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
const eqYmd = (a?: string | null, b?: string | null) => !!a && !!b && String(a) === String(b);
const sameDayEither = (last: string | null, logical: string, kst: string) =>
  eqYmd(last, logical) || eqYmd(last, kst);

function toDateSafe(v: any): Date {
  if (!v) return new Date(0);
  if (v instanceof Date) return v;
  if (typeof v?.toDate === 'function') return v.toDate();
  const d = new Date(v as any);
  return isNaN(d.getTime()) ? new Date(0) : d;
}
function pickDate(obj: any): Date {
  const cands = ['createdAt', 'completedAt', 'endedAt', 'timestamp', 'date', 'updatedAt'];
  for (const key of cands) {
    const v = obj?.[key];
    if (v) return toDateSafe(v);
  }
  return new Date(0);
}
function daysDiff(fromYmd: string, toYmd: string) {
  const [fy, fm, fd] = fromYmd.split('-').map(Number);
  const [ty, tm, td] = toYmd.split('-').map(Number);
  const from = new Date(fy, fm - 1, fd);
  const to = new Date(ty, tm - 1, td);
  return Math.round((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24));
}
function kstLogicalRange(offsetMin: number) {
  const nowKst = getTodayKSTDate();
  const logical = new Date(nowKst.getTime() - (offsetMin || 0) * 60000);
  const y = logical.getFullYear();
  const m = logical.getMonth();
  const d = logical.getDate();
  const msPerMin = 60000;
  const msPerHr = 3600000;
  const startKst = new Date(y, m, d, 0, 0, 0, 0);
  const startUtcMs = startKst.getTime() - 9 * msPerHr + (offsetMin || 0) * msPerMin;
  const endUtcMs = startUtcMs + 24 * 60 * msPerMin;
  return {
    startUtc: new Date(startUtcMs),
    endUtc: new Date(endUtcMs),
    ymd: `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`,
  };
}

/* ----------------------------------------------------
 * 합산/프리셋
 * --------------------------------------------------*/
function secondsFromStudy(r: any): number {
  if (typeof r?.totalSeconds === 'number') return r.totalSeconds;
  if (typeof r?.studySeconds === 'number') return r.studySeconds;
  if (typeof r?.seconds === 'number') return r.seconds;
  if (typeof r?.totalMinutes === 'number') return r.totalMinutes * 60;
  if (typeof r?.minutes === 'number') return r.minutes * 60;
  const s = r?.studyTime ?? '';
  const h = Number(s.match(/(\d+)\s*시간/)?.[1] ?? 0);
  const m = Number(s.match(/(\d+)\s*분/)?.[1] ?? 0);
  const sc = Number(s.match(/(\d+)\s*초/)?.[1] ?? 0);
  return h * 3600 + m * 60 + sc;
}
function secondsFromRoutine(r: any): number {
  if (typeof r?.totalSeconds === 'number') return r.totalSeconds;
  if (typeof r?.totalMinutes === 'number') return r.totalMinutes * 60;
  const sets = typeof r?.setCount === 'number' ? r.setCount : 1;
  const sumMinutes = (r?.steps ?? []).reduce((a: number, s: any) => a + (s?.minutes ?? 0), 0);
  return sumMinutes * sets * 60;
}
function serializeSteps(steps: Step[]) {
  return steps
    .map((s) =>
      `${(s.step || '')
        .replace(/\|/g, ' ')
        .replace(/,/g, ' ')
        .replace(/\n/g, ' ')
        .trim()},${Math.max(0, Math.floor(s.minutes || 0))}`,
    )
    .join('|');
}
const PRESETS: RoutinePreset[] = [
  { id: 'preset-2', title: '영단어 암기 루틴', steps: [
    { step: '영단어 외우기', minutes: 20 },
    { step: '예문 만들기', minutes: 15 },
    { step: '퀴즈 테스트 해보기 1분', minutes: 10 },
  ], tags: ['#암기'], origin: 'preset' },
  { id: 'preset-3', title: '오답 집중 루틴', steps: [
    { step: '최근 오답 복습', minutes: 20 },
    { step: '비슷한 유형 문제 다시 풀기', minutes: 25 },
    { step: '정답/오답 비교 정리', minutes: 15 },
  ], tags: ['#문제풀이', '#복습정리'], origin: 'preset' },
  { id: 'preset-4', title: '시험 전날 총정리 루틴', steps: [
    { step: '전체 범위 핵심 정리', minutes: 40 },
    { step: '예상 문제 풀기', minutes: 30 },
    { step: '오답 노트 만들기', minutes: 20 },
  ], tags: ['#복습정리'], origin: 'preset' },
  { id: 'preset-20', title: '단어장 복습 루틴', steps: [
    { step: '외운 단어 10개 랜덤 테스트', minutes: 10 },
    { step: '틀린 단어 집중 암기', minutes: 10 },
  ], tags: ['#암기'], origin: 'preset' },
];

/* ----------------------------------------------------
 * 컴포넌트
 * --------------------------------------------------*/
export default function HomePage() {
  const router = useRouter();
  const [uid, setUid] = useState<string | null>(null);

  const [goalMinutes, setGoalMinutes] = useState(0);
  const [studiedSeconds, setStudiedSeconds] = useState(0);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [memo, setMemo] = useState<string>('');

  const [repeatables, setRepeatables] = useState<Repeatable[]>([]);
  const [routineLib, setRoutineLib] = useState<Record<string, RoutinePreset>>({});

  const [todayLabel, setTodayLabel] = useState<string>('오늘');
  const [todayRoutineTotal, setTodayRoutineTotal] = useState(0);
  const [todayRoutineDone, setTodayRoutineDone] = useState(0);

  const dayOffsetRef = useRef<number>(DEFAULT_DAY_START_MIN);
  const lastLogicalDateRef = useRef<string>('');
  const isLaunchingRoutineRef = useRef(false);

  const [goalModalOpen, setGoalModalOpen] = useState(false);
  const [goalHour, setGoalHour] = useState('00');
  const [goalMin, setGoalMin] = useState('00');

  const [planModalOpen, setPlanModalOpen] = useState(false);
  const [newPlanText, setNewPlanText] = useState('');

  const prevAllPlansDoneRef = useRef(false);

  /* ---------- 오늘 메타 ---------- */
  const computeTodayMeta = () => {
    const kst = getTodayKSTDate();
    const dowIdx = (kst.getDay() + 6) % 7;
    const ko = ['월', '화', '수', '목', '금', '토', '일'][dowIdx];
    const dd = String(kst.getDate()).padStart(2, '0');
    setTodayLabel(`${ko} ${dd}`);
  };

  /* ---------- 레거시 마이그레이션 ---------- */
  const migrateLegacySetupKeys = async (_uid: string) => {
    try {
      const [legacyGoal, legacyPlans, legacyMemo] = await Promise.all([
        AsyncStorage.getItem(LEGACY_GOAL_KEY),
        AsyncStorage.getItem(LEGACY_PLANS_KEY),
        AsyncStorage.getItem(LEGACY_MEMO_KEY),
      ]);

      const tasks: Promise<any>[] = [];
      if (legacyGoal !== null) {
        tasks.push(AsyncStorage.setItem(k(GOAL_KEY_BASE, _uid), legacyGoal));
        tasks.push(AsyncStorage.removeItem(LEGACY_GOAL_KEY));
      }
      if (legacyPlans !== null) {
        tasks.push(AsyncStorage.setItem(k(PLANS_KEY_BASE, _uid), legacyPlans));
        tasks.push(AsyncStorage.removeItem(LEGACY_PLANS_KEY));
      }
      if (legacyMemo !== null) {
        tasks.push(AsyncStorage.setItem(k(MEMO_KEY_BASE, _uid), legacyMemo));
        tasks.push(AsyncStorage.removeItem(LEGACY_MEMO_KEY));
      }
      if (tasks.length) await Promise.all(tasks);
    } catch {}
  };

  /* ---------- 오늘 데이터 보유 확인 ---------- */
  const hasAnyTodayLocalData = async (_uid: string) => {
    const [goalStr, plansStr] = await Promise.all([
      AsyncStorage.getItem(k(GOAL_KEY_BASE, _uid)),
      AsyncStorage.getItem(k(PLANS_KEY_BASE, _uid)),
    ]);
    const goal = Number(goalStr || 0);
    let planLen = 0;
    try {
      const parsed = plansStr ? JSON.parse(plansStr) : [];
      planLen = Array.isArray(parsed) ? parsed.length : 0;
    } catch {}
    return goal > 0 || planLen > 0;
  };

  /* ---------- 초기 로딩 ---------- */
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (!user) { setUid(null); return; }
      setUid(user.uid);
      await migrateLegacySetupKeys(user.uid);
      await ensureFreshDayAndLoad(user.uid);
      await computeTodaySeconds(user.uid);
      await computeRepeatables(user.uid);
      computeTodayMeta();
    });
    return unsubscribe;
  }, [router]);

  const loadDayOffset = async (_uid: string) => {
    const raw = await AsyncStorage.getItem(k(DAY_START_OFFSET_KEY_BASE, _uid));
    const v = Number(raw);
    dayOffsetRef.current = Number.isFinite(v) ? v : DEFAULT_DAY_START_MIN;
  };

  const resetForNewLogicalDay = async (_uid: string, todayLogical: string) => {
    await AsyncStorage.multiRemove([
      k(GOAL_KEY_BASE, _uid),
      k(PLANS_KEY_BASE, _uid),
      k(MEMO_KEY_BASE, _uid),
      k(START_NOW_KEY_BASE, _uid),
    ]);
    await AsyncStorage.setItem(k(LAST_SETUP_DATE_KEY_BASE, _uid), todayLogical);
    setGoalMinutes(0);
    setPlans([]);
    setMemo('');
    setStudiedSeconds(0);
  };

  const maybeResetForNewDay = async (_uid: string) => {
    const offset = dayOffsetRef.current;
    const todayLogical = getLogicalDateStringKST(offset);
    const todayKst = getTodayKSTDateString();
    const last = await AsyncStorage.getItem(k(LAST_SETUP_DATE_KEY_BASE, _uid));

    if (!last) {
      await AsyncStorage.setItem(k(LAST_SETUP_DATE_KEY_BASE, _uid), todayLogical);
      lastLogicalDateRef.current = todayLogical;
      return false;
    }
    if (sameDayEither(last, todayLogical, todayKst)) {
      lastLogicalDateRef.current = todayLogical;
      return false;
    }
    if (await hasAnyTodayLocalData(_uid)) {
      await AsyncStorage.setItem(k(LAST_SETUP_DATE_KEY_BASE, _uid), todayLogical);
      lastLogicalDateRef.current = todayLogical;
      return false;
    }
    await resetForNewLogicalDay(_uid, todayLogical);
    lastLogicalDateRef.current = todayLogical;
    return true;
  };

  const loadLocalData = async (_uid: string) => {
    const [goalStr, plansStr, memoStr] = await Promise.all([
      AsyncStorage.getItem(k(GOAL_KEY_BASE, _uid)),
      AsyncStorage.getItem(k(PLANS_KEY_BASE, _uid)),
      AsyncStorage.getItem(k(MEMO_KEY_BASE, _uid)),
    ]);
    if (goalStr !== null) setGoalMinutes(Number(goalStr));
    if (plansStr) {
      try {
        const parsed = JSON.parse(plansStr) as Plan[];
        const sanitized = Array.isArray(parsed)
          ? parsed.map((p) => ({
              id: String(p.id ?? `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`),
              content: String(p.content ?? ''),
              priority: (['필수', '중요', '선택'] as Priority[]).includes(p.priority as Priority)
                ? (p.priority as Priority)
                : '중요',
              done: Boolean(p.done),
              createdAt: String(p.createdAt ?? new Date().toISOString()),
            }))
          : [];
        setPlans(sanitized);
      } catch {
        setPlans([]);
      }
    } else setPlans([]);
    if (typeof memoStr === 'string') setMemo(memoStr);
  };

  const loadRoutineLibrary = async (_uid: string) => {
    try {
      const raw = await AsyncStorage.getItem(k(ROUTINE_LIBRARY_KEY_BASE, _uid));
      const libArr: any[] = raw ? JSON.parse(raw) : [];
      const libMap: Record<string, RoutinePreset> = {};
      if (Array.isArray(libArr)) {
        libArr.forEach((r: any) => {
          if (!r?.id || !r?.title || !Array.isArray(r?.steps)) return;
          libMap[r.id] = {
            id: String(r.id),
            title: String(r.title),
            steps: r.steps.map((s: any) => ({ step: String(s?.step ?? ''), minutes: Number(s?.minutes ?? 0) })),
            tags: Array.isArray(r.tags) ? r.tags.map((t: any) => String(t)) : [],
            origin: 'user',
          };
        });
      }
      PRESETS.forEach((p) => { if (!libMap[p.id]) libMap[p.id] = p; });
      setRoutineLib(libMap);
    } catch {
      const map: Record<string, RoutinePreset> = {};
      PRESETS.forEach((p) => (map[p.id] = p));
      setRoutineLib(map);
    }
  };

  const isItemDoneFromWeekly = (it: WeeklyPlanItem, today: string) => {
    if (it?.done === true) return true;
    const dateKeys = [it?.doneAt, it?.completedAt, it?.finishedAt, it?.doneYmd, it?.completedYmd, it?.lastRunAt]
      .map(v => (v ? String(v) : ''));
    if (dateKeys.some(d => d === today)) return true;
    const sets = Math.max(1, Number(it?.setCount ?? 1));
    const doneSets = Number((it as any)?.doneSets ?? (it as any)?.progressCount ?? 0);
    if (doneSets >= sets) {
      const maybeDate = (it as any)?.doneDate || (it as any)?.progressDate;
      if (!maybeDate || String(maybeDate) === today) return true;
    }
    return false;
  };

  const computeTodayMetaAndLoad = async (_uid: string, raw: any) => {
    try {
      const dayKeys = ['mon','tue','wed','thu','fri','sat','sun'] as const;
      const idx = (getTodayKSTDate().getDay() + 6) % 7;
      const todayKey = dayKeys[idx] as keyof typeof raw;

      const arr: WeeklyPlanItem[] = Array.isArray(raw?.[todayKey]) ? raw[todayKey] : [];
      const total = arr.length;
      if (total === 0) {
        setTodayRoutineTotal(0);
        setTodayRoutineDone(0);
        return;
      }

      const today = getTodayKSTDateString();
      const done = arr.reduce((acc, it) => acc + (isItemDoneFromWeekly(it, today) ? 1 : 0), 0);

      setTodayRoutineTotal(total);
      setTodayRoutineDone(done);
    } catch {
      setTodayRoutineTotal(0);
      setTodayRoutineDone(0);
    }
  };

  const loadWeeklyToday = async (_uid: string) => {
    try {
      // uid → local → 기본 순서로 폴백
      const tryKeys = [
        `${WEEKLY_KEY_BASE}_${_uid}`,
        `${WEEKLY_KEY_BASE}_local`,
        WEEKLY_KEY_BASE,
      ];
      let rawStr: string | null = null;
      for (const key of tryKeys) {
        rawStr = await AsyncStorage.getItem(key);
        if (rawStr) break;
      }
      const raw = rawStr ? JSON.parse(rawStr) : {};
      await computeTodayMetaAndLoad(_uid, raw);
    } catch {
      setTodayRoutineTotal(0);
      setTodayRoutineDone(0);
    }
  };

  const ensureFreshDayAndLoad = async (_uid: string) => {
    await loadDayOffset(_uid);
    await maybeResetForNewDay(_uid);
    await Promise.all([loadLocalData(_uid), loadRoutineLibrary(_uid)]);
    await loadWeeklyToday(_uid);
  };

  useFocusEffect(
    useCallback(() => {
      if (!uid) return;
      (async () => {
        await migrateLegacySetupKeys(uid);
        await ensureFreshDayAndLoad(uid);
        await computeTodaySeconds(uid);
        await computeRepeatables(uid);
        computeTodayMeta();
      })();
    }, [uid])
  );

  useEffect(() => {
    if (!uid) return;
    const handler = async (state: AppStateStatus) => {
      if (state === 'active') {
        await loadDayOffset(uid);
        await maybeResetForNewDay(uid);
        await Promise.all([computeTodaySeconds(uid), loadRoutineLibrary(uid)]);
        await loadWeeklyToday(uid);
        await computeRepeatables(uid);
        await loadLocalData(uid);
        computeTodayMeta();
      }
    };
    const sub = AppState.addEventListener('change', handler);
    return () => sub.remove();
  }, [uid]);

  useEffect(() => {
    if (!uid) return;
    const id = setInterval(async () => {
      await maybeResetForNewDay(uid);
      await Promise.all([computeTodaySeconds(uid), loadRoutineLibrary(uid)]);
      await loadWeeklyToday(uid);
      await computeRepeatables(uid);
      await loadLocalData(uid);
      computeTodayMeta();
    }, 60 * 1000);
    return () => clearInterval(id);
  }, [uid]);

  async function sumTodaySecondsFromCollection(
    collName: 'studyRecords' | 'routineRecords',
    _uid: string,
    offsetMin: number,
  ) {
    const { startUtc, endUtc } = kstLogicalRange(offsetMin);
    const dateFields = ['createdAt', 'completedAt', 'endedAt', 'timestamp', 'date', 'updatedAt'];
    for (const f of dateFields) {
      try {
        const q1 = query(
          collection(db, collName),
          where('uid', '==', _uid),
          where(f as any, '>=', startUtc as any),
          where(f as any, '<', endUtc as any),
        );
        const snap = await getDocs(q1);
        if (!snap.empty) {
          const secs = snap.docs
            .map((d) => d.data())
            .reduce((sum, r) => sum + (collName === 'studyRecords' ? secondsFromStudy(r) : secondsFromRoutine(r)), 0);
          return secs;
        }
      } catch {}
    }
    const snapAll = await getDocs(query(collection(db, collName), where('uid', '==', _uid)));
    const secs = snapAll.docs
      .map((d) => d.data())
      .filter((r) => {
        const dt = pickDate(r);
        const t = (dt instanceof Date ? dt : toDateSafe(dt)).getTime();
        const { startUtc, endUtc } = kstLogicalRange(dayOffsetRef.current);
        return t >= startUtc.getTime() && t < endUtc.getTime();
      })
      .reduce((sum, r) => sum + (collName === 'studyRecords' ? secondsFromStudy(r) : secondsFromRoutine(r)), 0);
    return secs;
  }
  const computeTodaySeconds = async (_uid: string) => {
    const offset = dayOffsetRef.current;
    const [studySec, routineSec] = await Promise.all([
      sumTodaySecondsFromCollection('studyRecords', _uid, offset),
      sumTodaySecondsFromCollection('routineRecords', _uid, offset),
    ]);
    setStudiedSeconds(studySec + routineSec);
  };

  const computeRepeatables = async (_uid: string) => {
    try {
      const today = getTodayKSTDateString();
      const raw = await AsyncStorage.getItem(k(RUN_EVENTS_KEY_BASE, _uid));
      const events: RunEvent[] = raw ? JSON.parse(raw) : [];
      const titleToId: Record<string, string> = {};
      Object.values(routineLib).forEach((p) => (titleToId[p.title] = p.id));
      PRESETS.forEach((p) => (titleToId[p.title] = p.id));

      const counts: Record<string, { runCount: number; lastUsed?: string }> = {};
      events.forEach((ev) => {
        const id = ev.id || titleToId[ev.title || ''];
        const key = id || ev.title || '';
        if (!key) return;
        const usedAt = ev.usedAt;
        if (!counts[key]) counts[key] = { runCount: 0, lastUsed: undefined };
        counts[key].runCount += 1;
        if (!counts[key].lastUsed || counts[key].lastUsed! < usedAt) counts[key].lastUsed = usedAt;
      });

      const list: Repeatable[] = Object.entries(counts)
        .map(([key, meta]) => {
          const base = routineLib[key] || PRESETS.find((p) => p.id === key) || PRESETS.find((p) => p.title === key);
          if (!base) return null as any;
          return { ...base, runCount: meta.runCount, lastUsed: meta.lastUsed };
        })
        .filter(Boolean) as Repeatable[];

      const filtered = list
        .map((r) => ({ r, recentDays: r.lastUsed ? Math.max(0, daysDiff(r.lastUsed, today)) : 9999 }))
        .sort((a, b) => {
          const aRecent = a.recentDays <= 30 ? 0 : 1;
          const bRecent = b.recentDays <= 30 ? 0 : 1;
          if (aRecent !== bRecent) return aRecent - bRecent;
          if (b.r.runCount !== a.r.runCount) return b.r.runCount - a.r.runCount;
          if ((b.r.lastUsed || '') !== (a.r.lastUsed || '')) return (b.r.lastUsed || '').localeCompare(a.r.lastUsed || '');
          return 0;
        })
        .slice(0, 6)
        .map((x) => x.r);

      setRepeatables(filtered);
    } catch {
      setRepeatables([]);
    }
  };

  function formatHM(seconds: number) {
    const safe = Math.max(0, Math.floor(seconds));
    const h = Math.floor(safe / 3600);
    const m = Math.floor((safe % 3600) / 60);
    return `${h}시간 ${m}분`;
  }

  const goalSeconds = Math.max(0, goalMinutes * 60);
  const achievedForGauge = Math.min(studiedSeconds, goalSeconds);
  const goalPct = goalSeconds > 0 ? Math.min(100, Math.round((achievedForGauge / goalSeconds) * 100)) : 0;
  const overSeconds = Math.max(0, studiedSeconds - goalSeconds);
  const remainingSeconds = Math.max(0, goalSeconds - studiedSeconds);

  const needGoal = goalMinutes <= 0;
  const needPlans = plans.length === 0;

  const allPlansDone = plans.length > 0 && plans.every(p => p.done);
  const achievedGoal = goalSeconds > 0 && studiedSeconds >= goalSeconds;
  const studyAllDone = achievedGoal || allPlansDone;

  useEffect(() => {
    if (allPlansDone && !prevAllPlansDoneRef.current) {
      Alert.alert('🎉', '오늘의 공부 계획 클리어!');
    }
    prevAllPlansDoneRef.current = allPlansDone;
  }, [allPlansDone]);

  useEffect(() => {
    if (!uid) return;
    (async () => {
      if (!studyAllDone) return;
      const ymd = getLogicalDateStringKST(dayOffsetRef.current);
      try {
        const raw = await AsyncStorage.getItem(k(DAILY_STATUS_KEY_BASE, uid));
        const map = raw ? JSON.parse(raw) : {};
        const prev = map?.[ymd] ?? {};
        const next = {
          achievedGoal: Boolean(prev.achievedGoal || achievedGoal),
          allPlansDone: Boolean(prev.allPlansDone || allPlansDone),
          completedAt: prev.completedAt || new Date().toISOString(),
        };
        if (!prev || prev.achievedGoal !== next.achievedGoal || prev.allPlansDone !== next.allPlansDone || !prev.completedAt) {
          map[ymd] = next;
          await AsyncStorage.setItem(k(DAILY_STATUS_KEY_BASE, uid), JSON.stringify(map));
        }
      } catch {}
    })();
  }, [uid, studyAllDone, achievedGoal, allPlansDone, goalMinutes, studiedSeconds, plans]);

  const allWeeklyDone = todayRoutineTotal > 0 && todayRoutineDone >= todayRoutineTotal;

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.header}>오늘도 StudyFit과 함께 해요!</Text>

      {(needGoal || needPlans) && (
        <View style={{ gap: 12, marginBottom: 12 }}>
          {needGoal && (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyTitle}>오늘 목표 시간이 비어 있어요</Text>
              <Text style={styles.emptyDesc}>하루 목표 시간을 설정하면 진행률과 남은 시간을 홈에서 표시할게요.</Text>
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
                <TouchableOpacity style={styles.primaryBtn} onPress={() => setGoalModalOpen(true)}>
                  <Text style={styles.primaryBtnText}>빠르게 설정</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.secondaryBtn} onPress={() => router.push('/habit/planner')}>
                  <Text style={styles.secondaryBtnText}>관리로 이동</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
          {needPlans && (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyTitle}>오늘의 공부 계획이 없어요</Text>
              <Text style={styles.emptyDesc}>할 일을 추가하면 체크하면서 진행할 수 있어요.</Text>
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
                <TouchableOpacity style={styles.primaryBtn} onPress={() => setPlanModalOpen(true)}>
                  <Text style={styles.primaryBtnText}>할 일 추가</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.secondaryBtn} onPress={() => router.push('/habit/planner')}>
                  <Text style={styles.secondaryBtnText}>관리로 이동</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
        </View>
      )}

      {memo?.trim()?.length > 0 && (
        <View style={styles.memoBanner}>
          <Text style={styles.memoTitle}>📌 오늘의 메모</Text>
          <Text style={styles.memoText}>{memo}</Text>
        </View>
      )}

      <View style={styles.weekBoxBlue}>
        <View style={styles.rowSpaceBetween}>
          <Text style={styles.weekTitleBlue}>주간 플래너</Text>
          <TouchableOpacity onPress={() => router.push('/habit/planner')} style={styles.weekEditBtn}>
            <Text style={styles.weekEditText}>관리</Text>
          </TouchableOpacity>
        </View>
        <Text style={styles.weekSubtitleBlue}>{todayLabel}</Text>

        {todayRoutineTotal > 0 && (
          allWeeklyDone ? (
            <View style={styles.weekDoneBanner}>
              <Text style={styles.weekDoneText}>✅ 오늘 루틴 완료 ({todayRoutineDone}/{todayRoutineTotal})</Text>
            </View>
          ) : (
            <Text style={styles.weekProgressText}>오늘 루틴 {todayRoutineDone}/{todayRoutineTotal} 완료</Text>
          )
        )}

        <View style={{ marginTop: 8 }}>
          <TouchableOpacity
            style={[styles.weekRunBtnBlue, allWeeklyDone && { backgroundColor:'#22C55E', borderColor:'#16A34A' }]}
            onPress={() => router.push('/habit/weeklyrun')}
          >
            <Text style={styles.weekRunTextBlue}>{allWeeklyDone ? '다시 실행하기' : '지금 실행하기'}</Text>
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.statsBox}>
        <Text style={styles.sectionTitle}>오늘의 학습 현황</Text>

        <View style={styles.statRow}>
          <Text style={styles.statLabel}>📚 오늘 공부 시간</Text>
          <Text style={styles.statValue}>{formatHM(studiedSeconds)}</Text>
        </View>

        <View style={styles.statRow}>
          <Text style={styles.statLabel}>⏳ 남은 목표 시간</Text>
          <Text style={styles.statValue}>{formatHM(remainingSeconds)}</Text>
        </View>

        {goalSeconds > 0 && (
          <View style={styles.gaugeWrap}>
            <View style={styles.gaugeBar}>
              <View style={[styles.gaugeFill, { width: `${goalPct}%` }]} />
            </View>
            <View style={styles.gaugeLabelRow}>
              <Text style={styles.gaugeSmall}>0%</Text>
              <Text style={styles.gaugePercent}>{goalPct}% 달성</Text>
              <Text style={styles.gaugeSmall}>100%</Text>
            </View>
            {overSeconds > 0 && (
              <Text style={styles.gaugeOverText}>🔥 목표 초과 달성: {formatHM(overSeconds)}</Text>
            )} 
          </View>
        )}
      </View>

      {repeatables.length > 0 && (
        <View style={styles.repeatBox}>
          <View style={styles.rowSpaceBetween}>
            <Text style={styles.sectionTitle}>🔁 자주 반복하는 루틴</Text>
            <Text style={styles.repeatHint}>최근/총 실행 기준 상위</Text>
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 12 }}>
            {repeatables.map((r) => {
              const totalMin = r.steps.reduce((a, s) => a + (s.minutes || 0), 0);
              return (
                <View key={r.id} style={styles.repeatCard}>
                  <Text style={styles.repeatTitle} numberOfLines={1}>{r.title}</Text>
                  <Text style={styles.repeatMeta}>⏱ {totalMin}분 · ▶ {r.runCount}회{r.lastUsed ? ` · ${r.lastUsed}` : ''}</Text>
                  <TouchableOpacity
                    style={styles.repeatRunBtn}
                    onPress={() => {
                      if (isLaunchingRoutineRef.current) return;
                      isLaunchingRoutineRef.current = true;
                      const packedSteps = serializeSteps(r.steps);
                      router.push({
                        pathname: '/habit/weeklyrun',
                        params: { title: r.title, steps: packedSteps, setCount: '1', auto: '1' }
                      } as any);
                      setTimeout(() => { isLaunchingRoutineRef.current = false; }, 300);
                    }}>
                    <Text style={styles.repeatRunText}>바로 실행</Text>
                  </TouchableOpacity>
                </View>
              );
            })}
          </ScrollView>
        </View>
      )}

      {/* 오늘의 공부 계획 */}
      <View style={styles.todoBox}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text style={styles.sectionTitle}>오늘의 공부 계획</Text>
          <TouchableOpacity
            onPress={() => router.push('/setup')}
            style={{ paddingVertical: 6, paddingHorizontal: 10, backgroundColor: '#F3F4F6', borderRadius: 10 }}
          >
            <Text style={{ fontSize: 12, color: '#111827' }}>계획 추가</Text>
          </TouchableOpacity>
        </View>

        {plans.length === 0 && (
          <View style={styles.emptyTodoWrap}>
            <Text style={styles.emptyTodoMsg}>오늘의 공부 계획이 없어요</Text>
            <TouchableOpacity style={styles.emptyTodoBtn} onPress={() => setPlanModalOpen(true)}>
              <Text style={styles.emptyTodoBtnText}>추가하기</Text>
            </TouchableOpacity>
          </View>
        )}

        {(['필수', '중요', '선택'] as Priority[]).map((pri) => {
          const list = plans
            .filter((p) => p.priority === pri)
            .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

          if (list.length === 0) return null;

          return (
            <View key={pri} style={{ marginBottom: 14 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
                <View
                  style={[
                    styles.sectionDot,
                    { backgroundColor: '#EF4444' },
                    pri === '중요' && { backgroundColor: '#F59E0B' },
                    pri === '선택' && { backgroundColor: '#10B981' },
                  ]}
                />
                <Text style={{ fontSize: 16, fontWeight: '700', color: '#111827' }}>{pri}</Text>
                <Text style={{ marginLeft: 6, color: '#6B7280' }}>
                  ({list.length})
                </Text>
              </View>

              {list.map((p) => (
                <View key={p.id} style={styles.todoItemCard}>
                  <Pressable style={styles.todoItemRow} onPress={() => togglePlanDone(p.id)}>
                    <View style={[styles.checkbox, p.done && { borderColor: '#10B981', backgroundColor: '#ECFDF5' }]}>
                      {p.done && <Text style={styles.checkmark}>✓</Text>}
                    </View>
                    <Text
                      style={[styles.todoItemText, p.done && styles.todoItemTextDone]}
                      numberOfLines={3}
                    >
                      {p.content}
                    </Text>
                  </Pressable>
                </View>
              ))}
            </View>
          );
        })}
      </View>

      {/* ===== 목표 시간 빠른 설정 모달 ===== */}
      <Modal visible={goalModalOpen} transparent animationType="fade" onRequestClose={() => setGoalModalOpen(false)}>
        <View style={styles.modalBg}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>목표 시간 설정</Text>
            <Text style={{ color: '#6B7280', marginBottom: 8 }}>기본값은 00:00 입니다.</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <TextInput
                value={goalHour}
                onChangeText={(v) =>
                  setGoalHour(
                    String(Math.max(0, Math.min(23, Number((v || '').replace(/\D/g, '')) || 0))).padStart(2, '0')
                  )
                }
                placeholder="시"
                keyboardType="numeric"
                style={[styles.input, { width: 64, textAlign: 'center' }]}
                placeholderTextColor="#9CA3AF"
              />
              <Text style={{ fontSize: 18, color: '#0F172A' }}>:</Text>
              <TextInput
                value={goalMin}
                onChangeText={(v) =>
                  setGoalMin(
                    String(Math.max(0, Math.min(59, Number((v || '').replace(/\D/g, '')) || 0))).padStart(2, '0')
                  )
                }
                placeholder="분"
                keyboardType="numeric"
                style={[styles.input, { width: 64, textAlign: 'center' }]}
                placeholderTextColor="#9CA3AF"
              />
            </View>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <TouchableOpacity style={styles.primaryBtn} onPress={saveQuickGoal}>
                <Text style={styles.primaryBtnText}>저장</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.secondaryBtn} onPress={() => setGoalModalOpen(false)}>
                <Text style={styles.secondaryBtnText}>취소</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ===== 오늘 계획 빠른 추가 모달 ===== */}
      <Modal visible={planModalOpen} transparent animationType="fade" onRequestClose={() => setPlanModalOpen(false)}>
        <View style={styles.modalBg}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>오늘의 계획 추가</Text>
            <TextInput
              value={newPlanText}
              onChangeText={setNewPlanText}
              placeholder="예) 수학 문제집 30쪽"
              style={styles.input}
              placeholderTextColor="#9CA3AF"
            />
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
              <TouchableOpacity style={styles.primaryBtn} onPress={addQuickPlan}>
                <Text style={styles.primaryBtnText}>추가</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.secondaryBtn} onPress={() => setPlanModalOpen(false)}>
                <Text style={styles.secondaryBtnText}>취소</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );

  /* ---------- 내부 함수 ---------- */
  async function togglePlanDone(id: string) {
    if (!uid) return;
    const updated = plans.map((p) => (p.id === id ? { ...p, done: !p.done } : p));
    setPlans(updated);
    await AsyncStorage.setItem(k(PLANS_KEY_BASE, uid), JSON.stringify(updated));
    try {
      const ymd = getLogicalDateStringKST(dayOffsetRef.current);
      const achievedGoalNow = goalSeconds > 0 && studiedSeconds >= goalSeconds;
      const allPlansDoneNow = updated.length > 0 && updated.every(p => p.done);
      if (achievedGoalNow || allPlansDoneNow) {
        const raw = await AsyncStorage.getItem(k(DAILY_STATUS_KEY_BASE, uid));
        const map = raw ? JSON.parse(raw) : {};
        const prev = map?.[ymd] ?? {};
        map[ymd] = {
          achievedGoal: Boolean(prev.achievedGoal || achievedGoalNow),
          allPlansDone: Boolean(prev.allPlansDone || allPlansDoneNow),
          completedAt: prev.completedAt || new Date().toISOString(),
        };
        await AsyncStorage.setItem(k(DAILY_STATUS_KEY_BASE, uid), JSON.stringify(map));
      }
    } catch {}
  }
  function goBatchStart() {
    const queue = [...plans].sort((a, b) => {
      const order = (p: Priority) => (p === '필수' ? 0 : p === '중요' ? 1 : 2);
      const pa = order(a.priority), pb = order(b.priority);
      if (pa !== pb) return pa - pb;
      if (a.done !== b.done) return a.done ? 1 : -1;
      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    });
    router.push({ pathname: '/plan/batch', params: { plans: encodeURIComponent(JSON.stringify(queue)) } } as any);
  }

  async function saveQuickGoal() {
    if (!uid) return;
    const minutes = Number(goalHour) * 60 + Number(goalMin);
    await AsyncStorage.setItem(k(GOAL_KEY_BASE, uid), String(minutes));
    setGoalMinutes(minutes);
    setGoalModalOpen(false);
  }

  async function addQuickPlan() {
    if (!uid) return;
    const text = newPlanText.trim();
    if (!text) return;
    const newItem: Plan = {
      id: `${Date.now()}`,
      content: text,
      priority: '중요',
      done: false,
      createdAt: new Date().toISOString(),
    };
    const updated = [...plans, newItem];
    setPlans(updated);
    await AsyncStorage.setItem(k(PLANS_KEY_BASE, uid), JSON.stringify(updated));
    setNewPlanText('');
    setPlanModalOpen(false);
  }
}

/* ----------------------------------------------------
 * 스타일
 * --------------------------------------------------*/
const styles = StyleSheet.create({
  container: { padding: 20, backgroundColor: '#FFFFFF', flexGrow: 1 },
  header: { fontSize: 20, fontWeight: 'bold', textAlign: 'center', marginTop: 70, marginBottom: 50 },

  emptyCard: {
    borderWidth: 1, borderColor: '#E5E7EB', backgroundColor: '#F9FAFB',
    borderRadius: 14, padding: 14,
  },
  emptyTitle: { color: '#0F172A', fontSize: 16, fontWeight: '800' },
  emptyDesc: { color: '#6B7280', marginTop: 4 },

  allDoneBanner: { backgroundColor: '#ECFDF5', borderColor: '#A7F3D0', borderWidth: 1, padding: 12, borderRadius: 12, marginBottom: 12 },
  allDoneText: { color: '#065F46', fontWeight: '700', textAlign: 'center' },

  memoBanner: { backgroundColor: '#F9FAFB', borderWidth: 1, borderColor: '#E5E7EB', padding: 12, borderRadius: 12, marginBottom: 16 },
  memoTitle: { fontSize: 13, color: '#6B7280', marginBottom: 4, fontWeight: '600' },
  memoText: { fontSize: 14, color: '#111827', marginTop: 10 },

  sectionTitle: { fontSize: 16, fontWeight: '600', marginBottom: 4 },
  rowSpaceBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },

  weekBoxBlue: {
    backgroundColor: '#EEF5FF',
    padding: 16,
    borderRadius: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#C7D8FF',
  },
  weekTitleBlue: { fontSize: 16, fontWeight: '800', color: '#1E3A8A' },
  weekSubtitleBlue: { color: '#3B82F6', marginBottom: 10, marginTop: 2, fontSize: 12, fontWeight: '700' },
  weekEditBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
    backgroundColor: '#DBEAFE',
    borderWidth: 1,
    borderColor: '#93C5FD',
  },
  weekEditText: { color: '#1D4ED8', fontWeight: '800', fontSize: 12 },

  weekProgressText: { color: '#1E3A8A', fontWeight: '700', fontSize: 12, marginBottom: 6 },
  weekDoneBanner: { backgroundColor: '#ECFDF5', borderWidth: 1, borderColor: '#A7F3D0', padding: 8, borderRadius: 10, marginBottom: 6 },
  weekDoneText: { color: '#065F46', fontWeight: '800', textAlign: 'center' },

  weekRunBtnBlue: {
    backgroundColor: '#2563EB',
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#1D4ED8',
  },
  weekRunTextBlue: { color: '#fff', fontWeight: '900' },

  statsBox: {
    backgroundColor: '#FFFFFF',
    padding: 16,
    borderRadius: 16,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 4,
    elevation: 2,
  },
  statusDoneBanner: { backgroundColor: '#ECFDF5', borderColor: '#A7F3D0', borderWidth: 1, padding: 8, borderRadius: 10, marginTop: 8, marginBottom: 8 },
  statusDoneText: { color: '#065F46', fontWeight: '800', textAlign: 'center' },

  statRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 },
  statLabel: { fontSize: 14, color: '#374151' },
  statValue: { fontSize: 14, fontWeight: '800', color: '#111827' },
  gaugeWrap: { marginTop: 12 },
  gaugeBar: { height: 12, backgroundColor: '#E5E7EB', borderRadius: 999, overflow: 'hidden' },
  gaugeFill: { height: '100%', backgroundColor: '#10B981' },
  gaugeLabelRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 },
  gaugeSmall: { fontSize: 11, color: '#6B7280' },
  gaugePercent: { fontSize: 12, fontWeight: '800', color: '#065F46' },
  gaugeOverText: { marginTop: 6, fontSize: 12, color: '#B45309' },

  repeatBox: {
    backgroundColor: '#F9FAFB',
    padding: 16,
    borderRadius: 16,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  repeatHint: { fontSize: 12, color: '#6B7280' },
  repeatCard: {
    width: 220,
    padding: 14,
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 4,
    elevation: 2,
  },
  repeatTitle: { fontSize: 15, fontWeight: '700', color: '#111827' },
  repeatMeta: { fontSize: 12, color: '#6B7280', marginTop: 6, marginBottom: 10 },
  repeatRunBtn: { backgroundColor: '#059669', paddingVertical: 8, borderRadius: 10, alignItems: 'center' },
  repeatRunText: { color: '#fff', fontWeight: '800' },

  todoBox: {
    backgroundColor: '#fff',
    padding: 20,
    borderRadius: 16,
    marginTop: 4,
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 4,
    elevation: 3,
  },
  sectionDot: { width: 8, height: 8, borderRadius: 4, marginRight: 6 },
  todoItemCard: { borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 12, padding: 12, backgroundColor: '#FFFFFF', marginBottom: 10, gap: 8 },
  todoItemRow: { flexDirection: 'row', alignItems: 'center' },
  checkbox: {
    width: 20, height: 20, borderWidth: 2, borderRadius: 4,
    marginRight: 12, backgroundColor: '#fff', borderColor: '#9CA3AF',
    alignItems: 'center', justifyContent: 'center',
  },
  checkmark: { fontSize: 14, lineHeight: 14, fontWeight: '700', color: '#111827' },
  todoItemText: { fontSize: 15, flex: 1 },

  todoItemTextDone: {
    textDecorationLine: 'line-through',
    color: '#6B7280',
  },

  emptyTodoWrap: {
    borderWidth: 1,
    borderColor: '#E5E7EB',
    backgroundColor: '#F9FAFB',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    marginTop: 8,
    marginBottom: 8,
  },
  emptyTodoMsg: {
    fontSize: 14,
    color: '#374151',
    marginBottom: 10,
    fontWeight: '600',
  },
  emptyTodoBtn: {
    backgroundColor: '#3B82F6',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
  },
  emptyTodoBtnText: { color: '#fff', fontWeight: '800' },

  batchBtn: { marginTop: 10, backgroundColor: '#3B82F6', padding: 12, borderRadius: 12, alignItems: 'center' },
  batchBtnText: { color: '#fff', fontWeight: '800' },

  primaryBtn: {
    backgroundColor: '#3B82F6', paddingHorizontal: 14, paddingVertical: 10,
    borderRadius: 10,
  },
  primaryBtnText: { color: 'white', fontWeight: '800' },
  secondaryBtn: {
    backgroundColor: '#EFF6FF', paddingHorizontal: 14, paddingVertical: 10,
    borderRadius: 10, borderWidth: 1, borderColor: '#BFDBFE',
  },
  secondaryBtnText: { color: '#2563EB', fontWeight: '800' },

  modalBg: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', alignItems: 'center', justifyContent: 'center' },
  modalCard: { width: '88%', borderRadius: 16, backgroundColor: '#FFF', padding: 16 },
  modalTitle: { fontSize: 16, fontWeight: '800', color: '#0F172A', marginBottom: 8 },
  input: {
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: '#FFFFFF',
    color: '#0F172A',
  },
});
