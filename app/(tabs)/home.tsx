// app/home/index.tsx
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import { onAuthStateChanged } from 'firebase/auth';
import { collection, getDocs, query, where } from 'firebase/firestore';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AppState,
  AppStateStatus,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { auth, db } from '../../firebaseConfig';

// ---------- uid별 키 헬퍼 ----------
const k = (base: string, uid: string) => `${base}_${uid}`;

// ---------- Base 키 이름 ----------
const MEMO_KEY_BASE = 'todayMemo';
const PLANS_KEY_BASE = 'todayPlans';
const GOAL_KEY_BASE = 'todayGoalMinutes';
const START_NOW_KEY_BASE = 'startNow';
const RUN_EVENTS_KEY_BASE = 'routineRunEventsV1';
const LAST_SETUP_DATE_KEY_BASE = 'lastSetupLogicalDateKST';
const DAY_START_OFFSET_KEY_BASE = 'dayStartOffsetMin';

const DEFAULT_DAY_START_MIN = 240; // 04:00 시작

type Priority = '필수' | '중요' | '선택';
type Plan = {
  id: string;
  content: string;
  priority: Priority;
  done: boolean;
  createdAt: string;
};

type RunEvent = {
  title: string;  // 루틴 제목
  usedAt: string; // 'YYYY-MM-DD' (KST)
};

const PRIORITY_COLOR: Record<Priority, string> = {
  필수: '#EF4444',
  중요: '#F59E0B',
  선택: '#10B981',
};

// ========== 날짜/시간 유틸 ==========
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

// ========== 추천 파라미터 ==========
const W_STREAK = 5;
const W_RECENT = 2;
const W_LONG_UNUSED = 1;
const COLD_START_BONUS = 10;
const RECENT_WINDOW_DAYS = 14;
const LONG_UNUSED_CAP_DAYS = 21;

