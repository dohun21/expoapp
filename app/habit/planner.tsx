// app/habit/planner.tsx
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect } from '@react-navigation/native';
import { useRouter } from 'expo-router';
import { onAuthStateChanged } from 'firebase/auth';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  Dimensions,
  NativeScrollEvent,
  NativeSyntheticEvent,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View
} from 'react-native';
import { auth } from '../../firebaseConfig';

// Firestore
import { doc, getDoc, onSnapshot, serverTimestamp, setDoc } from 'firebase/firestore';
import { db } from '../../firebaseConfig';

/* ===== Keys / Types ===== */
const k = (base: string, uid: string) => `${base}_${uid}`;
const WEEKLY_KEY_BASE = 'weeklyPlannerV1';
const ROUTINE_TAB_KEY = '@userRoutinesV1';

type Step = { step: string; minutes: number };
type RoutineItem = { id: string; title: string; steps: Step[]; tags?: string[]; origin?: 'preset'|'user' };
type WeeklyPlanItem = { planId: string; routineId: string; title?: string; steps?: Step[]; tags?: string[]; startAt?: string };
type WeeklyPlanner = {
  mon?: WeeklyPlanItem[]; tue?: WeeklyPlanItem[]; wed?: WeeklyPlanItem[]; thu?: WeeklyPlanItem[]; fri?: WeeklyPlanItem[]; sat?: WeeklyPlanItem[]; sun?: WeeklyPlanItem[];
};
type DayKey = keyof WeeklyPlanner;

type WeeklyPlannerDoc = { days: WeeklyPlanner; version?: number; updatedAt?: any };

