// app/home/index.tsx
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import { onAuthStateChanged } from 'firebase/auth';
import { collection, getDocs, query, where } from 'firebase/firestore';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AppState,
  AppStateStatus,
  InteractionManager,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { auth, db } from '../../firebaseConfig';

/* ---------- Keys / Types ---------- */
const k = (base: string, uid: string) => `${base}_${uid}`;
const MEMO_KEY_BASE = 'todayMemo';
const PLANS_KEY_BASE = 'todayPlans';
const GOAL_KEY_BASE = 'todayGoalMinutes';
const RUN_EVENTS_KEY_BASE = 'routineRunEventsV1';
const LAST_SETUP_DATE_KEY_BASE = 'lastSetupLogicalDateKST';
const DAY_START_OFFSET_KEY_BASE = 'dayStartOffsetMin';
const DEFAULT_DAY_START_MIN = 240;

type Priority = '필수' | '중요' | '선택';
type Plan = { id: string; content: string; priority: Priority; done: boolean; createdAt: string; };
type Step = { step: string; minutes: number };
type Routine = { id: string; title: string; steps: Step[]; origin: 'preset' | 'custom' };
type RunEvent = { title: string; usedAt: string };

/* ---------- Preset Routines (기본 제공) ---------- */
const PRESETS: Routine[] = [
  {
    id: 'preset-words',
    title: '영단어 암기 루틴',
    steps: [
      { step: '영단어 외우기', minutes: 20 },
      { step: '예문 만들기', minutes: 15 },
      { step: '퀴즈 테스트', minutes: 10 },
    ],
    origin: 'preset',
  },
  {
    id: 'preset-wrong',
    title: '오답 집중 루틴',
    steps: [
      { step: '최근 오답 복습', minutes: 20 },
      { step: '유형 문제 풀기', minutes: 25 },
      { step: '오답 이유 정리', minutes: 15 },
    ],
    origin: 'preset',
  },
  {
    id: 'preset-core',
    title: '핵심 개념 정리 루틴',
    steps: [
      { step: '개념 선택/요약', minutes: 10 },
      { step: '예시 추가', minutes: 10 },
      { step: '문제 적용', minutes: 15 },
    ],
    origin: 'preset',
  },
  {
    id: 'preset-review',
    title: '전 범위 빠른 복습 루틴',
    steps: [
      { step: '요점 스캔', minutes: 10 },
      { step: '핵심문제 5개', minutes: 15 },
      { step: '오답 체크', minutes: 10 },
    ],
    origin: 'preset',
  },
];