function calcStreak(usedDaysSet: Set<string>, today: string) {
  let streak = 0;
  let cursor = today;
  while (usedDaysSet.has(cursor)) {
    streak += 1;
    const [y, m, d] = cursor.split('-').map(Number);
    const prev = new Date(y, m - 1, d - 1);
    const py = prev.getFullYear();
    const pm = String(prev.getMonth() + 1).padStart(2, '0');
    const pd = String(prev.getDate()).padStart(2, '0');
    cursor = `${py}-${pm}-${pd}`;
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
function daysDiff(fromYmd: string, toYmd: string) {
  const [fy, fm, fd] = fromYmd.split('-').map(Number);
  const [ty, tm, td] = toYmd.split('-').map(Number);
  const from = new Date(fy, fm - 1, fd);
  const to = new Date(ty, tm - 1, td);
  return Math.round((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24));
}

// ========== 오늘의 계획 → 기본 분/과목 ==========
function defaultMinutesByPriority(p: Priority) {
  if (p === '필수') return 60;
  if (p === '중요') return 40;
  return 25;
}
function guessSubject(text: string) {
  const t = text.toLowerCase();
  if (t.includes('수학')) return '수학';
  if (t.includes('영어') || t.includes('단어')) return '영어';
  if (t.includes('국어') || t.includes('문법') || t.includes('비문학')) return '국어';
  if (t.includes('과학')) return '과학';
  if (t.includes('사회') || t.includes('역사')) return '사회';
  return '기타';
}
function serializeSteps(steps: { step: string; minutes: number }[]) {
  return steps
    .map((s) =>
      `${(s.step || '')
        .replace(/\|/g, ' ')
        .replace(/,/g, ' ')
        .replace(/\n/g, ' ')
        .trim()},${Math.max(0, Math.floor(s.minutes || 0))}`
    )
    .join('|');
}

export default function HomePage() {
  const router = useRouter();
  const [uid, setUid] = useState<string | null>(null);

  const [goalMinutes, setGoalMinutes] = useState(0);
  const [studiedSeconds, setStudiedSeconds] = useState(0);

  const [plans, setPlans] = useState<Plan[]>([]);
  const [memo, setMemo] = useState<string>('');

  const [showCriteria, setShowCriteria] = useState(false);
  const [showSteps, setShowSteps] = useState(false);

  const [rankedRoutines, setRankedRoutines] = useState<any[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isLaunchingRoutine, setIsLaunchingRoutine] = useState(false);

  const [showCompleted, setShowCompleted] = useState(false); // ✅ 완료 항목 보이기 토글

  const dayOffsetRef = useRef<number>(DEFAULT_DAY_START_MIN);
  const lastLogicalDateRef = useRef<string>('');

  const baseRoutines = [
    { title: '영단어 암기 루틴', steps: [{ step: '영단어 외우기 1분', minutes: 1 }, { step: '예문 만들기', minutes: 1 }, { step: '퀴즈 테스트 해보기 1분', minutes: 1 }], tags: ['#암기', '#영어'] },
    { title: '오답 집중 루틴', steps: [{ step: '최근 오답 복습', minutes: 20 }, { step: '비슷한 유형 문제 다시 풀기', minutes: 25 }, { step: '정답/오답 비교 정리', minutes: 15 }], tags: ['#문제풀이', '#복습정리'] },
    { title: '시험 전날 총정리 루틴', steps: [{ step: '전체 범위 핵심 정리', minutes: 40 }, { step: '예상 문제 풀기', minutes: 30 }, { step: '오답 노트 만들기', minutes: 20 }], tags: ['#시험준비', '#복습정리'] },
    { title: '내가 만든 문제 루틴', steps: [{ step: '중요 개념 1개 고르기', minutes: 5 }, { step: '문제 만들기', minutes: 10 }, { step: '직접 풀고 해설 달기', minutes: 15 }], tags: ['#개념이해'] },
    { title: '수학 서술형 루틴', steps: [{ step: '서술형 문제 3개 풀기', minutes: 20 }, { step: '풀이 과정 점검', minutes: 10 }, { step: '모범답안과 비교', minutes: 10 }], tags: ['#문제풀이'] },
    { title: '국어 문법 루틴', steps: [{ step: '문법 개념 정리', minutes: 15 }, { step: '문제 적용', minutes: 15 }, { step: '틀린 문법 다시 암기', minutes: 10 }], tags: ['#개념이해'] },
    { title: '비문학 분석 루틴', steps: [{ step: '지문 1개 읽기', minutes: 10 }, { step: '글 구조 그리기', minutes: 10 }, { step: '문제 풀이 + 해설 확인', minutes: 10 }], tags: ['#개념이해'] },
    { title: '용어 정의 루틴', steps: [{ step: '중요 용어 5개 선택', minutes: 5 }, { step: '정확히 정의 써보기', minutes: 10 }, { step: '예시나 그림으로 보완', minutes: 10 }], tags: ['#암기반복'] },
    { title: '빠른 오답 다시보기 루틴', steps: [{ step: '지난 오답노트 빠르게 훑기', minutes: 10 }, { step: '틀렸던 이유 요약', minutes: 5 }, { step: '비슷한 문제 1개 풀기', minutes: 5 }], tags: ['#복습정리'] },
    { title: '모르는 것만 모으는 루틴', steps: [{ step: '공부하다 모르는 것 따로 표시', minutes: 5 }, { step: '모음 정리노트 만들기', minutes: 15 }, { step: '정답 찾아서 복습', minutes: 10 }], tags: ['#복습정리'] },
    { title: '수학 스스로 설명 루틴 (Feynman Technique)', steps: [{ step: '수학 개념 하나 선택', minutes: 5 }, { step: '초등학생에게 설명하듯 써보기', minutes: 10 }, { step: '부족한 부분 다시 학습', minutes: 10 }], tags: ['#개념이해', '#자기주도'] },
    { title: '핵심 개념 정리 루틴', steps: [{ step: '개념 하나 선택', minutes: 5 }, { step: '핵심 문장 3줄로 정리', minutes: 10 }, { step: '예시 추가 및 노트 정리', minutes: 10 }], tags: ['#개념이해'] },
    { title: '개념 비교 루틴', steps: [{ step: '헷갈리는 개념 2개 선정', minutes: 5 }, { step: '차이점 도식화', minutes: 10 }, { step: '문제 적용 예시 찾기', minutes: 10 }], tags: ['#개념이해'] },
    { title: '유형별 문제 루틴', steps: [{ step: '집중하고 싶은 문제 유형 선정', minutes: 5 }, { step: '유형에 맞는 문제 풀이', minutes: 25 }], tags: ['#문제풀이'] },
    { title: '실전 모드 루틴', steps: [{ step: '시험지 형식 문제 세트 풀기', minutes: 30 }, { step: '채점 및 오답 분석', minutes: 10 }], tags: ['#문제풀이'] },
    { title: '3단계 암기 루틴', steps: [{ step: '내용 보기', minutes: 5 }, { step: '소리 내어 말하기', minutes: 5 }, { step: '손으로 쓰기', minutes: 5 }], tags: ['#암기'] },
    { title: 'OX 암기 루틴', steps: [{ step: '외운 내용으로 OX 퀴즈 만들기', minutes: 5 }, { step: '직접 풀어보기', minutes: 10 }], tags: ['#암기'] },
    { title: '스스로 출제 루틴', steps: [{ step: '암기 내용 기반 문제 만들기', minutes: 10 }, { step: '직접 풀고 정답 확인 및 수정', minutes: 10 }], tags: ['#암기'] },
    { title: '단어장 복습 루틴', steps: [{ step: '외운 단어 10개 랜덤 테스트', minutes: 10 }, { step: '틀린 단어 집중 암기', minutes: 10 }], tags: ['#암기'] },
    { title: '수학 모의고사 루틴', steps: [{ step: '수학 모의고사 실제처럼 풀기 (100분)', minutes: 100 }, { step: '채점 및 풀이 확인', minutes: 15 }, { step: '틀린 문제 체크 후 다시 한 번 풀어보기', minutes: 30 }], tags: ['#문제풀이', '#수학'] },
    { title: '국어 모의고사 루틴', steps: [{ step: '국어 모의고사 실제처럼 풀기 (80분)', minutes: 80 }, { step: '채점 및 풀이 확인', minutes: 15 }, { step: '틀린 문제 체크 후 다시 한 번 풀어보기', minutes: 30 }], tags: ['#문제풀이', '#수학'] },
    { title: '영어 모의고사 루틴', steps: [{ step: '영어 모의고사 실제처럼 풀기 (70분)', minutes: 70 }, { step: '채점 및 풀이 확인', minutes: 15 }, { step: '틀린 문제 체크 후 다시 한 번 풀어보기', minutes: 30 }], tags: ['#문제풀이', '#수학'] },
  ];

  const ORDER: Priority[] = ['필수', '중요', '선택'];

  // ✅ 진행 현황 계산
  const totalCount = plans.length;
  const completedCount = useMemo(() => plans.filter(p => p.done).length, [plans]);
  const progress = totalCount > 0 ? completedCount / totalCount : 0;

  // 완료/미완료 분리 + 섹션 그룹
  const grouped = useMemo(() => {
    const base: Record<Priority, { done: Plan[]; todo: Plan[] }> = {
      필수: { done: [], todo: [] },
      중요: { done: [], todo: [] },
      선택: { done: [], todo: [] },
    };
    plans.forEach((p) => (p.done ? base[p.priority].done.push(p) : base[p.priority].todo.push(p)));
    ORDER.forEach((k) => {
      const sortFn = (a: Plan, b: Plan) =>
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      base[k].todo.sort(sortFn);
      base[k].done.sort(sortFn);
    });
    return base;
  }, [plans]);

  // ---------- 오프셋/날짜 확인 ----------
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
    } else {
      setPlans([]);
    }
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

  // ---------- 오늘(논리적 하루) 합산 ----------
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

  // ---------- 루틴 추천 ----------
  const refreshRanking = async (_uid: string) => {
    try {
      const today = getTodayKSTDateString();
      const json = await AsyncStorage.getItem(k(RUN_EVENTS_KEY_BASE, _uid));
      const events: RunEvent[] = json ? JSON.parse(json) : [];
      const usedMap: Record<string, string[]> = {};
      events.forEach((ev) => {
        if (!usedMap[ev.title]) usedMap[ev.title] = [];
        if (!usedMap[ev.title].includes(ev.usedAt)) usedMap[ev.title].push(ev.usedAt);
      });

      const scored = baseRoutines.map((r) => {
        const dates = usedMap[r.title] ?? [];
        const usedSet = new Set(dates);
        const streak = calcStreak(usedSet, today);
        const recent = calcRecentCount(dates, today);
        const since = lastUsedDaysAgo(dates, today);
        const longUnused = since === null ? LONG_UNUSED_CAP_DAYS : Math.min(since, LONG_UNUSED_CAP_DAYS);
        let score = W_STREAK * streak + W_RECENT * recent + W_LONG_UNUSED * longUnused;
        if (dates.length === 0) score += COLD_START_BONUS;
        return { ...r, _score: score, _detail: { streak, recent, longUnused, coldStart: dates.length === 0 } };
      });

      scored.sort((a, b) => b._score - a._score);
      setRankedRoutines(scored);
      setCurrentIndex(0);
    } catch (e) {
      console.error('루틴 추천 점수 계산 실패:', e);
      setRankedRoutines(
        baseRoutines.map((r) => ({ ...r, _score: 0, _detail: { streak: 0, recent: 0, longUnused: 0, coldStart: true } }))
      );
      setCurrentIndex(0);
    }
  };

  // ---------- 초기 로딩 ----------
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        setUid(null);
        return;
      }
      setUid(user.uid);

      await ensureFreshDayAndLoad(user.uid);

      try {
        await computeTodaySeconds(user.uid);
      } catch (error) {
        console.error('오늘 기록 불러오기 실패:', error);
      } finally {
        await refreshRanking(user.uid);
      }
    });
    return unsubscribe;
  }, [router]);

  // ---------- 앱 포그라운드/자정 경계 ----------
  useEffect(() => {
    if (!uid) return;
    const handler = async (state: AppStateStatus) => {
      if (state === 'active') {
        await loadDayOffset(uid);
        const offset = dayOffsetRef.current;
        const todayLogical = getLogicalDateStringKST(offset);
        if (todayLogical !== lastLogicalDateRef.current) {
          await resetForNewLogicalDay(uid, todayLogical);
          lastLogicalDateRef.current = todayLogical;
          try { router.replace('/setup'); } catch {}
        }
        await computeTodaySeconds(uid);
      }
    };
    const sub = AppState.addEventListener('change', handler);
    return () => sub.remove();
  }, [uid]);

  // 자정 경계 체크 + 1분마다 오늘 합산 갱신
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
    }, 60 * 1000);
    return () => clearInterval(id);
  }, [uid]);

  // ---------- 추천 루틴 UI 핸들러 ----------
  const recommendedRoutine = rankedRoutines[currentIndex] || baseRoutines[0];
  const handleNextRoutine = () => {
    if (rankedRoutines.length === 0) return;
    setCurrentIndex((prev) => (prev + 1) % rankedRoutines.length);
    setShowSteps(false);
  };

  const handleStartRoutine = async () => {
    if (!uid || isLaunchingRoutine) return;
    setIsLaunchingRoutine(true);
    try {
      const today = getTodayKSTDateString();
      const json = await AsyncStorage.getItem(k(RUN_EVENTS_KEY_BASE, uid));
      const events: RunEvent[] = json ? JSON.parse(json) : [];
      events.push({ title: recommendedRoutine.title, usedAt: today });
      await AsyncStorage.setItem(k(RUN_EVENTS_KEY_BASE, uid), JSON.stringify(events));
      await refreshRanking(uid);

      const packedSteps = serializeSteps(recommendedRoutine.steps || []);
      router.push({
        pathname: '/routine/run',
        params: {
          title: recommendedRoutine.title || '루틴',
          steps: packedSteps,
          setCount: String(1),
          origin: 'home',
        },
      } as any);
    } catch (e) {
      console.error('루틴 실행 이동 실패:', e);
      const packedSteps = serializeSteps(recommendedRoutine.steps || []);
      router.push({
        pathname: '/routine/run',
        params: {
          title: recommendedRoutine.title || '루틴',
          steps: packedSteps,
          setCount: String(1),
          origin: 'home',
        },
      } as any);
    } finally {
      setTimeout(() => setIsLaunchingRoutine(false), 600);
    }
  };

  // ---------- 계획 체크 ----------
  const togglePlanDone = async (id: string) => {
    try {
      if (!uid) return;
      const updated = plans.map((p) => (p.id === id ? { ...p, done: !p.done } : p));
      setPlans(updated);
      await AsyncStorage.setItem(k(PLANS_KEY_BASE, uid), JSON.stringify(updated));
    } catch (e) {
      console.error('계획 상태 저장 실패:', e);
    }
  };

  // ---------- 전체 시작(배치 화면으로 이동) ----------
  const goBatchStart = () => {
    const queue = [...plans].sort((a, b) => {
      const prioOrder = (p: Priority) => (p === '필수' ? 0 : p === '중요' ? 1 : 2);
      const pa = prioOrder(a.priority);
      const pb = prioOrder(b.priority);
      if (pa !== pb) return pa - pb;
      if (a.done !== b.done) return a.done ? 1 : -1;
      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    });

    router.push({
      pathname: '/plan/batch',
      params: {
        plans: encodeURIComponent(JSON.stringify(queue)),
      },
    } as any);
  };

  // 표시용
  const formatTime = (seconds: number) => {
    const safe = Math.max(0, seconds);
    const h = Math.floor(safe / 3600);
    const m = Math.floor((safe % 3600) / 60);
    const s = safe % 60;
    return `${h}시간 ${m}분 ${s}초`;
  };
  const remainingSeconds = Math.max(0, goalMinutes * 60 - studiedSeconds);

  const allDone = totalCount > 0 && completedCount === totalCount;
  const anyTodo = totalCount > 0 && completedCount < totalCount;

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.header}>오늘도 StudyFit과 함께 해요! </Text>

      {/* ✅ 전부 완료 배너 */}
      {allDone && (
        <View style={styles.allDoneBanner}>
          <Text style={styles.allDoneText}>🎉 오늘의 계획을 모두 완료했어요!</Text>
        </View>
      )}

      {/* 메모 배너 */}
      {memo?.trim()?.length > 0 && (
        <View style={styles.memoBanner}>
          <Text style={styles.memoTitle}>📌 오늘의 메모</Text>
          <Text style={styles.memoText}>{memo}</Text>
        </View>
      )}

      {/* 추천 루틴 */}
      <View style={styles.recommendBox}>
        <View style={styles.rowSpaceBetween}>
          <Text style={styles.recommendTitle}>📘 오늘의 추천 루틴</Text>
          <TouchableOpacity onPress={() => setShowCriteria(!showCriteria)}>
            <Text style={styles.icon}>💡</Text>
          </TouchableOpacity>
        </View>

        {showCriteria && (
          <View style={styles.criteriaBox}>
            <Text style={styles.criteriaHeader}>📌 추천 기준</Text>
            <Text style={styles.criteriaText}>1. 연속 실행된 루틴 우선</Text>
            <Text style={styles.criteriaText}>2. 최근 자주 실행한 루틴</Text>
            <Text style={styles.criteriaText}>3. 오랫동안 실행하지 않은 루틴</Text>
          </View>
        )}

        <View style={styles.rowSpaceBetween}>
          <Text style={styles.routineTitle}>{recommendedRoutine.title}</Text>
          <TouchableOpacity onPress={() => setShowSteps(!showSteps)}>
            <Text style={styles.icon}>⌄</Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.totalTime}>
          ({(recommendedRoutine.steps || []).reduce((sum: number, step: any) => sum + (step?.minutes ?? 0), 0)}분)
        </Text>

        {showSteps && (
          <View style={styles.stepsBox}>
            {(recommendedRoutine.steps || []).map((s: any, i: number) => (
              <Text key={i} style={styles.stepItem}>
                • {s?.step ?? ''} ({s?.minutes ?? 0}분)
              </Text>
            ))}
          </View>
        )}

        <TouchableOpacity
          style={[styles.startButton, isLaunchingRoutine && { opacity: 0.6 }]}
          onPress={handleStartRoutine}
          disabled={isLaunchingRoutine}
        >
          <Text style={styles.startButtonText}>지금 실행하기</Text>
        </TouchableOpacity>

        <TouchableOpacity onPress={handleNextRoutine} style={styles.changeButton}>
          <Text style={styles.changeButtonText}>다른 루틴 보기</Text>
        </TouchableOpacity>
      </View>

      {/* 공부 시간 */}
      <Text style={styles.timeText}>📚 오늘 공부 시간: {formatTime(studiedSeconds)}</Text>
      <Text style={styles.timeText}>⏳ 남은 목표 시간: {formatTime(remainingSeconds)}</Text>

      {/* ✅ 진행률 바 */}
      {totalCount > 0 && (
        <View style={styles.progressWrap}>
          <View style={styles.progressBar}>
            <View style={[styles.progressFill, { width: `${Math.round(progress * 100)}%` }]} />
          </View>
          <Text style={styles.progressText}>
            진행률 {completedCount}/{totalCount}
          </Text>
        </View>
      )}

      {/* 오늘의 계획 */}
      <View style={styles.todoBox}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text style={styles.sectionTitle}>오늘의 계획</Text>
          <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
            {completedCount > 0 && (
              <TouchableOpacity
                onPress={() => setShowCompleted(v => !v)}
                style={{ paddingVertical: 6, paddingHorizontal: 10, backgroundColor: '#EEF2FF', borderRadius: 10 }}
              >
                <Text style={{ fontSize: 12, color: '#1D4ED8', fontWeight: '700' }}>
                  {showCompleted ? `완료 숨기기 (${completedCount})` : `완료 보기 (${completedCount})`}
                </Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              onPress={() => router.push('/setup')}
              style={{ paddingVertical: 6, paddingHorizontal: 10, backgroundColor: '#F3F4F6', borderRadius: 10 }}
            >
              <Text style={{ fontSize: 12, color: '#111827' }}>+ 계획 추가</Text>
            </TouchableOpacity>
          </View>
        </View>

        {(['필수','중요','선택'] as Priority[]).map((pri) => {
          const todoList = grouped[pri]?.todo || [];
          const doneList = grouped[pri]?.done || [];
          if (todoList.length === 0 && (!showCompleted || doneList.length === 0)) return null;

          const renderItem = (p: Plan, isDone: boolean) => (
            <View key={p.id} style={[styles.todoItemCard, isDone && { backgroundColor: '#FAFAFA' }]}>
              <Pressable style={styles.todoItemRow} onPress={() => togglePlanDone(p.id)}>
                <View style={[styles.checkbox, isDone && { borderColor: '#10B981', backgroundColor: '#ECFDF5' }]}>
                  {p.done && <Text style={styles.checkmark}>✓</Text>}
                </View>
                <Text
                  style={[
                    styles.todoItemText,
                    isDone && { textDecorationLine: 'line-through', color: '#9CA3AF' },
                  ]}
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
                <Text style={{ marginLeft: 6, color: '#6B7280' }}>
                  ({todoList.length + (showCompleted ? doneList.length : 0)})
                </Text>
              </View>

              {/* 미완료 먼저 */}
              {todoList.map((p) => renderItem(p, false))}

              {/* 완료(옵션) */}
              {showCompleted && doneList.length > 0 && (
                <View style={{ marginTop: 4 }}>
                  {doneList.map((p) => renderItem(p, true))}
                </View>
              )}
            </View>
          );
        })}

        {plans.length === 0 && (
          <Text style={{ fontSize: 14, color: '#333' }}>오늘의 계획이 없습니다. 세팅 화면에서 추가해 보세요.</Text>
        )}

        {/* ✅ 하단 단일 버튼: 배치 시작 화면으로 이동 (모두 완료 시 비활성) */}
        <TouchableOpacity
          onPress={anyTodo ? goBatchStart : undefined}
          disabled={!anyTodo}
          style={[
            styles.batchBtn,
            !anyTodo && { backgroundColor: '#E5E7EB' },
          ]}
        >
          <Text style={[styles.batchBtnText, !anyTodo && { color: '#6B7280' }]}>
            {anyTodo ? '오늘의 공부 시작하기' : '오늘의 계획 모두 완료'}
          </Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 20, backgroundColor: '#FFFFFF', flexGrow: 1 },
  header: { fontSize: 20, fontWeight: 'bold', textAlign: 'center', marginTop: 70, marginBottom: 20 },

  allDoneBanner: {
    backgroundColor: '#ECFDF5',
    borderColor: '#A7F3D0',
    borderWidth: 1,
    padding: 12,
    borderRadius: 12,
    marginBottom: 12,
  },
  allDoneText: { color: '#065F46', fontWeight: '700', textAlign: 'center' },

  memoBanner: { backgroundColor: '#F9FAFB', borderWidth: 1, borderColor: '#E5E7EB', padding: 12, borderRadius: 12, marginBottom: 16 },
  memoTitle: { fontSize: 13, color: '#6B7280', marginBottom: 4, fontWeight: '600' },
  memoText: { fontSize: 14, color: '#111827', marginTop: 10},

  recommendBox: { backgroundColor: '#E0ECFF', padding: 20, borderRadius: 16, marginBottom: 30, marginTop: 40 },
  rowSpaceBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  icon: { fontSize: 18 },
  recommendTitle: { fontSize: 16, fontWeight: '600', marginBottom: 5},
  routineTitle: { fontSize: 16, fontWeight: '500', marginVertical: 10 },
  totalTime: { fontSize: 13, color: '#6B7280', marginBottom: 10 },
  criteriaBox: { marginTop: 6, marginBottom: 12, padding: 10, backgroundColor: '#BFDBFE', borderRadius: 8 },
  criteriaHeader: { fontSize: 12, color: '#1E3A8A', marginBottom: 4, fontWeight: '600' },
  criteriaText: { fontSize: 12, color: '#1E3A8A', marginBottom: 2 },
  stepsBox: { backgroundColor: '#DBEAFE', padding: 10, borderRadius: 8, marginBottom: 10 },
  stepItem: { fontSize: 13, color: '#1F2937', marginBottom: 3 },
  startButton: { backgroundColor: '#3B82F6', padding: 10, borderRadius: 8, alignItems: 'center', marginBottom: 10 },
  startButtonText: { color: '#fff', fontSize: 14 },
  changeButton: { alignItems: 'center', padding: 6, marginTop: 4 },
  changeButtonText: { fontSize: 13, color: '#2563EB' },

  timeText: { fontSize: 14, marginBottom: 8, marginLeft: 10 },

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

  todoItemCard: {
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 12,
    padding: 12,
    backgroundColor: '#FFFFFF',
    marginBottom: 10,
    gap: 8,
  },
  todoItemRow: { flexDirection: 'row', alignItems: 'center' },
  checkbox: {
    width: 20,
    height: 20,
    borderWidth: 2,
    borderRadius: 4,
    marginRight: 12,
    backgroundColor: '#fff',
    borderColor: '#9CA3AF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkmark: { fontSize: 14, lineHeight: 14, fontWeight: '700', color: '#111827' },
  todoItemText: { fontSize: 15, flex: 1 },

  batchBtn: { marginTop: 10, backgroundColor: '#3B82F6', padding: 12, borderRadius: 12, alignItems: 'center' },
  batchBtnText: { color: '#fff', fontWeight: '800' },
});
