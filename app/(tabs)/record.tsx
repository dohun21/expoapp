// app/(tabs)/record.tsx
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import { onAuthStateChanged } from 'firebase/auth';
import {
  Timestamp,
  addDoc,
  collection, getDocs, limit, query,
  serverTimestamp,
  where,
} from 'firebase/firestore';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated, Dimensions, Modal,
  PanResponder,
  Platform, ScrollView, Text, TouchableOpacity, View
} from 'react-native';
import { auth, db } from '../../firebaseConfig';

/* ===================== Types ===================== */
type StudyRecord = {
  subject?: string;
  content?: string;
  studyTime?: string;
  minutes?: number;
  totalMinutes?: number;
  seconds?: number;
  memo?: string;
  goalStatus?: 'success' | 'fail' | 'none';
  createdAt?: Timestamp | string | Date;
  timestamp?: Timestamp | string | Date;
  date?: Timestamp | string | Date;

  uid?: string; userId?: string; ownerId?: string; userUID?: string;
  email?: string; userEmail?: string;
};

type RoutineRecord = {
  title?: string;
  totalMinutes?: number;
  steps?: { step?: string; minutes?: number }[];
  setCount?: number;
  completed?: boolean;

  createdAt?: Timestamp | string | Date;
  completedAt?: Timestamp | string | Date;
  timestamp?: Timestamp | string | Date;
  date?: Timestamp | string | Date;

  uid?: string; userId?: string; ownerId?: string; userUID?: string;
  email?: string; userEmail?: string;
};

type Priority = '필수' | '중요' | '선택';
type Plan = { id: string; content: string; priority: Priority; done: boolean; createdAt: string };

type TabKey = 'list' | 'calendar';
type WeekStart = 'monday' | 'sunday';

/* ===================== UI Const ===================== */
const GREEN = { g1:'#A7F3D0', g2:'#6EE7B7', g3:'#34D399', g4:'#10B981', g5:'#059669', g6:'#064E3B' };
const BLUE  = { b:'#3B82F6' };
const GRAY  = { ring:'#E5E7EB', text:'#6B7280', light:'#F3F4F6' };

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');

/* ===================== Helpers ===================== */
const ALT_UID_FIELDS = ['userId','ownerId','userUID'] as const;
const ALT_EMAIL_FIELDS = ['email','userEmail'] as const;

// uid별 키
const k = (base: string, uid: string) => `${base}_${uid}`;
const PLANS_KEY_BASE = 'todayPlans';

function toDateSafe(v: any): Date {
  if (!v) return new Date(0);
  if (v instanceof Date) return v;
  if (typeof v?.toDate === 'function') return (v as Timestamp).toDate();
  const d = new Date(v as any);
  return isNaN(d.getTime()) ? new Date(0) : d;
}
function pickDate(obj: any): Date {
  const cands = ['createdAt','completedAt','timestamp','date'];
  for (const k of cands) if (obj?.[k]) return toDateSafe(obj[k]);
  return new Date(0);
}
function minutesFromStudy(r: StudyRecord): number {
  if (typeof r.totalMinutes === 'number') return r.totalMinutes;
  if (typeof r.minutes === 'number')      return r.minutes;
  if (typeof r.seconds === 'number')      return Math.floor(r.seconds / 60);
  const s = r.studyTime ?? '';
  const h = Number(s.match(/(\d+)\s*시간/)?.[1] ?? 0);
  const m = Number(s.match(/(\d+)\s*분/)?.[1] ?? 0);
  const sc= Number(s.match(/(\d+)\s*초/)?.[1] ?? 0);
  const total = h*60 + m + Math.floor(sc/60);
  return Number.isFinite(total) ? total : 0;
}
function totalMinutesFromRoutine(r: RoutineRecord): number {
  if (typeof r.totalMinutes === 'number') return r.totalMinutes;
  const sets = typeof r.setCount === 'number' ? r.setCount : 1;
  const sumSteps = (r.steps ?? []).reduce((a, s) => a + (s?.minutes ?? 0), 0);
  const total = sumSteps * sets;
  return Number.isFinite(total) ? total : 0;
}
function formatHM(min: number) {
  if (!Number.isFinite(min) || min <= 0) return '0분';
  const h = Math.floor(min / 60), m = Math.round(min % 60);
  if (h === 0) return `${m}분`;
  if (m === 0) return `${h}시간`;
  return `${h}시간 ${m}분`;
}
function minutesToColor(min?: number): string | null {
  const v = Number(min) || 0;
  if (v >= 600) return GREEN.g6;
  if (v >= 480) return GREEN.g5;
  if (v >= 360) return GREEN.g4;
  if (v >= 240) return GREEN.g3;
  if (v >= 120) return GREEN.g2;
  if (v >= 60)  return GREEN.g1;
  if (v > 0)    return 'rgba(16,185,129,0.15)';
  return null;
}
function ymdKey(d: Date) {
  const dt = toDateSafe(d);
  if (isNaN(dt.getTime())) return '—';
  const y = dt.getFullYear(), m = String(dt.getMonth()+1).padStart(2,'0'), dd = String(dt.getDate()).padStart(2,'0');
  return `${y}-${m}-${dd}`;
}
function getDaysInMonth(y: number, m0: number) { return new Date(y, m0+1, 0).getDate(); }
function firstWeekday(y: number, m0: number, start: WeekStart) {
  const dow = new Date(y, m0, 1).getDay();
  return start === 'monday' ? (dow + 6) % 7 : dow;
}
function startOfDay(d: Date) {
  const t = toDateSafe(d);
  return new Date(t.getFullYear(), t.getMonth(), t.getDate(), 0, 0, 0, 0);
}
function endOfDay(d: Date) {
  const t = toDateSafe(d);
  return new Date(t.getFullYear(), t.getMonth(), t.getDate(), 23, 59, 59, 999);
}

