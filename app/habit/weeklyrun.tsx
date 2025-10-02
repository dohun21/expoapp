// app/habit/weeklyrun.tsx
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { onAuthStateChanged } from 'firebase/auth';
import React, { useEffect, useRef, useState } from 'react';
import { Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { auth } from '../../firebaseConfig';

/* =========================
 * 타입
 * =======================*/
type Step = { step: string; minutes: number };
type RoutineLibItem = { id: string; title: string; steps: Step[]; tags?: string[] };
type WeeklyPlanItem = {
  planId: string;
  routineId?: string;
  title?: string;
  steps?: Step[];
  subject?: string;
  content?: string;
  setCount?: number;
  startAt?: string;   // "HH:mm"
};
type RoutineRun = {
  planId?: string;
  title: string;
  content: string;
  setCount: number;
  steps: Step[];
  startAtMin?: number | null;
  durationMin: number;
};

/* =========================
 * 키/유틸
 * =======================*/
const WEEKLY_KEY_BASE = 'weeklyPlannerV1';
const ROUTINE_TAB_KEY = '@userRoutinesV1';           // (구) 사용자 루틴 라이브러리
const ROUTINE_LIBRARY_KEY_BASE = 'routineLibraryV1';  // (신) 사용자 루틴 라이브러리
const DAY_START_OFFSET_KEY_BASE = 'dayStartOffsetMin';
const DEFAULT_DAY_START_MIN = 240; // 04:00
const DRAFTS_KEY_BASE = 'routineRunDraftsV1';
const DAILY_CHECKIN_KEY_BASE = 'dailyCheckinV1';

const k = (base: string, uid?: string | null) => (uid ? `${base}_${uid}` : base);

const koDow = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const dowKey = (d: Date) => koDow[(d.getDay() + 6) % 7];

function minutesOf(steps: Step[]) {
  return steps.reduce((a, s) => a + (s?.minutes || 0), 0);
}
function formatStudyTime(totalSec: number) {
  const n = Math.max(0, Math.floor(totalSec));
  const h = Math.floor(n / 3600);
  const m = Math.floor((n % 3600) / 60);
  const s = n % 60;
  return h > 0 ? `${h}시간 ${m}분 ${s}초` : `${m}분 ${s}초`;
}
function getLogicalKSTDate(offsetMin: number) {
  const now = new Date();
  const kstMs = now.getTime() + (9 * 60 - now.getTimezoneOffset()) * 60000;
  return new Date(kstMs - offsetMin * 60000);
}
async function getDayOffset(uid: string | null) {
  if (!uid) return DEFAULT_DAY_START_MIN;
  const raw = await AsyncStorage.getItem(k(DAY_START_OFFSET_KEY_BASE, uid));
  const v = Number(raw);
  return Number.isFinite(v) ? v : DEFAULT_DAY_START_MIN;
}
function ymd(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

/* =========================
 * 주간표 로드(키 불일치 보정)
 * =======================*/
async function readWeekly(uid: string | null) {
  const keysToTry = [
    k(WEEKLY_KEY_BASE, uid),    // weeklyPlannerV1_<uid>
    `${WEEKLY_KEY_BASE}_local`, // local fallback
    WEEKLY_KEY_BASE,            // legacy
  ];

  const hasAnyDayItems = (weekly: any) => {
    if (!weekly) return false;
    const src = weekly?.days ?? weekly?.week ?? weekly;
    const days = ['mon','tue','wed','thu','fri','sat','sun'];
    return days.some(d => Array.isArray(src?.[d]) && src[d].length > 0);
  };

  let picked: any = null;
  let pickedKey: string | null = null;

  for (const key of keysToTry) {
    const raw = await AsyncStorage.getItem(key);
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw);
      if (hasAnyDayItems(parsed)) {
        picked = parsed;
        pickedKey = key;
        break;
      }
    } catch {}
  }

  // 로그인 상태에서 _local이 선택되었으면 uid 키로 이관
  try {
    if (uid && picked && pickedKey === `${WEEKLY_KEY_BASE}_local`) {
      await AsyncStorage.setItem(k(WEEKLY_KEY_BASE, uid), JSON.stringify(picked));
    }
  } catch {}

  if (!picked) {
    // 내용 없는 객체라도 마지막으로 하나 반환(완전 null 방지)
    for (const key of keysToTry) {
      const raw = await AsyncStorage.getItem(key);
      if (raw) {
        try { return JSON.parse(raw); } catch {}
      }
    }
  }
  return picked; // null 가능
}

