// app/habit/select.tsx
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { onAuthStateChanged } from 'firebase/auth';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Dimensions,
  Modal,
  NativeScrollEvent,
  NativeSyntheticEvent,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { auth } from '../../firebaseConfig';

// Firestore
import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import { db } from '../../firebaseConfig';

/* ===== Keys / Types ===== */
const k = (base: string, uid: string) => `${base}_${uid}`;
const WEEKLY_KEY_BASE = 'weeklyPlannerV1';
const STORAGE_KEY = '@userRoutinesV1'; // routine.tsx와 동일

type Step = { step: string; minutes: number };
type Routine = {
  id: string;
  title: string;
  steps: Step[];
  tags: string[];
  origin: 'preset' | 'custom' | 'user';
};

type WeeklyPlanItem = { planId: string; routineId: string; title: string; steps: Step[]; tags: string[]; startAt?: string };
type WeeklyPlanner = {
  mon?: WeeklyPlanItem[]; tue?: WeeklyPlanItem[]; wed?: WeeklyPlanItem[];
  thu?: WeeklyPlanItem[]; fri?: WeeklyPlanItem[]; sat?: WeeklyPlanItem[]; sun?: WeeklyPlanItem[];
};
type DayKey = keyof WeeklyPlanner;

/* ===== Firestore helpers ===== */
type WeeklyPlannerDoc = { days: WeeklyPlanner; version?: number; updatedAt?: any };
function plannerDocRef(uid: string, docId: string = 'current') {
  return doc(db, 'users', uid, 'weeklyPlanner', docId);
}
async function pullPlanner(uid: string): Promise<WeeklyPlannerDoc | null> {
  const snap = await getDoc(plannerDocRef(uid));
  if (!snap.exists()) return null;
  return snap.data() as WeeklyPlannerDoc;
}
async function pushPlanner(uid: string, days: WeeklyPlanner, docId = 'current', version = 1) {
  await setDoc(plannerDocRef(uid, docId), { days, version, updatedAt: serverTimestamp() }, { merge: true });
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
const { width: SCREEN_W } = Dimensions.get('window');

const TAGS = ['#개념이해', '#문제풀이', '#암기', '#복습정리'] as const;

/* ===== Utils ===== */
const uidOrLocal=(u?:string|null)=> u ?? 'local';
const uniqId=()=> `${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
const totalMinutes=(steps?:Step[])=> (steps??[]).reduce((a,s)=>a+(s?.minutes||0),0);
const pad2 = (n:number)=>String(n).padStart(2,'0');

/* ===== PRESETS (routine.tsx와 동일) ===== */
const PRESET_ROUTINES: Routine[] = [
  { id: 'preset-2',  title: '영단어 암기 루틴', steps: [
    { step: '영단어 외우기', minutes: 20 },
    { step: '예문 만들기', minutes: 15 },
    { step: '퀴즈 테스트 해보기 1분', minutes: 10 },
  ], tags: ['#암기'], origin: 'preset' },
  { id: 'preset-3',  title: '오답 집중 루틴', steps: [
    { step: '최근 오답 복습', minutes: 20 },
    { step: '비슷한 유형 문제 다시 풀기', minutes: 25 },
    { step: '정답/오답 비교 정리', minutes: 15 },
  ], tags: ['#문제풀이', '#복습정리'], origin: 'preset' },
  { id: 'preset-4',  title: '시험 전날 총정리 루틴', steps: [
    { step: '전체 범위 핵심 정리', minutes: 40 },
    { step: '예상 문제 풀기', minutes: 30 },
    { step: '오답 노트 만들기', minutes: 20 },
  ], tags: ['#복습정리'], origin: 'preset' },
  { id: 'preset-5',  title: '내가 만든 문제 루틴', steps: [
    { step: '중요 개념 1개 고르기', minutes: 5 },
    { step: '문제 만들기', minutes: 10 },
    { step: '직접 풀고 해설 달기', minutes: 15 },
  ], tags: ['#개념이해'], origin: 'preset' },
  { id: 'preset-6',  title: '수학 서술형 루틴', steps: [
    { step: '서술형 문제 3개 풀기', minutes: 20 },
    { step: '풀이 과정 점검', minutes: 10 },
    { step: '모범답안과 비교', minutes: 10 },
  ], tags: ['#문제풀이'], origin: 'preset' },
  { id: 'preset-7',  title: '국어 문법 루틴', steps: [
    { step: '문법 개념 정리', minutes: 15 },
    { step: '문제 적용', minutes: 15 },
    { step: '틀린 문법 다시 암기', minutes: 10 },
  ], tags: ['#개념이해'], origin: 'preset' },
  { id: 'preset-8',  title: '비문학 분석 루틴', steps: [
    { step: '지문 1개 읽기', minutes: 10 },
    { step: '글 구조 그리기', minutes: 10 },
    { step: '문제 풀이 + 해설 확인', minutes: 10 },
  ], tags: ['#개념이해'], origin: 'preset' },
  { id: 'preset-10', title: '빠른 오답 다시보기 루틴', steps: [
    { step: '지난 오답노트 빠르게 훑기', minutes: 10 },
    { step: '틀린 단어 집중 암기', minutes: 5 },
    { step: '비슷한 문제 1개 풀기', minutes: 5 },
  ], tags: ['#복습정리'], origin: 'preset' },
  { id: 'preset-11', title: '모르는 것만 모으는 루틴', steps: [
    { step: '공부하다 모르는 것 따로 표시', minutes: 5 },
    { step: '모음 정리노트 만들기', minutes: 15 },
    { step: '정답 찾아서 복습', minutes: 10 },
  ], tags: ['#복습정리'], origin: 'preset' },
  { id: 'preset-12', title: '수학 스스로 설명 루틴 (Feynman Technique)', steps: [
    { step: '수학 개념 하나 선택', minutes: 5 },
    { step: '초등학생에게 설명하듯 써보기', minutes: 10 },
    { step: '부족한 부분 다시 학습', minutes: 10 },
  ], tags: ['#개념이해'], origin: 'preset' },
  { id: 'preset-13', title: '핵심 개념 정리 루틴', steps: [
    { step: '개념 하나 선택', minutes: 5 },
    { step: '핵심 문장 3줄로 정리', minutes: 10 },
    { step: '예시 추가 및 노트 정리', minutes: 10 },
  ], tags: ['#개념이해'], origin: 'preset' },
  { id: 'preset-15', title: '유형별 문제 루틴', steps: [
    { step: '집중하고 싶은 문제 유형 선정', minutes: 5 },
    { step: '유형에 맞는 문제 풀이', minutes: 25 },
  ], tags: ['#문제풀이'], origin: 'preset' },
  { id: 'preset-16', title: '실전 모드 루틴', steps: [
    { step: '시험지 형식 문제 세트 풀기', minutes: 30 },
    { step: '채점 및 오답 분석', minutes: 10 },
  ], tags: ['#문제풀이'], origin: 'preset' },
  { id: 'preset-19', title: '스스로 출제 루틴', steps: [
    { step: '암기 내용 기반 문제 만들기', minutes: 10 },
    { step: '직접 풀고 정답 확인 및 수정', minutes: 10 },
  ], tags: ['#암기'], origin: 'preset' },
  { id: 'preset-20', title: '단어장 복습 루틴', steps: [
    { step: '외운 단어 10개 랜덤 테스트', minutes: 10 },
    { step: '틀린 단어 집중 암기', minutes: 10 },
  ], tags: ['#암기'], origin: 'preset' },
];

/* ===== Screen ===== */
export default function SelectRoutineScreen(){
  const router = useRouter();
  const params = useLocalSearchParams<{ day?: string }>();
  const initialDay = (String(params.day||'mon') as DayKey);
  const [day, setDay] = useState<DayKey>(DAY_KEYS.includes(initialDay) ? initialDay : 'mon');

  const [uid, setUid] = useState<string|null>(null);
  useEffect(()=>{
    const unsub = onAuthStateChanged(auth, (user)=> setUid(user?.uid ?? null));
    return unsub;
  },[]);

  const [library, setLibrary] = useState<Routine[]>([]);
  const [weekly, setWeekly] = useState<WeeklyPlanner>({});

  const [search,setSearch] = useState('');
  const [activeTag, setActiveTag] = useState<(typeof TAGS)[number] | ''>('');

  // 가로 페이징 인디케이터
  const [pageIndex,setPageIndex]=useState(0);
  const pagerRef = useRef<ScrollView>(null);

  // 시간 휠 모달
  const [pickerOpen,setPickerOpen]=useState(false);
  const [targetRoutine,setTargetRoutine]=useState<Routine|undefined>();
  const hours12 = [12,1,2,3,4,5,6,7,8,9,10,11];
  const minutes = Array.from({length:12},(_,i)=>i*5);
  const H_ITEM_H=38, M_ITEM_H=38;
  const hRef = useRef<ScrollView>(null);
  const mRef = useRef<ScrollView>(null);
  const [hIndex,setHIndex]=useState(0);
  const [mIndex,setMIndex]=useState(0);
  const [ampm, setAmpm] = useState<'AM'|'PM'>('AM');

  useEffect(()=>{
    (async ()=>{
      // 1) 나만의 루틴 불러오기
      const rawMine = await AsyncStorage.getItem(STORAGE_KEY);
      const mine: Routine[] = rawMine ? JSON.parse(rawMine) : [];
      const userList: Routine[] = Array.isArray(mine)
        ? mine
          .filter((r:any)=>r?.id && r?.title && Array.isArray(r?.steps))
          .map((r:any)=>({
            id:String(r.id),
            title:String(r.title),
            steps:r.steps.map((s:any)=>({ step:String(s.step), minutes:Number(s.minutes)||0 })),
            tags:Array.isArray(r.tags)?r.tags.map((t:any)=>String(t)):[],
            origin:'user'
          }))
        : [];

      // 2) 프리셋과 병합 (id 중복 제거)
      const mergedMap = new Map<string,Routine>();
      [...PRESET_ROUTINES, ...userList].forEach(item=>{
        if (!mergedMap.has(item.id)) mergedMap.set(item.id, item);
      });
      const merged = Array.from(mergedMap.values());
      setLibrary(merged);

      // 3) 주간 플래너 로드
      const data = await initialLoadHybrid(uidOrLocal(uid));
      setWeekly(data ?? {});
    })();
  },[uid]);

  async function saveWeekly(data:WeeklyPlanner){
    setWeekly(data);
    await saveBothHybrid(uidOrLocal(uid), data);
  }

  /* 필터링 & 페이지 구성 */
  const filtered = useMemo(()=>{
    const q = search.trim();
    let list = library.slice();
    if (activeTag) list = list.filter(r => r.tags.includes(activeTag));
    if (q) {
      list = list.filter(r =>
        r.title.includes(q) ||
        r.tags.join(' ').includes(q) ||
        r.steps.some(s=>s.step.includes(q))
      );
    }
    list.sort((a,b)=> a.title.localeCompare(b.title, 'ko'));
    return list;
  },[library,search,activeTag]);

  const pages = useMemo(()=>{
    const res: Routine[][] = [];
    for(let i=0;i<filtered.length;i+=2){ res.push(filtered.slice(i,i+2)); }
    return res;
  },[filtered]);

  /* 추가 플로우 */
  const openPicker=(r:Routine)=>{
    setTargetRoutine(r);
    setAmpm('AM');
    setHIndex(0);
    setMIndex(0);
    setPickerOpen(true);
    requestAnimationFrame(()=>{
      hRef.current?.scrollTo({ y: 0, animated:false });
      mRef.current?.scrollTo({ y: 0, animated:false });
    });
  };

  const selectedPreview = useMemo(()=>{
    const hh12 = hours12[hIndex] ?? 12;
    const mm = minutes[mIndex] ?? 0;
    return `${ampm==='AM'?'오전':'오후'} ${pad2(hh12)}:${pad2(mm)}`;
  },[hIndex,mIndex,ampm]);

  const confirmAdd = async ()=>{
    if(!targetRoutine) return;

    const hh12 = hours12[hIndex] ?? 12;
    const mm = minutes[mIndex] ?? 0;
    const hour24 = ampm==='AM' ? (hh12%12) : ((hh12%12)+12);
    const time = `${pad2(hour24)}:${pad2(mm)}`;

    const newPlan: WeeklyPlanItem = {
      planId: uniqId(),
      routineId: targetRoutine.id,
      title: targetRoutine.title,
      steps: targetRoutine.steps,
      tags: targetRoutine.tags,
      startAt: time,
    };

    const next:WeeklyPlanner = { ...weekly };
    const arr:WeeklyPlanItem[] = Array.isArray(next[day]) ? [...(next[day] as WeeklyPlanItem[])] : [];
    arr.push(newPlan);
    arr.sort((a,b)=>{
      if(!a.startAt && !b.startAt) return 0;
      if(!a.startAt) return 1; if(!b.startAt) return -1;
      return a.startAt!.localeCompare(b.startAt!);
    });
    next[day]=arr;

    await saveWeekly(next);

    setPickerOpen(false);
    Alert.alert('추가 완료', `"${targetRoutine.title}"가 ${DAY_LABEL[day]}요일 ${selectedPreview}에 추가됐어요.`);
  };

  const goPlanner = ()=> router.push('/habit/planner');

  /* UI */
  return (
    <View style={{ flex:1, backgroundColor:'#fff' }}>
      {/* Header (제목 정확히 가운데) */}
      <View style={styles.header}>
        <View style={styles.headerSide}>
          <TouchableOpacity onPress={()=>router.back()} style={styles.headerBtn}>
            <Text style={styles.headerBtnText}>〈</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>루틴 추가</Text>
        </View>
        <View style={styles.headerSide} />
      </View>

      {/* Day row */}
      <View style={styles.weekRow}>
        {DAY_KEYS.map(d=>{
          const active=d===day;
          return (
            <TouchableOpacity key={d} onPress={()=>setDay(d)} style={[styles.dayChip, active && styles.dayChipActive]}>
              <Text style={[styles.dayChipText, active && styles.dayChipTextActive]}>{DAY_LABEL[d]}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Search */}
      <View style={{ paddingHorizontal:16 }}>
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="루틴 검색 (제목/태그/스텝)"
          style={styles.input}
        />
      </View>

      {/* Tag chips */}
      <View style={{ flexDirection:'row', flexWrap:'wrap', gap:8 as any, paddingHorizontal:16, marginTop:20, marginBottom: 12 }}>
        {TAGS.map(tag=>{
          const on = activeTag===tag;
          return (
            <TouchableOpacity
              key={tag}
              onPress={()=>setActiveTag(on?'':tag)}
              style={[styles.tagChip, on && styles.tagChipOn]}
            >
              <Text style={[styles.tagChipTxt, on && styles.tagChipTxtOn]}>{tag}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Horizontal pager */}
      <ScrollView
        ref={pagerRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={(e)=> setPageIndex(Math.round(e.nativeEvent.contentOffset.x/SCREEN_W))}
        contentContainerStyle={{ paddingVertical:14 }}
      >
        {pages.map((pair, idx)=>(
          <View key={idx} style={{ width: SCREEN_W, paddingHorizontal:16 }}>
            {pair.map(r=>{
              const mins = totalMinutes(r.steps);
              return (
                <View key={r.id} style={styles.cardOuter}>
                  <View style={styles.cardOffsetBg} />
                  <View style={styles.card}>
                    <View style={{ flexDirection:'row', justifyContent:'space-between', alignItems:'center', marginBottom:6 }}>
                      <Text style={{ fontWeight:'bold', fontSize:18, flex:1, paddingRight:8 }} numberOfLines={1}>
                        {r.title}
                      </Text>
                      <Text style={{ fontSize:12, color:'#6B7280' }}>{mins}분</Text>
                    </View>
                    <View style={{ flexDirection:'row', flexWrap:'wrap', marginBottom:8 }}>
                      {r.tags.map((tag, j)=>(
                        <Text key={j} style={{ color:'#059669', fontSize:14, marginRight:6, marginBottom:6 }}>{tag}</Text>
                      ))}
                    </View>
                    {r.steps.map((s, i)=>(
                      <Text key={i} style={{ fontSize:16, marginBottom:4 }}>• {s.step} ({s.minutes}분)</Text>
                    ))}
                    <View style={{ flexDirection:'row', gap:8 as any, marginTop:10 }}>
                      <TouchableOpacity
                        onPress={()=>openPicker(r)}
                        style={styles.addBtn}
                      >
                        <Text style={styles.addBtnText}>추가</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                </View>
              );
            })}
            {pair.length===1 && <View style={{ height: 8 }} /> }
          </View>
        ))}
        {pages.length===0 && (
          <View style={{ width: SCREEN_W, paddingHorizontal:16 }}>
            <Text style={{ color:'#6B7280', marginTop:8 }}>루틴이 없습니다.</Text>
          </View>
        )}
      </ScrollView>

      {/* ✅ 페이지 인디케이터 (하단 점) 복구 */}
      {pages.length > 1 && (
        <View style={styles.indicatorRow}>
          {pages.map((_, i) => (
            <View key={i} style={[styles.dot, i === pageIndex && styles.dotOn]} />
          ))}
        </View>
      )}

      {/* 설정 완료 */}
      <View style={styles.doneWrap}>
        <TouchableOpacity onPress={goPlanner} style={styles.doneBtn}>
          <Text style={styles.doneTxt}>설정 완료</Text>
        </TouchableOpacity>
      </View>

      {/* 시간 휠 모달 */}
      <Modal visible={pickerOpen} transparent animationType="fade" onRequestClose={()=>setPickerOpen(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <View style={{ flexDirection:'row', justifyContent:'space-between', alignItems:'center' }}>
              <Text style={{ fontSize:16, fontWeight:'900' }}>시간 선택</Text>
              <TouchableOpacity onPress={()=>setPickerOpen(false)}><Text style={{ fontSize:18 }}>✕</Text></TouchableOpacity>
            </View>

            <Text style={{ color:'#6B7280', marginTop:6 }}>{targetRoutine?.title}</Text>
            <Text style={{ marginTop:4, fontWeight:'800' }}>{selectedPreview}</Text>

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
              <View style={styles.wheelCol}>
                <ScrollView
                  ref={hRef}
                  showsVerticalScrollIndicator={false}
                  snapToInterval={H_ITEM_H}
                  decelerationRate="fast"
                  onMomentumScrollEnd={(e:NativeSyntheticEvent<NativeScrollEvent>)=>{
                    const idx = Math.round(e.nativeEvent.contentOffset.y/H_ITEM_H);
                    setHIndex(Math.max(0,Math.min(11,idx)));
                  }}
                  contentContainerStyle={{ paddingVertical:(H_ITEM_H*2) }}
                >
                  {hours12.map((h,idx)=>(
                    <View key={h} style={[styles.wheelItem,{ height:H_ITEM_H }]}>
                      <Text style={[styles.wheelTxt, idx===hIndex && styles.wheelTxtOn]}>{pad2(h)}</Text>
                    </View>
                  ))}
                </ScrollView>
                <View style={styles.selectionOverlay} pointerEvents="none" />
                <Text style={styles.wheelLabel}>시</Text>
              </View>

              <View style={styles.wheelCol}>
                <ScrollView
                  ref={mRef}
                  showsVerticalScrollIndicator={false}
                  snapToInterval={M_ITEM_H}
                  decelerationRate="fast"
                  onMomentumScrollEnd={(e:NativeSyntheticEvent<NativeScrollEvent>)=>{
                    const idx = Math.round(e.nativeEvent.contentOffset.y/M_ITEM_H);
                    setMIndex(Math.max(0,Math.min(11,idx)));
                  }}
                  contentContainerStyle={{ paddingVertical:(M_ITEM_H*2) }}
                >
                  {minutes.map((m,idx)=>(
                    <View key={m} style={[styles.wheelItem,{ height:M_ITEM_H }]}>
                      <Text style={[styles.wheelTxt, idx===mIndex && styles.wheelTxtOn]}>{pad2(m)}</Text>
                    </View>
                  ))}
                </ScrollView>
                <View style={styles.selectionOverlay} pointerEvents="none" />
                <Text style={styles.wheelLabel}>분</Text>
              </View>
            </View>

            <View style={{ flexDirection:'row', justifyContent:'flex-end', marginTop:12 }}>
              <TouchableOpacity onPress={()=>setPickerOpen(false)} style={[styles.grayBtn,{ marginRight:8 }]}><Text style={styles.grayBtnText}>취소</Text></TouchableOpacity>
              <TouchableOpacity onPress={confirmAdd} style={styles.primaryBtn}><Text style={styles.primaryBtnText}>추가</Text></TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

/* ===== Styles ===== */
const ITEM_H = 38;

const styles = StyleSheet.create({
  header:{
    height:56, paddingHorizontal:12, flexDirection:'row', alignItems:'center',
    borderBottomWidth:1, borderColor:'#F3F4F6', backgroundColor:'#fff', marginTop:50
  },
  headerSide:{ width:52, height:40, justifyContent:'center', alignItems:'center' },
  headerBtn:{ width:52, height:40, justifyContent:'center', alignItems:'center' },
  headerBtnText:{ fontSize:20, fontWeight:'800', color:'#111827' },
  headerCenter:{ flex:1, alignItems:'center', justifyContent:'center' },
  headerTitle:{ fontSize:16, fontWeight:'800', color:'#111827' },

  weekRow:{ paddingHorizontal:16, paddingVertical:8, flexDirection:'row', justifyContent:'space-between', alignItems:'center' , marginTop: 10},
  dayChip:{ width:42, height:42, borderRadius:21, alignItems:'center', justifyContent:'center', backgroundColor:'#F5F7FA', borderWidth:1, borderColor:'#E5E7EB' },
  dayChipActive:{ backgroundColor:'#E8F0FF', borderColor:'#3B82F6', borderWidth:2 },
  dayChipText:{ fontSize:14, fontWeight:'700', color:'#1F2937' },
  dayChipTextActive:{ color:'#1E3A8A', fontWeight:'800' },

  input:{ borderWidth:1, borderColor:'#E5E7EB', borderRadius:10, paddingHorizontal:12, paddingVertical:10, fontSize:14, backgroundColor:'#F8FAFC', marginTop:8 },

  tagChip:{ paddingHorizontal:10, paddingVertical:6, borderRadius:999, borderWidth:1, borderColor:'#3B82F6', backgroundColor:'#fff' },
  tagChipOn:{ backgroundColor:'#3B82F6' },
  tagChipTxt:{ color:'#3B82F6', fontSize:13, fontWeight:'700' },
  tagChipTxtOn:{ color:'#fff' },

  cardOuter:{ position:'relative', marginBottom:24, paddingHorizontal:10 },
  cardOffsetBg:{ position:'absolute', top:0, left:5, width:'95%', height:'100%', backgroundColor:'#10B981', borderRadius:16, zIndex:0 },
  card:{ backgroundColor:'#ECFDF5', padding:14, borderRadius:16, zIndex:1 },

  addBtn:{ flex:1, backgroundColor:'#3B82F6', height:36, borderRadius:20, justifyContent:'center', alignItems:'center' },
  addBtnText:{ color:'#fff', fontSize:14, fontWeight:'700', textAlign:'center' },

  /* ✅ 인디케이터 스타일 */
  indicatorRow:{ position:'absolute', bottom:24, left:0, right:0, flexDirection:'row', justifyContent:'center', alignItems:'center', gap:6 as any },
  dot:{ width:8, height:8, borderRadius:4, backgroundColor:'#D1D5DB' },
  dotOn:{ backgroundColor:'#3B82F6', width:18 },

  doneWrap:{ position:'absolute', left:0, right:0, bottom:64, alignItems:'center' },
  doneBtn:{ backgroundColor:'#10B981', paddingHorizontal:20, paddingVertical:10, borderRadius:24, elevation:2 },
  doneTxt:{ color:'#fff', fontWeight:'900' },

  grayBtn:{ backgroundColor:'#F3F4F6', paddingVertical:10, paddingHorizontal:14, borderRadius:10, alignItems:'center' },
  grayBtnText:{ color:'#111827', fontWeight:'800' },
  primaryBtn:{ backgroundColor:'#3B82F6', paddingVertical:10, paddingHorizontal:14, borderRadius:10, alignItems:'center' },
  primaryBtnText:{ color:'#fff', fontWeight:'900' },

  modalBackdrop:{ flex:1, backgroundColor:'rgba(0,0,0,0.45)', alignItems:'center', justifyContent:'center', padding:16 },
  modalCard:{ width:'100%', maxWidth:480, backgroundColor:'#fff', borderRadius:16, padding:16, borderWidth:1, borderColor:'#E5E7EB' },

  ampmRow:{ flexDirection:'row', justifyContent:'center', gap:8 as any, marginTop:10, marginBottom:8 },
  ampmChip:{ paddingHorizontal:14, paddingVertical:8, borderRadius:999, borderWidth:1, borderColor:'#D1D5DB', backgroundColor:'#FFFFFF' },
  ampmChipOn:{ backgroundColor:'#DBEAFE', borderColor:'#93C5FD' },
  ampmTxt:{ color:'#374151', fontWeight:'700' },
  ampmTxtOn:{ color:'#1E3A8A', fontWeight:'800' },

  wheelRow:{ flexDirection:'row', justifyContent:'center', alignItems:'center', marginTop:6 },
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