/* ===== Firestore helpers ===== */
function plannerDocRef(uid: string, docId: string = 'current') {
  return doc(db, 'users', uid, 'weeklyPlanner', docId);
}
async function pullPlanner(uid: string, docId = 'current'): Promise<WeeklyPlannerDoc | null> {
  const snap = await getDoc(plannerDocRef(uid, docId));
  if (!snap.exists()) return null;
  return snap.data() as WeeklyPlannerDoc;
}
async function pushPlanner(uid: string, days: WeeklyPlanner, docId = 'current', version = 1) {
  await setDoc(
    plannerDocRef(uid, docId),
    { days, version, updatedAt: serverTimestamp() },
    { merge: true }
  );
}
async function loadPlannerCache(uid: string): Promise<WeeklyPlanner | null> {
  try {
    const raw = await AsyncStorage.getItem(k(WEEKLY_KEY_BASE, uid));
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}
async function savePlannerCache(uid: string, data: WeeklyPlanner) {
  await AsyncStorage.setItem(k(WEEKLY_KEY_BASE, uid), JSON.stringify(data));
}
async function initialLoadHybrid(uid: string): Promise<WeeklyPlanner | null> {
  const cached = await loadPlannerCache(uid);
  const remote = await pullPlanner(uid);
  if (!remote) {
    if (cached) { try { await pushPlanner(uid, cached); } catch {} }
    return cached ?? {};
  }
  await savePlannerCache(uid, remote.days);
  return remote.days;
}
async function saveBothHybrid(uid: string, data: WeeklyPlanner) {
  await savePlannerCache(uid, data);
  try { await pushPlanner(uid, data); } catch {}
}

/* ===== Consts ===== */
const DAY_KEYS: DayKey[] = ['mon','tue','wed','thu','fri','sat','sun'];
const DAY_LABEL: Record<DayKey,string> = { mon:'월',tue:'화',wed:'수',thu:'목',fri:'금',sat:'토',sun:'일' };

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');

/* ===== Utils ===== */
function getTodayKSTDate(){ const now=new Date(); const utc=now.getTime()+now.getTimezoneOffset()*60000; return new Date(utc+9*3600000); }
function parseHHMM(s?:string){ if(!s) return null; const m=String(s).trim().match(/^(\d{1,2}):(\d{2})$/); if(!m) return null; const hh=+m[1], mm=+m[2]; if(hh<0||hh>23||mm<0||mm>59) return null; return {h:hh,m:mm}; }
function uidOrLocal(u?:string|null){ return u ?? 'local'; }
function uniqId(){ return `${Date.now()}-${Math.random().toString(36).slice(2,8)}`; }
const pad2=(n:number)=>String(n).padStart(2,'0');

/* ===== Presets (간단) ===== */
const PRESETS: RoutineItem[] = [
  { id:'preset-2',  title:'영단어 암기 루틴', steps:[{ step:'영단어 외우기', minutes:20 }, { step:'예문 만들기', minutes:15 }, { step:'퀴즈 테스트 해보기 1분', minutes:10 }], origin:'preset' },
];

/* ===== Screen ===== */
export default function PlannerPage(){
  const router = useRouter();
  const [uid, setUid] = useState<string|null>(null);

  const [activeDay, setActiveDay] = useState<DayKey>('mon');
  useEffect(()=>{ const idx=(getTodayKSTDate().getDay()+6)%7; setActiveDay(DAY_KEYS[idx]); },[]);

  const [weekly, setWeekly] = useState<WeeklyPlanner>({});
  const [library, setLibrary] = useState<RoutineItem[]>([]);

  useEffect(()=>{
    const unsub = onAuthStateChanged(auth, async user=>{
      const _uid = uidOrLocal(user?.uid);
      setUid(user?.uid ?? null);
      // 알림 기능 없음: 권한/예약 처리 제거
      primeLoad(_uid);
    });
    return unsub;
  },[]);

  // 실시간 반영 (로그인 사용자에게만)
  useEffect(() => {
    if (!uid) return;
    const unsub = onSnapshot(plannerDocRef(uid), (snap) => {
      if (!snap.exists()) return;
      const { days } = (snap.data() as WeeklyPlannerDoc);
      if (days) {
        savePlannerCache(uid, days);
        setWeekly(normalizeWeekly(days));
      }
    });
    return () => unsub();
  }, [uid]);

  useFocusEffect(useCallback(()=>{
    primeLoad(uidOrLocal(uid));
  },[uid]));

  async function primeLoad(_uid:string){ await Promise.all([loadWeekly(_uid), loadLibrary()]); }

  const normalizeWeekly = (raw:any):WeeklyPlanner=>{
    const out:WeeklyPlanner={};
    DAY_KEYS.forEach(d=>{
      const arr = Array.isArray(raw?.[d]) ? raw[d] : [];
      out[d] = arr.map((x:any):WeeklyPlanItem=>({
        planId: String(x?.planId ?? uniqId()),
        routineId: String(x?.routineId ?? x?.id ?? ''),
        startAt: typeof x?.startAt==='string' ? x.startAt : undefined,
        title: x?.title, steps: Array.isArray(x?.steps)? x.steps: undefined, tags: Array.isArray(x?.tags)? x.tags: undefined,
      }));
    });
    return out;
  };

  async function loadWeekly(_uid:string){
    const data = await initialLoadHybrid(_uid);
    setWeekly(normalizeWeekly(data ?? {}));
  }
  async function saveWeekly(_uid:string, data:WeeklyPlanner){
    setWeekly(data);
    await saveBothHybrid(_uid, data);
  }

  async function loadLibrary(){
    try{
      const raw = await AsyncStorage.getItem(ROUTINE_TAB_KEY);
      const arr = raw ? JSON.parse(raw) : [];
      const userList: RoutineItem[] = Array.isArray(arr) ? arr
        .filter((r:any)=>r?.id && r?.title && Array.isArray(r?.steps))
        .map((r:any)=>({ id:String(r.id), title:String(r.title), steps:r.steps, tags:Array.isArray(r.tags)?r.tags:[], origin:'user' })) : [];
      const merged = [...userList, ...PRESETS.filter(p=>!userList.find(u=>u.id===p.id))];
      setLibrary(merged);
    }catch{ setLibrary(PRESETS); }
  }

  // 정렬
  const dayList = useMemo(()=>{
    const l=(weekly[activeDay]??[]).slice();
    l.sort((a,b)=>{
      const ta=parseHHMM(a.startAt); const tb=parseHHMM(b.startAt);
      if(ta && tb){ if(ta.h!==tb.h) return ta.h-tb.h; if(tb.m!==ta.m) return ta.m-tb.m; return 0; }
      if(ta && !tb) return -1;
      if(!ta && tb) return 1;
      return 0;
    });
    return l;
  },[weekly,activeDay,weekly[activeDay]]);

  // 페이징
  const pages = useMemo(()=>{
    const arr: WeeklyPlanItem[][] = [];
    for(let i=0;i<dayList.length;i+=2){ arr.push(dayList.slice(i,i+2)); }
    return arr;
  },[dayList]);
  const [pageIndex,setPageIndex]=useState(0);

  // 시간/단계 편집 시트
  type EditPack = { plan: WeeklyPlanItem; base?: RoutineItem; };
  const [editPack, setEditPack] = useState<EditPack|null>(null);
  const [editSteps, setEditSteps] = useState<(Step & { enabled?: boolean })[]>([]);
  const [sheetMounted, setSheetMounted] = useState(false);
  const [sheetShowing, setSheetShowing] = useState(false);
  const { width: SCREENW, height: SCREENH } = Dimensions.get('window');
  const sheetTranslateY = useRef(new Animated.Value(SCREENH)).current;
  const overlayOpacity = useRef(new Animated.Value(0)).current;

  const hours12 = [12,1,2,3,4,5,6,7,8,9,10,11];
  const minutes = Array.from({length:12},(_,i)=>i*5);
  const ITEM_H_WHEEL = 38;
  const hRef = useRef<ScrollView>(null);
  const mRef = useRef<ScrollView>(null);
  const [hIndex,setHIndex]=useState(0);
  const [mIndex,setMIndex]=useState(0);
  const [ampm,setAmpm]=useState<'AM'|'PM'>('AM');

  const SHEET_IN_DUR = 220, SHEET_OUT_DUR = 200;
  const animateIn = () => {
    Animated.parallel([
      Animated.timing(sheetTranslateY, { toValue: 0, duration: SHEET_IN_DUR, useNativeDriver: true }),
      Animated.timing(overlayOpacity, { toValue: 1, duration: SHEET_IN_DUR, useNativeDriver: true }),
    ]).start();
  };
  const animateOut = (onDone?: () => void) => {
    Animated.parallel([
      Animated.timing(sheetTranslateY, { toValue: SCREENH, duration: SHEET_OUT_DUR, useNativeDriver: true }),
      Animated.timing(overlayOpacity, { toValue: 0, duration: SHEET_OUT_DUR, useNativeDriver: true }),
    ]).start(({ finished }) => { if (finished) onDone?.(); });
  };
  useEffect(() => {
    if (sheetShowing) { setSheetMounted(true); requestAnimationFrame(animateIn); }
    else if (sheetMounted) { animateOut(() => setSheetMounted(false)); }
  }, [sheetShowing]);

  const openEditItem = (plan: WeeklyPlanItem) => {
    const base = library.find(r=>r.id===plan.routineId);
    const steps = (plan.steps ?? base?.steps ?? []).map(s=>({ ...s, enabled: true }));
    setEditPack({ plan, base });
    setEditSteps(steps);

    const t = parseHHMM(plan.startAt) ?? { h:0, m:0 };
    const isPM = t.h>=12;
    const h12 = ((t.h%12)===0)?12:(t.h%12);
    setAmpm(isPM?'PM':'AM');
    setHIndex(Math.max(0, Math.min(11, hours12.indexOf(h12))));
    const mi = Math.round((t.m || 0)/5);
    setMIndex(Math.max(0, Math.min(11, mi)));

    sheetTranslateY.setValue(SCREENH);
    overlayOpacity.setValue(0);
    setSheetShowing(true);

    requestAnimationFrame(()=>{
      hRef.current?.scrollTo({ y: (Math.max(0, hours12.indexOf(h12)))*ITEM_H_WHEEL, animated:false });
      mRef.current?.scrollTo({ y: (Math.max(0, mi))*ITEM_H_WHEEL, animated:false });
    });
  };
  const closeSheet = () => setSheetShowing(false);

  const toggleEnable = (idx:number)=>{
    setEditSteps(prev=>{ const n=[...prev]; n[idx].enabled = n[idx].enabled===false ? true:false; return n; });
  };
  const updateStepName = (idx:number, name:string)=>{
    setEditSteps(prev=>{ const n=[...prev]; n[idx].step = name; return n; });
  };
  const updateStepMinutes = (idx:number, val:string)=>{
    const num = Math.max(1, Math.round(Number(val) || 0));
    setEditSteps(prev=>{ const n=[...prev]; n[idx].minutes = num; return n; });
  };
  const bump = (idx:number, delta:number)=>{
    setEditSteps(prev=>{ const n=[...prev]; n[idx].minutes = Math.max(1, (n[idx].minutes ?? 1)+delta); return n; });
  };

  const selectedPreview = useMemo(()=>{
    const hh12 = hours12[hIndex] ?? 12;
    const mm = minutes[mIndex] ?? 0;
    return `${ampm==='AM'?'오전':'오후'} ${pad2(hh12)}:${pad2(mm)}`;
  },[hIndex,mIndex,ampm]);

  // 편집 저장: 시간/단계만 저장 (알림 기능 없음)
  const confirmSave = async ()=>{
    if(!editPack) return;
    const finalSteps: Step[] = editSteps
      .filter(s=>s.enabled!==false)
      .map(s=>({ step: (s.step||'').trim() || '단계', minutes: Math.max(1, s.minutes ?? 1) }));
    if(finalSteps.length===0){
      Alert.alert('알림','최소 1개 이상의 단계를 선택해 주세요.'); return;
    }
    const hh12 = hours12[hIndex] ?? 12;
    const mm = minutes[mIndex] ?? 0;
    const h24 = ampm==='AM' ? (hh12%12) : ((hh12%12)+12);
    const time = `${pad2(h24)}:${pad2(mm)}`;

    const next:WeeklyPlanner = { ...weekly };
    const arr = (next[activeDay]??[]).map(it=>{
      if(it.planId!==editPack.plan.planId) return it;
      return {
        ...it,
        steps: finalSteps,
        startAt: time,
        title: it.title ?? editPack.base?.title,
        tags: it.tags ?? editPack.base?.tags,
      };
    });
    next[activeDay] = arr;
    await saveWeekly(uidOrLocal(uid), next);

    closeSheet();
    Alert.alert('저장됨', `${selectedPreview}로 저장했어요.`);
  };

  // 저장 후 홈: 데이터만 저장하고 이동
  const goHomeAfterSave = async () => {
    const _uid = uidOrLocal(uid);
    await saveWeekly(_uid, weekly);
    router.push('/home');
  };

  /* ===== UI ===== */
  return (
    <View style={{ flex:1, backgroundColor:'#fff' }}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={()=>router.back()} style={styles.headerBtn}>
          <Text style={styles.headerBtnText}>〈</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>주간 플래너</Text>
        <View style={styles.headerBtn} />
      </View>

      {/* 요일 스트립 + 액션 */}
      <View style={styles.stickyArea}>
        <View style={styles.weekRow}>
          {DAY_KEYS.map(d=>{
            const active=d===activeDay;
            return (
              <TouchableOpacity
                key={d}
                onPress={()=>setActiveDay(d)}
                style={[styles.dayChip, active && styles.dayChipActive]}
                activeOpacity={0.9}
              >
                <Text style={[styles.dayChipText, active && styles.dayChipTextActive]}>{DAY_LABEL[d]}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <TouchableOpacity
          style={styles.primaryBtn}
          onPress={()=>router.push(`/habit/select?day=${activeDay}`)}
          activeOpacity={0.9}
        >
          <Text style={styles.primaryBtnText}>+ 루틴 추가</Text>
        </TouchableOpacity>
      </View>

      {/* 리스트 */}
      {(() => {
        const dayListSorted = dayList;
        const pagesLocal = (() => {
          const arr: WeeklyPlanItem[][] = [];
          for (let i=0; i<dayListSorted.length; i+=2) arr.push(dayListSorted.slice(i,i+2));
          return arr;
        })();

        return pagesLocal.length===0 ? (
          <View style={{ paddingHorizontal:16 }}>
            <Text style={{ color:'#6B7280', fontSize:13 }}>이 요일에는 아직 계획이 없어요. “+ 루틴 추가”로 넣어보세요.</Text>
          </View>
        ) : (
          <ScrollView
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            onMomentumScrollEnd={(e:NativeSyntheticEvent<NativeScrollEvent>)=> setPageIndex(Math.round(e.nativeEvent.contentOffset.x/SCREEN_W))}
            contentContainerStyle={{ paddingVertical:14, paddingBottom:92 }}
          >
            {pagesLocal.map((pair, idx)=>(
              <View key={idx} style={{ width: SCREEN_W, paddingHorizontal:16 }}>
                {pair.map((it)=>{
                  const base = library.find(r=>r.id===it.routineId);
                  const title = it.title ?? base?.title ?? `루틴 #${it.routineId}`;
                  const steps = it.steps ?? base?.steps ?? [];
                  const tagList = (it.tags ?? base?.tags ?? []) as string[];

                  return (
                    <View key={it.planId} style={styles.cardOuter}>
                      <View style={styles.cardOffsetBg} />
                      <View style={styles.card}>
                        <View style={{ flexDirection:'row', justifyContent:'space-between', alignItems:'center', marginBottom:6 }}>
                          <View style={{ flex:1, paddingRight:8 }}>
                            <Text style={styles.cardTitle} numberOfLines={1}>{title}</Text>
                          </View>
                          <View style={{ alignItems:'flex-end' }}>
                            <View style={[styles.timeChip, !it.startAt && styles.timeChipGray]}>
                              <Text style={[styles.timeChipText, !it.startAt && styles.timeChipTextGray]}>
                                {it.startAt ? `⏰ ${it.startAt}` : '시간 미정'}
                              </Text>
                            </View>
                          </View>
                        </View>

                        {tagList.length>0 && (
                          <View style={{ flexDirection:'row', flexWrap:'wrap', marginBottom:8 }}>
                            {tagList.map((t,i)=>(
                              <Text key={`${it.planId}-tag-${i}`} style={{ color:'#059669', fontSize:14, marginRight:6, marginBottom:6 }}>{t}</Text>
                            ))}
                          </View>
                        )}

                        {steps.map((s, i)=>(
                          <Text key={i} style={{ fontSize:16, marginBottom:4 }}>
                            • {s.step} ({s.minutes}분)
                          </Text>
                        ))}

                        <View style={{ flexDirection:'row', gap:8 as any, marginTop:10 }}>
                          <TouchableOpacity
                            onPress={()=>openEditItem(it)}
                            style={{ flex:1, backgroundColor:'#3B82F6', height:36, borderRadius:20, justifyContent:'center', alignItems:'center' }}
                          >
                            <Text style={{ color:'#fff', fontSize:14, fontWeight:'700' }}>수정하기</Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            onPress={async ()=>{
                              const _uid = uidOrLocal(uid);
                              const next:WeeklyPlanner={ ...weekly, [activeDay]: (weekly[activeDay]??[]).filter(x=>x.planId!==it.planId) };
                              await saveWeekly(_uid, next);
                              // 알림 기능 제거: 예약 취소 호출도 없음
                            }}
                            style={{ width:90, backgroundColor:'#FEE2E2', height:36, borderRadius:20, justifyContent:'center', alignItems:'center' }}
                          >
                            <Text style={{ color:'#B91C1C', fontWeight:'900' }}>삭제</Text>
                          </TouchableOpacity>
                        </View>
                      </View>
                    </View>
                  );
                })}
                {pair.length===1 && <View style={{ height: 8 }} /> }
              </View>
            ))}
          </ScrollView>
        );
      })()}

      {/* 설정 완료 */}
      <View style={styles.doneWrap}>
        <TouchableOpacity onPress={goHomeAfterSave} style={styles.doneBtn} activeOpacity={0.9}>
          <Text style={styles.doneTxt}>저장 후 홈으로</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

/* ===== Styles ===== */
const CIRCLE = 42;
const ITEM_H = 38;

const styles = StyleSheet.create({
  header:{
    height:56, paddingHorizontal:12, flexDirection:'row', alignItems:'center',
    justifyContent:'space-between', borderBottomWidth:1, borderColor:'#F3F4F6', backgroundColor:'#fff', marginTop: 50
  },
  headerBtn:{ width:52, height:40, alignItems:'center', justifyContent:'center' },
  headerBtnText:{ fontSize:20, fontWeight:'800', color:'#111827' },
  headerTitle:{ fontSize:16, fontWeight:'800', color:'#111827' },

  stickyArea:{ paddingHorizontal:16, paddingTop:10, paddingBottom:0, backgroundColor:'#fff' },

  weekRow:{ paddingVertical:8, flexDirection:'row', justifyContent:'space-between', alignItems:'center', marginBottom:30 },
  dayChip:{
    width: CIRCLE, height: CIRCLE, borderRadius: CIRCLE/2,
    alignItems:'center', justifyContent:'center',
    backgroundColor:'#F5F7FA', borderWidth:1, borderColor:'#E5E7EB'
  },
  dayChipActive:{ backgroundColor:'#E8F0FF', borderColor:'#3B82F6', borderWidth:2 },
  dayChipText:{ fontSize:14, fontWeight:'700', color:'#1F2937' },
  dayChipTextActive:{ color:'#1E3A8A', fontWeight:'800' },

  primaryBtn:{ backgroundColor:'#3B82F6', paddingVertical:10, paddingHorizontal:14, borderRadius:10, alignItems:'center', marginBottom:8 },
  primaryBtnText:{ color:'#fff', fontWeight:'900' },

  cardOuter:{ position:'relative', marginBottom:24, paddingHorizontal:10 },
  cardOffsetBg:{ position:'absolute', top:0, left:5, width:'95%', height:'100%', backgroundColor:'#10B981', borderRadius:16, zIndex:0 },
  card:{ backgroundColor:'#ECFDF5', padding:14, borderRadius:16, zIndex:1 },
  cardTitle:{ fontSize:18, fontWeight:'bold', color:'#111827' },

  timeChip:{ paddingHorizontal:10, paddingVertical:6, borderRadius:999, backgroundColor:'#DBEAFE', borderWidth:1, borderColor:'#93C5FD' },
  timeChipGray:{ backgroundColor:'#F3F4F6', borderColor:'#E5E7EB' },
  timeChipText:{ fontSize:12, fontWeight:'800', color:'#1D4ED8' },
  timeChipTextGray:{ color:'#374151' },

  doneWrap:{ position:'absolute', left:0, right:0, bottom:64, alignItems:'center' },
  doneBtn:{ backgroundColor:'#10B981', paddingHorizontal:20, paddingVertical:10, borderRadius:24, elevation:2 },
  doneTxt:{ color:'#fff', fontWeight:'900' },
});
