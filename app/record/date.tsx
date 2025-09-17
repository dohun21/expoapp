import { useLocalSearchParams, useRouter } from 'expo-router';
import { onAuthStateChanged } from 'firebase/auth';
import {
  Timestamp, collection, getDocs, limit, query, where,
} from 'firebase/firestore';
import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator, Platform, ScrollView, Text,
  TouchableOpacity, View
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

  // ✅ summary 필드 (과거/현재 스키마 모두 수용)
  stars?: number;            // 0~5
  feelings?: string[];       // 오늘의 느낌 태그들
  goalStatus?: 'success' | 'fail' | 'none' | 'full' | 'partial';

  memo?: string;

  createdAt?: Timestamp | string | Date;
  timestamp?: Timestamp | string | Date;
  date?: Timestamp | string | Date;

  // 과거 스키마 호환
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

  // 과거 스키마 호환
  uid?: string; userId?: string; ownerId?: string; userUID?: string;
  email?: string; userEmail?: string;
};

/* ===================== UI Const ===================== */
const GREEN = { 500:'#059669', 600:'#047857', 100:'#DCFCE7' };
const BLUE  = { 500:'#3B82F6', 100:'#DBEAFE' };
const GRAY  = { text:'#6B7280', border:'#E5E7EB', bg:'#F9FAFB', line:'#F3F4F6', dark:'#111827' };

/* ===================== Helper ===================== */
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
  return h*60 + m + Math.floor(sc/60);
}
function totalMinutesFromRoutine(r: RoutineRecord): number {
  if (typeof r.totalMinutes === 'number') return r.totalMinutes;
  const sets = typeof r.setCount === 'number' ? r.setCount : 1;
  const sumSteps = (r.steps ?? []).reduce((a, s) => a + (s?.minutes ?? 0), 0);
  return sumSteps * sets;
}
function formatHM(min: number) {
  if (!Number.isFinite(min) || min <= 0) return '0분';
  const h = Math.floor(min / 60), m = min % 60;
  if (h && m) return `${h}시간 ${m}분`;
  if (h) return `${h}시간`;
  return `${m}분`;
}
function getKSTDayRange(ymd: string){
  const [y,m,d] = ymd.split('-').map(Number);
  return {
    from: new Date(y, m-1, d, 0,0,0,0),
    to:   new Date(y, m-1, d, 23,59,59,999),
  };
}

/* 시간대 버킷팅(2시간 간격, 0~24) */
function splitIntoSegmentsOfDay(
  items: { start: Date; end: Date; minutes: number }[],
  dayFrom: Date, dayTo: Date
){
  const buckets = Array.from({ length: 12 }, () => 0); // 0: 00-02, ... 11: 22-24
  const clamp = (t:number)=>Math.max(dayFrom.getTime(), Math.min(dayTo.getTime(), t));
  for (const it of items) {
    const s = clamp(it.start.getTime());
    const e = clamp(it.end.getTime());
    if (e <= s) continue;
    let cur = s;
    while (cur < e) {
      const hour = new Date(cur).getHours();
      const idx = Math.floor(hour/2); // 0..11
      const bucketStart = new Date(dayFrom.getFullYear(), dayFrom.getMonth(), dayFrom.getDate(), idx*2).getTime();
      const bucketEnd   = new Date(dayFrom.getFullYear(), dayFrom.getMonth(), dayFrom.getDate(), idx*2 + 2).getTime();
      const sliceEnd = Math.min(bucketEnd, e);
      const sliceMin = Math.max(0, Math.round((sliceEnd - cur) / 60000));
      buckets[idx] += sliceMin;
      cur = sliceEnd;
    }
  }
  return buckets;
}

/* ✅ goalStatus 통합(normalize): 과거('success'/'fail')와 현재('full'/'partial') 모두 지원 */
type GoalNorm = 'full' | 'partial' | 'fail' | 'none';
function normalizeGoalStatus(v: StudyRecord['goalStatus']): GoalNorm {
  const s = String(v ?? 'none').toLowerCase();
  if (s === 'success' || s === 'full') return 'full';
  if (s === 'partial') return 'partial';
  if (s === 'fail') return 'fail';
  return 'none';
}