/* ===================== Screen ===================== */
export default function RecordScreen() {
  const router = useRouter();

  const [uid, setUid] = useState<string|null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [loading, setLoading] = useState(true);

  const [tab, setTab] = useState<TabKey>('list');

  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month0, setMonth0] = useState(now.getMonth());
  const [weekStart] = useState<WeekStart>('monday');

  const [dailyTotals, setDailyTotals] = useState<Record<string, number>>({});
  const [recentStudy, setRecentStudy] = useState<StudyRecord[]>([]);
  const [recentRoutine, setRecentRoutine] = useState<RoutineRecord[]>([]);

  const [detailDate, setDetailDate] = useState<Date|null>(null);
  const [dayStudy, setDayStudy] = useState<StudyRecord[]>([]);
  const [dayRoutine, setDayRoutine] = useState<RoutineRecord[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);

  // ✅ 오늘의 계획(AsyncStorage) 로딩 및 이행도 분석 (원본 유지용)
  const [todayPlans, setTodayPlans] = useState<Plan[]>([]);
  const [adherence, setAdherence] = useState({
    total:0, doneCount:0, matchedCount:0, coveragePct:0, overUnder:0, byPlan:[], recordedTotalMin:0
  } as any);

  // 범례 토글 (달력 탭에서 사용)
  const [legendOpen, setLegendOpen] = useState(false);

  // bottom sheet
  const sheetY = useRef(new Animated.Value(400)).current;

  // ===== Swiper refs (원본 구조 유지, list 탭에서는 사용 안함) =====
  const pagerRef = useRef<ScrollView>(null);
  const [page, setPage] = useState(0);
  const PAGES = 5;

  /* ------------- auth ------------- */
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      if (!user) { setUid(null); setAuthChecked(true); router.replace('/login'); return; }
      setUid(user.uid); setAuthChecked(true);
    });
    return unsub;
  }, []);

  /* ------------- load data ------------- */
  useEffect(() => {
    if (!authChecked || !uid) return;
    setRecentStudy([]);
    setRecentRoutine([]);
    setDailyTotals({});
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        await Promise.all([loadRecent(uid), loadMonth(uid, year, month0), loadPlans(uid)]);
      } finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [authChecked, uid, year, month0]);

  // 오늘의 계획 로드 (원본 유지)
  async function loadPlans(userId: string) {
    try {
      const raw = await AsyncStorage.getItem(k(PLANS_KEY_BASE, userId));
      if (!raw) { setTodayPlans([]); return; }
      const parsed: Plan[] = JSON.parse(raw);
      const todayKey = ymdKey(new Date());
      const onlyToday = parsed.filter(p => ymdKey(new Date(p.createdAt)) === todayKey);
      setTodayPlans(onlyToday);
    } catch {
      setTodayPlans([]);
    }
  }

  /* ------------- Firestore loaders (원본 로더 그대로) ------------- */
  async function loadRecent(userId: string) {
    const userEmail = auth.currentUser?.email ?? null;

    const fetchStudy = async (): Promise<StudyRecord[]> => {
      try {
        const snap = await getDocs(query(collection(db, 'studyRecords'), where('uid', '==', userId), limit(500)));
        if (!snap.empty) return snap.docs.map(d => d.data() as StudyRecord);
      } catch {}
      for (const f of ALT_UID_FIELDS) {
        try {
          const snap = await getDocs(query(collection(db, 'studyRecords'), where(f as any, '==', userId), limit(500)));
          if (!snap.empty) return snap.docs.map(d => d.data() as StudyRecord);
        } catch {}
      }
      if (userEmail) {
        for (const f of ALT_EMAIL_FIELDS) {
          try {
            const snap = await getDocs(query(collection(db, 'studyRecords'), where(f as any, '==', userEmail), limit(500)));
            if (!snap.empty) return snap.docs.map(d => d.data() as StudyRecord);
          } catch {}
        }
      }
      return [];
    };

    const fetchRoutine = async (): Promise<RoutineRecord[]> => {
      try {
        const snap = await getDocs(query(collection(db, 'routineRecords'), where('uid', '==', userId), limit(500)));
        if (!snap.empty) return snap.docs.map(d => d.data() as RoutineRecord);
      } catch {}
      for (const f of ALT_UID_FIELDS) {
        try {
          const snap = await getDocs(query(collection(db, 'routineRecords'), where(f as any, '==', userId), limit(500)));
          if (!snap.empty) return snap.docs.map(d => d.data() as RoutineRecord);
        } catch {}
      }
      if (userEmail) {
        for (const f of ALT_EMAIL_FIELDS) {
          try {
            const snap = await getDocs(query(collection(db, 'routineRecords'), where(f as any, '==', userEmail), limit(500)));
            if (!snap.empty) return snap.docs.map(d => d.data() as RoutineRecord);
          } catch {}
        }
      }
      return [];
    };

    const [ss, rr] = await Promise.all([fetchStudy(), fetchRoutine()]);

    const rrNorm = rr.map(r => ({
      ...r,
      totalMinutes: totalMinutesFromRoutine(r),
      createdAt: pickDate(r),
    }));
    const ssNorm = ss.map(s => ({
      ...s,
      createdAt: pickDate(s),
    }));

    ssNorm.sort((a,b)=> pickDate(b).getTime()-pickDate(a).getTime());
    rrNorm.sort((a,b)=> pickDate(b).getTime()-pickDate(a).getTime());

    setRecentStudy(ssNorm);
    setRecentRoutine(rrNorm);
  }

  /** ✅ 월 집계: 공부 + 루틴 (달력용 / 원본 유지) */
  async function loadMonth(userId: string, y: number, m0: number) {
    const from = new Date(y, m0, 1, 0,0,0,0);
    const to   = new Date(y, m0+1, 0, 23,59,59,999);

    const getStudy = async (): Promise<StudyRecord[]> => {
      try {
        const snap = await getDocs(query(collection(db,'studyRecords'), where('uid','==', userId), limit(500)));
        if (!snap.empty) return snap.docs.map(d=>d.data() as StudyRecord);
      } catch {}
      const email = auth.currentUser?.email ?? null;
      for (const f of ALT_UID_FIELDS) {
        try {
          const snap = await getDocs(query(collection(db,'studyRecords'), where(f as any,'==', userId), limit(500)));
          if (!snap.empty) return snap.docs.map(d=>d.data() as StudyRecord);
        } catch {}
      }
      if (email) {
        for (const f of ALT_EMAIL_FIELDS) {
          try {
            const snap = await getDocs(query(collection(db,'studyRecords'), where(f as any,'==', email), limit(500)));
            if (!snap.empty) return snap.docs.map(d=>d.data() as StudyRecord);
          } catch {}
        }
      }
      return [];
    };

    const getRoutine = async (): Promise<RoutineRecord[]> => {
      try {
        const snap = await getDocs(query(collection(db,'routineRecords'), where('uid','==', userId), limit(500)));
        if (!snap.empty) return snap.docs.map(d=>d.data() as RoutineRecord);
      } catch {}
      const email = auth.currentUser?.email ?? null;
      for (const f of ALT_UID_FIELDS) {
        try {
          const snap = await getDocs(query(collection(db,'routineRecords'), where(f as any,'==', userId), limit(500)));
          if (!snap.empty) return snap.docs.map(d=>d.data() as RoutineRecord);
        } catch {}
      }
      if (email) {
        for (const f of ALT_EMAIL_FIELDS) {
          try {
            const snap = await getDocs(query(collection(db,'routineRecords'), where(f as any,'==', email), limit(500)));
            if (!snap.empty) return snap.docs.map(d=>d.data() as RoutineRecord);
          } catch {}
        }
      }
      return [];
    };

    const [rowsS, rowsR] = await Promise.all([getStudy(), getRoutine()]);

    const map: Record<string, number> = {};
    rowsS.forEach(r => {
      const d = pickDate(r);
      if (d < from || d > to) return;
      const key = ymdKey(d);
      map[key] = (map[key] || 0) + minutesFromStudy(r);
    });
    rowsR.forEach(r => {
      const d = pickDate(r);
      if (d < from || d > to) return;
      const key = ymdKey(d);
      map[key] = (map[key] || 0) + totalMinutesFromRoutine(r);
    });

    setDailyTotals(map);
  }

  async function openDayDetail(d: Date) {
    if (!uid) return;
    setDetailLoading(true);
    setDetailDate(d);

    const inDay = (x: any) => {
      const t = pickDate(x);
      return t >= startOfDay(d) && t <= endOfDay(d);
    };

    setDayStudy(recentStudy.filter(inDay));
    setDayRoutine(recentRoutine.filter(inDay));
    setDetailLoading(false);
    openSheet();
  }

  /* ------------- 분석 파생값 (습관 전용 심플 버전) ------------- */

  // 최근 N일 범위 필터 (원본 함수와 동일 로직)
  function withinDays(dt: Date, days: number) {
    const end = endOfDay(new Date());
    const start = startOfDay(new Date(end.getTime() - (days-1) * 24 * 60 * 60 * 1000));
    return dt >= start && dt <= end;
  }

  // 루틴 제목별 “기록한 날(YYYY-MM-DD)” 집합
  const habits = useMemo(() => {
    const grouped = new Map<string, Set<string>>();
    recentRoutine.forEach(r => {
      const title = (r.title ?? '루틴').trim();
      const d = pickDate(r);
      if (!withinDays(d, 180)) return;
      const key = ymdKey(d);
      if (!grouped.has(title)) grouped.set(title, new Set());
      grouped.get(title)!.add(key);
    });

    const todayKey = ymdKey(new Date());
    type Habit = { title: string; todayDone: boolean; current: number; best: number; weekCount: number };
    const calcStreak = (days: Set<string>) => {
      // current
      let cur = 0; { let d = new Date(); while (days.has(ymdKey(d))) { cur += 1; d.setDate(d.getDate()-1); } }
      // best
      let best = 0, run = 0;
      let d = new Date(); d.setDate(d.getDate()-179);
      for (let i=0;i<180;i++){
        if (days.has(ymdKey(d))) run += 1; else { best = Math.max(best, run); run = 0; }
        d.setDate(d.getDate()+1);
      }
      best = Math.max(best, run);
      return { cur, best };
    };
    const weekCount = (days: Set<string>) => {
      const today = new Date();
      const dow = (today.getDay()+6)%7; // 월=0
      const monday = new Date(today); monday.setDate(today.getDate()-dow); monday.setHours(0,0,0,0);
      let c = 0;
      for (let i=0;i<7;i++){ const d=new Date(monday); d.setDate(monday.getDate()+i); if (days.has(ymdKey(d))) c++; }
      return c;
    };

    const list: Habit[] = [];
    grouped.forEach((days, title) => {
      const { cur, best } = calcStreak(days);
      list.push({ title, todayDone: days.has(todayKey), current: cur, best, weekCount: weekCount(days) });
    });

    // 정렬: 오늘 미완료 ↑ → 연속 적은 ↑ (보완 먼저)
    list.sort((a,b)=>{
      if (a.todayDone !== b.todayDone) return a.todayDone ? 1 : -1;
      if (a.current !== b.current) return a.current - b.current;
      return a.title.localeCompare(b.title);
    });
    return list;
  }, [recentRoutine]);

  // 이번 주 전체 합계 (모든 습관의 weekCount 합)
  const weeklySum = useMemo(()=> habits.reduce((a,b)=>a+b.weekCount,0), [habits]);

  /* ------------- Calendar 계산 (원본 유지) ------------- */
  const daysInThisMonth = getDaysInMonth(year, month0);
  const firstWd = firstWeekday(year, month0, weekStart);
  const monthTitle = `${year}년 ${month0+1}월`;

  const totalThisMonth = useMemo(() => {
    let sum = 0;
    for (let i=1;i<=daysInThisMonth;i++) {
      const key = ymdKey(new Date(year, month0, i));
      sum += (dailyTotals[key] || 0);
    }
    return sum;
  }, [dailyTotals, year, month0, daysInThisMonth]);

  /* ------------- Guards ------------- */
  if (!authChecked || !uid || loading) {
    return (
      <View style={{ flex:1, backgroundColor:'#fff', alignItems:'center', justifyContent:'center' }}>
        <ActivityIndicator size="large" color="#059669" />
      </View>
    );
  }

  /* ===================== UI ===================== */
  return (
    <View style={{ flex:1, backgroundColor:'#FFFFFF' }}>
      {/* Header + Tabs */}
      <View style={{ paddingTop: Platform.OS==='android'?28:48, paddingHorizontal:20 }}>
        <Text style={{ fontSize:22, fontWeight:'bold', marginBottom:16 , marginTop: 25, marginLeft: 10 }}>기록</Text>
        <View style={{ flexDirection:'row', marginBottom:14 }}>
          <TouchableOpacity onPress={()=>setTab('list')}
            style={{ flex:1, paddingVertical:10, borderBottomWidth:2,
              borderColor: tab==='list' ? '#059669' : '#E5E7EB', alignItems:'center' }}>
            <Text style={{ fontWeight:'700', color: tab==='list' ? '#059669' : '#374151' }}>기록</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={()=>setTab('calendar')}
            style={{ flex:1, paddingVertical:10, borderBottomWidth:2,
              borderColor: tab==='calendar' ? '#059669' : '#E5E7EB', alignItems:'center' }}>
            <Text style={{ fontWeight:'700', color: tab==='calendar' ? '#059669' : '#374151' }}>달력</Text>
          </TouchableOpacity>
        </View>
      </View>

      {tab==='list' ? (
        // ======= 새 습관 대시보드 (심플) =======
        <ScrollView style={{ flex:1 }} contentContainerStyle={{ paddingHorizontal:20, paddingBottom:32 }}>
          <Card>
            <Text style={{ fontSize:15, fontWeight:'800', marginBottom:8 }}>📅 이번 주 습관 진행</Text>
            <ProgressBar value={weeklySum} max={Math.max(1, habits.length * 3 /*기본 주3회 가정*/)} />
            <Text style={{ fontSize:12, color: GRAY.text, marginTop:6 }}>
              각 루틴을 하루 1회로 집계해요. “오늘 완료”를 누르면 streak에 바로 반영돼요.
            </Text>
          </Card>

          {habits.length===0 ? (
            <Card><Text style={{ color: GRAY.text }}>루틴 기록이 아직 없어요. 루틴을 실행하면 습관 카드가 생겨요.</Text></Card>
          ) : habits.map(h => (
            <HabitCard
              key={h.title}
              title={h.title}
              current={h.current}
              best={h.best}
              weekCount={h.weekCount}
              todayDone={h.todayDone}
              onPressDone={async ()=>{
                if (h.todayDone) { Alert.alert('오늘 완료됨', '이미 오늘 완료했어요.'); return; }
                try {
                  await addDoc(collection(db,'routineRecords'), {
                    uid, title: h.title, createdAt: serverTimestamp(),
                  });
                  // 낙관적 갱신
                  setRecentRoutine(prev => [{ uid: uid!, title: h.title, createdAt: new Date() }, ...prev]);
                } catch (e) {
                  Alert.alert('오류','기록 저장 중 문제가 발생했어요.');
                }
              }}
            />
          ))}
        </ScrollView>
      ) : (
        // ===== Calendar tab (원본 그대로 유지) =====
        <ScrollView style={{ flex:1 }} contentContainerStyle={{ paddingHorizontal:20, paddingBottom:40 }}>
          {/* month nav */}
          <View style={{ flexDirection:'row', alignItems:'center', justifyContent:'space-between', marginBottom:10 }}>
            <TouchableOpacity onPress={()=>{ const m=month0-1; if(m<0){ setYear(y=>y-1); setMonth0(11);} else setMonth0(m); }} style={{ padding:6 }}>
              <Text style={{ fontSize:18 }}>〈</Text>
            </TouchableOpacity>
            <Text style={{ fontSize:16, fontWeight:'700' }}>{monthTitle}</Text>
            <TouchableOpacity onPress={()=>{ const m=month0+1; if(m>11){ setYear(y=>y+1); setMonth0(0);} else setMonth0(m); }} style={{ padding:6 }}>
              <Text style={{ fontSize:18 }}>〉</Text>
            </TouchableOpacity>
          </View>

          {/* monthly total (공부 + 루틴) */}
          <View style={{ backgroundColor:'#fff', borderRadius:12, borderWidth:1, borderColor:'#E5E7EB', padding:12, marginBottom:10 }}>
            <Text style={{ fontSize:13, color: GRAY.text, marginBottom:4 }}>이번 달 공부 시간 (공부+루틴)</Text>
            <Text style={{ fontSize:18, fontWeight:'800', color:'#059669' }}>
              {formatHM(totalThisMonth)}
            </Text>
          </View>

          {/* week header */}
          <WeekHeader />

          {/* grid */}
          <CalendarGrid
            year={year}
            month0={month0}
            firstWd={firstWd}
            dailyTotals={dailyTotals}
            onPressDay={(d)=>router.push({ pathname: '/record/date', params: { date: ymdKey(d) } })}
            onLongPressDay={openDayDetail}
          />

          {/* 범례 */}
          <Legend legendOpen={legendOpen} setLegendOpen={setLegendOpen} />
        </ScrollView>
      )}

      {/* bottom sheet (하루 상세) */}
      <Modal visible={!!detailDate} transparent animationType="none" onRequestClose={closeSheet}>
        <TouchableOpacity activeOpacity={1} onPress={closeSheet} style={{ flex:1, backgroundColor:'rgba(0,0,0,0.2)' }} />
        <Animated.View
          style={{
            position:'absolute', left:0, right:0, bottom:0, maxHeight:SCREEN_H*0.75,
            backgroundColor:'#fff', borderTopLeftRadius:16, borderTopRightRadius:16, paddingBottom:24,
            transform:[{ translateY: sheetY }],
          }}
          {...panResponder().panHandlers}
        >
          <SheetHandle />
          <View style={{ paddingHorizontal:20, paddingTop:10 }}>
            <Text style={{ fontSize:16, fontWeight:'800' }}>{detailDate ? ymdKey(detailDate) : ''}</Text>
          </View>

          {detailLoading ? (
            <View style={{ alignItems:'center', justifyContent:'center', paddingVertical:20 }}>
              <ActivityIndicator size="small" color="#059669" />
            </View>
          ) : (
            <ScrollView contentContainerStyle={{ paddingHorizontal:20, paddingTop:10, paddingBottom:20 }}>
              <Text style={{ fontSize:14, fontWeight:'700', marginBottom:8 }}>공부 기록</Text>
              {dayStudy.length===0 ? (
                <Text style={{ color: GRAY.text, marginBottom:12 }}>기록이 없습니다.</Text>
              ) : dayStudy.map((r,idx)=>(
                <Card key={`ds-${idx}`}>
                  <Text style={{ fontSize:15, fontWeight:'700' }}>
                    {(r.subject ?? '공부')}{r.content ? ` · ${r.content}`:''}
                  </Text>
                  <Text style={{ fontSize:14, color:'#059669', marginTop:4 }}>{formatHM(minutesFromStudy(r))}</Text>
                  {!!r.memo && <Text style={{ fontSize:13, color:'#374151', marginTop:4 }}>메모: {r.memo}</Text>}
                </Card>
              ))}

              <Text style={{ fontSize:14, fontWeight:'700', marginTop:10, marginBottom:8 }}>루틴 기록</Text>
              {dayRoutine.length===0 ? (
                <Text style={{ color: GRAY.text }}>기록이 없습니다.</Text>
              ) : dayRoutine.map((r,idx)=>(
                <Card key={`dr-${idx}`}>
                  <Text style={{ fontSize:15, fontWeight:'700' }}>{r.title ?? '루틴'}</Text>
                  <Text style={{ fontSize:14, color:'#059669', marginTop:4 }}>{formatHM(totalMinutesFromRoutine(r))}</Text>
                  {!!(r.steps?.length) && (
                    <Text style={{ fontSize:13, color: GRAY.text, marginTop:4 }}>
                      {r.steps?.map(s=>s.step).filter(Boolean).join(' · ')}
                    </Text>
                  )}
                </Card>
              ))}
            </ScrollView>
          )}
        </Animated.View>
      </Modal>
    </View>
  );

  // helpers (inside component to capture refs/state)
  function panResponder() {
    return PanResponder.create({
      onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dy) > 6,
      onPanResponderMove: (_e, g) => { if (g.dy > 0) sheetY.setValue(g.dy); },
      onPanResponderRelease: (_e, g) => {
        if (g.dy > 120) closeSheet();
        else Animated.spring(sheetY, { toValue: 0, useNativeDriver: true, bounciness: 0 }).start();
      },
    });
  }
  function openSheet(){ sheetY.setValue(400); Animated.timing(sheetY,{toValue:0,duration:200,useNativeDriver:true}).start(); }
  function closeSheet(){ Animated.timing(sheetY,{toValue:400,duration:180,useNativeDriver:true}).start(()=>{ setDetailDate(null); setDayStudy([]); setDayRoutine([]); }); }
}

