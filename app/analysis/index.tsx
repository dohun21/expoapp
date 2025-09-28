// app/analysis/index.tsx
import { useRouter } from 'expo-router';
import { onAuthStateChanged } from 'firebase/auth';
import { Timestamp, collection, getDocs, limit, query, where } from 'firebase/firestore';
import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Dimensions, Platform, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { auth, db } from '../../firebaseConfig';

/* ---------- UI Const ---------- */
const { width: SCREEN_W } = Dimensions.get('window');
const GREEN = { g1:'#A7F3D0', g2:'#6EE7B7', g3:'#34D399', g4:'#10B981', g5:'#059669', g6:'#064E3B' };
const GRAY  = { ring:'#E5E7EB', text:'#6B7280', light:'#F3F4F6' };

/* ---------- Types ---------- */
type StudyRecord = {
  subject?: string; content?: string;
  studyTime?: string; minutes?: number; totalMinutes?: number; seconds?: number;
  createdAt?: Timestamp | string | Date; timestamp?: Timestamp | string | Date; date?: Timestamp | string | Date;
  uid?: string; userId?: string; ownerId?: string; userUID?: string; email?: string; userEmail?: string;
};
type RoutineRecord = {
  title?: string; totalMinutes?: number; steps?: { step?:string; minutes?:number }[]; setCount?: number;
  createdAt?: Timestamp | string | Date; completedAt?: Timestamp | string | Date; timestamp?: Timestamp | string | Date; date?: Timestamp | string | Date;
  uid?: string; userId?: string; ownerId?: string; userUID?: string; email?: string; userEmail?: string;
};
const ALT_UID_FIELDS = ['userId','ownerId','userUID'] as const;
const ALT_EMAIL_FIELDS = ['email','userEmail'] as const;

/* ---------- Helpers ---------- */
function toDateSafe(v:any){ if(!v) return new Date(0); if(v instanceof Date) return v; if(typeof v?.toDate==='function') return (v as Timestamp).toDate(); const d=new Date(v as any); return isNaN(d.getTime())?new Date(0):d; }
function pickDate(obj:any){ const c=['createdAt','completedAt','timestamp','date']; for(const k of c) if(obj?.[k]) return toDateSafe(obj[k]); return new Date(0); }
function ymdKey(d:Date){ const y=d.getFullYear(), m=String(d.getMonth()+1).padStart(2,'0'), dd=String(d.getDate()).padStart(2,'0'); return `${y}-${m}-${dd}`; }
function minutesFromStudy(r:StudyRecord){ if(typeof r.totalMinutes==='number') return r.totalMinutes; if(typeof r.minutes==='number') return r.minutes; if(typeof r.seconds==='number') return Math.floor(r.seconds/60); const s=r.studyTime??''; const h=Number(s.match(/(\d+)\s*시간/)?.[1]??0); const m=Number(s.match(/(\d+)\s*분/)?.[1]??0); const sc=Number(s.match(/(\d+)\s*초/)?.[1]??0); const total=h*60+m+Math.floor(sc/60); return Number.isFinite(total)?total:0; }
function totalMinutesFromRoutine(r:RoutineRecord){ if(typeof r.totalMinutes==='number') return r.totalMinutes; const sets=typeof r.setCount==='number'?r.setCount:1; const sum=(r.steps??[]).reduce((a,s)=>a+(s?.minutes??0),0); const total=sum*sets; return Number.isFinite(total)?total:0; }
function formatHM(min:number){ if(!Number.isFinite(min)||min<=0) return '0분'; const h=Math.floor(min/60), m=Math.round(min%60); if(h===0) return `${m}분`; if(m===0) return `${h}시간`; return `${h}시간 ${m}분`; }

