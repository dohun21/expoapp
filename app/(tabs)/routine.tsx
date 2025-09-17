import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

type Step = { step: string; minutes: number };
type Routine = {
  id: string;
  title: string;
  steps: Step[];
  tags: string[];
  origin: 'preset' | 'custom';
};

const STORAGE_KEY = '@userRoutinesV1';
const FAV_KEY = '@favoriteRoutineIdsV1';         // v1: string[], v2: Record<id, favoriteAt>
const RUN_KEY = '@routineRunStatsV1';            // { [id]: { runCount: number, lastRunAt: number } }

// ✅ 허용 태그(4개 고정)
const ALLOWED_TAGS = ['#개념이해', '#문제풀이', '#암기', '#복습정리'] as const;
type AllowedTag = typeof ALLOWED_TAGS[number];

// ✅ 기본 제공 루틴 (태그 4개만 사용하도록 정리)
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
    { step: '틀렸던 이유 요약', minutes: 5 },
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

type TabKey = 'fav' | 'preset' | 'mine';

export default function RoutinePage() {
  const router = useRouter();
  const { tab } = useLocalSearchParams<{ tab?: string }>();

  // ==== UI 상태 ====
  const [search, setSearch] = useState('');
  // ✅ 기본 탭을 'mine'으로 변경
  const [activeTab, setActiveTab] = useState<TabKey>('mine');
  const [selectedTag, setSelectedTag] = useState<AllowedTag | ''>('');

  // ==== 커스텀 루틴 입력 ====
  const [myTitle, setMyTitle] = useState('');
  const RECOMMENDED_TAGS: AllowedTag[] = [...ALLOWED_TAGS];
  const [selectedCreateTags, setSelectedCreateTags] = useState<AllowedTag[]>([]);
  const [stepInput, setStepInput] = useState('');
  const [stepMinutes, setStepMinutes] = useState('');
  const [stepList, setStepList] = useState<Step[]>([]);
  const [showMessage, setShowMessage] = useState(false);

  // ==== 데이터 ====
  const [userRoutines, setUserRoutines] = useState<Routine[]>([]);
  // 즐겨찾기: v2 = Record<id, favoriteAt>, v1(배열)은 로드시 마이그레이션
  const [favorites, setFavorites] = useState<Record<string, number>>({});
  const favoriteIds = useMemo(() => new Set(Object.keys(favorites)), [favorites]);

  // 실행 기록
  const [runStats, setRunStats] = useState<Record<string, { runCount: number; lastRunAt: number }>>({});

  // ✅ 스크롤 & 키보드 회피 최소화
  const scrollRef = useRef<ScrollView | null>(null);
  const KEYBOARD_OFFSET = Platform.OS === 'ios' ? 10 : 0;

  // ✅ URL 쿼리로 초기 탭 제어 (예: /routine?tab=mine)
  useEffect(() => {
    const t = Array.isArray(tab) ? tab[0] : tab;
    if (t === 'fav' || t === 'preset' || t === 'mine') {
      setActiveTab(t);
    }
  }, [tab]);

  // 초기 로드: 내 루틴 + 즐겨찾기 + 실행기록
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
          // 혹시 예전에 다른 태그가 저장돼 있었다면 허용 태그로만 정화
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

  // 저장 헬퍼
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

  // ⭐ 즐겨찾기
  const isFavorite = (id: string) => favoriteIds.has(id);
  const toggleFavorite = (id: string) => {
    setFavorites((prev) => {
      const next = { ...prev };
      if (next[id]) delete next[id];
      else next[id] = Date.now();
      persistFavorites(next);
      return next;
    });
  };

  // 실행 기록 업데이트
  const markRun = (id: string) => {
    setRunStats((prev) => {
      const cur = prev[id] ?? { runCount: 0, lastRunAt: 0 };
      const next = { ...prev, [id]: { runCount: cur.runCount + 1, lastRunAt: Date.now() } };
      persistRunStats(next);
      return next;
    });
  };

  const allRoutines = useMemo(() => [...PRESET_ROUTINES, ...userRoutines], [userRoutines]);

  // 검색/태그/탭 필터 + 정렬
  const listToShow = useMemo(() => {
    let base: Routine[];
    if (activeTab === 'preset') base = PRESET_ROUTINES;
    else if (activeTab === 'mine') base = userRoutines;
    else base = allRoutines.filter((r) => favoriteIds.has(r.id)); // fav

    if (selectedTag) base = base.filter((r) => r.tags.includes(selectedTag));
    if (search.trim()) {
      const q = search.trim();
      base = base.filter((r) => r.title.includes(q) || r.tags.some((t) => t.includes(q)));
    }

    if (activeTab === 'fav') {
      // 즐겨찾기 탭: 최근 실행 ↓ → 즐겨찾기한 시점 ↓ → 제목
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
      // 다른 탭: 즐겨찾기 우선 → 제목
      return [...base].sort((a, b) => {
        const af = isFavorite(a.id) ? 1 : 0;
        const bf = isFavorite(b.id) ? 1 : 0;
        if (af !== bf) return bf - af;
        return a.title.localeCompare(b.title, 'ko');
      });
    }
  }, [activeTab, selectedTag, search, userRoutines, favoriteIds, runStats, favorites]);

  // 태그 칩 토글 (허용 태그만)
  const toggleCreateTag = (tag: AllowedTag) => {
    setSelectedCreateTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    );
  };

  const handleAddRoutine = async () => {
    if (!myTitle.trim() || stepList.length === 0) {
      Alert.alert('❗', '제목과 단계는 필수입니다!');
      return;
    }

    // 선택된 허용 태그만 저장
    const tagSet = new Set<AllowedTag>(selectedCreateTags);

    const newItem: Routine = {
      id: `mine-${Date.now()}`,
      title: myTitle.trim(),
      steps: stepList,
      tags: Array.from(tagSet),
      origin: 'custom',
    };

    const next = [...userRoutines, newItem];
    await saveUserRoutines(next);

    // 입력값 리셋
    setMyTitle('');
    setSelectedCreateTags([]);
    setStepList([]);
    setShowMessage(true);
    setActiveTab('mine');
    setTimeout(() => setShowMessage(false), 1500);
  };

  const handleDeleteMine = async (id: string) => {
    // 내 루틴 삭제 시 즐겨찾기/실행기록에서도 제거
    const nextMine = userRoutines.filter((r) => r.id !== id);
    await saveUserRoutines(nextMine);

    setFavorites((prev) => {
      if (!prev[id]) return prev;
      const cp = { ...prev };
      delete cp[id];
      persistFavorites(cp);
      return cp;
    });

    setRunStats((prev) => {
      if (!prev[id]) return prev;
      const cp = { ...prev };
      delete cp[id];
      persistRunStats(cp);
      return cp;
    });
  };

  const onRunPress = (routine: Routine) => {
    markRun(routine.id);
    router.push(
      `/routine/run?title=${encodeURIComponent(routine.title)}&steps=${encodeURIComponent(
        routine.steps.map((s) => `${s.step},${s.minutes}`).join('|')
      )}`
    );
  };

  // 즐겨찾기 퀵 섹션 (즐겨찾기 탭에서만 표시)
  const FavoriteSection = () => {
    const favs = allRoutines
      .filter((r) => favoriteIds.has(r.id))
      .sort((a, b) => {
        const la = runStats[a.id]?.lastRunAt ?? 0;
        const lb = runStats[b.id]?.lastRunAt ?? 0;
        if (la !== lb) return lb - la;
        const fa = favorites[a.id] ?? 0;
        const fb = favorites[b.id] ?? 0;
        if (fa !== fb) return fb - fa;
        return a.title.localeCompare(b.title, 'ko');
      })
      .slice(0, 3);

    return (
      <View style={{ marginBottom: 16 }}>
        <Text style={{ fontSize: 18, fontWeight: '700', marginBottom: 8 }}>
          즐겨찾기 루틴 <Text style={{ color: '#64748b' }}>({Object.keys(favorites).length})</Text>
        </Text>
        {favs.length === 0 ? (
          <View style={{ padding: 12, borderRadius: 12, backgroundColor: '#F8FAFC' }}>
            <Text style={{ color: '#6B7280' }}>
              카드의 ★을 눌러 자주 쓰는 루틴을 즐겨찾기에 추가해 보세요.
            </Text>
          </View>
        ) : (
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {favs.map((r) => (
              <TouchableOpacity
                key={r.id}
                onPress={() => onRunPress(r)}
                style={{
                  flex: 1,
                  padding: 12,
                  borderWidth: 1,
                  borderColor: '#e5e7eb',
                  borderRadius: 12,
                  backgroundColor: '#FFFFFF',
                }}
              >
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Text numberOfLines={1} style={{ fontWeight: '600' }}>{r.title}</Text>
                  <Ionicons name="play-circle" size={20} />
                </View>
                <Text numberOfLines={1} style={{ marginTop: 6, opacity: 0.7 }}>
                  {r.steps.map((s) => s.step).join(' · ')}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        )}
      </View>
    );
  };

  const RoutineCard = ({ routine }: { routine: Routine }) => (
    <View
      style={{
        position: 'relative',
        marginBottom: 24,
        paddingHorizontal: 10,
      }}
    >
      <View
        style={{
          position: 'absolute',
          top: 0,
          left: 5,
          width: '95%',
          height: '100%',
          backgroundColor: '#10B981',
          borderRadius: 16,
          zIndex: 0,
        }}
      />
      <View
        style={{
          backgroundColor: '#ECFDF5',
          padding: 14,
          borderRadius: 16,
          zIndex: 1,
        }}
      >
        {/* 상단: 제목 + 즐겨찾기 */}
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
          <View style={{ flex: 1, paddingRight: 8 }}>
            <Text style={{ fontWeight: 'bold', fontSize: 18 }} numberOfLines={1}>
              {routine.title}
            </Text>
          </View>
          <TouchableOpacity
            onPress={() => toggleFavorite(routine.id)}
            hitSlop={8}
            style={{ paddingHorizontal: 4, paddingVertical: 2 }}
          >
            <Ionicons name={isFavorite(routine.id) ? 'star' : 'star-outline'} size={20} />
          </TouchableOpacity>
        </View>

        {/* 태그 (허용 4개만 이미 보장) */}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: 8 }}>
          {routine.tags.map((tag, j) => (
            <Text key={j} style={{ color: '#059669', fontSize: 14, marginRight: 6, marginBottom: 6 }}>
              {tag}
            </Text>
          ))}
        </View>

        {/* 단계 */}
        {routine.steps.map((s, idx) => (
          <Text key={idx} style={{ fontSize: 16, marginBottom: 4 }}>
            • {s.step} ({s.minutes}분)
          </Text>
        ))}

        {/* 버튼 */}
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
          <TouchableOpacity
            onPress={() => onRunPress(routine)}
            style={{
              flex: 1,
              backgroundColor: '#3B82F6',
              height: 36,
              borderRadius: 20,
              justifyContent: 'center',
              alignItems: 'center',
            }}
          >
            <Text style={{ color: '#fff', fontSize: 14 }}>실행하기</Text>
          </TouchableOpacity>

          {routine.origin === 'custom' && (
            <TouchableOpacity
              onPress={() => handleDeleteMine(routine.id)}
              style={{
                width: 48,
                backgroundColor: '#FEE2E2',
                height: 36,
                borderRadius: 20,
                justifyContent: 'center',
                alignItems: 'center',
              }}
            >
              <Ionicons name="trash" size={18} color="#DC2626" />
            </TouchableOpacity>
          )}
        </View>
      </View>
    </View>
  );

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: '#fff' }}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={KEYBOARD_OFFSET}
    >
      <ScrollView
        ref={scrollRef}
        style={{ flex: 1, padding: 20 }}
        contentContainerStyle={{ paddingBottom: 60 }}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={{ fontSize: 22, fontWeight: 'bold', marginBottom: 16, marginTop: 70 }}>
          루틴 목록
        </Text>

        {/* 🔹 즐겨찾기 퀵 섹션: 즐겨찾기 탭에서만 표시 */}
        {activeTab === 'fav' && <FavoriteSection />}

        {/* 🔹 세그먼트 탭: 즐겨찾기 | 기본 | 내 루틴 */}
        <View style={{ flexDirection: 'row', gap: 8, marginBottom: 14 }}>
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
                  paddingHorizontal: 12,
                  paddingVertical: 8,
                  borderRadius: 999,
                  borderWidth: 1,
                  borderColor: '#3B82F6',
                  backgroundColor: active ? '#3B82F6' : '#fff',
                }}
              >
                <Text style={{ color: active ? '#fff' : '#3B82F6', fontSize: 13 }}>{label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* 🔎 검색 */}
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="루틴 제목 또는 태그 검색"
          style={{
            height: 40,
            borderColor: '#ccc',
            borderWidth: 1,
            borderRadius: 8,
            marginBottom: 12,
            paddingHorizontal: 10,
          }}
        />

        {/* 🏷️ 태그 필터 (4개만) */}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 18 }}>
          {RECOMMENDED_TAGS.map((tag) => {
            const active = selectedTag === tag;
            return (
              <TouchableOpacity
                key={tag}
                onPress={() => setSelectedTag(active ? '' : tag)}
                style={{
                  paddingHorizontal: 10,
                  paddingVertical: 5,
                  borderRadius: 20,
                  borderWidth: 1,
                  borderColor: '#3B82F6',
                  backgroundColor: active ? '#3B82F6' : '#fff',
                }}
              >
                <Text style={{ color: active ? '#fff' : '#3B82F6', fontSize: 14 }}>{tag}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* 📚 루틴 목록 */}
        {listToShow.length === 0 ? (
          <Text style={{ color: '#6B7280', marginBottom: 20 }}>
            {activeTab === 'fav'
              ? '즐겨찾기한 루틴이 없습니다. 카드의 ★을 눌러 추가해 보세요.'
              : '조건에 맞는 루틴이 없습니다.'}
          </Text>
        ) : (
          listToShow.map((r) => <RoutineCard key={r.id} routine={r} />)
        )}

        {/* ======================= 나만의 루틴 만들기 (내 루틴 탭에서만 표시) ======================= */}
        {activeTab === 'mine' && (
          <>
            <Text style={{ fontSize: 18, fontWeight: '600', marginTop: 30, marginBottom: 10 }}>
              + 나만의 루틴 만들기
            </Text>

            <View style={{ backgroundColor: '#F0F9FF', padding: 20, borderRadius: 16, marginBottom: 80 }}>
              <TextInput
                value={myTitle}
                onChangeText={setMyTitle}
                placeholder="루틴 제목 (예: 오답 노트 정리 루틴)"
                style={{
                  height: 40,
                  borderWidth: 1,
                  borderColor: '#00000066',
                  marginBottom: 10,
                  borderRadius: 8,
                  paddingHorizontal: 10,
                  backgroundColor: '#fff',
                }}
              />

              {/* 해시태그: 칩 선택만 (자유 입력 제거) */}
              <Text style={{ marginBottom: 8, fontWeight: '600' }}>태그 선택</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
                {RECOMMENDED_TAGS.map((tag) => {
                  const active = selectedCreateTags.includes(tag);
                  return (
                    <TouchableOpacity
                      key={tag}
                      onPress={() => toggleCreateTag(tag)}
                      style={{
                        paddingHorizontal: 10,
                        paddingVertical: 6,
                        borderRadius: 20,
                        borderWidth: 1,
                        borderColor: '#059669',
                        backgroundColor: active ? '#059669' : '#fff',
                      }}
                    >
                      <Text style={{ color: active ? '#fff' : '#059669' }}>{tag}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              {/* 단계 입력 */}
              <View style={{ marginBottom: 10, padding: 10, backgroundColor: '#F0F9FF', borderRadius: 12 }}>
                <Text style={{ fontSize: 14, fontWeight: '600', marginBottom: 6 }}>루틴 단계 추가</Text>

                <View style={{ flexDirection: 'row', marginBottom: 10 }}>
                  <TextInput
                    value={stepInput}
                    onChangeText={setStepInput}
                    placeholder="단계 이름"
                    style={{
                      flex: 2,
                      height: 44,
                      borderWidth: 1,
                      borderColor: '#CBD5E1',
                      borderRadius: 8,
                      paddingHorizontal: 12,
                      backgroundColor: '#F9FAFB',
                      marginRight: 6,
                      color: '#111827',
                    }}
                    placeholderTextColor="#9CA3AF"
                  />
                  <TextInput
                    value={stepMinutes}
                    onChangeText={setStepMinutes}
                    placeholder="분"
                    keyboardType="numeric"
                    style={{
                      flex: 1,
                      height: 44,
                      borderWidth: 1,
                      borderColor: '#CBD5E1',
                      borderRadius: 8,
                      paddingHorizontal: 12,
                      backgroundColor: '#F9FAFB',
                      marginRight: 6,
                      color: '#111827',
                    }}
                    placeholderTextColor="#9CA3AF"
                  />
                  <TouchableOpacity
                    onPress={() => {
                      if (!stepInput.trim() || isNaN(Number(stepMinutes))) return;
                      const newStep = { step: stepInput.trim(), minutes: Number(stepMinutes) };
                      setStepList((prev) => [...prev, newStep]);
                      setStepInput('');
                      setStepMinutes('');
                    }}
                    style={{
                      backgroundColor: '#10B981',
                      borderRadius: 8,
                      paddingHorizontal: 14,
                      justifyContent: 'center',
                      height: 44,
                    }}
                  >
                    <Text style={{ color: '#fff', fontWeight: '600' }}>추가</Text>
                  </TouchableOpacity>
                </View>

                {stepList.map((s, i) => (
                  <View
                    key={i}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      paddingVertical: 8,
                      paddingHorizontal: 14,
                      backgroundColor: '#FFFFFF',
                      borderRadius: 8,
                      marginBottom: 6,
                      borderWidth: 1,
                      borderColor: '#E5E7EB',
                    }}
                  >
                    <Text style={{ color: '#1F2937' }}>
                      {s.step} - {s.minutes}분
                    </Text>
                    <TouchableOpacity
                      onPress={() => {
                        setStepList((prev) => prev.filter((_, idx) => idx !== i));
                      }}
                    >
                      <Ionicons name="close-circle" size={20} color="#EF4444" />
                    </TouchableOpacity>
                  </View>
                ))}
              </View>

              <TouchableOpacity
                onPress={handleAddRoutine}
                style={{
                  backgroundColor: '#3B82F6',
                  height: 40,
                  borderRadius: 12,
                  justifyContent: 'center',
                  alignItems: 'center',
                  marginTop: 10,
                }}
              >
                <Text style={{ color: '#fff', fontWeight: '600' }}>루틴 추가하기</Text>
              </TouchableOpacity>
              {showMessage && (
                <Text style={{ marginTop: 10, color: '#059669', textAlign: 'center' }}>
                  ✅ 루틴이 추가되었습니다!
                </Text>
              )}
            </View>
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