function pickDayList(weekly: any, key: string): any[] {
  if (!weekly) return [];
  const direct = weekly?.[key];
  if (Array.isArray(direct)) return direct;
  const days1 = weekly?.days?.[key];
  if (Array.isArray(days1)) return days1;
  const week1 = weekly?.week?.[key];
  if (Array.isArray(week1)) return week1;
  const firstArray = Object.values(weekly || {}).find((v: any) => Array.isArray(v));
  return Array.isArray(firstArray) ? (firstArray as any[]) : [];
}

function parsePackedSteps(packed?: string): Step[] {
  if (!packed) return [];
  return packed
    .split('|')
    .map((pair) => {
      const [s, m] = pair.split(',');
      return { step: (s || '').trim(), minutes: Math.max(0, Number(m) || 0) };
    })
    .filter((s) => s.step.length > 0);
}
function parseHMToMin(hm?: string): number | null {
  if (!hm) return null;
  const m = hm.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]), mi = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(mi)) return null;
  return h * 60 + mi;
}
async function getLogicalMinutesNow(uid: string | null) {
  const offset = await getDayOffset(uid);
  const logical = getLogicalKSTDate(offset);
  return logical.getHours() * 60 + logical.getMinutes();
}

/* =========================
 * 프리셋(라이브러리 병합용)
 * =======================*/
const PRESETS: RoutineLibItem[] = [
  { id: 'preset-2',  title: '영단어 암기 루틴', steps: [
    { step: '영단어 외우기', minutes: 20 },
    { step: '예문 만들기', minutes: 15 },
    { step: '퀴즈 테스트 해보기 1분', minutes: 10 },
  ]},
  { id: 'preset-3',  title: '오답 집중 루틴', steps: [
    { step: '최근 오답 복습', minutes: 20 },
    { step: '비슷한 유형 문제 다시 풀기', minutes: 25 },
    { step: '정답/오답 비교 정리', minutes: 15 },
  ]},
  { id: 'preset-4',  title: '시험 전날 총정리 루틴', steps: [
    { step: '전체 범위 핵심 정리', minutes: 40 },
    { step: '예상 문제 풀기', minutes: 30 },
    { step: '오답 노트 만들기', minutes: 20 },
  ]},
  { id: 'preset-20', title: '단어장 복습 루틴', steps: [
    { step: '외운 단어 10개 랜덤 테스트', minutes: 10 },
    { step: '틀린 단어 집중 암기', minutes: 10 },
  ]},
];

