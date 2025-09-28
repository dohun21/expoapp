// app/(tabs)/record.tsx
import { useRouter } from 'expo-router';
import { onAuthStateChanged } from 'firebase/auth';
import {
  Timestamp,
  collection, getDocs, limit, query,
  where
} from 'firebase/firestore';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
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

/* ===================== UI Const ===================== */
const GREEN = { g1:'#A7F3D0', g2:'#6EE7B7', g3:'#34D399', g4:'#10B981', g5:'#059669', g6:'#064E3B' };
const GRAY  = { ring:'#E5E7EB', text:'#6B7280', light:'#F3F4F6' };

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');

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
function firstWeekday(y: number, m0: number, start: 'monday'|'sunday') {
  const dow = new Date(y, m0, 1).getDay();
  return start === 'monday' ? (dow + 6) % 7 : dow;
}

/* ===================== Screen ===================== */
export default function RecordScreen() {
  const router = useRouter();

  const [uid, setUid] = useState<string|null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [loading, setLoading] = useState(true);

  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month0, setMonth0] = useState(now.getMonth());
  const [weekStart] = useState<'monday'|'sunday'>('monday');

  const [dailyTotals, setDailyTotals] = useState<Record<string, number>>({});
  const [recentStudy, setRecentStudy] = useState<StudyRecord[]>([]);
  const [recentRoutine, setRecentRoutine] = useState<RoutineRecord[]>([]);

  const [detailDate, setDetailDate] = useState<Date|null>(null);
  const [dayStudy, setDayStudy] = useState<StudyRecord[]>([]);
  const [dayRoutine, setDayRoutine] = useState<RoutineRecord[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);

  // bottom sheet
  const sheetY = useRef(new Animated.Value(400)).current;

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

  /** ✅ 월 집계: 공부 + 루틴 (달력 색상에 사용) */
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
      const start = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0,0,0,0);
      const end   = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23,59,59,999);
      return t >= start && t <= end;
    };

    setDayStudy(recentStudy.filter(inDay));
    setDayRoutine(recentRoutine.filter(inDay));
    setDetailLoading(false);
    openSheet();
  }

  /* ------------- Calendar 계산 ------------- */
  const firstWd = firstWeekday(year, month0, weekStart);
  const monthTitle = `${year}년 ${month0+1}월`;

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
      {/* Header */}
      <View style={{ paddingTop: Platform.OS==='android'?28:48, paddingHorizontal:20 }}>
        <Text style={{ fontSize:22, fontWeight:'bold', marginBottom:12 , marginTop: 25, marginLeft: 10 }}>기록</Text>
      </View>

      {/* 달력 화면 (탭 제거) */}
      <ScrollView style={{ flex:1 }} contentContainerStyle={{ paddingHorizontal:20, paddingBottom:40 , marginTop:15}}>
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

        {/* 이번 달 총합 (공부+루틴) */}
        <View style={{ backgroundColor:'#fff', borderRadius:12, borderWidth:1, borderColor:'#E5E7EB', padding:12, marginBottom:10 }}>
          <Text style={{ fontSize:13, color: GRAY.text, marginBottom:4 }}>이번 달 공부 시간</Text>
          <Text style={{ fontSize:18, fontWeight:'800', color:'#059669' }}>
            {formatHM(Object.keys(dailyTotals).reduce((sum,k)=>sum + (k.startsWith(`${year}-${String(month0+1).padStart(2,'0')}`)? dailyTotals[k]:0),0))}
          </Text>
        </View>

        {/* 요일 헤더 */}
        <WeekHeader />

        {/* 달력 그리드: 탭(눌러서 상세 페이지), 꾹(시트 요약) */}
        <CalendarGrid
          year={year}
          month0={month0}
          firstWd={firstWd}
          dailyTotals={dailyTotals}
          onPressDay={(d)=>router.push({ pathname: '/record/date', params: { date: ymdKey(d) } })}
          onLongPressDay={openDayDetail}
        />

        {/* 접이식 범례 */}
        <Legend />
      </ScrollView>

      {/* bottom sheet (하루 요약) */}
      <Modal visible={!!detailDate} transparent animationType="none" onRequestClose={closeSheet}>
        <TouchableOpacity activeOpacity={1} onPress={closeSheet} style={{ flex:1, backgroundColor:'rgba(0,0,0,0.2)' }} />
        <Animated.View
          style={{
            position:'absolute', left:0, right:0, bottom:0, maxHeight:SCREEN_H*0.85,
            backgroundColor:'#fff', borderTopLeftRadius:16, borderTopRightRadius:16, paddingBottom:24,
            transform:[{ translateY: sheetY }],
          }}
          {...panResponder().panHandlers}
        >
          <SheetHandle />
          <View style={{ paddingHorizontal:20, paddingTop:10, paddingBottom:6 }}>
            <Text style={{ fontSize:16, fontWeight:'800' }}>{detailDate ? ymdKey(detailDate) : ''}</Text>
          </View>

          {detailLoading ? (
            <View style={{ alignItems:'center', justifyContent:'center', paddingVertical:20 }}>
              <ActivityIndicator size="small" color="#059669" />
            </View>
          ) : (
            <DayDetailTabs study={dayStudy} routine={dayRoutine} />
          )}
        </Animated.View>
      </Modal>
    </View>
  );

  // ===== bottom sheet helpers =====
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
function KpiRow({ items }:{ items:{label:string; value:string}[] }) {
  return (
    <View style={{ flexDirection:'row', justifyContent:'space-between', gap:8 }}>
      {items.map((it,idx)=>(
        <View key={idx} style={{ flex:1, backgroundColor:'#F9FAFB', borderRadius:10, borderWidth:1, borderColor:'#EEF2F7', padding:10 }}>
          <Text style={{ fontSize:12, color: GRAY.text }}>{it.label}</Text>
          <Text style={{ marginTop:4, fontSize:16, fontWeight:'800' }}>{it.value}</Text>
        </View>
      ))}
    </View>
  );
}
function Section({ title, right, children }:{ title:string; right?:React.ReactNode; children:React.ReactNode }) {
  return (
    <View style={{ marginTop:4, marginBottom:12 }}>
      <View style={{ flexDirection:'row', alignItems:'center', justifyContent:'space-between', marginBottom:8 }}>
        <Text style={{ fontSize:14, fontWeight:'700' }}>{title}</Text>
        {right ?? null}
      </View>
      {children}
    </View>
  );
}
function Pill({ text, sub }:{ text:string; sub?:string }) {
  return (
    <View style={{ paddingVertical:6, paddingHorizontal:10, borderRadius:999, borderWidth:1, borderColor:'#E5E7EB', backgroundColor:'#F9FAFB' }}>
      <Text style={{ fontSize:12 }}>
        <Text style={{ fontWeight:'700' }}>{text}</Text>
        {sub ? <Text style={{ color: GRAY.text }}>  {sub}</Text> : null}
      </Text>
    </View>
  );
}
function TableHeader({ cols }:{ cols:string[] }) {
  return (
    <View style={{ flexDirection:'row', paddingVertical:8, borderBottomWidth:1, borderBottomColor:'#F1F5F9' }}>
      {cols.map((c,i)=>(
        <Text key={i} style={{ flex:i===0?1.4:1, fontSize:12, color:GRAY.text }}>{c}</Text>
      ))}
    </View>
  );
}
function TableRow({ cells, boldFirst=false }:{ cells:(string|undefined)[]; boldFirst?:boolean }) {
  return (
    <View style={{ flexDirection:'row', paddingVertical:8, borderBottomWidth:1, borderBottomColor:'#F8FAFC' }}>
      {cells.map((c,i)=>(
        <Text key={i} style={{ flex:i===0?1.4:1, fontSize:13 }}>
          <Text style={{ fontWeight: boldFirst && i===0 ? '700' : '400' }}>{c ?? '-'}</Text>
        </Text>
      ))}
    </View>
  );
}

