// app/(tabs)/record.tsx
import { useRouter } from 'expo-router';
import { onAuthStateChanged } from 'firebase/auth';
import {
  Timestamp, collection, getDocs, limit, query, where,
} from 'firebase/firestore';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, Animated, Dimensions, Modal, PanResponder,
  Platform, ScrollView, Text, TouchableOpacity, View,
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

type TabKey = 'list' | 'calendar';
type WeekStart = 'monday' | 'sunday';

/* ===================== UI Const ===================== */
const GREEN = { g1:'#A7F3D0', g2:'#6EE7B7', g3:'#34D399', g4:'#10B981', g5:'#059669', g6:'#064E3B' };
const BLUE  = { b:'#3B82F6' };
const GRAY  = { ring:'#E5E7EB', text:'#6B7280', light:'#F3F4F6' };

/* ===================== Helpers ===================== */
const ALT_UID_FIELDS = ['userId','ownerId','userUID'] as const;
const ALT_EMAIL_FIELDS = ['email','userEmail'] as const;

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
/** ✅ 색상: 1시간 미만도 아주 연하게 표시 */
function minutesToColor(min?: number): string | null {
  const v = Number(min) || 0;
  if (v >= 600) return GREEN.g6;
  if (v >= 480) return GREEN.g5;
  if (v >= 360) return GREEN.g4;
  if (v >= 240) return GREEN.g3;
  if (v >= 120) return GREEN.g2;
  if (v >= 60)  return GREEN.g1;
  if (v > 0)    return 'rgba(16,185,129,0.15)'; // 1시간 미만
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
function addDays(d: Date, n: number) {
  const base = toDateSafe(d);
  const copy = new Date(base.getTime());
  copy.setDate(copy.getDate() + n);
  return copy;
}

function fmtDate(d: Date) {
  const k = toDateSafe(d);
  const w = ['일','월','화','수','목','금','토'][k.getDay()];
  return `${k.getFullYear()}년 ${k.getMonth()+1}월 ${k.getDate()}일 (${w})`;
}
function fmtTime(d: Date) {
  const k = toDateSafe(d);
  const hh = String(k.getHours()).padStart(2,'0');
  const mm = String(k.getMinutes()).padStart(2,'0');
  return `${hh}:${mm}`;
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

  const [plannerDate, setPlannerDate] = useState(new Date());

  // ✅ 범례 토글 상태
  const [legendOpen, setLegendOpen] = useState(false);

  // bottom sheet (기존 유지)
  const sheetY = useRef(new Animated.Value(400)).current;
  const { width: screenW, height: screenH } = Dimensions.get('window');
  const H_PAD = 20, GAP = 8, COLS = 7;
  const CELL = Math.floor((screenW - H_PAD*2 - GAP*(COLS-1)) / COLS);

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dy) > 6,
      onPanResponderMove: (_e, g) => { if (g.dy > 0) sheetY.setValue(g.dy); },
      onPanResponderRelease: (_e, g) => {
        if (g.dy > 120) closeSheet();
        else Animated.spring(sheetY, { toValue: 0, useNativeDriver: true, bounciness: 0 }).start();
      },
    })
  ).current;
  function openSheet(){ sheetY.setValue(400); Animated.timing(sheetY,{toValue:0,duration:200,useNativeDriver:true}).start(); }
  function closeSheet(){ Animated.timing(sheetY,{toValue:400,duration:180,useNativeDriver:true}).start(()=>{ setDetailDate(null); setDayStudy([]); setDayRoutine([]); }); }

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
    // 계정 전환 시 잔상 제거
    setRecentStudy([]);
    setRecentRoutine([]);
    setDailyTotals({});
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        await Promise.all([loadRecent(uid), loadMonth(uid, year, month0)]);
      } finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [authChecked, uid, year, month0]);

  /* ------------- Firestore loaders ------------- */
  async function loadRecent(userId: string) {
    const userEmail = auth.currentUser?.email ?? null;

    const fetchStudy = async (): Promise<StudyRecord[]> => {
      try {
        const snap = await getDocs(query(collection(db, 'studyRecords'), where('uid', '==', userId), limit(500)));
        if (!snap.empty) return snap.docs.map(d => d.data() as StudyRecord);
      } catch {}
      // 과거 스키마 호환
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

    // 내림차순 정렬
    ssNorm.sort((a,b)=> pickDate(b).getTime()-pickDate(a).getTime());
    rrNorm.sort((a,b)=> pickDate(b).getTime()-pickDate(a).getTime());

    setRecentStudy(ssNorm);
    setRecentRoutine(rrNorm);
  }

  /** ✅ 월 집계: 공부 + 루틴 */
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

  /* ------------- Derived (플래너/주간 통계만) ------------- */
  type Segment = { kind:'study'|'routine'; label: string; start: Date; end: Date; minutes: number };
  const dayStart = useMemo(() => startOfDay(plannerDate), [plannerDate]);
  const dayEnd   = useMemo(() => endOfDay(plannerDate),   [plannerDate]);

  const plannerSegments: Segment[] = useMemo(() => {
    const segs: Segment[] = [];

    recentStudy.forEach(r => {
      const end = pickDate(r);
      const m = minutesFromStudy(r);
      if (!m || m <= 0) return;
      const start = new Date(end.getTime() - m*60*1000);
      if (end < dayStart || start > dayEnd) return;
      const s = new Date(Math.max(start.getTime(), dayStart.getTime()));
      const e = new Date(Math.min(end.getTime(),   dayEnd.getTime()));
      const mm = Math.max(1, Math.round((e.getTime()-s.getTime())/60000));
      const label = `${r.subject ?? '공부'}${r.content ? ' · ' + r.content : ''}`;
      segs.push({ kind:'study', label, start:s, end:e, minutes:mm });
    });

    recentRoutine.forEach(r => {
      const end = pickDate(r);
      const m = totalMinutesFromRoutine(r);
      if (!m || m <= 0) return;
      const start = new Date(end.getTime() - m*60*1000);
      if (end < dayStart || start > dayEnd) return;
      const s = new Date(Math.max(start.getTime(), dayStart.getTime()));
      const e = new Date(Math.min(end.getTime(),   dayEnd.getTime()));
      const mm = Math.max(1, Math.round((e.getTime()-s.getTime())/60000));
      segs.push({ kind:'routine', label: r.title ?? '루틴', start:s, end:e, minutes:mm });
    });

    segs.sort((a,b)=> a.start.getTime()-b.start.getTime());
    return segs;
  }, [recentStudy, recentRoutine, dayStart.getTime(), dayEnd.getTime()]);

  const weekStats = useMemo(() => {
    const to = new Date(), from = new Date(); from.setDate(to.getDate()-6);
    let totalMin = 0;
    const bySubject = new Map<string, number>();
    let goals = { total: 0, success: 0 };

    recentStudy.forEach(r => {
      const d = pickDate(r);
      if (d < startOfDay(from) || d > endOfDay(to)) return;
      const m = minutesFromStudy(r);
      totalMin += m;
      const subj = r.subject || '기타';
      bySubject.set(subj, (bySubject.get(subj) || 0) + m);
      if (r.goalStatus) { goals.total += 1; if (r.goalStatus === 'success') goals.success += 1; }
    });

    const total = Array.from(bySubject.values()).reduce((a,b)=>a+b,0);
    const subjectLine = total===0 ? '데이터 없음'
      : Array.from(bySubject.entries())
        .sort((a,b)=>b[1]-a[1]).slice(0,6)
        .map(([name, min]) => `${name} ${Math.round(min/total*100)}%`).join(', ');

    return {
      totalMin,
      avgMin: Math.round(totalMin / 7),
      subjectLine,
      goalRate: goals.total===0 ? 0 : Math.round(goals.success/goals.total*100),
    };
  }, [recentStudy]);

  const daysInThisMonth = getDaysInMonth(year, month0);
  const firstWd = firstWeekday(year, month0, weekStart);
  const monthTitle = `${year}년 ${month0+1}월`;

  /** ✅ 이번 달 합계(공부+루틴) */
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
        <ScrollView style={{ flex:1 }} contentContainerStyle={{ paddingHorizontal:20, paddingBottom:40 }}>
          {/* ======= 스터디 플래너 ======= */}
          <View style={{ backgroundColor:'#fff', borderRadius:12, borderWidth:1, borderColor:'#E5E7EB', padding:12, marginBottom:12 }}>
            {/* 날짜 네비 */}
            <View style={{ flexDirection:'row', alignItems:'center', justifyContent:'space-between', marginBottom:8 }}>
              <TouchableOpacity onPress={()=>setPlannerDate(d=>addDays(d,-1))} style={{ padding:6 }}>
                <Text style={{ fontSize:18 }}>〈</Text>
              </TouchableOpacity>
              <Text style={{ fontSize:15, fontWeight:'800' }}>{fmtDate(plannerDate)}</Text>
              <View style={{ flexDirection:'row', alignItems:'center' }}>
                <TouchableOpacity onPress={()=>setPlannerDate(new Date())} style={{ paddingVertical:6, paddingHorizontal:10, marginRight:6, borderWidth:1, borderColor:'#E5E7EB', borderRadius:8 }}>
                  <Text style={{ fontSize:12 }}>오늘</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={()=>setPlannerDate(d=>addDays(d,1))} style={{ padding:6 }}>
                  <Text style={{ fontSize:18 }}>〉</Text>
                </TouchableOpacity>
              </View>
            </View>

            <View style={{ flexDirection:'row' }}>
              {/* 좌: 그날 항목 목록 */}
              <View style={{ flex:1, paddingRight:10 }}>
                {plannerSegments.length === 0 ? (
                  <Text style={{ color: GRAY.text }}>이 날짜에 기록이 없어요.</Text>
                ) : plannerSegments.map((s, i) => (
                  <View key={i} style={{ paddingVertical:8, borderBottomWidth: i===plannerSegments.length-1?0:1, borderColor:'#F3F4F6' }}>
                    <Text style={{ fontSize:14, fontWeight:'700' }}>
                      {s.kind==='study' ? '📚 ' : '✅ '}{s.label}
                    </Text>
                    <Text style={{ fontSize:12, color: GRAY.text, marginTop:2 }}>
                      {fmtTime(s.start)}–{fmtTime(s.end)} · {formatHM(s.minutes)}
                    </Text>
                  </View>
                ))}
              </View>

              {/* 우: 시간표 색칠 */}
              <View style={{ width: 180 }}>
                <TimeTable segments={plannerSegments} windowStart={dayStart} />
              </View>
            </View>
          </View>

          {/* 📊 주간 공부 분석 (유지) */}
          <View style={{ backgroundColor:'#fff', borderRadius:12, borderWidth:1, borderColor:'#E5E7EB', padding:12, marginBottom:12 }}>
            <Text style={{ fontSize:15, fontWeight:'800', marginBottom:10 }}>📊 주간 공부 분석</Text>
            <InfoRow label="이번 주 총 공부 시간" value={formatHM(weekStats.totalMin)} />
            <InfoRow label="과목별 분포" value={weekStats.subjectLine} />
            <InfoRow label="목표 달성률" value={`${(weekStats.goalRate)}%`} />
            <InfoRow label="이번 주 평균 공부 시간" value={formatHM(weekStats.avgMin)} last />
          </View>

        </ScrollView>
      ) : (
        // Calendar tab
        <ScrollView style={{ flex:1 }} contentContainerStyle={{ paddingHorizontal:H_PAD, paddingBottom:40 }}>
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
          <View style={{ flexDirection:'row', justifyContent:'space-between', marginTop:6, marginBottom:6 }}>
            {(weekStart==='monday'?['월','화','수','목','금','토','일']:['일','월','화','수','목','금','토']).map(w=>(
              <View key={w} style={{ width: CELL, alignItems:'center' }}>
                <Text style={{ color: GRAY.text, fontSize:12 }}>{w}</Text>
              </View>
            ))}
          </View>

          {/* grid */}
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
                  onPress={()=>router.push({ pathname: '/record/date', params: { date: key } })}
                  onLongPress={()=>openDayDetail(d)}
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

          {/* ✅ 범례 (터치로 펼치기/접기) */}
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
        </ScrollView>
      )}

      {/* bottom sheet (기존 그대로) */}
      <Modal visible={!!detailDate} transparent animationType="none" onRequestClose={closeSheet}>
        <TouchableOpacity activeOpacity={1} onPress={closeSheet} style={{ flex:1, backgroundColor:'rgba(0,0,0,0.2)' }} />
        <Animated.View
          style={{
            position:'absolute', left:0, right:0, bottom:0, maxHeight:screenH*0.75,
            backgroundColor:'#fff', borderTopLeftRadius:16, borderTopRightRadius:16, paddingBottom:24,
            transform:[{ translateY: sheetY }],
          }}
          {...panResponder.panHandlers}
        >
          <View style={{ alignItems:'center', paddingTop:8 }}>
            <View style={{ width:36, height:5, borderRadius:999, backgroundColor: GRAY.light }} />
          </View>
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
}

