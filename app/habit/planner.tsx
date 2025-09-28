// app/habit/planner.tsx
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect } from '@react-navigation/native';
import { useRouter } from 'expo-router';
import { onAuthStateChanged } from 'firebase/auth';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  Dimensions,
  Modal,
  NativeScrollEvent,
  NativeSyntheticEvent,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View
} from 'react-native';
import { auth } from '../../firebaseConfig';

// ✅ Firestore 하이브리드 유틸 (inline)
import { doc, getDoc, onSnapshot, serverTimestamp, setDoc } from 'firebase/firestore';
import { db } from '../../firebaseConfig';

// ✅ 알림 (expo-notifications)
import * as Notifications from 'expo-notifications';

/* ===================== 알림 핸들러 (포그라운드 표시) ===================== */
// 최신 타입 대응: shouldShowBanner, shouldShowList 포함
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

/* ===================== Keys / Types ===================== */
const k = (base: string, uid: string) => `${base}_${uid}`;
const WEEKLY_KEY_BASE = 'weeklyPlannerV1';
const ROUTINE_TAB_KEY = '@userRoutinesV1';
const NOTI_KEY_BASE = 'weeklyPlannerNotiIdsV1'; // planId -> notificationId 매핑 저장

type Step = { step: string; minutes: number };
type RoutineItem = { id: string; title: string; steps: Step[]; tags?: string[]; origin?: 'preset'|'user' };
type WeeklyPlanItem = { planId: string; routineId: string; title?: string; steps?: Step[]; tags?: string[]; startAt?: string };
type WeeklyPlanner = {
  mon?: WeeklyPlanItem[]; tue?: WeeklyPlanItem[]; wed?: WeeklyPlanItem[]; thu?: WeeklyPlanItem[]; fri?: WeeklyPlanItem[]; sat?: WeeklyPlanItem[]; sun?: WeeklyPlanItem[];
};
type DayKey = keyof WeeklyPlanner;

type WeeklyPlannerDoc = { days: WeeklyPlanner; version?: number; updatedAt?: any };
type NotiMap = Record<string, string>; // planId -> notificationId

/* ===================== Firestore helpers ===================== */
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

/* ===================== Consts ===================== */
const DAY_KEYS: DayKey[] = ['mon','tue','wed','thu','fri','sat','sun'];
const DAY_LABEL: Record<DayKey,string> = { mon:'월',tue:'화',wed:'수',thu:'목',fri:'금',sat:'토',sun:'일' };
const WEEKDAY_NUM: Record<DayKey, number> = { // Expo calendar weekday: 1=Sun ... 7=Sat
  sun:1, mon:2, tue:3, wed:4, thu:5, fri:6, sat:7
};
const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');

/* ===================== Utils ===================== */
function getTodayKSTDate(){ const now=new Date(); const utc=now.getTime()+now.getTimezoneOffset()*60000; return new Date(utc+9*3600000); }
function parseHHMM(s?:string){ if(!s) return null; const m=String(s).trim().match(/^(\d{1,2}):(\d{2})$/); if(!m) return null; const hh=+m[1], mm=+m[2]; if(hh<0||hh>23||mm<0||mm>59) return null; return {h:hh,m:mm}; }
function uidOrLocal(u?:string|null){ return u ?? 'local'; }
function uniqId(){ return `${Date.now()}-${Math.random().toString(36).slice(2,8)}`; }
const pad2=(n:number)=>String(n).padStart(2,'0');