/* ===================== UI Atoms ===================== */
function Card({ children, style }: { children: React.ReactNode; style?: any }) {
  return (
    <View style={[{
      backgroundColor:'#fff', borderRadius:14,
      borderWidth:1, borderColor: GRAY.border,
      padding:14, marginBottom:12,
      shadowColor:'#000', shadowOpacity:0.05, shadowRadius:8,
      shadowOffset:{ width:0, height:3 }, elevation:2,
    }, style]}>
      {children}
    </View>
  );
}
function StatTile({ label, value, tone='default' }:{
  label:string; value:string; tone?:'default'|'green'|'blue';
}){
  const bg = tone==='green'? GREEN[100] : tone==='blue'? BLUE[100] : GRAY.bg;
  const color = tone==='green'? GREEN[600] : tone==='blue'? BLUE[500] : GRAY.dark;
  return (
    <View style={{ flex:1, backgroundColor:bg, padding:12, borderRadius:12, borderWidth:1, borderColor:GRAY.border }}>
      <Text style={{ fontSize:12, color:GRAY.text, marginBottom:6 }}>{label}</Text>
      <Text style={{ fontSize:18, fontWeight:'800', color }}>{value}</Text>
    </View>
  );
}
function Chip({ text, tone='green' }:{ text:string; tone?:'green'|'blue'|'gray' }){
  const map:any = {
    green: { bg:'#ECFDF5', fg:GREEN[600], bd: '#D1FAE5' },
    blue:  { bg:'#EFF6FF', fg:BLUE[500],  bd: '#DBEAFE' },
    gray:  { bg:'#F3F4F6', fg:GRAY.dark,  bd: '#E5E7EB' },
  };
  const c = map[tone];
  return (
    <View style={{ paddingHorizontal:10, paddingVertical:5, backgroundColor:c.bg, borderColor:c.bd, borderWidth:1, borderRadius:999, marginRight:6, marginBottom:6 }}>
      <Text style={{ fontSize:12, color:c.fg }}>{text}</Text>
    </View>
  );
}
function Progress({ value }:{ value:number }) {
  return (
    <View style={{ height:10, backgroundColor:'#E5E7EB', borderRadius:999, overflow:'hidden' }}>
      <View style={{ width:`${Math.max(0, Math.min(1, value))*100}%`, height:'100%', backgroundColor:GREEN[500] }} />
    </View>
  );
}

