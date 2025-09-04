import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
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

// ✅ 기본 제공 루틴 (수정 없이 고정)
const PRESET_ROUTINES: Routine[] = [
  {
    id: 'preset-2',
    title: '영단어 암기 루틴',
    steps: [
      { step: '영단어 외우기', minutes: 20 },
      { step: '예문 만들기', minutes: 15 },
      { step: '퀴즈 테스트 해보기 1분', minutes: 10 },
    ],
    tags: ['#암기', '#영어'],
    origin: 'preset',
  },
  {
    id: 'preset-3',
    title: '오답 집중 루틴',
    steps: [
      { step: '최근 오답 복습', minutes: 20 },
      { step: '비슷한 유형 문제 다시 풀기', minutes: 25 },
      { step: '정답/오답 비교 정리', minutes: 15 },
    ],
    tags: ['#문제풀이', '#복습정리'],
    origin: 'preset',
  },
  {
    id: 'preset-4',
    title: '시험 전날 총정리 루틴',
    steps: [
      { step: '전체 범위 핵심 정리', minutes: 40 },
      { step: '예상 문제 풀기', minutes: 30 },
      { step: '오답 노트 만들기', minutes: 20 },
    ],
    tags: ['#시험준비', '#복습정리'],
    origin: 'preset',
  },
  {
    id: 'preset-5',
    title: '내가 만든 문제 루틴',
    steps: [
      { step: '중요 개념 1개 고르기', minutes: 5 },
      { step: '문제 만들기', minutes: 10 },
      { step: '직접 풀고 해설 달기', minutes: 15 },
    ],
    tags: ['#개념이해'],
    origin: 'preset',
  },
  {
    id: 'preset-6',
    title: '수학 서술형 루틴',
    steps: [
      { step: '서술형 문제 3개 풀기', minutes: 20 },
      { step: '풀이 과정 점검', minutes: 10 },
      { step: '모범답안과 비교', minutes: 10 },
    ],
    tags: ['#문제풀이'],
    origin: 'preset',
  },
  {
    id: 'preset-7',
    title: '국어 문법 루틴',
    steps: [
      { step: '문법 개념 정리', minutes: 15 },
      { step: '문제 적용', minutes: 15 },
      { step: '틀린 문법 다시 암기', minutes: 10 },
    ],
    tags: ['#개념이해'],
    origin: 'preset',
  },
  {
    id: 'preset-8',
    title: '비문학 분석 루틴',
    steps: [
      { step: '지문 1개 읽기', minutes: 10 },
      { step: '글 구조 그리기', minutes: 10 },
      { step: '문제 풀이 + 해설 확인', minutes: 10 },
    ],
    tags: ['#개념이해'],
    origin: 'preset',
  },
  {
    id: 'preset-10',
    title: '빠른 오답 다시보기 루틴',
    steps: [
      { step: '지난 오답노트 빠르게 훑기', minutes: 10 },
      { step: '틀렸던 이유 요약', minutes: 5 },
      { step: '비슷한 문제 1개 풀기', minutes: 5 },
    ],
    tags: ['#복습정리'],
    origin: 'preset',
  },
  {
    id: 'preset-11',
    title: '모르는 것만 모으는 루틴',
    steps: [
      { step: '공부하다 모르는 것 따로 표시', minutes: 5 },
      { step: '모음 정리노트 만들기', minutes: 15 },
      { step: '정답 찾아서 복습', minutes: 10 },
    ],
    tags: ['#복습정리'],
    origin: 'preset',
  },
  {
    id: 'preset-12',
    title: '수학 스스로 설명 루틴 (Feynman Technique)',
    steps: [
      { step: '수학 개념 하나 선택', minutes: 5 },
      { step: '초등학생에게 설명하듯 써보기', minutes: 10 },
      { step: '부족한 부분 다시 학습', minutes: 10 },
    ],
    tags: ['#개념이해', '#자기주도'],
    origin: 'preset',
  },
  {
    id: 'preset-13',
    title: '핵심 개념 정리 루틴',
    steps: [
      { step: '개념 하나 선택', minutes: 5 },
      { step: '핵심 문장 3줄로 정리', minutes: 10 },
      { step: '예시 추가 및 노트 정리', minutes: 10 },
    ],
    tags: ['#개념이해'],
    origin: 'preset',
  },
  {
    id: 'preset-15',
    title: '유형별 문제 루틴',
    steps: [
      { step: '집중하고 싶은 문제 유형 선정', minutes: 5 },
      { step: '유형에 맞는 문제 풀이', minutes: 25 },
    ],
    tags: ['#문제풀이'],
    origin: 'preset',
  },
  {
    id: 'preset-16',
    title: '실전 모드 루틴',
    steps: [
      { step: '시험지 형식 문제 세트 풀기', minutes: 30 },
      { step: '채점 및 오답 분석', minutes: 10 },
    ],
    tags: ['#문제풀이'],
    origin: 'preset',
  },

  {
    id: 'preset-19',
    title: '스스로 출제 루틴',
    steps: [
      { step: '암기 내용 기반 문제 만들기', minutes: 10 },
      { step: '직접 풀고 정답 확인 및 수정', minutes: 10 },
    ],
    tags: ['#암기'],
    origin: 'preset',
  },
  {
    id: 'preset-20',
    title: '단어장 복습 루틴',
    steps: [
      { step: '외운 단어 10개 랜덤 테스트', minutes: 10 },
      { step: '틀린 단어 집중 암기', minutes: 10 },
    ],
    tags: ['#암기'],
    origin: 'preset',
  },
];