/* ===== Calendar parts ===== */
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
      {Array.from({length: getDaysInMonth(year,month0)},(_,i)=>i+1).map((day,i)=>{
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

/** ✅ 접이식 범례 */
function Legend() {
  const [open, setOpen] = useState(false);

  const items = [
    { label:'10시간 이상', color:GREEN.g6 },
    { label:'8–9시간',   color:GREEN.g5 },
    { label:'6–7시간',   color:GREEN.g4 },
    { label:'4–5시간',   color:GREEN.g3 },
    { label:'2–3시간',   color:GREEN.g2 },
    { label:'1시간',     color:GREEN.g1 },
    { label:'1시간 미만', color:'rgba(16,185,129,0.15)' },
    { label:'기록 없음', color:'transparent', ring:true },
  ];

  return (
    <View style={{ marginTop:10, backgroundColor:'#fff', borderRadius:12, borderWidth:1, borderColor:'#E5E7EB' }}>
      <TouchableOpacity
        onPress={()=>setOpen(v=>!v)}
        activeOpacity={0.7}
        style={{ paddingVertical:12, paddingHorizontal:12, flexDirection:'row', alignItems:'center', justifyContent:'space-between' }}
      >
        <Text style={{ fontSize:14, fontWeight:'800' }}>범례</Text>
        <Text style={{ fontSize:16, color:'#111827' }}>{open ? '▴' : '▾'}</Text>
      </TouchableOpacity>

      {open && (
        <View style={{ paddingVertical:4, paddingHorizontal:12, paddingBottom:12 }}>
          {items.map((it,idx)=>(
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

/* ===================== Day Detail: Tabs & Aggregation ===================== */
type DayTabKey = 'overview' | 'study' | 'routine';

function DayDetailTabs({ study, routine }:{ study:StudyRecord[]; routine:RoutineRecord[] }) {
  const [tab, setTab] = useState<DayTabKey>('overview');

  const studyTotalMin = useMemo(()=> study.reduce((a,b)=>a+minutesFromStudy(b),0), [study]);
  const routineCounts = useMemo(()=>{
    let sessions = routine.length;
    let sets = 0;
    for (const r of routine) sets += typeof r.setCount === 'number' ? r.setCount : 1;
    return { sessions, sets };
  }, [routine]);

  const subjectAgg = useMemo(()=>{
    const m = new Map<string, number>();
    for (const s of study) {
      const key = (s.subject ?? '기타').trim();
      m.set(key, (m.get(key) ?? 0) + minutesFromStudy(s));
    }
    return [...m.entries()]
      .map(([subject, minutes])=>({ subject, minutes }))
      .sort((a,b)=> b.minutes - a.minutes || a.subject.localeCompare(b.subject));
  }, [study]);

  const routineAgg = useMemo(()=>{
    const m = new Map<string, { count:number; sets:number; minutes:number }>();
    for (const r of routine) {
      const title = (r.title ?? '루틴').trim();
      const sets = typeof r.setCount === 'number' ? r.setCount : 1;
      const minutes = totalMinutesFromRoutine(r);
      const cur = m.get(title) ?? { count:0, sets:0, minutes:0 };
      cur.count += 1; cur.sets += sets; cur.minutes += minutes;
      m.set(title, cur);
    }
    return [...m.entries()]
      .map(([title, v])=>({ title, ...v }))
      .sort((a,b)=> b.count - a.count || b.sets - a.sets || a.title.localeCompare(b.title));
  }, [routine]);

  return (
    <View style={{ flex:1 }}>
      {/* Segmented tabs (하루 요약 내부는 유지) */}
      <View style={{ paddingHorizontal:12, paddingTop:8, paddingBottom:4 }}>
        <View style={{ backgroundColor:'#F3F4F6', borderRadius:12, padding:4, flexDirection:'row' }}>
          {(['overview','study','routine'] as DayTabKey[]).map((k)=>(
            <TouchableOpacity
              key={k}
              onPress={()=>setTab(k)}
              style={{
                flex:1, paddingVertical:8, borderRadius:8, alignItems:'center',
                backgroundColor: tab===k ? '#fff' : 'transparent',
                borderWidth: tab===k ? 1 : 0, borderColor: tab===k ? '#E5E7EB' : 'transparent'
              }}>
              <Text style={{ fontSize:13, fontWeight: tab===k ? '800':'600' }}>
                {k==='overview' ? '요약' : k==='study' ? '공부' : '루틴'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* Content */}
      <ScrollView contentContainerStyle={{ paddingHorizontal:20, paddingTop:10, paddingBottom:24 }}>
        {tab === 'overview' && (
          <>
            <Card>
              <KpiRow items={[
                { label:'공부 시간', value: formatHM(studyTotalMin) },
                { label:'루틴 반복', value: `${routineCounts.sessions}회` },
                { label:'총 세트',   value: `${routineCounts.sets}세트` },
              ]} />
            </Card>

            <Section title="과목 TOP 3">
              <View style={{ flexDirection:'row', flexWrap:'wrap', gap:8 }}>
                {(subjectAgg.slice(0,3)).map(s=>(
                  <Pill key={s.subject} text={s.subject} sub={formatHM(s.minutes)} />
                ))}
                {subjectAgg.length===0 && <Text style={{ color: GRAY.text }}>공부 기록이 없습니다.</Text>}
              </View>
            </Section>

            <Section title="루틴 TOP 3(반복 기준)">
              <View style={{ flexDirection:'row', flexWrap:'wrap', gap:8 }}>
                {(routineAgg.slice(0,3)).map(r=>(
                  <Pill key={r.title} text={r.title} sub={`${r.count}회 · ${r.sets}세트`} />
                ))}
                {routineAgg.length===0 && <Text style={{ color: GRAY.text }}>루틴 기록이 없습니다.</Text>}
              </View>
            </Section>
          </>
        )}

        {tab === 'study' && (
          <>
            <Card>
              <Section title="과목별 합계">
                <TableHeader cols={['과목','시간']} />
                {subjectAgg.length===0 ? (
                  <Text style={{ color: GRAY.text, paddingVertical:8 }}>공부 기록이 없습니다.</Text>
                ) : subjectAgg.map(s=>(
                  <TableRow key={s.subject} boldFirst cells={[s.subject, formatHM(s.minutes)]} />
                ))}
              </Section>
            </Card>

            <Card>
              <Section title="상세(최신순)">
                <TableHeader cols={['과목/내용','시간']} />
                {study.length===0 ? (
                  <Text style={{ color: GRAY.text, paddingVertical:8 }}>공부 기록이 없습니다.</Text>
                ) : study
                  .slice()
                  .sort((a,b)=> pickDate(b).getTime()-pickDate(a).getTime())
                  .map((r,idx)=>(
                    <TableRow
                      key={idx}
                      cells={[`${r.subject ?? '기타'}  ·  ${(r.content ?? '').toString().slice(0,20)}`, formatHM(minutesFromStudy(r))]}
                    />
                  ))}
              </Section>
            </Card>
          </>
        )}

        {tab === 'routine' && (
          <>
            <Card>
              <Section title="제목별 요약(반복·세트 중심)">
                <TableHeader cols={['루틴','반복','세트','시간(보조)']} />
                {routineAgg.length===0 ? (
                  <Text style={{ color: GRAY.text, paddingVertical:8 }}>루틴 기록이 없습니다.</Text>
                ) : routineAgg.map(r=>(
                  <TableRow key={r.title} boldFirst cells={[r.title, `${r.count}회`, `${r.sets}세트`, r.minutes>0?formatHM(r.minutes):'-']} />
                ))}
              </Section>
            </Card>

            <Card>
              <Section title="상세(최신순)">
                <TableHeader cols={['루틴','세트','시간(보조)']} />
                {routine.length===0 ? (
                  <Text style={{ color: GRAY.text, paddingVertical:8 }}>루틴 기록이 없습니다.</Text>
                ) : routine
                  .slice()
                  .sort((a,b)=> pickDate(b).getTime()-pickDate(a).getTime())
                  .map((r,idx)=>(
                    <TableRow
                      key={idx}
                      cells={[
                        (r.title ?? '루틴'),
                        `${typeof r.setCount==='number'? r.setCount : 1}세트`,
                        totalMinutesFromRoutine(r)>0?formatHM(totalMinutesFromRoutine(r)):'-'
                      ]}
                    />
                  ))}
              </Section>
            </Card>
          </>
        )}
      </ScrollView>
    </View>
  );
}