/* ---------- Small UI ---------- */
function Card({ children }:{ children:React.ReactNode }){
  return (
    <View style={{ backgroundColor:'#fff', borderRadius:12, borderWidth:1, borderColor:'#E5E7EB', padding:12, marginBottom:12, shadowColor:'#000', shadowOpacity:0.06, shadowRadius:6, shadowOffset:{width:0,height:3}, elevation:2 }}>
      {children}
    </View>
  );
}
function Kpi({ label, value }:{ label:string; value:string }){
  return (
    <View style={{ flex:1, backgroundColor:'#F9FAFB', borderRadius:10, borderWidth:1, borderColor:'#EEF2F7', padding:10 }}>
      <Text style={{ fontSize:12, color: GRAY.text }}>{label}</Text>
      <Text style={{ marginTop:4, fontSize:18, fontWeight:'800' }}>{value}</Text>
    </View>
  );
}
function Section({ title, right, children }:{ title:string; right?:React.ReactNode; children:React.ReactNode }){
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

/* ---------- Simple Bar Chart (no libs) ---------- */
function BarChart({ data, labels, max }: { data:number[]; labels:string[]; max:number; }){
  const H = 120; const barW = Math.max(10, Math.floor((SCREEN_W - 40 - 16 - data.length*6)/data.length));
  const safeMax = Math.max(1, max);
  return (
    <View style={{ paddingHorizontal:8 }}>
      <View style={{ height:H, flexDirection:'row', alignItems:'flex-end' }}>
        {data.map((v,i)=>(
          <View key={i} style={{ alignItems:'center', marginHorizontal:3 }}>
            <View style={{ width:barW, height: Math.round((v/safeMax)*H), backgroundColor:GREEN.g4, borderTopLeftRadius:6, borderTopRightRadius:6 }} />
          </View>
        ))}
      </View>
      <View style={{ flexDirection:'row', justifyContent:'space-between', marginTop:6 }}>
        {labels.map((t,i)=>(
          <Text key={i} style={{ width:barW+6, textAlign:'center', fontSize:11, color: GRAY.text }}>{t}</Text>
        ))}
      </View>
    </View>
  );
}

/* ---------- Screen ---------- */
export default function AnalysisScreen(){
  const router = useRouter();
  const [uid, setUid] = useState<string|null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [loading, setLoading] = useState(true);

  const [studyRows, setStudyRows] = useState<StudyRecord[]>([]);
  const [routineRows, setRoutineRows] = useState<RoutineRecord[]>([]);

  useEffect(()=>{
    const unsub = onAuthStateChanged(auth,(user)=>{
      if(!user){ setUid(null); setAuthChecked(true); router.replace('/login'); return; }
      setUid(user.uid); setAuthChecked(true);
    });
    return unsub;
  },[router]);

  useEffect(()=>{
    if(!authChecked || !uid) return;
    let cancelled=false;
    (async()=>{
      setLoading(true);
      try{
        const [ss, rr] = await Promise.all([fetchStudy(uid), fetchRoutine(uid)]);
        if(!cancelled){ setStudyRows(ss); setRoutineRows(rr); }
      } finally{ if(!cancelled) setLoading(false); }
    })();
    return ()=>{ cancelled=true; };
  },[authChecked, uid]);

  async function fetchStudy(userId:string):Promise<StudyRecord[]>{
    const email = auth.currentUser?.email ?? null;
    const tryQ = async (field:'uid'|typeof ALT_UID_FIELDS[number]|typeof ALT_EMAIL_FIELDS[number], val:string)=> {
      try{ const snap=await getDocs(query(collection(db,'studyRecords'), where(field as any,'==',val), limit(500))); if(!snap.empty) return snap.docs.map(d=>d.data() as StudyRecord); } catch {}
      return null;
    };
    let rows:StudyRecord[]|null = await tryQ('uid', userId);
    if(!rows) for(const f of ALT_UID_FIELDS){ rows = await tryQ(f, userId); if(rows) break; }
    if(!rows && email) for(const f of ALT_EMAIL_FIELDS){ rows = await tryQ(f, email); if(rows) break; }
    rows = rows ?? [];
    return rows.map(s=>({ ...s, createdAt: pickDate(s) })).sort((a,b)=> +pickDate(b)-+pickDate(a));
  }
  async function fetchRoutine(userId:string):Promise<RoutineRecord[]>{
    const email = auth.currentUser?.email ?? null;
    const tryQ = async (field:'uid'|typeof ALT_UID_FIELDS[number]|typeof ALT_EMAIL_FIELDS[number], val:string)=> {
      try{ const snap=await getDocs(query(collection(db,'routineRecords'), where(field as any,'==',val), limit(500))); if(!snap.empty) return snap.docs.map(d=>d.data() as RoutineRecord); } catch {}
      return null;
    };
    let rows:RoutineRecord[]|null = await tryQ('uid', userId);
    if(!rows) for(const f of ALT_UID_FIELDS){ rows = await tryQ(f, userId); if(rows) break; }
    if(!rows && email) for(const f of ALT_EMAIL_FIELDS){ rows = await tryQ(f, email); if(rows) break; }
    rows = rows ?? [];
    return rows.map(r=>({ ...r, totalMinutes: totalMinutesFromRoutine(r), createdAt: pickDate(r) })).sort((a,b)=> +pickDate(b)-+pickDate(a));
  }

  /* ---------- Aggregations ---------- */
  const lastNDaysKeys = (n:number)=> {
    const arr:string[] = [];
    const today = new Date(); today.setHours(0,0,0,0);
    for(let i=n-1;i>=0;i--){
      const d = new Date(today); d.setDate(d.getDate()-i);
      arr.push(ymdKey(d));
    }
    return arr;
  };

  const totalsByDay = useMemo(()=>{
    const map:Record<string,number> = {};
    [...studyRows, ...routineRows].forEach(r=>{
      const d = pickDate(r as any);
      const key = ymdKey(d);
      const v = 'subject' in r ? minutesFromStudy(r as StudyRecord) : totalMinutesFromRoutine(r as RoutineRecord);
      map[key] = (map[key] ?? 0) + (v || 0);
    });
    return map;
  },[studyRows, routineRows]);

  const keys7 = useMemo(()=>lastNDaysKeys(7),[]);
  const keys30 = useMemo(()=>lastNDaysKeys(30),[]);
  const data7 = keys7.map(k=> totalsByDay[k] ?? 0);
  const data30 = keys30.map(k=> totalsByDay[k] ?? 0);
  const max7 = Math.max(1, ...data7);
  const sum7 = data7.reduce((a,b)=>a+b,0);
  const avg7 = Math.round(sum7/7);
  const best7 = Math.max(0, ...data7);
  const best7Idx = data7.findIndex(v=>v===best7);
  const best7Label = keys7[best7Idx]?.slice(5);

  const streak = useMemo(()=>{
    // 연속 기록 일수 (오늘부터 뒤로)
    let s=0;
    for(let i=keys30.length-1;i>=0;i--){
      const v = totalsByDay[keys30[i]] ?? 0;
      if(v>0) s++; else break;
    }
    return s;
  },[totalsByDay, keys30]);

  const subjectAgg = useMemo(()=>{
    const m = new Map<string, number>();
    studyRows.forEach(s=>{
      const key = (s.subject ?? '기타').trim();
      m.set(key, (m.get(key) ?? 0) + minutesFromStudy(s));
    });
    return [...m.entries()].map(([subject, minutes])=>({ subject, minutes }))
      .sort((a,b)=> b.minutes - a.minutes || a.subject.localeCompare(b.subject))
      .slice(0,5);
  },[studyRows]);

  const routineAgg = useMemo(()=>{
    const m = new Map<string, { count:number; sets:number; minutes:number }>();
    routineRows.forEach(r=>{
      const title = (r.title ?? '루틴').trim();
      const sets = typeof r.setCount==='number' ? r.setCount : 1;
      const minutes = totalMinutesFromRoutine(r);
      const cur = m.get(title) ?? { count:0, sets:0, minutes:0 };
      cur.count += 1; cur.sets += sets; cur.minutes += minutes;
      m.set(title, cur);
    });
    return [...m.entries()].map(([title, v])=>({ title, ...v }))
      .sort((a,b)=> b.count - a.count || b.sets - a.sets || a.title.localeCompare(b.title))
      .slice(0,5);
  },[routineRows]);

  /* ---------- Guard ---------- */
  if(!authChecked || !uid || loading){
    return (
      <View style={{ flex:1, backgroundColor:'#fff', alignItems:'center', justifyContent:'center' }}>
        <ActivityIndicator size="large" color="#059669" />
      </View>
    );
  }

  /* ---------- UI ---------- */
  return (
    <View style={{ flex:1, backgroundColor:'#FFFFFF' }}>
      {/* Header */}
      <View style={{ paddingTop: Platform.OS==='android'?28:48, paddingHorizontal:20, paddingBottom:8 }}>
        <View style={{ flexDirection:'row', alignItems:'center', justifyContent:'space-between' }}>
          <Text style={{ fontSize:22, fontWeight:'bold', marginTop: 25, marginLeft: 10 }}>분석</Text>
          <TouchableOpacity onPress={()=>router.back()} style={{ padding:8, marginTop:25 }}>
            <Text style={{ fontSize:16 }}>닫기</Text>
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView style={{ flex:1 }} contentContainerStyle={{ paddingHorizontal:20, paddingBottom:32 }}>
        {/* KPIs */}
        <Card>
          <View style={{ flexDirection:'row', gap:8 }}>
            <Kpi label="이번 주 총합" value={formatHM(sum7)} />
            <Kpi label="하루 평균(7일)" value={formatHM(avg7)} />
          </View>
          <View style={{ height:8 }} />
          <View style={{ flexDirection:'row', gap:8 }}>
            <Kpi label="최고치(최근7일)" value={`${formatHM(best7)} · ${best7Label ?? '-'}`} />
            <Kpi label="연속 기록" value={`${streak}일`} />
          </View>
        </Card>

        {/* Weekly bars */}
        <Section title="최근 7일 추이">
          <Card>
            <BarChart
              data={data7}
              labels={keys7.map(k=>k.slice(5))} // MM-DD
              max={max7}
            />
            <Text style={{ marginTop:8, fontSize:12, color: GRAY.text }}>공부 + 루틴 총합(분)</Text>
          </Card>
        </Section>

        {/* Subjects */}
        <Section title="과목 TOP 5">
          <Card>
            {subjectAgg.length===0 ? (
              <Text style={{ color: GRAY.text }}>공부 기록이 없습니다.</Text>
            ) : subjectAgg.map((s,idx)=>(
              <View key={s.subject} style={{ flexDirection:'row', alignItems:'center', paddingVertical:8, borderBottomWidth: idx===subjectAgg.length-1?0:1, borderBottomColor:'#F1F5F9' }}>
                <View style={{ width:22, height:22, borderRadius:11, backgroundColor:'#F3F4F6', alignItems:'center', justifyContent:'center', marginRight:8 }}>
                  <Text style={{ fontSize:12, color:'#111827' }}>{idx+1}</Text>
                </View>
                <Text style={{ flex:1, fontSize:14, fontWeight:'700' }}>{s.subject}</Text>
                <Text style={{ fontSize:13, color: GRAY.text }}>{formatHM(s.minutes)}</Text>
              </View>
            ))}
          </Card>
        </Section>

        {/* Routines */}
        <Section title="루틴 TOP 5(반복 기준)">
          <Card>
            {routineAgg.length===0 ? (
              <Text style={{ color: GRAY.text }}>루틴 기록이 없습니다.</Text>
            ) : routineAgg.map((r,idx)=>(
              <View key={r.title} style={{ flexDirection:'row', alignItems:'center', paddingVertical:8, borderBottomWidth: idx===routineAgg.length-1?0:1, borderBottomColor:'#F1F5F9' }}>
                <View style={{ width:22, height:22, borderRadius:11, backgroundColor:'#ECFDF5', alignItems:'center', justifyContent:'center', marginRight:8 }}>
                  <Text style={{ fontSize:12, color: GREEN.g5 }}>{idx+1}</Text>
                </View>
                <Text style={{ flex:1, fontSize:14, fontWeight:'700' }}>{r.title}</Text>
                <Text style={{ fontSize:13, color: GRAY.text }}>{r.count}회 · {r.sets}세트</Text>
              </View>
            ))}
          </Card>
        </Section>

        {/* 30-day mini trend (text summary) */}
        <Section title="최근 30일 요약">
          <Card>
            <Text style={{ fontSize:13, color: GRAY.text }}>
              총 {formatHM(data30.reduce((a,b)=>a+b,0))} · 최고 {formatHM(Math.max(0, ...data30))} · 평균 {formatHM(Math.round(data30.reduce((a,b)=>a+b,0)/Math.max(1,data30.length)))}
            </Text>
          </Card>
        </Section>
      </ScrollView>
    </View>
  );
}