/* ---------- Date Utils (KST) ---------- */
function getTodayKSTDateString() {
  const now = new Date();
  const kst = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
  const y = kst.getFullYear();
  const m = String(kst.getMonth() + 1).padStart(2, '0');
  const d = String(kst.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
function getLogicalDateStringKST(offsetMin: number) {
  const now = new Date();
  const kst = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
  const shifted = new Date(kst.getTime() - (offsetMin || 0) * 60000);
  const y = shifted.getFullYear();
  const m = String(shifted.getMonth() + 1).padStart(2, '0');
  const d = String(shifted.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
function logicalDateStrKSTFor(d: Date, offsetMin: number) {
  const kst = new Date(d.toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
  const shifted = new Date(kst.getTime() - (offsetMin || 0) * 60000);
  const y = shifted.getFullYear();
  const m = String(shifted.getMonth() + 1).padStart(2, '0');
  const dd = String(shifted.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}
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

/* ---------- Time helpers ---------- */
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

/* ---------- Scoring ---------- */
const RECENT_WINDOW_DAYS = 14;
const LONG_UNUSED_CAP_DAYS = 21;
function daysDiff(fromYmd: string, toYmd: string) {
  const [fy, fm, fd] = fromYmd.split('-').map(Number);
  const [ty, tm, td] = toYmd.split('-').map(Number);
  const from = new Date(fy, fm - 1, fd);
  const to = new Date(ty, tm - 1, td);
  return Math.round((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24));
}
function calcStreak(usedDaysSet: Set<string>, today: string) {
  let streak = 0;
  let cursor = today;
  while (usedDaysSet.has(cursor)) {
    streak += 1;
    const [y, m, d] = cursor.split('-').map(Number);
    const prev = new Date(y, m - 1, d - 1);
    cursor = `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}-${String(prev.getDate()).padStart(2, '0')}`;
  }
  return streak;
}
function calcRecentCount(usedDates: string[], today: string) {
  return usedDates.filter((ymd) => {
    const diff = daysDiff(ymd, today);
    return diff >= 0 && diff <= RECENT_WINDOW_DAYS;
  }).length;
}
function lastUsedDaysAgo(usedDates: string[], today: string): number | null {
  if (usedDates.length === 0) return null;
  const last = usedDates.reduce((a, b) => (a > b ? a : b));
  return daysDiff(last, today);
}
function formatHMS(seconds: number) {
  const safe = Math.max(0, Math.floor(seconds));
  const h = Math.floor(safe / 3600);
  const m = Math.floor((safe % 3600) / 60);
  const s = safe % 60;
  return `${h}시간 ${m}분 ${s}초`;
}

/* ---------- Styles tokens ---------- */
const PRIORITY_COLOR: Record<Priority, string> = {
  필수: '#EF4444', 중요: '#F59E0B', 선택: '#10B981',
};

/* =========================================================
 *                     Home Page
 * =======================================================*/
export default function HomePage() {
  const router = useRouter();
  const [uid, setUid] = useState<string | null>(null);

  const [goalMinutes, setGoalMinutes] = useState(0);
  const [studiedSeconds, setStudiedSeconds] = useState(0);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [memo, setMemo] = useState<string>('');

  // ✅ 오늘의 루틴 (리빌드)
  const [routines, setRoutines] = useState<Routine[]>([]);
  const [ranked, setRanked] = useState<(Routine & { _score: number })[]>([]);
  const [ri, setRi] = useState(0);
  const [launching, setLaunching] = useState(false);

  // ✅ 축하 배너(오버레이 제거: 터치 블로킹 원천 차단)
  const [showPlanBanner, setShowPlanBanner] = useState(false);
  const [showGoalBanner, setShowGoalBanner] = useState(false);

  const dayOffsetRef = useRef<number>(DEFAULT_DAY_START_MIN);
  const lastLogicalDateRef = useRef<string>('');

  const ORDER: Priority[] = ['필수', '중요', '선택'];

  const totalCount = plans.length;
  const completedCount = useMemo(() => plans.filter(p => p.done).length, [plans]);
  const progress = totalCount > 0 ? completedCount / totalCount : 0;

  const grouped = useMemo(() => {
    const base: Record<Priority, { done: Plan[]; todo: Plan[] }> = {
      필수: { done: [], todo: [] },
      중요: { done: [], todo: [] },
      선택: { done: [], todo: [] },
    };
    plans.forEach((p) => (p.done ? base[p.priority].done.push(p) : base[p.priority].todo.push(p)));
    ORDER.forEach((kk) => {
      const sortFn = (a: Plan, b: Plan) =>
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      base[kk].todo.sort(sortFn);
      base[kk].done.sort(sortFn);
    });
    return base;
  }, [plans]);

  /* ---------- Logical day ---------- */
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
    ]);
    await AsyncStorage.setItem(k(LAST_SETUP_DATE_KEY_BASE, _uid), todayLogical);
    setGoalMinutes(0);
    setPlans([]);
    setMemo('');
    setStudiedSeconds(0);
    setShowPlanBanner(false);
    setShowGoalBanner(false);
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
              priority: (['필수','중요','선택'] as Priority[]).includes(p.priority as Priority) ? (p.priority as Priority) : '중요',
              done: !!p.done,
              createdAt: String(p.createdAt ?? new Date().toISOString()),
            }))
          : [];
        setPlans(sanitized);
      } catch { setPlans([]); }
    } else setPlans([]);
    if (typeof memoStr === 'string') setMemo(memoStr);
  };
  const ensureFreshDayAndLoad = async (_uid: string) => {
    await loadDayOffset(_uid);
    const offset = dayOffsetRef.current;
    const todayLogical = getLogicalDateStringKST(offset);
    const last = await AsyncStorage.getItem(k(LAST_SETUP_DATE_KEY_BASE, _uid));
    if (last !== todayLogical) {
      await resetForNewLogicalDay(_uid, todayLogical);
      lastLogicalDateRef.current = todayLogical;
      try { router.replace('/setup'); } catch {}
      return;
    }
    lastLogicalDateRef.current = todayLogical;
    await loadLocalData(_uid);
  };

  /* ---------- Study aggregate ---------- */
  const computeTodaySeconds = async (_uid: string) => {
    const offset = dayOffsetRef.current;
    const todayLogical = getLogicalDateStringKST(offset);

    const sSnap = await getDocs(query(collection(db, 'studyRecords'), where('uid', '==', _uid)));
    const studySec = sSnap.docs
      .map((d) => d.data())
      .filter((r) => logicalDateStrKSTFor(pickDate(r), offset) === todayLogical)
      .reduce((sum, r) => sum + secondsFromStudy(r), 0);

    const rSnap = await getDocs(query(collection(db, 'routineRecords'), where('uid', '==', _uid)));
    const routineSec = rSnap.docs
      .map((d) => d.data())
      .filter((r) => logicalDateStrKSTFor(pickDate(r), offset) === todayLogical)
      .reduce((sum, r) => sum + secondsFromRoutine(r), 0);

    setStudiedSeconds(studySec + routineSec);
  };

  /* ---------- 오늘의 루틴: 프리셋 + 커스텀 합치기 ---------- */
  const loadRoutines = useCallback(async () => {
    const STORAGE_KEY = '@userRoutinesV1';
    let custom: Routine[] = [];
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as any[];
        if (Array.isArray(parsed)) {
          custom = parsed.map((r, i) => ({
            id: String(r.id ?? `custom-${i}-${Math.random().toString(36).slice(2,7)}`),
            title: String(r.title ?? '루틴'),
            steps: Array.isArray(r.steps)
              ? r.steps.map((s: any) => ({ step: String(s?.step ?? ''), minutes: Number(s?.minutes) || 0 }))
              : [],
            origin: 'custom',
          }));
        }
      }
    } catch {}
    const map = new Map<string, Routine>();
    for (const c of custom) map.set(c.title, c);
    for (const p of PRESETS) if (!map.has(p.title)) map.set(p.title, p);
    const merged = Array.from(map.values());
    setRoutines(merged);
    return merged;
  }, []);

  /* ---------- 추천 점수 계산 ---------- */
  const refreshRanking = useCallback(async (_uid: string) => {
    const list = await loadRoutines();
    const today = getTodayKSTDateString();
    const raw = await AsyncStorage.getItem(k(RUN_EVENTS_KEY_BASE, _uid));
    const events: RunEvent[] = raw ? JSON.parse(raw) : [];

    const usedMap: Record<string, string[]> = {};
    for (const ev of events) {
      if (!usedMap[ev.title]) usedMap[ev.title] = [];
      if (!usedMap[ev.title].includes(ev.usedAt)) usedMap[ev.title].push(ev.usedAt);
    }
    const anyUsed = Object.values(usedMap).some(arr => arr.length > 0);

    const scored = list.map((r) => {
      const dates = usedMap[r.title] ?? [];
      const usedSet = new Set(dates);
      const streak = calcStreak(usedSet, today);
      const recent = calcRecentCount(dates, today);
      const since = lastUsedDaysAgo(dates, today);

      // 정규화
      const streakN = Math.min(streak, 7) / 7; // 0~1
      const recentN = Math.min(recent, 7) / 7; // 0~1
      const longN = since === null ? 0.6 : Math.min(Math.max(since, 0), LONG_UNUSED_CAP_DAYS) / LONG_UNUSED_CAP_DAYS;

      // 가중치
      const W_STREAK = 0.5, W_RECENT = 0.3, W_LONG = 0.2;
      let score = W_STREAK * streakN + W_RECENT * recentN + W_LONG * longN;

      // 콜드스타트 완화
      if (dates.length === 0 && !anyUsed) score += 0.06;
      if (dates.length === 0 && anyUsed)  score += 0.01;

      return { ...r, _score: score };
    });

    scored.sort((a, b) => b._score - a._score);
    setRanked(scored);
    setRi(0);
  }, [loadRoutines]);

  /* ---------- 자동 완료 반영(원인 무관) ---------- */
  const autoMarkPlanDoneFromLastStudy = useCallback(async (_uid: string) => {
    try {
      const lastContent = await AsyncStorage.getItem('content');
      if (!lastContent) return;
      const plansStr = await AsyncStorage.getItem(k(PLANS_KEY_BASE, _uid));
      if (!plansStr) return;
      let parsed: Plan[] = [];
      try { parsed = JSON.parse(plansStr) as Plan[]; } catch { return; }
      if (!Array.isArray(parsed) || parsed.length === 0) return;

      const idx = parsed.findIndex(p => !p.done && String(p.content) === String(lastContent));
      if (idx === -1) return;

      parsed[idx] = { ...parsed[idx], done: true };
      await AsyncStorage.setItem(k(PLANS_KEY_BASE, _uid), JSON.stringify(parsed));
      setPlans(parsed);
    } catch {}
  }, []);

  /* ---------- Init ---------- */
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        setUid(null);
        setRoutines([]); setRanked([]);
        setShowPlanBanner(false); setShowGoalBanner(false);
        return;
      }
      setUid(user.uid);
      await ensureFreshDayAndLoad(user.uid);
      try {
        await computeTodaySeconds(user.uid);
        await autoMarkPlanDoneFromLastStudy(user.uid);
      } finally {
        await refreshRanking(user.uid);
      }
    });
    return unsub;
  }, [router, autoMarkPlanDoneFromLastStudy, refreshRanking]);

  useEffect(() => {
    if (!uid) return;
    const handler = async (state: AppStateStatus) => {
      if (state === 'active') {
        await ensureFreshDayAndLoad(uid);
        await computeTodaySeconds(uid);
        await autoMarkPlanDoneFromLastStudy(uid);
        await refreshRanking(uid);
      }
    };
    const sub = AppState.addEventListener('change', handler);
    return () => sub.remove();
  }, [uid, autoMarkPlanDoneFromLastStudy, refreshRanking]);

  useEffect(() => {
    if (!uid) return;
    const id = setInterval(async () => {
      const offset = dayOffsetRef.current;
      const todayLogical = getLogicalDateStringKST(offset);
      if (todayLogical !== lastLogicalDateRef.current) {
        await resetForNewLogicalDay(uid, todayLogical);
        lastLogicalDateRef.current = todayLogical;
        try { router.replace('/setup'); } catch {}
      }
      await computeTodaySeconds(uid);
      await autoMarkPlanDoneFromLastStudy(uid);
      await refreshRanking(uid);
    }, 60 * 1000);
    return () => clearInterval(id);
  }, [uid, autoMarkPlanDoneFromLastStudy, refreshRanking]);

  /* ---------- Congrats 배너 (오버레이 X) ---------- */
  const allDone = totalCount > 0 && completedCount === totalCount;
  useEffect(() => { setShowPlanBanner(allDone); }, [allDone]);
  useEffect(() => {
    if (goalMinutes > 0 && studiedSeconds >= goalMinutes * 60) setShowGoalBanner(true);
    else setShowGoalBanner(false);
  }, [goalMinutes, studiedSeconds]);

  /* ---------- Today’s Routine UI handlers ---------- */
  const rec = ranked[ri] || routines[0] || PRESETS[0];
  const totalMinutesOf = (r?: Routine) =>
    (r?.steps ?? []).reduce((sum, s) => sum + (Number(s.minutes) || 0), 0);

  const serializeSteps = (steps: Step[]) =>
    (steps || [])
      .map(s => `${(s.step || '').replace(/[|,\n]/g, ' ').trim()},${Math.max(0, Math.floor(Number(s.minutes) || 0))}`)
      .join('|');

  const nextRoutine = () => {
    if (!ranked.length) return;
    setRi((i) => (i + 1) % ranked.length);
  };

  const startRoutine = async () => {
    if (!uid || launching) return;
    setLaunching(true);
    try {
      const today = getTodayKSTDateString();
      const raw = await AsyncStorage.getItem(k(RUN_EVENTS_KEY_BASE, uid));
      const events: RunEvent[] = raw ? JSON.parse(raw) : [];
      events.push({ title: rec.title, usedAt: today });
      await AsyncStorage.setItem(k(RUN_EVENTS_KEY_BASE, uid), JSON.stringify(events));

      const packed = serializeSteps(rec.steps || []);
      // 안전한 네비게이션 시점 (UI 블로킹 방지)
      InteractionManager.runAfterInteractions(() => {
        try {
          router.push({ pathname: '/routine/run', params: { title: rec.title, steps: packed, setCount: String(1), origin: 'home' } } as any);
        } catch {
          try { router.push('/routine/run' as any); } catch {}
        }
      });
    } finally {
      setTimeout(() => setLaunching(false), 300);
    }
  };

  const togglePlanDone = async (id: string) => {
    if (!uid) return;
    const updated = plans.map((p) => (p.id === id ? { ...p, done: !p.done } : p));
    setPlans(updated);
    await AsyncStorage.setItem(k(PLANS_KEY_BASE, uid), JSON.stringify(updated));
  };

  const goBatchStart = () => {
    const queue = [...plans].sort((a, b) => {
      const prio = (p: Priority) => (p === '필수' ? 0 : p === '중요' ? 1 : 2);
      const pa = prio(a.priority), pb = prio(b.priority);
      if (pa !== pb) return pa - pb;
      if (a.done !== b.done) return a.done ? 1 : -1;
      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    });
    router.push({ pathname: '/plan/batch', params: { plans: encodeURIComponent(JSON.stringify(queue)) } } as any);
  };

  const remainingSeconds = Math.max(0, goalMinutes * 60 - studiedSeconds);
