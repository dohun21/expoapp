// app/(tabs)/routine.tsx
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  Dimensions,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

/* ============== Types & Consts ============== */
type Step = { step: string; minutes: number };
type Routine = {
  id: string;
  title: string;
  steps: Step[];
  tags: string[];
  origin: 'preset' | 'custom';
};

type TabKey = 'fav' | 'preset' | 'mine';
type EditableStep = Step & { enabled?: boolean };

const STORAGE_KEY = '@userRoutinesV1';
const FAV_KEY = '@favoriteRoutineIdsV1';
const RUN_KEY = '@routineRunStatsV1';

const ALLOWED_TAGS = ['#개념이해', '#문제풀이', '#암기', '#복습정리'] as const;
type AllowedTag = typeof ALLOWED_TAGS[number];

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

const { height: SCREEN_H } = Dimensions.get('window');

/* ============== Component ============== */
export default function RoutinePage() {
  const router = useRouter();
  const { tab } = useLocalSearchParams<{ tab?: string }>();

  /* 목록 탭/검색/필터 */
  const [activeTab, setActiveTab] = useState<TabKey>('mine');
  const [search, setSearch] = useState('');
  const [selectedTag, setSelectedTag] = useState<AllowedTag | ''>('');

  /* 데이터 */
  const [userRoutines, setUserRoutines] = useState<Routine[]>([]);
  const [favorites, setFavorites] = useState<Record<string, number>>({});
  const [runStats, setRunStats] = useState<Record<string, { runCount: number; lastRunAt: number }>>({});

  const favoriteIds = useMemo(() => new Set(Object.keys(favorites)), [favorites]);

  /* 내 루틴 생성(간단판) */
  const [myTitle, setMyTitle] = useState('');
  const [selectedCreateTag, setSelectedCreateTag] = useState<AllowedTag | ''>('');
  const [stepInput, setStepInput] = useState('');
  const [stepMinutes, setStepMinutes] = useState('');
  const [stepList, setStepList] = useState<Step[]>([]);
  const [showMessage, setShowMessage] = useState(false);

  /* 실행 전 빠른 조정 바텀시트 */
  const [adjustTarget, setAdjustTarget] = useState<Routine | null>(null);
  const [adjustSteps, setAdjustSteps] = useState<EditableStep[]>([]);
  const [adjustMounted, setAdjustMounted] = useState(false);
  const [adjustShowing, setAdjustShowing] = useState(false);
  const sheetTranslateY = useRef(new Animated.Value(SCREEN_H)).current;
  const overlayOpacity = useRef(new Animated.Value(0)).current;

  /* URL 초기 탭 */
  useEffect(() => {
    const t = Array.isArray(tab) ? tab[0] : tab;
    if (t === 'fav' || t === 'preset' || t === 'mine') setActiveTab(t);
  }, [tab]);

  /* 초기 로드 */
  useEffect(() => {
    (async () => {
      try {
        const [rawRoutines, rawFav, rawRun] = await Promise.all([
          AsyncStorage.getItem(STORAGE_KEY),
          AsyncStorage.getItem(FAV_KEY),
          AsyncStorage.getItem(RUN_KEY),
        ]);

        if (rawRoutines) {
          const parsed: Routine[] = JSON.parse(rawRoutines);
          const cleaned = parsed.map(r => ({
            ...r,
            tags: r.tags.filter((t): t is AllowedTag => (ALLOWED_TAGS as readonly string[]).includes(t)),
          }));
          setUserRoutines(cleaned);
          if (JSON.stringify(cleaned) !== rawRoutines) {
            await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(cleaned));
          }
        }
        if (rawFav) {
          const parsed = JSON.parse(rawFav);
          if (Array.isArray(parsed)) {
            const now = Date.now();
            const map: Record<string, number> = {};
            (parsed as string[]).forEach((id) => (map[id] = now));
            setFavorites(map);
            AsyncStorage.setItem(FAV_KEY, JSON.stringify(map));
          } else if (parsed && typeof parsed === 'object') {
            setFavorites(parsed as Record<string, number>);
          }
        }
        if (rawRun) setRunStats(JSON.parse(rawRun));
      } catch (e) {
        console.log('initial load error', e);
      }
    })();
  }, []);

  /* 저장 헬퍼 */
  const saveUserRoutines = async (arr: Routine[]) => {
    setUserRoutines(arr);
    try { await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(arr)); } catch {}
  };
  const persistFavorites = async (obj: Record<string, number>) => {
    try { await AsyncStorage.setItem(FAV_KEY, JSON.stringify(obj)); } catch {}
  };
  const persistRunStats = async (obj: Record<string, { runCount: number; lastRunAt: number }>) => {
    try { await AsyncStorage.setItem(RUN_KEY, JSON.stringify(obj)); } catch {}
  };

  /* 공통 유틸 */
  const isFavorite = (id: string) => favoriteIds.has(id);
  const toggleFavorite = (id: string) => {
    setFavorites((prev) => {
      const next = { ...prev };
      if (next[id]) delete next[id]; else next[id] = Date.now();
      persistFavorites(next);
      return next;
    });
  };
  const markRun = (id: string) => {
    setRunStats((prev) => {
      const cur = prev[id] ?? { runCount: 0, lastRunAt: 0 };
      const next = { ...prev, [id]: { runCount: cur.runCount + 1, lastRunAt: Date.now() } };
      persistRunStats(next);
      return next;
    });
  };

  /* 목록 데이터 */
  const allRoutines = useMemo(() => [...PRESET_ROUTINES, ...userRoutines], [userRoutines]);
  const filteredRoutines = useMemo(() => {
    let base: Routine[];
    if (activeTab === 'preset') base = PRESET_ROUTINES;
    else if (activeTab === 'mine') base = userRoutines;
    else base = allRoutines.filter((r) => favoriteIds.has(r.id));

    if (selectedTag) base = base.filter((r) => r.tags.includes(selectedTag));
    if (search.trim()) {
      const q = search.trim();
      base = base.filter((r) => r.title.includes(q) || r.tags.some((t) => t.includes(q)));
    }
    if (activeTab === 'fav') {
      return [...base].sort((a, b) => {
        const la = runStats[a.id]?.lastRunAt ?? 0;
        const lb = runStats[b.id]?.lastRunAt ?? 0;
        if (la !== lb) return lb - la;
        const fa = favorites[a.id] ?? 0;
        const fb = favorites[b.id] ?? 0;
        if (fa !== fb) return fb - fa;
        return a.title.localeCompare(b.title, 'ko');
      });
    } else {
      return [...base].sort((a, b) => {
        const af = isFavorite(a.id) ? 1 : 0;
        const bf = isFavorite(b.id) ? 1 : 0;
        if (af !== bf) return bf - af;
        return a.title.localeCompare(b.title, 'ko');
      });
    }
  }, [activeTab, selectedTag, search, userRoutines, favoriteIds, runStats, favorites]);

  /* 내 루틴 생성 */
  const handleAddRoutine = async () => {
    if (!myTitle.trim() || stepList.length === 0) {
      Alert.alert('❗', '제목과 단계는 필수입니다!');
      return;
    }
    const newItem: Routine = {
      id: `mine-${Date.now()}`,
      title: myTitle.trim(),
      steps: stepList,
      tags: selectedCreateTag ? [selectedCreateTag] : [],
      origin: 'custom',
    };
    const next = [...userRoutines, newItem];
    await saveUserRoutines(next);
    setMyTitle(''); setSelectedCreateTag(''); setStepList([]);
    setShowMessage(true); setActiveTab('mine');
    setTimeout(() => setShowMessage(false), 1200);
  };

  const handleDeleteMine = async (id: string) => {
    const nextMine = userRoutines.filter((r) => r.id !== id);
    await saveUserRoutines(nextMine);
    setFavorites((prev) => {
      if (!prev[id]) return prev;
      const cp = { ...prev }; delete cp[id]; persistFavorites(cp); return cp;
    });
    setRunStats((prev) => {
      if (!prev[id]) return prev;
      const cp = { ...prev }; delete cp[id]; persistRunStats(cp); return cp;
    });
  };

  /* 빠른 조정 시트 애니메이션 */
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
    if (adjustShowing) { setAdjustMounted(true); requestAnimationFrame(animateIn); }
    else if (adjustMounted) { animateOut(() => setAdjustMounted(false)); }
  }, [adjustShowing]);

  const openAdjust = (routine: Routine) => {
    setAdjustTarget(routine);
    setAdjustSteps(routine.steps.map((s) => ({ ...s, enabled: true })));
    sheetTranslateY.setValue(SCREEN_H);
    overlayOpacity.setValue(0);
    setAdjustShowing(true);
  };
  const closeAdjust = () => setAdjustShowing(false);
  const toggleEnable = (idx: number) => {
    setAdjustSteps((prev) => { const next=[...prev]; next[idx].enabled = next[idx].enabled===false ? true:false; return next; });
  };
  const updateStepName = (idx: number, name: string) => {
    setAdjustSteps((prev) => { const next=[...prev]; next[idx].step = name; return next; });
  };
  const updateStepMinutes = (idx: number, val: string) => {
    const n = Math.max(1, Math.round(Number(val) || 0));
    setAdjustSteps((prev) => { const next=[...prev]; next[idx].minutes = n; return next; });
  };
  const bump = (idx: number, delta: number) => {
    setAdjustSteps((prev) => { const next=[...prev]; next[idx].minutes = Math.max(1, (next[idx].minutes ?? 1)+delta); return next; });
  };
  const confirmRun = () => {
    if (!adjustTarget) return;
    const finalSteps = adjustSteps
      .filter((s) => s.enabled !== false)
      .map((s) => ({ step: (s.step || '').trim() || '단계', minutes: Math.max(1, s.minutes ?? 1) }));
    if (finalSteps.length === 0) { Alert.alert('알림', '최소 1개 이상의 단계를 선택해 주세요.'); return; }
    markRun(adjustTarget.id);
    const qs = finalSteps.map((s) => `${s.step},${s.minutes}`).join('|');
    router.push(`/routine/run?title=${encodeURIComponent(adjustTarget.title)}&steps=${encodeURIComponent(qs)}`);
    closeAdjust();
  };

  /* ---------- Sub-Components ---------- */
  const SectionHeader = ({ title, right }: { title: string; right?: React.ReactNode }) => (
    <View style={{ flexDirection:'row', justifyContent:'space-between', alignItems:'center', marginBottom:20, marginLeft: 10 }}>
      <Text style={{ fontSize: 22, fontWeight: 'bold' }}>{title}</Text>
      {right}
    </View>
  );

  const RoutineCard = ({ routine }: { routine: Routine }) => (
    <View style={{ position: 'relative', marginBottom: 24, paddingHorizontal: 10 }}>
      {/* 그린 오프셋 배경 */}
      <View style={{ position: 'absolute', top: 0, left: 5, width: '95%', height: '100%', backgroundColor: '#10B981', borderRadius: 16, zIndex: 0 }} />
      {/* 본 카드 */}
      <View style={{ backgroundColor: '#ECFDF5', padding: 14, borderRadius: 16, zIndex: 1 }}>
        {/* 상단: 제목 + 즐겨찾기 */}
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
          <View style={{ flex: 1, paddingRight: 8 }}>
            <Text style={{ fontWeight: 'bold', fontSize: 18 }} numberOfLines={1}>
              {routine.title}
            </Text>
          </View>
          <TouchableOpacity onPress={() => toggleFavorite(routine.id)} hitSlop={8} style={{ paddingHorizontal: 4, paddingVertical: 2 }}>
            <Ionicons name={isFavorite(routine.id) ? 'star' : 'star-outline'} size={20} />
          </TouchableOpacity>
        </View>

        {/* 태그 */}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: 8 }}>
          {routine.tags.map((tag, j) => (
            <Text key={j} style={{ color: '#059669', fontSize: 14, marginRight: 6, marginBottom: 6 }}>
              {tag}
            </Text>
          ))}
        </View>

        {/* 단계 전체 표시 */}
        {routine.steps.map((s, idx) => (
          <Text key={idx} style={{ fontSize: 16, marginBottom: 4 }}>
            • {s.step} ({s.minutes}분)
          </Text>
        ))}

        {/* 버튼 */}
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
          

          {routine.origin === 'custom' && (
            <TouchableOpacity
              onPress={() => handleDeleteMine(routine.id)}
              style={{ width: 48, backgroundColor: '#FEE2E2', height: 36, borderRadius: 20, justifyContent: 'center', alignItems: 'center' }}
            >
              <Ionicons name="trash" size={18} color="#DC2626" />
            </TouchableOpacity>
          )}
        </View>
      </View>
    </View>
  );

  /* ============== Render ============== */
  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: '#fff' }}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 10 : 0}
    >
      <ScrollView style={{ flex: 1, padding: 20, marginTop: 50 }} contentContainerStyle={{ paddingBottom: 90 }} keyboardShouldPersistTaps="handled">
        <SectionHeader title="루틴" />

        {/* 세그먼트 */}
        <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12 }}>
          {[
            { key: 'fav',    label: `즐겨찾기 (${Object.keys(favorites).length})` },
            { key: 'preset', label: `기본 (${PRESET_ROUTINES.length})` },
            { key: 'mine',   label: `내 루틴 (${userRoutines.length})` },
          ].map(({ key, label }) => {
            const k = key as TabKey;
            const active = activeTab === k;
            return (
              <TouchableOpacity
                key={k}
                onPress={() => setActiveTab(k)}
                style={{
                  paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999,
                  borderWidth: 1, borderColor: '#3B82F6',
                  backgroundColor: active ? '#3B82F6' : '#fff',
                }}
              >
                <Text style={{ color: active ? '#fff' : '#3B82F6', fontSize: 13 }}>{label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* 검색/태그 */}
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="루틴 제목 또는 태그 검색"
          style={{ height: 40, borderColor: '#ccc', borderWidth: 1, borderRadius: 8, marginBottom: 12, paddingHorizontal: 10 }}
        />
        <View style={{ flexDirection:'row', flexWrap:'wrap', gap:8, marginBottom:12 }}>
          {ALLOWED_TAGS.map((tag) => {
            const active = selectedTag === tag;
            return (
              <TouchableOpacity
                key={tag}
                onPress={() => setSelectedTag(active ? '' : tag)}
                style={{
                  paddingHorizontal:10, paddingVertical:6, borderRadius:999,
                  borderWidth:1, borderColor:'#3B82F6',
                  backgroundColor: active ? '#3B82F6' : '#fff',
                }}
              >
                <Text style={{ color: active ? '#fff' : '#3B82F6', fontSize: 13 }}>{tag}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* 리스트 */}
        {filteredRoutines.length === 0 ? (
          <Text style={{ color:'#6B7280', marginBottom: 16 }}>
            {activeTab === 'fav' ? '즐겨찾기한 루틴이 없습니다.' : '조건에 맞는 루틴이 없습니다.'}
          </Text>
        ) : (
          filteredRoutines.map((r) => <RoutineCard key={r.id} routine={r} />)
        )}

        {/* 내 루틴 만들기 */}
        {activeTab === 'mine' && (
          <>
            <Text style={{ fontSize:18, fontWeight:'700', marginTop: 20, marginBottom:10 }}>+ 나만의 루틴 만들기</Text>
            <View style={{ backgroundColor:'#F0F9FF', padding:16, borderRadius:16, marginBottom:80 }}>
              <TextInput
                value={myTitle}
                onChangeText={setMyTitle}
                placeholder="루틴 제목 (예: 오답 노트 정리 루틴)"
                style={{ height: 40, borderWidth: 1, borderColor: '#00000066', marginBottom: 10, borderRadius: 8, paddingHorizontal: 10, backgroundColor: '#fff' }}
              />
              <View style={{ flexDirection:'row', flexWrap:'wrap', gap:6, marginBottom:10 }}>
                {ALLOWED_TAGS.map((tag) => {
                  const active = selectedCreateTag === tag;
                  return (
                    <TouchableOpacity
                      key={tag}
                      onPress={() => setSelectedCreateTag(prev => prev === tag ? '' : tag)}
                      style={{ paddingHorizontal:10, paddingVertical:6, borderRadius:999, borderWidth:1, borderColor:'#059669', backgroundColor: active ? '#059669' : '#fff' }}
                    >
                      <Text style={{ color: active ? '#fff' : '#059669' }}>{tag}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              <View style={{ marginBottom: 10, padding: 10, backgroundColor: '#F0F9FF', borderRadius: 12 }}>
                <Text style={{ fontSize: 14, fontWeight: '600', marginBottom: 6 }}>루틴 단계 추가</Text>
                <View style={{ flexDirection:'row', marginBottom:10 }}>
                  <TextInput
                    value={stepInput} onChangeText={setStepInput} placeholder="단계 이름"
                    style={{ flex:2, height:44, borderWidth:1, borderColor:'#CBD5E1', borderRadius:8, paddingHorizontal:12, backgroundColor:'#F9FAFB', marginRight:6, color:'#111827' }}
                    placeholderTextColor="#9CA3AF"
                  />
                  <TextInput
                    value={stepMinutes} onChangeText={setStepMinutes} placeholder="분" keyboardType="numeric"
                    style={{ flex:1, height:44, borderWidth:1, borderColor:'#CBD5E1', borderRadius:8, paddingHorizontal:12, backgroundColor:'#F9FAFB', marginRight:6, color:'#111827' }}
                    placeholderTextColor="#9CA3AF"
                  />
                  <TouchableOpacity
                    onPress={() => {
                      if (!stepInput.trim() || isNaN(Number(stepMinutes))) return;
                      const newStep = { step: stepInput.trim(), minutes: Math.max(1, Math.round(Number(stepMinutes))) };
                      setStepList((prev) => [...prev, newStep]);
                      setStepInput(''); setStepMinutes('');
                    }}
                    style={{ backgroundColor:'#10B981', borderRadius:8, paddingHorizontal:14, justifyContent:'center', height:44 }}
                  >
                    <Text style={{ color:'#fff', fontWeight:'700' }}>추가</Text>
                  </TouchableOpacity>
                </View>
                {stepList.map((s,i)=>(
                  <View key={i} style={{ flexDirection:'row', alignItems:'center', justifyContent:'space-between', paddingVertical:8, paddingHorizontal:12, backgroundColor:'#FFFFFF', borderRadius:8, marginBottom:6, borderWidth:1, borderColor:'#E5E7EB' }}>
                    <Text style={{ color:'#1F2937' }}>{s.step} - {s.minutes}분</Text>
                    <TouchableOpacity onPress={() => setStepList(prev => prev.filter((_,idx)=>idx!==i))}>
                      <Ionicons name="close-circle" size={20} color="#EF4444" />
                    </TouchableOpacity>
                  </View>
                ))}
              </View>
              <TouchableOpacity
                onPress={handleAddRoutine}
                style={{ backgroundColor:'#3B82F6', height:40, borderRadius:12, justifyContent:'center', alignItems:'center' }}
              >
                <Text style={{ color:'#fff', fontWeight:'700' }}>루틴 추가하기</Text>
              </TouchableOpacity>
              {showMessage && <Text style={{ marginTop: 10, color: '#059669', textAlign: 'center' }}>✅ 루틴이 추가되었습니다!</Text>}
            </View>
          </>
        )}
      </ScrollView>

      {/* ===== 빠른 조정 바텀시트 ===== */}
      {adjustMounted && (
        <Modal visible transparent animationType="none" onRequestClose={closeAdjust}>
          <Pressable style={{ flex: 1 }} onPress={closeAdjust}>
            <Animated.View pointerEvents="none" style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', opacity: overlayOpacity }} />
          </Pressable>
          <Animated.View
            style={{
              transform: [{ translateY: sheetTranslateY }],
              position: 'absolute', left: 0, right: 0, bottom: 0,
              backgroundColor: '#fff', borderTopLeftRadius: 16, borderTopRightRadius: 16,
              padding: 16, maxHeight: '80%',
              shadowColor: '#000', shadowOffset: { width: 0, height: -3 }, shadowOpacity: 0.15, shadowRadius: 6, elevation: 10,
            }}
          >
            <View style={{ flexDirection:'row', justifyContent:'space-between', alignItems:'center', marginBottom:8 }}>
              <Text style={{ fontSize:18, fontWeight:'800' }}>{adjustTarget?.title} · 빠른 조정</Text>
              <TouchableOpacity onPress={closeAdjust}><Ionicons name="close" size={22} /></TouchableOpacity>
            </View>
            <ScrollView style={{ maxHeight: 420 }} keyboardShouldPersistTaps="handled">
              {adjustSteps.map((s, i) => (
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
              <TouchableOpacity onPress={closeAdjust} style={{ flex:1, height:44, borderRadius:12, borderWidth:1, borderColor:'#9CA3AF', justifyContent:'center', alignItems:'center' }}>
                <Text style={{ color:'#374151', fontWeight:'700' }}>취소</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={confirmRun} style={{ flex:1, height:44, borderRadius:12, backgroundColor:'#3B82F6', justifyContent:'center', alignItems:'center' }}>
                <Text style={{ color:'#fff', fontWeight:'800' }}>이대로 실행</Text>
              </TouchableOpacity>
            </View>
          </Animated.View>
        </Modal>
      )}
    </KeyboardAvoidingView>
  );
}