/* ===================== Small Components ===================== */
function Card({ children }: { children: React.ReactNode }) {
  return (
    <View style={{
      backgroundColor:'#fff', borderRadius:12, borderWidth:1, borderColor:'#E5E7EB',
      padding:12, marginBottom:8, shadowColor:'#000', shadowOpacity:0.06, shadowRadius:6,
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

/* ===================== Time table (06~다음날 05) ===================== */
function TimeTable({
  segments,
  windowStart,
}: {
  segments: { kind:'study'|'routine'; start: Date; end: Date; minutes: number }[];
  windowStart: Date;
}) {
  const HOUR_H = 30;
  const TOTAL_H = HOUR_H * 24;
  const PX_PER_MIN = HOUR_H / 60;

  const PIVOT = 6;
  const hourOrder = Array.from({ length: 24 }, (_, i) => (i + PIVOT) % 24);
  const hourLabels = hourOrder.map((h) => String(h).padStart(2, '0'));

  const base = (() => {
    const b = toDateSafe(windowStart);
    return new Date(b.getFullYear(), b.getMonth(), b.getDate(), PIVOT, 0, 0, 0);
  })();

  const toYRaw = (d: Date) => {
    const dt = toDateSafe(d);
    let diffMin = (dt.getTime() - base.getTime()) / 60000;
    if (diffMin < 0) diffMin += 24 * 60;
    diffMin = Math.max(0, Math.min(24 * 60, diffMin));
    return diffMin * PX_PER_MIN;
  };
  const toY = (d: Date) => Math.round(toYRaw(d));

  return (
    <View style={{ flexDirection: 'row' }}>
      {/* 시간 라벨 (06 → 05) */}
      <View style={{ width: 32, marginRight: 6 }}>
        {hourLabels.map((label, i) => (
          <View key={i} style={{ height: 30, justifyContent: 'flex-start' }}>
            <Text style={{ fontSize: 10, color: GRAY.text }}>{label}</Text>
          </View>
        ))}
      </View>

      {/* 그리드 + 채움 */}
      <View
        style={{
          flex: 1,
          height: TOTAL_H,
          position: 'relative',
          borderWidth: 1,
          borderColor: '#EEF2F7',
          borderRadius: 10,
          overflow: 'hidden',
          backgroundColor: '#FFFFFF',
        }}
      >
        {hourLabels.map((_, i) => (
          <View
            key={i}
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              top: i * 30,
              height: 1,
              backgroundColor: '#F3F4F6',
            }}
          />
        ))}

        {segments.map((s, idx) => {
          const top = toY(s.start);
          const bottom = toY(s.end);
          const rawHeight = bottom - top;
          const height = Math.max(14, Math.round(rawHeight));
          const isStudy = s.kind === 'study';

          const bg = isStudy ? 'rgba(16,185,129,0.55)' : 'rgba(59,130,246,0.55)';
          const stroke = isStudy ? GREEN.g4 : BLUE.b;

          return (
            <View
              key={idx}
              style={{
                position: 'absolute',
                left: 1,
                right: 1,
                top,
                height,
                backgroundColor: bg,
                borderWidth: 1,
                borderColor: stroke,
                borderRadius: 6,
              }}
            />
          );
        })}
      </View>
    </View>
  );
}