/* ===================== Small Components ===================== */
function Card({ children }: { children: React.ReactNode }) {
  return (
    <View style={{
      backgroundColor:'#fff', borderRadius:12, borderWidth:1, borderColor:'#E5E7EB',
      padding:12, marginBottom:12, shadowColor:'#000', shadowOpacity:0.06, shadowRadius:6,
      shadowOffset:{ width:0, height:3 }, elevation:2,
    }}>
      {children}
    </View>
  );
}
function InfoRow({ label, value, last }: { label: string; value: string | number; last?: boolean }) {
  return (
    <View style={{
      backgroundColor:'#F9FAFB', borderRadius:8, paddingVertical:10, paddingHorizontal:12,
      marginBottom: last?0:8, borderWidth:1, borderColor:'#EEF2F7'
    }}>
      <Text style={{ fontSize:13, color: GRAY.text }}>
        {label}: <Text style={{ color:'#111827', fontWeight:'700' }}>{String(value)}</Text>
      </Text>
    </View>
  );
}

/* ===== Habit mini components ===== */
function ProgressBar({ value, max }:{ value:number; max:number }) {
  const safeMax = Math.max(1, max);
  const pct = Math.max(0, Math.min(100, Math.round((value/safeMax)*100)));
  return (
    <View>
      <View style={{ height:14, backgroundColor:'#F3F4F6', borderRadius:999, overflow:'hidden' }}>
        <View style={{ width:`${pct}%`, height:'100%', backgroundColor:'#10B981' }} />
      </View>
      <View style={{ flexDirection:'row', justifyContent:'space-between', marginTop:6 }}>
        <Text style={{ fontSize:12, color: GRAY.text }}>진행도</Text>
        <Text style={{ fontSize:12, fontWeight:'700' }}>{value}/{safeMax} · {pct}%</Text>
      </View>
    </View>
  );
}
function Pill({ text }:{ text:string }) {
  return (
    <View style={{ backgroundColor:'#F3F4F6', borderRadius:999, paddingHorizontal:10, paddingVertical:6 }}>
      <Text style={{ fontSize:11 }}>{text}</Text>
    </View>
  );
}
function Button({ text, onPress, filled=false, disabled=false }:{
  text:string; onPress:()=>void; filled?:boolean; disabled?:boolean
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled}
      style={{
        paddingHorizontal:14, paddingVertical:10, borderRadius:10,
        backgroundColor: filled ? (disabled?'#9CA3AF':'#10B981') : '#fff',
        borderWidth: filled ? 0 : 1, borderColor: '#E5E7EB',
        opacity: disabled ? 0.9 : 1,
      }}
    >
      <Text style={{ color: filled ? '#fff' : '#111827', fontWeight:'700' }}>{text}</Text>
    </TouchableOpacity>
  );
}
function HabitCard({
  title, current, best, weekCount, todayDone, onPressDone
}:{
  title:string; current:number; best:number; weekCount:number; todayDone:boolean; onPressDone:()=>void
}) {
  return (
    <Card>
      <Text style={{ fontSize:16, fontWeight:'800', marginBottom:8 }}>{title}</Text>
      <View style={{ flexDirection:'row', gap:8, marginBottom:8, flexWrap:'wrap' }}>
        <Pill text={`연속 ${current}일`} />
        <Pill text={`최장 ${best}일`} />
        <Pill text={`이번 주 ${weekCount}회`} />
        <Pill text={todayDone ? '오늘 완료' : '오늘 미완료'} />
      </View>
      <View style={{ flexDirection:'row', justifyContent:'flex-end', marginTop:4 }}>
        <Button
          text={todayDone ? '오늘 기록됨' : '오늘 완료'}
          onPress={onPressDone}
          filled
          disabled={todayDone}
        />
      </View>
    </Card>
  );
}