/* ============================================================
==============================================================/







  /* ---------- Render ---------- */
  return (
    <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      <Text style={styles.header}>오늘도 StudyFit과 함께 해요!</Text>

      {/* 메모 */}
      {memo?.trim()?.length > 0 && (
        <View style={styles.memoBanner}>
          <Text style={styles.memoTitle}>오늘의 메모</Text>
          <Text style={styles.memoText}>{memo}</Text>
        </View>
      )}

      {/* ✅ 축하 배너(스크롤 내 고정, 오버레이 없음 → 터치 블로킹 원천 제거) */}
      {showPlanBanner && (
        <View style={[styles.banner, { backgroundColor: '#ECFDF5', borderColor: '#A7F3D0' }]}>
          <Text style={styles.bannerTitle}>오늘의 공부 계획 완료!</Text>
          <Text style={styles.bannerBody}>계획한 할 일을 모두 끝냈어요. 훌륭해요! 가벼운 루틴으로 마무리할까요?</Text>
          <View style={styles.bannerRow}>
            <TouchableOpacity style={[styles.bannerBtn, { backgroundColor: '#3B82F6' }]} onPress={startRoutine}>
              <Text style={styles.bannerBtnTextPrimary}>추천 루틴 실행</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.bannerBtn, { backgroundColor: '#F3F4F6' }]} onPress={() => setShowPlanBanner(false)}>
              <Text style={styles.bannerBtnText}>닫기</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
      {showGoalBanner && (
        <View style={[styles.banner, { backgroundColor: '#F0FDFA', borderColor: '#99F6E4' }]}>
          <Text style={styles.bannerTitle}>목표 공부 시간 달성!</Text>
          <Text style={styles.bannerBody}>오늘 목표 {Math.round(goalMinutes/6)/10}시간을 채웠어요. 가볍게 정리 루틴으로 마무리해봐요.</Text>
          <View style={styles.bannerRow}>
            <TouchableOpacity style={[styles.bannerBtn, { backgroundColor: '#10B981' }]} onPress={() => setShowGoalBanner(false)}>
              <Text style={styles.bannerBtnTextPrimary}>좋아요</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.bannerBtn, { backgroundColor: '#F3F4F6' }]} onPress={startRoutine}>
              <Text style={styles.bannerBtnText}>정리 루틴 실행</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* ✅ 오늘의 루틴 (완전 리빌드) */}
      <View style={styles.recommendBox}>
        <View style={styles.rowSpaceBetween}>
          <Text style={styles.recommendTitle}>📘 오늘의 루틴</Text>
          <TouchableOpacity onPress={nextRoutine}>
            <Text style={styles.changeButtonText}>다른 루틴 보기</Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.routineTitle}>{rec?.title ?? '루틴'}</Text>
        <Text style={styles.totalTime}>({totalMinutesOf(rec)}분)</Text>

        <View style={styles.stepsBox}>
          {(rec?.steps ?? []).map((s, i) => (
            <Text key={i} style={styles.stepItem}>• {s.step} ({s.minutes}분)</Text>
          ))}
        </View>

        <TouchableOpacity
          activeOpacity={0.8}
          disabled={launching}
          style={[styles.startButton, launching && { opacity: 0.6 }]}
          onPress={startRoutine}
        >
          <Text style={styles.startButtonText}>{launching ? '실행 준비중…' : '지금 실행하기'}</Text>
        </TouchableOpacity>
      </View>

      {/* 공부 시간 */}
      <Text style={styles.timeText}>오늘 공부 시간: {formatHMS(studiedSeconds)}</Text>
      <Text style={styles.timeText}>남은 목표 시간: {formatHMS(remainingSeconds)}</Text>

      {/* 진행률 */}
      {totalCount > 0 && (
        <View style={styles.progressWrap}>
          <View style={styles.progressBar}>
            <View style={[styles.progressFill, { width: `${Math.round(progress * 100)}%` }]} />
          </View>
          <Text style={styles.progressText}>진행률 {completedCount}/{totalCount}</Text>
        </View>
      )}

      {/* 오늘의 계획 */}
      <View style={styles.todoBox}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text style={styles.sectionTitle}>오늘의 계획</Text>
          <TouchableOpacity
            onPress={() => router.push('/setup')}
            style={{ paddingVertical: 6, paddingHorizontal: 10, backgroundColor: '#F3F4F6', borderRadius: 10 }}
          >
            <Text style={{ fontSize: 12, color: '#111827' }}>+ 계획 추가</Text>
          </TouchableOpacity>
        </View>

        {(['필수','중요','선택'] as Priority[]).map((pri) => {
          const todoList = grouped[pri]?.todo || [];
          const doneList = grouped[pri]?.done || [];
          if (todoList.length === 0 && doneList.length === 0) return null;

          const Item = (p: Plan, isDone: boolean) => (
            <View key={p.id} style={[styles.todoItemCard, isDone && { backgroundColor: '#FAFAFA' }]}>
              <Pressable style={styles.todoItemRow} onPress={() => togglePlanDone(p.id)}>
                <View style={[styles.checkbox, isDone && { borderColor: '#10B981', backgroundColor: '#ECFDF5' }]}>
                  {p.done && <Text style={styles.checkmark}>✓</Text>}
                </View>
                <Text
                  style={[styles.todoItemText, isDone && { textDecorationLine: 'line-through', color: '#9CA3AF' }]}
                  numberOfLines={3}
                >
                  {p.content}
                </Text>
              </Pressable>
            </View>
          );

          return (
            <View key={pri} style={{ marginBottom: 14 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
                <View style={[styles.sectionDot, { backgroundColor: PRIORITY_COLOR[pri] }]} />
                <Text style={{ fontSize: 16, fontWeight: '700', color: '#111827' }}>{pri}</Text>
                <Text style={{ marginLeft: 6, color: '#6B7280' }}>({todoList.length + doneList.length})</Text>
              </View>

              {todoList.map((p) => Item(p, false))}
              {doneList.length > 0 && <View style={{ marginTop: 4 }}>{doneList.map((p) => Item(p, true))}</View>}
            </View>
          );
        })}

        {plans.length === 0 && (
          <Text style={{ fontSize: 14, color: '#333' }}>오늘의 계획이 없습니다. 세팅 화면에서 추가해 보세요.</Text>
        )}

        <TouchableOpacity
          onPress={plans.some(p => !p.done) ? goBatchStart : undefined}
          style={[styles.batchBtn, !plans.some(p => !p.done) && { backgroundColor: '#E5E7EB' }]}
        >
          <Text style={[styles.batchBtnText, !plans.some(p => !p.done) && { color: '#6B7280' }]}>
            {plans.some(p => !p.done) ? '오늘의 공부 시작하기' : '오늘의 계획 모두 완료'}
          </Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

/* ---------- Styles ---------- */
const styles = StyleSheet.create({
  container: { padding: 20, backgroundColor: '#FFFFFF', flexGrow: 1 },
  header: { fontSize: 20, fontWeight: 'bold', textAlign: 'center', marginTop: 70, marginBottom: 20 },

  memoBanner: { backgroundColor: '#F9FAFB', borderWidth: 1, borderColor: '#E5E7EB', padding: 12, borderRadius: 12, marginBottom: 16 },
  memoTitle: { fontSize: 13, color: '#6B7280', marginBottom: 4, fontWeight: '600' },
  memoText: { fontSize: 14, color: '#111827', marginTop: 8 },

  /* ✅ 축하 배너(스크롤 내) */
  banner: {
    borderWidth: 1,
    padding: 14,
    borderRadius: 12,
    marginBottom: 12,
  },
  bannerTitle: { fontSize: 16, fontWeight: '800', color: '#111827', marginBottom: 6 },
  bannerBody: { fontSize: 13, color: '#111827', marginBottom: 10 },
  bannerRow: { flexDirection: 'row', gap: 10 },
  bannerBtn: { flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  bannerBtnTextPrimary: { color: '#FFFFFF', fontWeight: '800' },
  bannerBtnText: { color: '#111827', fontWeight: '700' },

  /* 오늘의 루틴 */
  recommendBox: { backgroundColor: '#E0ECFF', padding: 20, borderRadius: 16, marginBottom: 30, marginTop: 10 },
  rowSpaceBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  recommendTitle: { fontSize: 16, fontWeight: '600', marginBottom: 8 },
  routineTitle: { fontSize: 16, fontWeight: '700', marginVertical: 6, color: '#111827' },
  totalTime: { fontSize: 13, color: '#6B7280', marginBottom: 10 },
  stepsBox: { backgroundColor: '#DBEAFE', padding: 10, borderRadius: 8, marginBottom: 10 },
  stepItem: { fontSize: 13, color: '#1F2937', marginBottom: 3 },
  startButton: { backgroundColor: '#3B82F6', paddingVertical: 12, borderRadius: 10, alignItems: 'center', marginTop: 6 },
  startButtonText: { color: '#fff', fontSize: 15, fontWeight: '800' },
  changeButtonText: { fontSize: 13, color: '#2563EB' },

  timeText: { fontSize: 14, marginBottom: 8, marginLeft: 25 },

  progressWrap: { marginHorizontal: 10, marginBottom: 16, marginTop: 4 },
  progressBar: { height: 10, backgroundColor: '#E5E7EB', borderRadius: 999, overflow: 'hidden' },
  progressFill: { height: '100%', backgroundColor: '#3B82F6' },
  progressText: { marginTop: 6, fontSize: 12, color: '#6B7280', textAlign: 'right' },

  sectionTitle: { fontSize: 16, fontWeight: '600', marginBottom: 10 },

  todoBox: {
    backgroundColor: '#fff',
    padding: 20,
    borderRadius: 16,
    marginTop: 20,
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
    width: 20, height: 20, borderWidth: 2, borderRadius: 4, marginRight: 12,
    backgroundColor: '#fff', borderColor: '#9CA3AF', alignItems: 'center', justifyContent: 'center',
  },
  checkmark: { fontSize: 14, lineHeight: 14, fontWeight: '700', color: '#111827' },
  todoItemText: { fontSize: 15, flex: 1 },

  batchBtn: { marginTop: 10, backgroundColor: '#3B82F6', padding: 12, borderRadius: 12, alignItems: 'center' },
  batchBtnText: { color: '#fff', fontWeight: '800' },
});