export default function RoutinePage() {
  const router = useRouter();

  // ==== UI 상태 ====
  const [search, setSearch] = useState('');
  const [activeTab, setActiveTab] = useState<'all' | 'preset' | 'mine'>('all');
  const [selectedTag, setSelectedTag] = useState<string>('');

  // ==== 커스텀 루틴 입력 ====
  const [myTitle, setMyTitle] = useState('');
  const [myTags, setMyTags] = useState('');
  const [stepInput, setStepInput] = useState('');
  const [stepMinutes, setStepMinutes] = useState('');
  const [stepList, setStepList] = useState<Step[]>([]);
  const [showMessage, setShowMessage] = useState(false);

  // ==== 데이터 ====
  const [userRoutines, setUserRoutines] = useState<Routine[]>([]);

  // ✅ 스크롤 & 키보드 회피 추가
  const scrollRef = useRef<ScrollView | null>(null);
  const scrollToEnd = () => {
    requestAnimationFrame(() => {
      scrollRef.current?.scrollToEnd({ animated: true });
    });
  };
  const KEYBOARD_OFFSET = Platform.OS === 'ios' ? 80 : 0; // 필요 시 72~96 사이로 조정

  // 초기 로드: 내 루틴 불러오기
  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        if (raw) {
          const parsed: Routine[] = JSON.parse(raw);
          setUserRoutines(parsed);
        }
      } catch (e) {
        console.log('load user routines error', e);
      }
    })();
  }, []);

  // 저장 헬퍼
  const saveUserRoutines = async (arr: Routine[]) => {
    setUserRoutines(arr);
    try {
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(arr));
    } catch (e) {
      console.log('save user routines error', e);
    }
  };

  const allRoutines = useMemo(() => [...PRESET_ROUTINES, ...userRoutines], [userRoutines]);

  // 검색/태그/탭 필터
  const listToShow = useMemo(() => {
    let base: Routine[] =
      activeTab === 'preset' ? PRESET_ROUTINES :
      activeTab === 'mine' ? userRoutines :
      allRoutines;

    if (selectedTag) {
      base = base.filter(r => r.tags.includes(selectedTag));
    }
    if (search.trim()) {
      base = base.filter(
        r => r.title.includes(search.trim()) || r.tags.some(t => t.includes(search.trim()))
      );
    }
    return base;
  }, [activeTab, selectedTag, search, userRoutines]);

  const tagChips = ['#개념이해', '#문제풀이', '#암기', '#복습정리'];

  const handleAddRoutine = async () => {
    if (!myTitle.trim() || stepList.length === 0) {
      Alert.alert('❗', '제목과 단계는 필수입니다!');
      return;
    }
    const newItem: Routine = {
      id: `mine-${Date.now()}`,
      title: myTitle.trim(),
      steps: stepList,
      tags: myTags
        .split(' ')
        .map(s => s.trim())
        .filter(s => s.startsWith('#') && s.length > 1),
      origin: 'custom',
    };
    const next = [...userRoutines, newItem];
    await saveUserRoutines(next);

    setMyTitle('');
    setMyTags('');
    setStepList([]);
    setShowMessage(true);
    setActiveTab('mine');
    setTimeout(() => setShowMessage(false), 1800);
  };

  const handleDeleteMine = async (id: string) => {
    const next = userRoutines.filter(r => r.id !== id);
    await saveUserRoutines(next);
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
        {/* 출처 뱃지 */}
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 }}>
          <Text style={{ fontWeight: 'bold', fontSize: 18 }}>{routine.title}</Text>
          <View
            style={{
              paddingHorizontal: 8,
              paddingVertical: 4,
              backgroundColor: routine.origin === 'preset' ? '#E0E7FF' : '#DBEAFE',
              borderRadius: 999,
            }}
          >
            <Text style={{ fontSize: 12, color: '#1F2937' }}>
              {routine.origin === 'preset' ? '기본' : '내 루틴'}
            </Text>
          </View>
        </View>

        <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: 8 }}>
          {routine.tags.map((tag, j) => (
            <Text key={j} style={{ color: '#059669', fontSize: 14, marginRight: 6, marginBottom: 6 }}>
              {tag}
            </Text>
          ))}
        </View>

        {routine.steps.map((s, idx) => (
          <Text key={idx} style={{ fontSize: 16, marginBottom: 4 }}>
            • {s.step} ({s.minutes}분)
          </Text>
        ))}

        <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
          <TouchableOpacity
            onPress={() =>
              router.push(
                `/routine/run?title=${encodeURIComponent(routine.title)}&steps=${encodeURIComponent(
                  routine.steps.map((s) => `${s.step},${s.minutes}`).join('|')
                )}`
              )
            }
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
        contentContainerStyle={{ paddingBottom: 120 }}  // 하단 여유
        keyboardShouldPersistTaps="handled"
      >
        <Text style={{ fontSize: 22, fontWeight: 'bold', marginBottom: 16, marginTop: 70 }}>
          루틴 목록
        </Text>

        {/* 🔹 세그먼트 탭 */}
        <View style={{ flexDirection: 'row', gap: 8, marginBottom: 14 }}>
          {[
            { key: 'all', label: `모두 (${allRoutines.length})` },
            { key: 'preset', label: `기본 (${PRESET_ROUTINES.length})` },
            { key: 'mine', label: `내 루틴 (${userRoutines.length})` },
          ].map(({ key, label }) => {
            const k = key as 'all' | 'preset' | 'mine';
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

        {/* 🏷️ 태그 필터 */}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 18 }}>
          {tagChips.map((tag) => {
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
          <Text style={{ color: '#6B7280', marginBottom: 20 }}>조건에 맞는 루틴이 없습니다.</Text>
        ) : (
          listToShow.map((r) => <RoutineCard key={r.id} routine={r} />)
        )}

        {/* ======================= 나만의 루틴 만들기 ======================= */}
        <Text style={{ fontSize: 18, fontWeight: '600', marginTop: 30, marginBottom: 10 }}>
          + 나만의 루틴 만들기
        </Text>

        <View style={{ backgroundColor: '#F0F9FF', padding: 20, borderRadius: 16, marginBottom: 100 }}>
          <TextInput
            value={myTitle}
            onChangeText={setMyTitle}
            placeholder="루틴 제목 (예: 오답 노트 정리 루틴)"
            onFocus={scrollToEnd} // ← 포커스 시 하단으로 스크롤
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
          <TextInput
            value={myTags}
            onChangeText={setMyTags}
            placeholder="해시태그 (예: #복습정리 #문제풀이)"
            onFocus={scrollToEnd}
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

          {/* 단계 입력 */}
          <View style={{ marginBottom: 10, padding: 10, backgroundColor: '#F0F9FF', borderRadius: 12 }}>
            <Text style={{ fontSize: 14, fontWeight: '600', marginBottom: 6 }}>루틴 단계 추가</Text>

            <View style={{ flexDirection: 'row', marginBottom: 10 }}>
              <TextInput
                value={stepInput}
                onChangeText={setStepInput}
                placeholder="단계 이름"
                onFocus={scrollToEnd}
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
                onFocus={scrollToEnd}
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
                  // 항목 추가 후에도 하단 보이게
                  scrollToEnd();
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
                    scrollToEnd();
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
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