/* ===== Bars / Heat components / Calendar parts (원본 유지) ===== */
function MiniBars({ data, labels, max }:{ data:number[]; labels:string[]; max:number }) {
  const safeMax = Math.max(1, max);
  return (
    <View style={{ flexDirection:'row', alignItems:'flex-end', marginTop:10 }}>
      {data.map((v,i)=>(
        <View key={i} style={{ flex:1, alignItems:'center' }}>
          <View style={{
            width:10,
            height: Math.max(4, Math.round((v/safeMax)*60)),
            backgroundColor:'#10B981',
            borderRadius:4,
          }}/>
        </View>
      ))}
    </View>
  );
}

function HourHeat({ hours, max }:{ hours:number[]; max:number }) {
  const labels = Array.from({length:24},(_,i)=>String(i).padStart(2,'0'));
  const safeMax = Math.max(1, max);
  return (
    <View style={{ flexDirection:'row', flexWrap:'wrap' }}>
      {hours.map((v,i)=>{
        const ratio = v/safeMax;
        const bg = `rgba(16,185,129,${0.15 + ratio*0.7})`;
        return (
          <View key={i} style={{ width:'12.5%', padding:4 }}>
            <View style={{
              height:22, borderRadius:6, backgroundColor: bg, borderWidth:1, borderColor:'#E5E7EB',
              alignItems:'center', justifyContent:'center'
            }}>
              <Text style={{ fontSize:9, color:'#0F172A' }}>{labels[i]}</Text>
            </View>
          </View>
        );
      })}
    </View>
  );
}