/* ===================== Presets (간단 병합용) ===================== */
const PRESETS: RoutineItem[] = [
  { id:'preset-2',  title:'영단어 암기 루틴', steps:[{ step:'영단어 외우기', minutes:20 }, { step:'예문 만들기', minutes:15 }, { step:'퀴즈 테스트 해보기 1분', minutes:10 }], tags:['#암기'], origin:'preset' },
  { id:'preset-3',  title:'오답 집중 루틴', steps:[{ step:'최근 오답 복습', minutes:20 },{ step:'비슷한 유형 문제 다시 풀기', minutes:25 },{ step:'정답/오답 비교 정리', minutes:15 }], tags:['#문제풀이','#복습정리'], origin:'preset' },
  { id:'preset-4',  title:'시험 전날 총정리 루틴', steps:[{ step:'전체 범위 핵심 정리', minutes:40 },{ step:'예상 문제 풀기', minutes:30 },{ step:'오답 노트 만들기', minutes:20 }], tags:['#복습정리'], origin:'preset' },
  { id:'preset-5',  title:'내가 만든 문제 루틴', steps:[{ step:'중요 개념 1개 고르기', minutes:5 },{ step:'문제 만들기', minutes:10 },{ step:'직접 풀고 해설 달기', minutes:15 }], tags:['#개념이해'], origin:'preset' },
  { id:'preset-6',  title:'수학 서술형 루틴', steps:[{ step:'서술형 문제 3개 풀기', minutes:20 },{ step:'풀이 과정 점검', minutes:10 },{ step:'모범답안과 비교', minutes:10 }], tags:['#문제풀이'], origin:'preset' },
  { id:'preset-7',  title:'국어 문법 루틴', steps:[{ step:'문법 개념 정리', minutes:15 },{ step:'문제 적용', minutes:15 },{ step:'틀린 문법 다시 암기', minutes:10 }], tags:['#개념이해'], origin:'preset' },
  { id:'preset-8',  title:'비문학 분석 루틴', steps:[{ step:'지문 1개 읽기', minutes:10 },{ step:'글 구조 그리기', minutes:10 },{ step:'문제 풀이 + 해설 확인', minutes:10 }], tags:['#개념이해'], origin:'preset' },
  { id:'preset-10', title:'빠른 오답 다시보기 루틴', steps:[{ step:'지난 오답노트 빠르게 훑기', minutes:10 },{ step:'틀린 단어 집중 암기', minutes:5 },{ step:'비슷한 문제 1개 풀기', minutes:5 }], tags:['#복습정리'], origin:'preset' },
  { id:'preset-11', title:'모르는 것만 모으는 루틴', steps:[{ step:'공부하다 모르는 것 따로 표시', minutes:5 },{ step:'모음 정리노트 만들기', minutes:15 },{ step:'정답 찾아서 복습', minutes:10 }], tags:['#복습정리'], origin:'preset' },
  { id:'preset-12', title:'수학 스스로 설명 루틴 (Feynman Technique)', steps:[{ step:'수학 개념 하나 선택', minutes:5 },{ step:'초등학생에게 설명하듯 써보기', minutes:10 },{ step:'부족한 부분 다시 학습', minutes:10 }], tags:['#개념이해'], origin:'preset' },
  { id:'preset-13', title:'핵심 개념 정리 루틴', steps:[{ step:'개념 하나 선택', minutes:5 },{ step:'핵심 문장 3줄로 정리', minutes:10 },{ step:'예시 추가 및 노트 정리', minutes:10 }], tags:['#개념이해'], origin:'preset' },
  { id:'preset-15', title:'유형별 문제 루틴', steps:[{ step:'집중하고 싶은 문제 유형 선정', minutes:5 },{ step:'유형에 맞는 문제 풀이', minutes:25 }], tags:['#문제풀이'], origin:'preset' },
  { id:'preset-16', title:'실전 모드 루틴', steps:[{ step:'시험지 형식 문제 세트 풀기', minutes:30 },{ step:'채점 및 오답 분석', minutes:10 }], tags:['#문제풀이'], origin:'preset' },
  { id:'preset-19', title:'스스로 출제 루틴', steps:[{ step:'암기 내용 기반 문제 만들기', minutes:10 },{ step:'직접 풀고 정답 확인 및 수정', minutes:10 }], tags:['#암기'], origin:'preset' },
  { id:'preset-20', title:'단어장 복습 루틴', steps:[{ step:'외운 단어 10개 랜덤 테스트', minutes:10 },{ step:'틀린 단어 집중 암기', minutes:10 }], tags:['#암기'], origin:'preset' },
];