export default function WeeklyRun() {
  const router = useRouter();
  const params = useLocalSearchParams();

  // URL 파라미터(단일 실행 fallback)
  const paramTitle =
    (Array.isArray(params?.title) ? params.title[0] : (params?.title as string)) ||
    (Array.isArray(params?.routineTitle) ? params.routineTitle[0] : (params?.routineTitle as string));
  const paramStepsPacked = Array.isArray(params?.steps) ? params.steps[0] : (params?.steps as string | undefined);
  const paramSetCount =
    Number(Array.isArray(params?.setCount) ? params.setCount[0] : (params?.setCount as string | undefined)) || 1;
  const paramContent = Array.isArray(params?.content) ? params.content[0] : (params?.content as string | undefined);

  // 인증
  const [uid, setUid] = useState<string | null>(null);
  const [authReady, setAuthReady] = useState(false);
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUid(u?.uid ?? null);
      setAuthReady(true);
    });
    return () => unsub();
  }, []);

  // 오늘 큐
  const [queue, setQueue] = useState<RoutineRun[]>([]);
  const [loadingList, setLoadingList] = useState(true);

  // 큐 로드
  useEffect(() => {
    async function loadQueue() {
      if (!authReady) return;

      // (A) 파라미터 단일 실행
      if (paramTitle && paramStepsPacked) {
        const parsed = parsePackedSteps(paramStepsPacked);
        const single: RoutineRun = {
          title: paramTitle.trim(),
          content: (paramContent ?? '').trim(),
          setCount: Math.max(1, paramSetCount || 1),
          steps: parsed,
          startAtMin: null,
          durationMin: minutesOf(parsed) * Math.max(1, paramSetCount || 1),
        };
        setQueue([single]);
        setLoadingList(false);
        return;
      }

      // (B) 오늘 요일 기반 큐(시간과 무관하게 '목록 → 순서대로' 진행)
      setLoadingList(true);
      try {
        const weekly = await readWeekly(uid);

        // ✅ 1) 논리적 하루 시작(예: 04:00) 기준 요일
        const offset = await getDayOffset(uid);
        const keyLogical = dowKey(getLogicalKSTDate(offset));

        // ✅ 2) KST 자정 기준 요일 (Home과 동일한 기준)
        const keyKst = dowKey(getLogicalKSTDate(0));

        // 우선순위: 논리적 → KST → 폴백(첫 배열)
        let rawList: WeeklyPlanItem[] =
          (pickDayList(weekly, keyLogical) as WeeklyPlanItem[]) || [];

        if (!rawList.length && keyKst !== keyLogical) {
          rawList = (pickDayList(weekly, keyKst) as WeeklyPlanItem[]) || [];
        }

        if (!rawList.length) {
          const anyFallback = pickDayList(weekly, '') as WeeklyPlanItem[];
          if (Array.isArray(anyFallback) && anyFallback.length) {
            rawList = anyFallback;
          }
        }

        // 라이브러리: (구) @userRoutinesV1 + (신) routineLibraryV1_<uid> + PRESETS 병합
        const libFromOldKeyRaw = await AsyncStorage.getItem(ROUTINE_TAB_KEY);
        const libFromNewKeyRaw = await AsyncStorage.getItem(k(ROUTINE_LIBRARY_KEY_BASE, uid));

        const libOld: RoutineLibItem[] = libFromOldKeyRaw ? JSON.parse(libFromOldKeyRaw) : [];
        const libNew: RoutineLibItem[] = libFromNewKeyRaw ? JSON.parse(libFromNewKeyRaw) : [];

        const mergedMap: Record<string, RoutineLibItem> = {};
        [...libOld, ...libNew].forEach((r: any) => {
          if (!r) return;
          const id = String(r.id ?? '');
          const steps: Step[] = Array.isArray(r.steps)
            ? r.steps.map((s: any) => ({ step: String(s?.step || ''), minutes: Number(s?.minutes || 0) }))
            : [];
          if (!id || steps.length === 0) return;
          mergedMap[id] = { id, title: String(r.title ?? '루틴'), steps, tags: Array.isArray(r.tags) ? r.tags.map((t:any)=>String(t)) : [] };
        });
        PRESETS.forEach(p => {
          if (!mergedMap[p.id]) mergedMap[p.id] = { id: p.id, title: p.title, steps: p.steps, tags: (p as any).tags || [] };
        });
        const mergedLib: RoutineLibItem[] = Object.values(mergedMap);
        const findLib = (id?: string) => (id ? mergedLib.find(x => x.id === id) : undefined);

        const materialized: RoutineRun[] = [];
        for (const it0 of rawList) {
          const it = { ...it0, planId: String((it0 as any)?.planId ?? (it0 as any)?.id ?? '') } as WeeklyPlanItem;

          let steps: Step[] | undefined =
            Array.isArray(it?.steps)
              ? it!.steps!.map((s: any) => ({ step: String(s?.step || ''), minutes: Number(s?.minutes || 0) }))
              : undefined;

          if ((!steps || steps.length === 0) && it?.routineId) {
            const found = findLib(it.routineId);
            if (found?.steps?.length) {
              steps = found.steps;
              if (!it.title && found.title) (it as any).title = found.title;
            }
          }
          if (!steps || steps.length === 0) continue;

          const setCount = Math.max(1, Number(it?.setCount || 1));
          const durationMin = minutesOf(steps) * setCount;
          const startAtMin = parseHMToMin(it?.startAt);

          materialized.push({
            planId: it.planId,
            title: String(it?.title || '루틴'),
            content: String((it as any)?.content || (it as any)?.subject || ''),
            setCount,
            steps,
            startAtMin,
            durationMin,
          });
        }

        // 보기 편하게 시작시간 기준 정렬(실행 순서는 배열 인덱스 순으로 진행)
        materialized.sort((a, b) => {
          const A = a.startAtMin ?? 99999;
          const B = b.startAtMin ?? 99999;
          return A - B;
        });

        setQueue(materialized);
      } finally {
        setLoadingList(false);
      }
    }
    loadQueue();
  }, [authReady, uid, paramTitle, paramStepsPacked, paramSetCount, paramContent]);

  // 시간 표기를 위한 now(자동 시작 제거: 표시에만 사용)
  const [nowMinState, setNowMinState] = useState(0);
  useEffect(() => {
    let intA: ReturnType<typeof setInterval> | null = null;
    (async () => setNowMinState(await getLogicalMinutesNow(uid)))();
    intA = setInterval(async () => {
      setNowMinState(await getLogicalMinutesNow(uid));
    }, 60 * 1000);
    return () => { if (intA) clearInterval(intA); };
  }, [uid]);

  // 실행 상태
  const [phase, setPhase] = useState<'list' | 'run'>('list');
  const [routineIdx, setRoutineIdx] = useState(0);
  const currentRoutine: RoutineRun | undefined = queue[routineIdx];
  const steps: Step[] = currentRoutine?.steps || [];
  const setCount = currentRoutine?.setCount || 1;
  const routineTitle = currentRoutine?.title || '';
  const content = currentRoutine?.content || '';

  const totalSteps = steps.length;
  const [ready, setReady] = useState(true);
  const [setIdx, setSetIdx] = useState(0);
  const [stepIdx, setStepIdx] = useState(0);
  const [running, setRunning] = useState(false);
  const [leftSec, setLeftSec] = useState(0);
  const elapsedRef = useRef(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const sec = (steps[Math.min(stepIdx, Math.max(0, totalSteps - 1))]?.minutes || 0) * 60;
    setLeftSec(sec);
  }, [stepIdx, steps, totalSteps]);

  useEffect(() => {
    if (!running) return;
    if (intervalRef.current) return;
    intervalRef.current = setInterval(() => {
      setLeftSec((prev) => {
        if (prev <= 1) {
          elapsedRef.current += 1;
          if (intervalRef.current) {
            clearInterval(intervalRef.current);
            intervalRef.current = null;
          }
          nextStepOrNextSetOrFinish();
          return 0;
        }
        elapsedRef.current += 1;
        return prev - 1;
      });
    }, 1000);
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [running, stepIdx, setIdx]);

  const isLastStepInSet = totalSteps > 0 && stepIdx === totalSteps - 1;
  const isLastSetInRoutine = setIdx === Math.max(1, setCount) - 1;

  function formatLeft(s: number) {
    const mm = Math.floor(s / 60);
    const ss = s % 60;
    return `${mm}분 ${String(ss).padStart(2, '0')}초`;
  }
  function stopTimer() {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    setRunning(false);
  }

  /* --------------------------
   * 체크인 저장
   * ------------------------*/
  const [showCheckin, setShowCheckin] = useState(false);
  const [mood, setMood] = useState<1 | 2 | 3 | 4 | 5>(3);
  const [focus, setFocus] = useState<1 | 2 | 3 | 4 | 5>(3);
  const [goalAchieved, setGoalAchieved] = useState<boolean>(false);
  const [pendingStatus, setPendingStatus] = useState<'draft' | 'final' | null>(null);
  const pendingElapsedRef = useRef(0);

  async function persistDraft(
    status: 'draft' | 'final',
    elapsedOverride?: number,
    withCheckin: boolean = false
  ) {
    const elapsed = Math.max(0, Math.floor(elapsedOverride ?? elapsedRef.current));
    const record: any = {
      status,
      title: routineTitle,
      setCount,
      plannedMinutes: minutesOf(steps) * Math.max(1, setCount),
      elapsedSeconds: elapsed,
      completedAt: new Date().toISOString(),
    };
    if (withCheckin) {
      record.mood = mood;
      record.focus = focus;
      record.goalAchieved = !!goalAchieved;
    }
    try {
      const key = k(DRAFTS_KEY_BASE, uid);
      const raw = (await AsyncStorage.getItem(key)) || '[]';
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) arr.push(record);
      await AsyncStorage.setItem(key, JSON.stringify(arr));
    } catch {}
  }

  async function saveRoutineCheckinForToday() {
    try {
      const offset = await getDayOffset(uid);
      const logical = getLogicalKSTDate(offset);
      const dayKey = `${k(DAILY_CHECKIN_KEY_BASE, uid)}_${ymd(logical)}`;
      const payload = {
        ymd: ymd(logical),
        routineIndex: routineIdx,
        routineTitle,
        mood, focus, goalAchieved: !!goalAchieved,
        savedAt: new Date().toISOString(),
      };
      const raw = await AsyncStorage.getItem(dayKey);
      let arr: any[] = [];
      if (raw) {
        try {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) arr = parsed;
          else if (parsed && typeof parsed === 'object') arr = [parsed];
        } catch {}
      }
      arr.push(payload);
      await AsyncStorage.setItem(dayKey, JSON.stringify(arr));
    } catch {}
  }

  function nextSequentialIndex(fromIndex: number): number | null {
    const nxt = fromIndex + 1;
    return nxt < queue.length ? nxt : null;
  }

  async function confirmCheckinAndProceed(nextAction: 'next' | 'exit') {
    if (!pendingStatus) return;
    await persistDraft(pendingStatus, pendingElapsedRef.current, true);
    await saveRoutineCheckinForToday();

    // 초기화
    setMood(3); setFocus(3); setGoalAchieved(false);
    setPendingStatus(null); setShowCheckin(false);

    if (nextAction === 'exit') {
      router.replace('/home');
      return;
    }

    // 시간 무시하고 '다음 순번'으로 진행
    const nxt = nextSequentialIndex(routineIdx);
    if (nxt == null) {
      router.replace('/home');
      return;
    }
    startRoutineAtIndex(nxt);
  }

  // 세트/단계 진행
  function nextStepOrNextSetOrFinish() {
    stopTimer();
    if (totalSteps === 0) return;

    if (isLastStepInSet) {
      if (!isLastSetInRoutine) {
        setSetIdx((s) => s + 1);
        setStepIdx(0);
        setTimeout(() => setRunning(true), 200);
      } else {
        finishCurrentRoutine();
      }
    } else {
      setStepIdx((i) => i + 1);
      setTimeout(() => setRunning(true), 200);
    }
  }

  function finishCurrentRoutine() {
    stopTimer();
    const planned = minutesOf(steps) * 60 * Math.max(1, setCount);
    const totalElapsed = Math.max(elapsedRef.current, planned);

    pendingElapsedRef.current = totalElapsed;
    setPendingStatus('final');
    setShowCheckin(true);
  }

  function startRoutineAtIndex(idx: number) {
    setPhase('run');
    setRoutineIdx(Math.max(0, idx));
    setSetIdx(0);
    setStepIdx(0);
    elapsedRef.current = 0;
    setReady(true);      // 준비 화면 먼저
    setRunning(false);   // 시작 버튼 눌러야 카운트 시작
  }

  /* =========================
   * 렌더
   * =======================*/
  if (phase === 'list') {
    if (loadingList) {
      return (
        <View style={[styles.page, { justifyContent: 'center', alignItems: 'center' }]}>
          <Text style={{ color: '#6B7280' }}>오늘의 루틴을 불러오는 중...</Text>
        </View>
      );
    }
    if (!queue.length) {
      return (
        <View style={[styles.page, { justifyContent: 'center', alignItems: 'center' }]}>
          <Text style={{ fontSize: 16, marginBottom: 10 }}>오늘 실행할 루틴이 없어요.</Text>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <TouchableOpacity onPress={() => router.replace('/habit/planner')} style={[styles.backBtn, { backgroundColor: '#059669' }]}>
              <Text style={styles.backText}>관리로 가기</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => router.replace('/home')} style={styles.backBtn}>
              <Text style={styles.backText}>홈으로</Text>
            </TouchableOpacity>
          </View>
        </View>
      );
    }

    const timeLabel = (r: RoutineRun) =>
      r.startAtMin != null
        ? `${String(Math.floor(r.startAtMin / 60)).padStart(2,'0')}:${String(r.startAtMin % 60).padStart(2,'0')}`
        : '시간 미지정';

    return (
      <View style={styles.page}>
        <Text style={styles.title}>오늘 실행할 루틴 {queue.length}개</Text>

        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 14 }}>
          {queue.map((r, i) => {
            const totalMin = r.durationMin;
            return (
              <View key={i} style={styles.card}>
                <View style={styles.titleRow}>
                  <Text style={styles.cardTitle} numberOfLines={1}>{r.title}</Text>
                  <Text style={styles.timePill}>{timeLabel(r)}</Text>
                  <Text style={[styles.timePill, { marginLeft: 6 }]}>총 {totalMin}분</Text>
                </View>
                {!!r.content && <Text style={styles.metaDim}>내용: {r.content}</Text>}

                <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
                  <TouchableOpacity
                    onPress={() => startRoutineAtIndex(i)}
                    style={[styles.smallBtn, styles.smallBtnPrimary]}
                  >
                    <Text style={styles.smallBtnText}>이 루틴 시작</Text>
                  </TouchableOpacity>
                </View>
              </View>
            );
          })}
        </ScrollView>

        <TouchableOpacity
          onPress={() => startRoutineAtIndex(0)}
          style={styles.readyBtn}
        >
          <Text style={styles.readyText}>첫 번째 루틴부터 시작</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // 실행 단계 준비 화면
  const current = steps[Math.min(stepIdx, Math.max(0, totalSteps - 1))] || { step: '', minutes: 0 };
  const stepProgress = totalSteps > 0 ? (stepIdx + 1) / totalSteps : 0;
  const setProgress = (setIdx + 1) / Math.max(1, setCount);
  const totalMinForThis = minutesOf(steps) * Math.max(1, setCount);

  if (ready) {
    return (
      <View style={styles.page}>
        <Text style={styles.runTitle} numberOfLines={2}>{routineTitle}</Text>

        <View style={styles.card}>
          <Text style={styles.metaDim}>총 {totalMinForThis}분</Text>
          {!!content && <Text style={[styles.metaDim, { marginTop: 4 }]}>내용: {content}</Text>}

          <View style={styles.stepList}>
            <Text style={styles.stepsHeader}>단계 목록</Text>
            {steps.map((s, i) => (
              <Text key={i} style={styles.stepChip}>
                • {s.step} ({s.minutes}분)
              </Text>
            ))}
          </View>
        </View>

        <View style={styles.progressBlock}>
          <Text style={styles.progressLabel}>단계 진행</Text>
          <View style={styles.progressBar}>
            <View style={[styles.progressFillBlue, { width: `${Math.round(stepProgress * 100)}%` }]} />
          </View>
          <Text style={[styles.progressLabel, { marginTop: 8 }]}>세트 진행</Text>
          <View style={styles.progressBar}>
            <View style={[styles.progressFill, { width: `${Math.round(setProgress * 100)}%` }]} />
          </View>
        </View>

        <TouchableOpacity onPress={() => { setReady(false); setRunning(true); }} style={styles.readyBtn}>
          <Text style={styles.readyText}>시작하기</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // 실행 중 화면
  const nextButtonLabel =
    (totalSteps > 0 && stepIdx === totalSteps - 1 && setIdx === Math.max(1, setCount) - 1)
      ? ((routineIdx >= queue.length - 1) ? '전체 마치기' : '루틴 마치기')
      : (isLastStepInSet ? '다음 세트' : '다음 단계');

  return (
    <View style={styles.page}>
      <Text style={styles.runTitle} numberOfLines={2}>{routineTitle}</Text>

      <View style={styles.card}>
        {!!content && <Text style={styles.metaDim}>내용: {content}</Text>}

        <View style={styles.progressBlock}>
          <Text style={styles.progressLabel}>단계 진행</Text>
          <View style={styles.progressBar}>
            <View style={[styles.progressFillBlue, { width: `${Math.round(stepProgress * 100)}%` }]} />
          </View>

          <Text style={[styles.progressLabel, { marginTop: 8 }]}>세트 진행</Text>
          <View style={styles.progressBar}>
            <View style={[styles.progressFill, { width: `${Math.round(setProgress * 100)}%` }]} />
          </View>
        </View>
      </View>

      <View style={styles.nowBox}>
        <Text style={styles.nowLabel}>지금 할 일</Text>
        <Text style={styles.nowTitle} numberOfLines={2}>{current.step}</Text>
        <Text style={styles.nowTimer}>{formatStudyTime(leftSec)}</Text>

        <View style={styles.btnRow}>
          <TouchableOpacity onPress={() => setRunning((r) => !r)} style={[styles.btn, styles.primary]}>
            <Text style={styles.btnText}>{running ? '일시정지' : '재개'}</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={nextStepOrNextSetOrFinish} style={[styles.btn, styles.blue]}>
            <Text style={styles.btnText}>{nextButtonLabel}</Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity
          onPress={async () => {
            stopTimer();
            pendingElapsedRef.current = elapsedRef.current;
            setPendingStatus('draft');
            setShowCheckin(true);
          }}
          style={[styles.btn, styles.gray, { marginTop: 8 }]}
        >
          <Text style={styles.btnText}>임시저장 후 나가기</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.stepsCard}>
        <Text style={styles.stepsHeader}>단계 목록</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingVertical: 4 }}>
          {steps.map((s, i) => {
            const active = i === stepIdx;
            return (
              <View key={i} style={[styles.stepPill, active ? styles.stepPillActive : null]}>
                <Text style={[styles.stepPillText, active ? styles.stepPillTextActive : null]}>
                  {i + 1}. {s.step}
                </Text>
              </View>
            );
          })}
        </ScrollView>
      </View>

      {/* 체크인 모달 (summary 스타일) */}
      <Modal visible={showCheckin} transparent animationType="slide" onRequestClose={() => setShowCheckin(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>루틴 체크인</Text>

            <Text style={styles.sheetLabel}>오늘의 느낌</Text>
            <View style={styles.chipsRow}>
              {[
                { v: 1, label: '최악' },
                { v: 2, label: '별로' },
                { v: 3, label: '보통' },
                { v: 4, label: '좋음' },
                { v: 5, label: '아주좋음' },
              ].map((o) => (
                <TouchableOpacity key={o.v} onPress={() => setMood(o.v as 1|2|3|4|5)} style={[styles.chip, mood === o.v && styles.chipActive]}>
                  <Text style={[styles.chipText, mood === o.v && styles.chipTextActive]}>{o.label}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={[styles.sheetLabel, { marginTop: 14 }]}>목표 달성 여부</Text>
            <View style={styles.chipsRow}>
              <TouchableOpacity onPress={() => setGoalAchieved(true)} style={[styles.chip, goalAchieved && styles.chipActive]}>
                <Text style={[styles.chipText, goalAchieved && styles.chipTextActive]}>달성</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setGoalAchieved(false)} style={[styles.chip, !goalAchieved && styles.chipActive]}>
                <Text style={[styles.chipText, !goalAchieved && styles.chipTextActive]}>미달성</Text>
              </TouchableOpacity>
            </View>

            <Text style={[styles.sheetLabel, { marginTop: 14 }]}>집중도</Text>
            <View style={styles.chipsRow}>
              {[1,2,3,4,5].map((v) => (
                <TouchableOpacity key={v} onPress={() => setFocus(v as 1|2|3|4|5)} style={[styles.circle, focus >= v && styles.circleActive]}>
                  <Text style={[styles.circleText, focus >= v && styles.circleTextActive]}>{v}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <View style={styles.sheetBtnRow}>
              <TouchableOpacity
                onPress={() => confirmCheckinAndProceed('exit')}
                style={[styles.sheetBtn, styles.sheetBtnGhost]}
              >
                <Text style={[styles.sheetBtnText, styles.sheetBtnGhostText]}>
                  {pendingStatus === 'draft' ? '임시저장 후 나가기' : '홈으로'}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => confirmCheckinAndProceed('next')}
                style={[styles.sheetBtn, styles.sheetBtnPrimary]}
              >
                <Text style={styles.sheetBtnText}>{(routineIdx >= queue.length - 1) ? '홈으로' : '다음 루틴 시작'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

/* =========================
 * 스타일
 * =======================*/
const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#FFFFFF', paddingHorizontal: 20, paddingTop: 50, paddingBottom: 16 },
  title: { fontSize: 18, fontWeight: 'bold', textAlign: 'center', marginBottom: 14, marginTop: 60, color: '#111827' },

  card: { backgroundColor: '#F8FAFC', borderRadius: 16, padding: 14, marginBottom: 12, borderWidth: 1, borderColor: '#E5E7EB' },
  cardTitle: { fontSize: 16, fontWeight: '900', color: '#0F172A', flex: 1 },
  metaDim: { fontSize: 12, color: '#6B7280' },

  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  timePill: {
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999,
    backgroundColor: '#DBEAFE', borderWidth: 1, borderColor: '#93C5FD',
    color: '#1D4ED8', fontWeight: '800', fontSize: 12,
  },

  progressBlock: { marginTop: 8 },
  progressLabel: { fontSize: 11, color: '#6B7280', marginTop: 6, marginBottom: 4, fontWeight: '700' },
  progressBar: { height: 10, backgroundColor: '#E5E7EB', borderRadius: 999, overflow: 'hidden' },
  progressFill: { height: '100%', backgroundColor: '#10B981' },
  progressFillBlue: { height: '100%', backgroundColor: '#2563EB' },

  readyBtn: { height: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: '#3B82F6', marginTop: 14 },
  readyText: { color: '#fff', fontWeight: '900', fontSize: 15 },

  smallBtn: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, borderWidth: 1 },
  smallBtnPrimary: { backgroundColor: '#2563EB', borderColor: '#1D4ED8' },
  smallBtnText: { color: '#fff', fontWeight: '800', fontSize: 12 },

  nowBox: { backgroundColor: '#EEF2FF', borderRadius: 16, padding: 16, marginTop: 8 },
  nowLabel: { fontSize: 12, color: '#374151' },
  nowTitle: { fontSize: 18, fontWeight: '900', marginTop: 4, color: '#1F2937' },
  nowTimer: { marginTop: 10, fontSize: 32, fontWeight: '900', color: '#111', letterSpacing: 0.5 },

  btnRow: { flexDirection: 'row', gap: 10, marginTop: 14 },
  btn: { flex: 1, height: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  primary: { backgroundColor: '#059669' },
  blue: { backgroundColor: '#2563EB' },
  gray: { backgroundColor: '#6B7280' },
  btnText: { color: '#fff', fontWeight: '800', fontSize: 15 },

  stepsCard: { marginTop: 12, backgroundColor: '#F8FAFC', borderRadius: 14, paddingVertical: 10, paddingHorizontal: 12, borderWidth: 1, borderColor: '#E5E7EB' },
  stepsHeader: { fontSize: 12, color: '#374151', fontWeight: '700', marginBottom: 6 },
  stepPill: { paddingHorizontal: 10, paddingVertical: 6, backgroundColor: '#E5E7EB', borderRadius: 999, marginRight: 8 },
  stepPillActive: { backgroundColor: '#1D4ED8' },
  stepPillText: { fontSize: 12, color: '#374151', fontWeight: '800' },
  stepPillTextActive: { color: '#FFFFFF' },

  runTitle: { fontSize: 18, fontWeight: '900', textAlign: 'center', marginBottom: 12, marginTop: 60, color: '#111827' },

  stepList: { marginTop: 8, backgroundColor: '#FFF', borderRadius: 12, padding: 10, borderWidth: 1, borderColor: '#E5E7EB' },
  stepChip: { fontSize: 12, color: '#111', marginBottom: 4 },

  backBtn: { backgroundColor: '#3B82F6', paddingHorizontal: 16, paddingVertical: 10, borderRadius: 10 },
  backText: { color: '#fff', fontWeight: '700' },

  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#fff', padding: 16, borderTopLeftRadius: 16, borderTopRightRadius: 16 },
  sheetTitle: { fontSize: 16, fontWeight: '900', color: '#111827', marginBottom: 8, textAlign: 'center' },
  sheetLabel: { fontSize: 12, color: '#374151', fontWeight: '700', marginTop: 4, marginBottom: 6 },
  chipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 10, paddingVertical: 8, borderRadius: 999, backgroundColor: '#F3F4F6', borderWidth: 1, borderColor: '#E5E7EB' },
  chipActive: { backgroundColor: '#1D4ED8', borderColor: '#1D4ED8' },
  chipText: { fontSize: 12, color: '#111827', fontWeight: '800' },
  chipTextActive: { color: '#fff' },

  circle: { width: 36, height: 36, borderRadius: 18, borderWidth: 1, borderColor: '#E5E7EB', backgroundColor: '#F3F4F6', alignItems: 'center', justifyContent: 'center' },
  circleActive: { backgroundColor: '#2563EB', borderColor: '#2563EB' },
  circleText: { fontSize: 12, color: '#111827', fontWeight: '900' },
  circleTextActive: { color: '#fff' },

  sheetBtnRow: { flexDirection: 'row', gap: 10, marginTop: 16 },
  sheetBtn: { flex: 1, height: 46, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  sheetBtnPrimary: { backgroundColor: '#2563EB' },
  sheetBtnGhost: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#E5E7EB' },
  sheetBtnText: { fontWeight: '900', color: '#fff' },
  sheetBtnGhostText: { color: '#111827' },
});