function WeekdayBars({ values, max }:{ values:number[]; max:number }) {
  const names = ['일','월','화','수','목','금','토'];
  const safeMax = Math.max(1, max);
  return (
    <View>
      {values.map((v,i)=>(
        <View key={i} style={{ marginBottom:8 }}>
          <View style={{ flexDirection:'row', justifyContent:'space-between', marginBottom:4 }}>
            <Text style={{ fontSize:13 }}>{names[i]}</Text>
            <Text style={{ fontSize:12, color: GRAY.text }}>{formatHM(v)}</Text>
          </View>
          <View style={{ height:10, backgroundColor:'#F3F4F6', borderRadius:999, overflow:'hidden' }}>
            <View style={{ width:`${(v/safeMax)*100}%`, height:'100%', backgroundColor:'#3B82F6' }}/>
          </View>
        </View>
      ))}
    </View>
  );
}

function SplitBar({ leftPct, leftLabel, rightLabel }:{ leftPct:number; leftLabel:string; rightLabel:string }) {
  const lp = Math.max(0, Math.min(100, leftPct));
  const rp = 100 - lp;
  return (
    <View style={{ marginTop:8 }}>
      <View style={{ height:14, backgroundColor:'#F3F4F6', borderRadius:999, overflow:'hidden', flexDirection:'row' }}>
        <View style={{ width:`${lp}%`, backgroundColor:'#10B981' }}/>
        <View style={{ width:`${rp}%`, backgroundColor:'#3B82F6' }}/>
      </View>
      <View style={{ flexDirection:'row', justifyContent:'space-between', marginTop:6 }}>
        <Text style={{ fontSize:12, color:'#065F46' }}>{leftLabel} {lp}%</Text>
        <Text style={{ fontSize:12, color:'#1E3A8A' }}>{rightLabel} {rp}%</Text>
      </View>
    </View>
  );
}