/* ===================== 알림 유틸 ===================== */
async function ensureNotificationPermission() {
  const settings = await Notifications.getPermissionsAsync();
  if (settings.status !== 'granted') {
    const req = await Notifications.requestPermissionsAsync();
    if (req.status !== 'granted') return false;
  }
  // ✅ ANDROID: 알림 채널 보장 (없으면 생성)
  try {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'Default',
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  } catch {}
  return true;
}

async function loadNotiMap(uid: string): Promise<NotiMap> {
  try {
    const raw = await AsyncStorage.getItem(k(NOTI_KEY_BASE, uid));
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}
async function saveNotiMap(uid: string, map: NotiMap) {
  await AsyncStorage.setItem(k(NOTI_KEY_BASE, uid), JSON.stringify(map));
}
async function cancelNotiId(id?: string) {
  if (!id) return;
  try { await Notifications.cancelScheduledNotificationAsync(id); } catch {}
}
async function scheduleWeeklyPlanNoti(day: DayKey, plan: WeeklyPlanItem, titleFallback: string) {
  if (!plan.startAt) return undefined;
  const t = parseHHMM(plan.startAt);
  if (!t) return undefined;

  const weekday = WEEKDAY_NUM[day];
  const title = (plan.title || titleFallback || '루틴 시작');
  const body = '루틴을 시작할 시간이에요! 눌러서 바로 실행해요.';

  const id = await Notifications.scheduleNotificationAsync({
    content: {
      title,
      body,
      data: { planId: plan.planId, routineId: plan.routineId, day },
      // channelId는 입력 타입에 없음 → 기본 채널 사용
    },
    trigger: {
      repeats: true,
      weekday,     // 1=Sun .. 7=Sat
      hour: t.h,
      minute: t.m,
    } as Notifications.CalendarTriggerInput,
  });
  return id;
}
async function syncAllNotifications(uid: string, weekly: WeeklyPlanner, library: RoutineItem[]) {
  const ok = await ensureNotificationPermission();
  if (!ok) return;

  const prevMap = await loadNotiMap(uid);
  await Promise.all(Object.values(prevMap).map(id => cancelNotiId(id)));

  const newMap: NotiMap = {};
  for (const day of DAY_KEYS) {
    const list = weekly[day] || [];
    for (const plan of list) {
      const base = library.find(r => r.id === plan.routineId);
      const notiId = await scheduleWeeklyPlanNoti(day, plan, base?.title || '');
      if (notiId) newMap[plan.planId] = notiId;
    }
  }
  await saveNotiMap(uid, newMap);
}
async function rescheduleSingle(uid: string, day: DayKey, plan: WeeklyPlanItem, library: RoutineItem[]) {
  const ok = await ensureNotificationPermission();
  if (!ok) return;

  const map = await loadNotiMap(uid);
  if (map[plan.planId]) {
    await cancelNotiId(map[plan.planId]);
    delete map[plan.planId];
  }
  const base = library.find(r => r.id === plan.routineId);
  const newId = await scheduleWeeklyPlanNoti(day, plan, base?.title || '');
  if (newId) map[plan.planId] = newId;
  await saveNotiMap(uid, map);
}
async function cancelByPlanId(uid: string, planId: string) {
  const map = await loadNotiMap(uid);
  if (map[planId]) {
    await cancelNotiId(map[planId]);
    delete map[planId];
    await saveNotiMap(uid, map);
  }
}

/* ===================== Screen ===================== */
export default function PlannerPage(){
  const router = useRouter();
  const [uid, setUid] = useState<string|null>(null);

  const [activeDay, setActiveDay] = useState<DayKey>('mon');
  useEffect(()=>{ const idx=(getTodayKSTDate().getDay()+6)%7; setActiveDay(DAY_KEYS[idx]); },[]);

  const [weekly, setWeekly] = useState<WeeklyPlanner>({});
  const [library, setLibrary] = useState<RoutineItem[]>([]);

  useEffect(()=>{
    const unsub = onAuthStateChanged(auth, user=>{
      const _uid = uidOrLocal(user?.uid);
      setUid(user?.uid ?? null);
      primeLoad(_uid);
      ensureNotificationPermission(); // 권한/채널 준비
    });
    return unsub;
  },[]);

  // 🔄 Firestore 실시간 반영
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  // ⬇️ 하이브리드 로드/저장
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

  /* ===== 정렬: startAt 있는 항목 → 없는 항목 ===== */
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

  /* ===== 가로 페이징: 1페이지 당 2개(세로) ===== */
  const pages = useMemo(()=>{
    const arr: WeeklyPlanItem[][] = [];
    for(let i=0;i<dayList.length;i+=2){ arr.push(dayList.slice(i,i+2)); }
    return arr;
  },[dayList]);
  const [pageIndex,setPageIndex]=useState(0);

  /* ========== 세부 수정 바텀시트 (루틴 화면과 동일 UX + 시간 설정) ========== */
  type EditPack = { plan: WeeklyPlanItem; base?: RoutineItem; };
  const [editPack, setEditPack] = useState<EditPack|null>(null);
  const [editSteps, setEditSteps] = useState<(Step & { enabled?: boolean })[]>([]);
  const [sheetMounted, setSheetMounted] = useState(false);
  const [sheetShowing, setSheetShowing] = useState(false);
  const sheetTranslateY = useRef(new Animated.Value(SCREEN_H)).current;
  const overlayOpacity = useRef(new Animated.Value(0)).current;

  // 시간 휠 (AM/PM)
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
      Animated.timing(sheetTranslateY, { toValue: SCREEN_H, duration: SHEET_OUT_DUR, useNativeDriver: true }),
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

    // 시간 초기화 (기본 00:00)
    const t = parseHHMM(plan.startAt) ?? { h:0, m:0 };
    const isPM = t.h>=12;
    const h12 = ((t.h%12)===0)?12:(t.h%12);
    setAmpm(isPM?'PM':'AM');
    setHIndex(Math.max(0, Math.min(11, hours12.indexOf(h12))));
    const mi = Math.round((t.m || 0)/5);
    setMIndex(Math.max(0, Math.min(11, mi)));

    sheetTranslateY.setValue(SCREEN_H);
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

    // 🔔 이 항목만 즉시 재예약
    try {
      await rescheduleSingle(uidOrLocal(uid), activeDay, arr.find(p=>p.planId===editPack.plan.planId)!, library);
    } catch {}

    closeSheet();
    Alert.alert('저장됨', `${selectedPreview}로 저장했어요. (알림도 갱신됨)`);
  };

  // ✅ 하단 버튼: 저장 후 홈으로 (전체 동기화)
  const goHomeAfterSave = async () => {
    const _uid = uidOrLocal(uid);
    await saveWeekly(_uid, weekly);
    try { await syncAllNotifications(_uid, weekly, library); } catch {}
    router.push('/home');
  };

  /* ===================== UI ===================== */
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

      {/* 리스트: 세로 2개 × 가로 페이징 */}
      {pages.length===0 ? (
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
          {pages.map((pair, idx)=>(
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
                            try { await cancelByPlanId(_uid, it.planId); } catch {}
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
      )}

      {/* 설정 완료(=저장 후 홈) 버튼 */}
      <View style={styles.doneWrap}>
        <TouchableOpacity onPress={goHomeAfterSave} style={styles.doneBtn} activeOpacity={0.9}>
          <Text style={styles.doneTxt}>저장 후 홈으로</Text>
        </TouchableOpacity>
      </View>

      {/* 페이지 인디케이터 */}
      {pages.length>1 && (
        <View style={styles.indicatorRow}>
          {pages.map((_,i)=>(<View key={i} style={[styles.dot, i===pageIndex ? styles.dotOn : null]} />))}
        </View>
      )}

      {/* ===== 세부 수정 바텀시트 ===== */}
      {sheetMounted && (
        <Modal visible transparent animationType="none" onRequestClose={closeSheet}>
          <TouchableOpacity activeOpacity={1} onPress={closeSheet} style={{ flex:1 }}>
            <Animated.View pointerEvents="none" style={{ flex:1, backgroundColor:'rgba(0,0,0,0.4)', opacity: overlayOpacity }} />
          </TouchableOpacity>

          <Animated.View
            style={{
              transform: [{ translateY: sheetTranslateY }],
              position:'absolute', left:0, right:0, bottom:0,
              backgroundColor:'#fff', borderTopLeftRadius:16, borderTopRightRadius:16,
              padding:16, maxHeight:'80%',
              shadowColor:'#000', shadowOffset:{ width:0, height:-3 }, shadowOpacity:0.15, shadowRadius:6, elevation:10,
            }}
          >
            <View style={{ flexDirection:'row', justifyContent:'space-between', alignItems:'center', marginBottom:8 }}>
              <Text style={{ fontSize:18, fontWeight:'800' }}>{editPack?.plan.title ?? (library.find(r=>r.id===editPack?.plan.routineId)?.title) ?? '세부 수정'}</Text>
              <TouchableOpacity onPress={closeSheet}><Ionicons name="close" size={22} /></TouchableOpacity>
            </View>

            {/* 시간 선택 */}
            <View style={{ marginBottom:10 }}>
              <Text style={{ fontSize:14, fontWeight:'700', marginBottom:6 }}>시작 시간</Text>
              <View style={styles.ampmRow}>
                {(['AM','PM'] as const).map(opt=>{
                  const on = ampm===opt;
                  return (
                    <TouchableOpacity key={opt} onPress={()=>setAmpm(opt)} style={[styles.ampmChip, on && styles.ampmChipOn]}>
                      <Text style={[styles.ampmTxt, on && styles.ampmTxtOn]}>{opt==='AM'?'오전':'오후'}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              <View style={styles.wheelRow}>
                {/* Hours */}
                <View style={styles.wheelCol}>
                  <ScrollView
                    ref={hRef}
                    showsVerticalScrollIndicator={false}
                    snapToInterval={ITEM_H_WHEEL}
                    decelerationRate="fast"
                    onMomentumScrollEnd={(e:NativeSyntheticEvent<NativeScrollEvent>)=>{ const idx=Math.round(e.nativeEvent.contentOffset.y/ITEM_H_WHEEL); setHIndex(Math.max(0,Math.min(11,idx))); }}
                    contentContainerStyle={{ paddingVertical:(ITEM_H_WHEEL*2) }}
                  >
                    {hours12.map((h,idx)=>(
                      <View key={h} style={[styles.wheelItem,{ height:ITEM_H_WHEEL }]}>
                        <Text style={[styles.wheelTxt, idx===hIndex && styles.wheelTxtOn]}>{pad2(h)}</Text>
                      </View>
                    ))}
                  </ScrollView>
                  <View style={styles.selectionOverlay} pointerEvents="none" />
                  <Text style={styles.wheelLabel}>시</Text>
                </View>
                {/* Minutes */}
                <View style={styles.wheelCol}>
                  <ScrollView
                    ref={mRef}
                    showsVerticalScrollIndicator={false}
                    snapToInterval={ITEM_H_WHEEL}
                    decelerationRate="fast"
                    onMomentumScrollEnd={(e:NativeSyntheticEvent<NativeScrollEvent>)=>{ const idx=Math.round(e.nativeEvent.contentOffset.y/ITEM_H_WHEEL); setMIndex(Math.max(0,Math.min(11,idx))); }}
                    contentContainerStyle={{ paddingVertical:(ITEM_H_WHEEL*2) }}
                  >
                    {minutes.map((m,idx)=>(
                      <View key={m} style={[styles.wheelItem,{ height:ITEM_H_WHEEL }]}>
                        <Text style={[styles.wheelTxt, idx===mIndex && styles.wheelTxtOn]}>{pad2(m)}</Text>
                      </View>
                    ))}
                  </ScrollView>
                  <View style={styles.selectionOverlay} pointerEvents="none" />
                  <Text style={styles.wheelLabel}>분</Text>
                </View>
              </View>
              <Text style={{ marginTop:6, color:'#111827', fontWeight:'800' }}>{`${selectedPreview}`}</Text>
            </View>

            {/* 단계 빠른 조정 */}
            <ScrollView style={{ maxHeight: 320 }} keyboardShouldPersistTaps="handled">
              {editSteps.map((s, i) => (
                <View key={i} style={{ borderWidth:1, borderColor:'#E5E7EB', borderRadius:12, padding:10, marginBottom:8, backgroundColor: s.enabled===false ? '#F3F4F6' : '#FFFFFF' }}>
                  <TouchableOpacity onPress={() => toggleEnable(i)} style={{ flexDirection:'row', alignItems:'center', marginBottom:8 }}>
                    <Ionicons name={s.enabled===false ? 'square-outline' : 'checkbox'} size={20} color={s.enabled===false ? '#9CA3AF' : '#10B981'} style={{ marginRight:8 }} />
                    <Text style={{ color: s.enabled===false ? '#9CA3AF' : '#111827', fontWeight:'700' }}>단계 {i+1}</Text>
                  </TouchableOpacity>
                  <TextInput
                    value={s.step} onChangeText={(t)=>updateStepName(i,t)} placeholder="단계 내용"
                    style={{ height: 40, borderWidth:1, borderColor:'#CBD5E1', borderRadius:8, paddingHorizontal:12, backgroundColor: s.enabled===false ? '#E5E7EB' : '#F9FAFB', color: s.enabled===false ? '#9CA3AF' : '#111827', marginBottom:8 }}
                    placeholderTextColor="#9CA3AF" editable={s.enabled!==false}
                  />
                  <View style={{ flexDirection:'row', alignItems:'center' }}>
                    <TouchableOpacity disabled={s.enabled===false} onPress={()=>bump(i,-5)} style={{ marginRight:6 }}>
                      <Ionicons name="remove-circle" size={22} color={s.enabled===false ? '#CBD5E1' : '#111827'} />
                    </TouchableOpacity>
                    <TextInput
                      value={String(s.minutes ?? 1)} onChangeText={(t)=>updateStepMinutes(i,t)} keyboardType="numeric"
                      style={{ width:70, height:40, borderWidth:1, borderColor:'#CBD5E1', borderRadius:8, textAlign:'center', backgroundColor: s.enabled===false ? '#E5E7EB' : '#FFFFFF', color: s.enabled===false ? '#9CA3AF' : '#111827', marginRight:6 }}
                      editable={s.enabled!==false}
                    />
                    <Text style={{ marginRight:10, color: s.enabled===false ? '#9CA3AF' : '#111827' }}>분</Text>
                    <TouchableOpacity disabled={s.enabled===false} onPress={()=>bump(i,+5)}>
                      <Ionicons name="add-circle" size={22} />
                    </TouchableOpacity>
                  </View>
                </View>
              ))}
            </ScrollView>

            <View style={{ flexDirection:'row', columnGap:8 as any, marginTop:12 }}>
              <TouchableOpacity onPress={closeSheet} style={{ flex:1, height:44, borderRadius:12, borderWidth:1, borderColor:'#9CA3AF', justifyContent:'center', alignItems:'center' }}>
                <Text style={{ color:'#374151', fontWeight:'700' }}>취소</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={confirmSave} style={{ flex:1, height:44, borderRadius:12, backgroundColor:'#3B82F6', justifyContent:'center', alignItems:'center' }}>
                <Text style={{ color:'#fff', fontWeight:'800' }}>저장</Text>
              </TouchableOpacity>
            </View>
          </Animated.View>
        </Modal>
      )}
    </View>
  );
}

/* ===================== Styles ===================== */
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

  /* 카드 */
  cardOuter:{ position:'relative', marginBottom:24, paddingHorizontal:10 },
  cardOffsetBg:{ position:'absolute', top:0, left:5, width:'95%', height:'100%', backgroundColor:'#10B981', borderRadius:16, zIndex:0 },
  card:{ backgroundColor:'#ECFDF5', padding:14, borderRadius:16, zIndex:1 },
  cardTitle:{ fontSize:18, fontWeight:'bold', color:'#111827' },

  /* 시간 칩 */
  timeChip:{ paddingHorizontal:10, paddingVertical:6, borderRadius:999, backgroundColor:'#DBEAFE', borderWidth:1, borderColor:'#93C5FD' },
  timeChipGray:{ backgroundColor:'#F3F4F6', borderColor:'#E5E7EB' },
  timeChipText:{ fontSize:12, fontWeight:'800', color:'#1D4ED8' },
  timeChipTextGray:{ color:'#374151' },

  /* 설정 완료 버튼 (하단 고정) */
  doneWrap:{ position:'absolute', left:0, right:0, bottom:64, alignItems:'center' },
  doneBtn:{ backgroundColor:'#10B981', paddingHorizontal:20, paddingVertical:10, borderRadius:24, elevation:2 },
  doneTxt:{ color:'#fff', fontWeight:'900' },

  /* 가로 페이징 인디케이터 */
  indicatorRow:{ position:'absolute', bottom:24, left:0, right:0, flexDirection:'row', justifyContent:'center', alignItems:'center' },
  dot:{ width:8, height:8, borderRadius:4, backgroundColor:'#D1D5DB', marginHorizontal:3 },
  dotOn:{ backgroundColor:'#3B82F6', width:18, borderRadius:9 },

  /* 바텀시트 공통 */
  ampmRow:{ flexDirection:'row', justifyContent:'center', gap:8 as any, marginTop:6, marginBottom:8 },
  ampmChip:{ paddingHorizontal:14, paddingVertical:8, borderRadius:999, borderWidth:1, borderColor:'#D1D5DB', backgroundColor:'#FFFFFF' },
  ampmChipOn:{ backgroundColor:'#DBEAFE', borderColor:'#93C5FD' },
  ampmTxt:{ color:'#374151', fontWeight:'700' },
  ampmTxtOn:{ color:'#1E3A8A', fontWeight:'800' },

  wheelRow:{ flexDirection:'row', justifyContent:'center', alignItems:'center' },
  wheelCol:{ width:110, height: ITEM_H*5, borderWidth:1, borderColor:'#E5E7EB', borderRadius:12, marginHorizontal:6, overflow:'hidden', backgroundColor:'#F9FAFB', position:'relative' },
  wheelItem:{ justifyContent:'center', alignItems:'center' },
  wheelTxt:{ fontSize:18, color:'#6B7280' },
  wheelTxtOn:{ color:'#111827', fontWeight:'800' },
  wheelLabel:{ position:'absolute', right:8, top:8, fontSize:12, color:'#6B7280' },
  selectionOverlay:{
    position:'absolute',
    left:0, right:0,
    top: ITEM_H*2,
    height: ITEM_H,
    borderTopWidth: 2,
    borderBottomWidth: 2,
    borderColor: '#93C5FD',
    backgroundColor: 'transparent',
  },
});