/* ===================== Screen ===================== */
export default function RecordDayDetail() {
  const router = useRouter();
  const { date } = useLocalSearchParams<{ date?: string }>();

  const [uid, setUid] = useState<string|null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [loading, setLoading] = useState(true);

  const [study, setStudy] = useState<StudyRecord[]>([]);
  const [routines, setRoutines] = useState<RoutineRecord[]>([]);

  /* ----- auth ----- */
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      if (!user) { router.replace('/login'); return; }
      setUid(user.uid); setAuthChecked(true);
    });
    return unsub;
  }, []);

  /* ----- data ----- */
  useEffect(() => {
    if (!authChecked || !uid || !date) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [ss, rr] = await Promise.all([fetchStudy(uid), fetchRoutine(uid)]);
        const { from, to } = getKSTDayRange(date);
        const inDay = (x:any) => { const t = pickDate(x); return t >= from && t <= to; };
        const s2 = ss.filter(inDay).sort((a,b)=> pickDate(b).getTime()-pickDate(a).getTime());
        const r2 = rr.filter(inDay).sort((a,b)=> pickDate(b).getTime()-pickDate(a).getTime());
        if (!cancelled) { setStudy(s2); setRoutines(r2); }
      } finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [authChecked, uid, date]);

  async function fetchStudy(userId: string): Promise<StudyRecord[]> {
    const email = auth.currentUser?.email ?? null;
    try {
      const snap = await getDocs(query(collection(db, 'studyRecords'), where('uid', '==', userId), limit(800)));
      if (!snap.empty) return snap.docs.map(d => d.data() as StudyRecord);
    } catch {}
    for (const f of ALT_UID_FIELDS) {
      try {
        const snap = await getDocs(query(collection(db, 'studyRecords'), where(f as any, '==', userId), limit(800)));
        if (!snap.empty) return snap.docs.map(d => d.data() as StudyRecord);
      } catch {}
    }
    if (email) {
      for (const f of ALT_EMAIL_FIELDS) {
        try {
          const snap = await getDocs(query(collection(db, 'studyRecords'), where(f as any, '==', email), limit(800)));
          if (!snap.empty) return snap.docs.map(d => d.data() as StudyRecord);
        } catch {}
      }
    }
    return [];
  }
  async function fetchRoutine(userId: string): Promise<RoutineRecord[]> {
    const email = auth.currentUser?.email ?? null;
    try {
      const snap = await getDocs(query(collection(db, 'routineRecords'), where('uid', '==', userId), limit(800)));
      if (!snap.empty) return snap.docs.map(d => d.data() as RoutineRecord);
    } catch {}
    for (const f of ALT_UID_FIELDS) {
      try {
        const snap = await getDocs(query(collection(db, 'routineRecords'), where(f as any, '==', userId), limit(800)));
        if (!snap.empty) return snap.docs.map(d => d.data() as RoutineRecord);
      } catch {}
    }
    if (email) {
      for (const f of ALT_EMAIL_FIELDS) {
        try {
          const snap = await getDocs(query(collection(db, 'routineRecords'), where(f as any, '==', email), limit(800)));
          if (!snap.empty) return snap.docs.map(d => d.data() as RoutineRecord);
        } catch {}
      }
    }
    return [];
  }

  /* ----- 분석 ----- */
  const { from: dayFrom, to: dayTo } = useMemo(() => getKSTDayRange(String(date)), [date]);

  const totalStudyMin   = useMemo(()=> study.reduce((a,s)=>a+minutesFromStudy(s),0), [study]);
  const totalRoutineMin = useMemo(()=> routines.reduce((a,r)=>a+totalMinutesFromRoutine(r),0), [routines]);

  const avgStar = useMemo(()=>{
    const list = study.map(s=>s.stars ?? 0).filter(n=>n>0);
    return list.length ? list.reduce((a,b)=>a+b,0)/list.length : 0;
  }, [study]);
  const goalRate = useMemo(()=>{
    const all = study.filter(s=>{
      const g = normalizeGoalStatus(s.goalStatus);
      return g !== 'none';
    });
    if (!all.length) return 0;
    const ok = all.filter(s=> normalizeGoalStatus(s.goalStatus) === 'full').length;
    return Math.round(ok/all.length*100);
  }, [study]);

  // 상위 과목 (비중)
  const topSubjects = useMemo(()=>{
    const m = new Map<string, number>();
    study.forEach(s => m.set(s.subject ?? '기타', (m.get(s.subject ?? '기타') ?? 0) + minutesFromStudy(s)));
    const total = Math.max(1, totalStudyMin);
    return Array.from(m.entries()).sort((a,b)=>b[1]-a[1]).slice(0,3).map(([k,v])=>`${k} ${Math.round(v/total*100)}%`);
  }, [study, totalStudyMin]);

  // 시간대 분포(2시간 단위)
  const timeBuckets = useMemo(()=>{
    // study → 세그먼트(start=end-minutes)
    const segStudy = study.map(s=>{
      const end = pickDate(s);
      const m = minutesFromStudy(s);
      const start = new Date(end.getTime() - m*60*1000);
      return { start, end, minutes: m };
    });
    // routine → 세그먼트
    const segRoutine = routines.map(r=>{
      const end = pickDate(r);
      const m = totalMinutesFromRoutine(r);
      const start = new Date(end.getTime() - m*60*1000);
      return { start, end, minutes: m };
    });
    const buckets = splitIntoSegmentsOfDay([...segStudy, ...segRoutine], dayFrom, dayTo);
    const max = Math.max(1, ...buckets);
    return { buckets, max };
  }, [study, routines, dayFrom.getTime(), dayTo.getTime()]);

  /* ----- guards ----- */
  if (!authChecked || loading || !date) {
    return (
      <View style={{ flex:1, backgroundColor:'#fff', alignItems:'center', justifyContent:'center' }}>
        <ActivityIndicator size="large" color={GREEN[500]} />
      </View>
    );
  }

  /* ===================== UI ===================== */
  return (
    <View style={{ flex:1, backgroundColor:'#FFFFFF' }}>
      {/* Header */}
      <View style={{
        paddingTop: Platform.OS==='android'?28:48,
        paddingHorizontal:16, paddingBottom:12,
        borderBottomWidth:1, borderColor: GRAY.border,
        backgroundColor:'#fff', flexDirection:'row', alignItems:'center', justifyContent:'space-between'
      }}>
        {/* ✅ 바로 이전 화면(달력 탭)으로 복귀 */}
        <TouchableOpacity
          onPress={()=>router.back()}
          hitSlop={{ top:10, bottom:10, left:10, right:10 }}
          style={{ padding:8 }}
        >
          <Text style={{ fontSize:18 }}>〈</Text>
        </TouchableOpacity>
        <Text style={{ fontSize:16, fontWeight:'800' }}>{date}</Text>
        <View style={{ width:32 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding:16, paddingBottom:36 }}>
        {/* ===== 하루 요약 / 분석 ===== */}
        <Card>
          <Text style={{ fontSize:15, fontWeight:'800', marginBottom:10 }}>📊 하루 분석</Text>
          <View style={{ flexDirection:'row', gap:10 as any }}>
            <StatTile label="총 공부" value={formatHM(totalStudyMin)} tone="green" />
            <StatTile label="총 루틴" value={formatHM(totalRoutineMin)} tone="blue" />
          </View>

          <View style={{ height:10 }} />
          <View style={{ flexDirection:'row', gap:10 as any }}>
            <StatTile label="집중도 평균" value={avgStar ? `${avgStar.toFixed(1)} / 5` : '-'} />
            <StatTile label="목표 달성률" value={`${goalRate}%`} />
          </View>

          {/* 상위 과목 */}
          {topSubjects.length>0 && (
            <View style={{ marginTop:10 }}>
              <Text style={{ fontSize:12, color:GRAY.text, marginBottom:6 }}>많이 공부한 과목</Text>
              <View style={{ flexDirection:'row', flexWrap:'wrap' }}>
                {topSubjects.map((s,i)=><Chip key={i} text={s} tone="blue" />)}
              </View>
            </View>
          )}

          {/* 시간대 분포 미니 차트 (2시간 간격) */}
          <View style={{ marginTop:12 }}>
            <Text style={{ fontSize:12, color:GRAY.text, marginBottom:8 }}>시간대 분포 (2시간)</Text>
            <View style={{ flexDirection:'row', alignItems:'flex-end', justifyContent:'space-between' }}>
              {timeBuckets.buckets.map((v, i) => {
                const hLabel = String(i*2).padStart(2,'0');
                const height = Math.round((v / timeBuckets.max) * 56) + 6; // 최소 높이 6
                return (
                  <View key={i} style={{ alignItems:'center', width:18 }}>
                    <View style={{
                      width:14, height, borderRadius:6,
                      backgroundColor: v>0 ? GREEN[500] : '#E5E7EB'
                    }}/>
                    <Text style={{ fontSize:8, color:GRAY.text, marginTop:4 }}>{hLabel}</Text>
                  </View>
                );
              })}
            </View>
          </View>
        </Card>

        {/* ===== 공부 기록 ===== */}
        <Text style={{ fontSize:15, fontWeight:'800', marginBottom:8 }}>📚 공부 기록</Text>
        {study.length === 0 ? (
          <Card><Text style={{ color: GRAY.text }}>기록이 없습니다.</Text></Card>
        ) : study.map((r, idx) => {
          const mins = minutesFromStudy(r);
          const star = Math.max(0, Math.min(5, Math.round((r.stars ?? 0) * 10) / 10));
          const g = normalizeGoalStatus(r.goalStatus);
          const chipStyle =
            g === 'full' ? { bg:'#ECFDF5', bd:'#A7F3D0', fg:GREEN[600], label:'목표 달성' } :
            g === 'partial' ? { bg:'#FEF9C3', bd:'#FDE68A', fg:'#CA8A04', label:'일부 달성' } :
            g === 'fail' ? { bg:'#FEE2E2', bd:'#FECACA', fg:'#DC2626', label:'목표 미달성' } :
            null;

          return (
            <Card key={`s-${idx}`}>
              {/* 제목 */}
              <View style={{ flexDirection:'row', alignItems:'center', justifyContent:'space-between' }}>
                <Text style={{ fontSize:15, fontWeight:'700', color: GRAY.dark }}>
                  {(r.subject ?? '공부')}{r.content ? ` · ${r.content}` : ''}
                </Text>
                <Text style={{ fontSize:14, color: GREEN[500], fontWeight:'700' }}>{formatHM(mins)}</Text>
              </View>

              {/* 집중도 */}
              <View style={{ marginTop:10 }}>
                <View style={{ flexDirection:'row', justifyContent:'space-between', marginBottom:6 }}>
                  <Text style={{ fontSize:12, color: GRAY.text }}>집중도</Text>
                  <Text style={{ fontSize:12, color: GRAY.text }}>{star ? `${star}/5` : '-'}</Text>
                </View>
                <Progress value={(r.stars ?? 0) / 5} />
              </View>

              {/* 오늘의 느낌 */}
              {!!(r.feelings?.length) && (
                <View style={{ marginTop:10 }}>
                  <Text style={{ fontSize:12, color: GRAY.text, marginBottom:6 }}>오늘의 느낌</Text>
                  <View style={{ flexDirection:'row', flexWrap:'wrap' }}>
                    {r.feelings!.map((f, i)=><Chip key={i} text={f} />)}
                  </View>
                </View>
              )}

              {/* 목표 달성 여부 (full/partial/fail 지원) */}
              {chipStyle && (
                <View style={{
                  marginTop:10, alignSelf:'flex-start',
                  backgroundColor: chipStyle.bg,
                  borderColor: chipStyle.bd,
                  borderWidth:1, paddingVertical:6, paddingHorizontal:10,
                  borderRadius:10
                }}>
                  <Text style={{ fontSize:12, fontWeight:'700', color: chipStyle.fg }}>
                    {chipStyle.label}
                  </Text>
                </View>
              )}

              {/* 메모(있을 때만) */}
              {!!r.memo && (
                <View style={{ marginTop:10, borderTopWidth:1, borderTopColor: GRAY.line, paddingTop:8 }}>
                  <Text style={{ fontSize:12, color: GRAY.text }}>메모</Text>
                  <Text style={{ fontSize:13, color: GRAY.dark, marginTop:4 }}>{r.memo}</Text>
                </View>
              )}
            </Card>
          );
        })}

        {/* ===== 루틴 기록 ===== */}
        <Text style={{ fontSize:15, fontWeight:'800', marginTop:6, marginBottom:8 }}>✅ 루틴 기록</Text>
        {routines.length === 0 ? (
          <Card><Text style={{ color: GRAY.text }}>기록이 없습니다.</Text></Card>
        ) : routines.map((r, idx) => (
          <Card key={`r-${idx}`}>
            <View style={{ flexDirection:'row', alignItems:'center', justifyContent:'space-between' }}>
              <Text style={{ fontSize:15, fontWeight:'700' }}>{r.title ?? '루틴'}</Text>
              <Text style={{ fontSize:14, color: BLUE[500], fontWeight:'700' }}>{formatHM(totalMinutesFromRoutine(r))}</Text>
            </View>
            {!!(r.steps?.length) && (
              <Text style={{ fontSize:12, color: GRAY.text, marginTop:6 }}>
                {r.steps?.map(s=>s.step).filter(Boolean).join(' · ')}
              </Text>
            )}
            {typeof r.setCount === 'number' && (
              <Text style={{ fontSize:12, color: GRAY.text, marginTop:2 }}>
                세트 수: {r.setCount}
              </Text>
            )}
            {typeof r.completed === 'boolean' && (
              <Text style={{ fontSize:12, color: GRAY.text, marginTop:2 }}>
                완료: {r.completed ? '예' : '아니오'}
              </Text>
            )}
          </Card>
        ))}
      </ScrollView>
    </View>
  );
}