function MonthlyBars({ items, max }:{ items:{label:string; min:number}[]; max:number }) {
  const safeMax = Math.max(1, max);
  return (
    <View style={{ flexDirection:'row', alignItems:'flex-end', gap:10 }}>
      {items.map((it, idx)=>(
        <View key={idx} style={{ alignItems:'center', flex:1 }}>
          <View style={{
            width:18,
            height: Math.max(6, Math.round((it.min/safeMax)*70)),
            backgroundColor:'#10B981',
            borderRadius:6,
          }}/>
          <Text style={{ marginTop:6, fontSize:11, color: GRAY.text }}>{it.label}</Text>
          <Text style={{ marginTop:2, fontSize:11, fontWeight:'700' }}>{formatHM(it.min)}</Text>
        </View>
      ))}
    </View>
  );
}

/* ===== Calendar parts (원본 그대로) ===== */
function WeekHeader() {
  const COLS = 7, GAP = 8, H_PAD = 20;
  const width = (SCREEN_W - H_PAD*2 - GAP*6) / COLS;
  const names = ['월','화','수','목','금','토','일'];
  return (
    <View style={{ flexDirection:'row', justifyContent:'space-between', marginTop:6, marginBottom:6 }}>
      {names.map(w=>(
        <View key={w} style={{ alignItems:'center', width }}>
          <Text style={{ color: GRAY.text, fontSize:12 }}>{w}</Text>
        </View>
      ))}
    </View>
  );
}

function CalendarGrid({
  year, month0, firstWd, dailyTotals, onPressDay, onLongPressDay
}: {
  year:number; month0:number; firstWd:number;
  dailyTotals: Record<string, number>;
  onPressDay: (d:Date)=>void;
  onLongPressDay: (d:Date)=>void;
}) {
  const COLS = 7, GAP = 8, H_PAD = 20;
  const CELL = (SCREEN_W - H_PAD*2 - GAP*6) / COLS;

  return (
    <View style={{ flexDirection:'row', flexWrap:'wrap' }}>
      {Array.from({length:firstWd}).map((_,i)=>(
        <View key={`empty-${i}`} style={{ width:CELL, height:CELL, marginRight:(i%COLS)===COLS-1?0:GAP, marginBottom:GAP }} />
      ))}
      {Array.from({length:getDaysInMonth(year,month0)},(_,i)=>i+1).map((day,i)=>{
        const col = (firstWd + i) % COLS;
        const d = new Date(year, month0, day);
        const key = ymdKey(d);
        const total = dailyTotals[key] || 0;
        const bg = minutesToColor(total);
        return (
          <TouchableOpacity
            key={day}
            onPress={()=>onPressDay(d)}
            onLongPress={()=>onLongPressDay(d)}
            delayLongPress={220}
            style={{
              width:CELL, height:CELL,
              marginRight: col===COLS-1 ? 0 : GAP, marginBottom:GAP,
              borderRadius: CELL/2,
              borderWidth: bg?0:1, borderColor: GRAY.ring,
              backgroundColor: bg || '#fff',
              alignItems:'center', justifyContent:'center',
            }}>
            <Text style={{ fontWeight:'700', fontSize:13, color: bg?'#fff':'#111827' }}>{day}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

function Legend({ legendOpen, setLegendOpen }:{ legendOpen:boolean; setLegendOpen:(f:(b:boolean)=>boolean)=>void }) {
  return (
    <View style={{ marginTop:10, backgroundColor:'#fff', borderRadius:12, borderWidth:1, borderColor:'#E5E7EB' }}>
      <TouchableOpacity
        onPress={()=>setLegendOpen(o=>!o)}
        style={{ paddingVertical:12, paddingHorizontal:12, flexDirection:'row', alignItems:'center', justifyContent:'space-between' }}
        activeOpacity={0.7}
      >
        <Text style={{ fontSize:14, fontWeight:'800' }}>범례</Text>
        <Text style={{ fontSize:16, color: GRAY.text }}>{legendOpen ? '▾' : '▸'}</Text>
      </TouchableOpacity>

      {legendOpen && (
        <View style={{ paddingHorizontal:12, paddingBottom:12 }}>
          {[
            { label:'10시간 이상', color:GREEN.g6 },
            { label:'8–9시간',   color:GREEN.g5 },
            { label:'6–7시간',   color:GREEN.g4 },
            { label:'4–5시간',   color:GREEN.g3 },
            { label:'2–3시간',   color:GREEN.g2 },
            { label:'1시간',     color:GREEN.g1 },
            { label:'1시간 미만', color:'rgba(16,185,129,0.15)' },
            { label:'기록 없음', color:'transparent', ring:true },
          ].map((it,idx)=>(
            <View key={idx} style={{ flexDirection:'row', alignItems:'center', marginBottom:6 }}>
              <View style={{
                width:16, height:16, borderRadius:8, marginRight:8,
                backgroundColor: it.color==='transparent' ? '#fff' : it.color,
                borderWidth: it.ring?1:0, borderColor: GRAY.ring,
              }}/>
              <Text>{it.label}</Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

function SheetHandle() {
  return (
    <View style={{ alignItems:'center', paddingTop:8 }}>
      <View style={{ width:36, height:5, borderRadius:999, backgroundColor: GRAY.light }} />
    </View>
  );
}

