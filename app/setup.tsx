// app/setup.tsx
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Picker } from '@react-native-picker/picker';
import { useRouter } from 'expo-router';
import { onAuthStateChanged } from 'firebase/auth';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  AppState,
  AppStateStatus,
  KeyboardAvoidingView,
  Platform,
  SafeAreaView,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { auth } from '../firebaseConfig';

type Priority = '필수' | '중요' | '선택';
type Plan = { id: string; content: string; priority: Priority; done: boolean; createdAt: string };
type PlanStat = { content: string; count: number; lastUsedAt: string };

const PRIORITY_COLOR: Record<Priority, string> = { 필수: '#EF4444', 중요: '#F59E0B', 선택: '#10B981' };
const PICKER_HEIGHT = 230;

// 유저별 키
const k = (base: string, uid: string) => `${base}_${uid}`;

// Keys
const STATS_KEY_BASE = 'recentPlanStats';
const MEMO_KEY_BASE = 'todayMemo';
const PLANS_KEY_BASE = 'todayPlans';
const STUDY_LOG_KEY_BASE = 'studyMinutesLog';
const GOAL_HISTORY_KEY_BASE = 'goalHistory';
const GOAL_GUIDE_DISMISSED_KEY_BASE = 'goalGuideDismissed';
const TODAY_GOAL_MINUTES_KEY_BASE = 'todayGoalMinutes';
const LAST_SETUP_DATE_KEY_BASE = 'lastSetupLogicalDateKST';
const DAY_START_OFFSET_KEY_BASE = 'dayStartOffsetMin';
const DEFAULT_DAY_START_MIN = 240;

// 한국시간 기준 논리적 날짜
function getLogicalDateStringKST(offsetMin: number) {
  const now = new Date();
  const kst = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
  const shifted = new Date(kst.getTime() - (offsetMin || 0) * 60000);
  const y = shifted.getFullYear();
  const m = String(shifted.getMonth() + 1).padStart(2, '0');
  const d = String(shifted.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export default function SetupPage() {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(true);
  const [uid, setUid] = useState<string | null>(null);

  // 단일 화면 + 단계 전환(페이징 없음)
  const [step, setStep] = useState<0 | 1>(0);

  // 타이핑 중 여부(네비 버튼 보호용)
  const [isTyping, setIsTyping] = useState(false);

  // 목표 시간
  const [goalMinutes, setGoalMinutes] = useState(0);
  const [goalHoursWheel, setGoalHoursWheel] = useState(0);
  const [goalMinsWheel, setGoalMinsWheel] = useState(0);

  // 메모/계획
  const [memo, setMemo] = useState('');
  const [planContent, setPlanContent] = useState('');
  const [planPriority, setPlanPriority] = useState<Priority>('중요');
  const [plans, setPlans] = useState<Plan[]>([]);

  // 추천/통계
  const [recommendations, setRecommendations] = useState<PlanStat[]>([]);
  const [recentAvgMin, setRecentAvgMin] = useState<number | null>(null);
  const [favoriteGoalMin, setFavoriteGoalMin] = useState<number | null>(null);

  // 가이드
  const [showPriorityHelp, setShowPriorityHelp] = useState(false);
  const [showGoalGuide, setShowGoalGuide] = useState(true);
  const [guideCollapsed, setGuideCollapsed] = useState(false);
  const [guideDismissed, setGuideDismissed] = useState(false);

  // 내부 레퍼런스
  const lastLogicalDateRef = useRef<string>('');
  const dayOffsetRef = useRef<number>(DEFAULT_DAY_START_MIN);

  // 로그인 확인
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      if (!user) {
        setUid(null);
        router.replace('/login');
        setIsLoading(false);
        return;
      }
      setUid(user.uid);
      setIsLoading(false);
    });
    return unsub;
  }, []);

  // 오프셋 로드
  const loadDayOffset = async (_uid: string) => {
    const raw = await AsyncStorage.getItem(k(DAY_START_OFFSET_KEY_BASE, _uid));
    const v = Number(raw);
    dayOffsetRef.current = Number.isFinite(v) ? v : DEFAULT_DAY_START_MIN;
  };

  // 추천/평균/최애 로더
  const loadRecommendations = async (_uid: string) => {
    try {
      const raw = await AsyncStorage.getItem(k(STATS_KEY_BASE, _uid));
      if (!raw) return setRecommendations([]);
      const all = JSON.parse(raw) as PlanStat[];
      const now = Date.now();
      const top3 = all
        .map((s) => {
          const days = Math.max(1, Math.floor((now - new Date(s.lastUsedAt).getTime()) / 86400000));
          const recencyBonus = Math.max(0, 14 - days);
          return { ...s, score: s.count * 2 + recencyBonus };
        })
        .sort((a: any, b: any) => b.score - a.score)
        .slice(0, 3);
      setRecommendations(top3);
    } catch {
      setRecommendations([]);
    }
  };

  const loadRecentAvg = async (_uid: string) => {
    try {
      const raw = await AsyncStorage.getItem(k(STUDY_LOG_KEY_BASE, _uid));
      if (!raw) return setRecentAvgMin(null);
      const arr = JSON.parse(raw) as { date: string; minutes: number }[];
      const last7 = arr.slice(-7);
      if (last7.length === 0) return setRecentAvgMin(null);
      const sum = last7.reduce((acc, cur) => acc + (cur.minutes || 0), 0);
      setRecentAvgMin(Math.round(sum / last7.length));
    } catch {
      setRecentAvgMin(null);
    }
  };

  const loadFavoriteGoal = async (_uid: string) => {
    try {
      const raw = await AsyncStorage.getItem(k(GOAL_HISTORY_KEY_BASE, _uid));
      if (!raw) return setFavoriteGoalMin(null);
      const histRaw = JSON.parse(raw) as any[];
      const hist = (Array.isArray(histRaw) ? histRaw : []).map(Number).filter((n) => Number.isFinite(n) && n > 0);
      if (hist.length === 0) return setFavoriteGoalMin(null);
      const counts = new Map<number, number>();
      hist.forEach((m) => counts.set(m, (counts.get(m) || 0) + 1));
      let bestVal = hist[hist.length - 1];
      let bestCnt = -1;
      counts.forEach((cnt, val) => {
        if (cnt > bestCnt || (cnt === bestCnt && hist.lastIndexOf(val) > hist.lastIndexOf(bestVal))) {
          bestCnt = cnt;
          bestVal = val;
        }
      });
      setFavoriteGoalMin(bestVal);
    } catch {
      setFavoriteGoalMin(null);
    }
  };

  // 오늘 초기화
  const resetForNewLogicalDay = async (_uid: string, todayLogical: string) => {
    await AsyncStorage.multiRemove([
      k(TODAY_GOAL_MINUTES_KEY_BASE, _uid),
      k(MEMO_KEY_BASE, _uid),
      k(PLANS_KEY_BASE, _uid),
    ]);
    await AsyncStorage.setItem(k(LAST_SETUP_DATE_KEY_BASE, _uid), todayLogical);

    setGoalMinutes(0);
    setGoalHoursWheel(0);
    setGoalMinsWheel(0);
    setMemo('');
    setPlans([]);

    const dismissed = await AsyncStorage.getItem(k(GOAL_GUIDE_DISMISSED_KEY_BASE, _uid));
    const isDismissed = dismissed === '1';
    setGuideDismissed(isDismissed);
    setShowGoalGuide(!isDismissed);
    setGuideCollapsed(false);

    await Promise.all([loadRecommendations(_uid), loadRecentAvg(_uid), loadFavoriteGoal(_uid)]);
  };

  // 로드 + 날짜확인
  const ensureFreshDayAndLoad = async (_uid: string) => {
    await loadDayOffset(_uid);
    const offset = dayOffsetRef.current;
    const todayLogical = getLogicalDateStringKST(offset);
    const last = await AsyncStorage.getItem(k(LAST_SETUP_DATE_KEY_BASE, _uid));

    if (last !== todayLogical) {
      await resetForNewLogicalDay(_uid, todayLogical);
    } else {
      const [m, p] = await Promise.all([
        AsyncStorage.getItem(k(MEMO_KEY_BASE, _uid)),
        AsyncStorage.getItem(k(PLANS_KEY_BASE, _uid)),
      ]);
      setGoalMinutes(0);
      setGoalHoursWheel(0);
      setGoalMinsWheel(0);
      if (m) setMemo(m);
      if (p) setPlans(JSON.parse(p) as Plan[]);
      const dismissed = await AsyncStorage.getItem(k(GOAL_GUIDE_DISMISSED_KEY_BASE, _uid));
      const isDismissed = dismissed === '1';
      setGuideDismissed(isDismissed);
      setShowGoalGuide(!isDismissed);
      setGuideCollapsed(false);
    }
    lastLogicalDateRef.current = todayLogical;
    await Promise.all([loadRecommendations(_uid), loadRecentAvg(_uid), loadFavoriteGoal(_uid)]);
  };

  useEffect(() => {
    if (!uid) return;
    (async () => {
      try {
        await ensureFreshDayAndLoad(uid);
      } catch {}
    })();
  }, [uid]);

  // 앱 복귀 시 날짜 재확인
  useEffect(() => {
    if (!uid) return;
    const handler = async (state: AppStateStatus) => {
      if (state === 'active') {
        await loadDayOffset(uid);
        const offset = dayOffsetRef.current;
        const todayLogical = getLogicalDateStringKST(offset);
        if (lastLogicalDateRef.current !== todayLogical) {
          await resetForNewLogicalDay(uid, todayLogical);
          lastLogicalDateRef.current = todayLogical;
        }
      }
    };
    const sub = AppState.addEventListener('change', handler);
    return () => sub.remove();
  }, [uid]);

  // 자정 경계 체크
  useEffect(() => {
    if (!uid) return;
    const id = setInterval(async () => {
      const offset = dayOffsetRef.current;
      const todayLogical = getLogicalDateStringKST(offset);
      if (todayLogical !== lastLogicalDateRef.current) {
        await resetForNewLogicalDay(uid, todayLogical);
        lastLogicalDateRef.current = todayLogical;
      }
    }, 60 * 1000);
    return () => clearInterval(id);
  }, [uid]);

  // 휠 → 총 분
  useEffect(() => {
    setGoalMinutes(goalHoursWheel * 60 + goalMinsWheel);
  }, [goalHoursWheel, goalMinsWheel]);

  const setGoalByMinutes = (m: number) => {
    const clamped = Math.max(0, Math.min(m, 10 * 60 + 59));
    setGoalHoursWheel(Math.floor(clamped / 60));
    setGoalMinsWheel(clamped % 60);
  };

  const feedback = useMemo(() => {
    if (goalMinutes === 0) return '아직 목표 시간이 없어요. 오늘의 목표를 설정해볼까요? ';
    if (goalMinutes <= 59) return '';
    if (goalMinutes <= 119) return '1시간, 가볍게 시작해봐요 ';
    if (goalMinutes <= 179) return '2시간, 집중해서 끝내봅시다 ';
    if (goalMinutes <= 239) return '3시간, 핵심 과목 완성하기 ';
    if (goalMinutes <= 299) return '4시간, 오늘 계획의 절반 완성 ';
    if (goalMinutes <= 359) return '5시간, 강력한 몰입 타임 ';
    if (goalMinutes <= 419) return '6시간, 페이스 유지하며 꾸준히 ';
    if (goalMinutes <= 479) return '7시간, 장기전의 핵심 구간이에요 ';
    if (goalMinutes <= 539) return '8시간, 하루 마스터 코스 ';
    if (goalMinutes <= 599) return '9시간, 막판 스퍼트! ';
    return '10시간, 체력 관리가 필수 🙌';
  }, [goalMinutes]);

  // 통계 누적
  const bumpStat = async (content: string) => {
    if (!uid) return;
    try {
      const raw = await AsyncStorage.getItem(k(STATS_KEY_BASE, uid));
      let stats: PlanStat[] = raw ? JSON.parse(raw) : [];
      const idx = stats.findIndex((s) => s.content === content);
      const nowIso = new Date().toISOString();
      if (idx >= 0) {
        stats[idx] = { ...stats[idx], count: Math.min(100, stats[idx].count + 1), lastUsedAt: nowIso };
      } else {
        stats.unshift({ content, count: 1, lastUsedAt: nowIso });
      }
      await AsyncStorage.setItem(k(STATS_KEY_BASE, uid), JSON.stringify(stats));
    } catch {}
  };

  const addPlan = async () => {
    const trimmed = planContent.trim();
    if (!trimmed) return Alert.alert('입력 필요', '공부 내용을 입력하세요.');
    if (trimmed.length > 80) return Alert.alert('글자 수 초과', '공부 내용은 80자 이내로 입력해 주세요.');
    const newItem: Plan = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      content: trimmed,
      priority: planPriority,
      done: false,
      createdAt: new Date().toISOString(),
    };
    setPlans((prev) => [newItem, ...prev]);
    setPlanContent('');
    await bumpStat(trimmed);
    if (uid) await loadRecommendations(uid);
  };

  const deletePlan = (id: string) => setPlans((prev) => prev.filter((p) => p.id !== id));
  const cyclePriority = (p: Priority): Priority => (p === '필수' ? '중요' : p === '중요' ? '선택' : '필수');
  const changePriority = (id: string) =>
    setPlans((prev) => prev.map((p) => (p.id === id ? { ...p, priority: cyclePriority(p.priority) } : p)));

  const handleSaveAndStart = async () => {
    if (!uid) return;
    const memoTrimmed = memo.trim();
    if (memoTrimmed.length > 80) {
      Alert.alert('메모가 너무 길어요', '메모는 80자 이내로 작성해 주세요.');
      return;
    }
    try {
      await AsyncStorage.setItem(k(TODAY_GOAL_MINUTES_KEY_BASE, uid), String(goalMinutes));
      await AsyncStorage.setItem(k(MEMO_KEY_BASE, uid), memoTrimmed);
      await AsyncStorage.setItem(k(PLANS_KEY_BASE, uid), JSON.stringify(plans));
      const offset = dayOffsetRef.current;
      await AsyncStorage.setItem(k(LAST_SETUP_DATE_KEY_BASE, uid), getLogicalDateStringKST(offset));
      try {
        const raw = await AsyncStorage.getItem(k(GOAL_HISTORY_KEY_BASE, uid));
        const hist = raw ? (JSON.parse(raw) as number[]) : [];
        hist.push(goalMinutes);
        const trimmed = hist.slice(-50);
        await AsyncStorage.setItem(k(GOAL_HISTORY_KEY_BASE, uid), JSON.stringify(trimmed));
      } catch {}
      router.replace('/home');
    } catch (err) {
      console.error(err);
      Alert.alert('저장 실패', '저장 중 문제가 발생했습니다.');
    }
  };

  if (isLoading || !uid) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#fff' }}>
        <ActivityIndicator size="large" color="#059669" />
      </View>
    );
  }

  const hourOptions = Array.from({ length: 11 }, (_, i) => i);
  const minuteOptions = Array.from({ length: 60 }, (_, i) => i);

  // 공통 카드 컨테이너
  const Card = ({ children, style }: any) => (
    <View
      style={[
        {
          width: '100%',
          backgroundColor: '#FFFFFF',
          borderRadius: 16,
          padding: 16,
          marginBottom: 12,
          shadowColor: '#000',
          shadowOpacity: 0.06,
          shadowRadius: 6,
          shadowOffset: { width: 0, height: 3 },
          elevation: 2,
        },
        style,
      ]}
    >
      {children}
    </View>
  );

  const KEYBOARD_OFFSET = Platform.select({ ios: 88, android: 0 }) as number;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#FFFFFF' }}>
      {/* 상단 타이틀 */}
      <View style={{ paddingHorizontal: 24, paddingTop: 8, paddingBottom: 12 }}>
        <Text style={{ fontSize: 24, fontWeight: 'bold' }}>오늘의 공부 계획</Text>
      </View>

      {/* 단일 스크롤 + 단계 조건부 렌더링 */}
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={KEYBOARD_OFFSET}
      >
        <ScrollView
          style={{ flex: 1, paddingHorizontal: 24 }}
          contentContainerStyle={{ paddingBottom: 140 }}
          keyboardShouldPersistTaps="always"
        >
          {step === 0 ? (
            // ===== Step 0: 목표 시간 =====
            <View>
              <Card style={{ marginTop: 12 }}>
                <Text style={{ fontSize: 16, fontWeight: '700', marginBottom: 12, marginTop: 5 }}> 오늘 목표 공부 시간</Text>

                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                  {/* Hours */}
                  <View style={{ flex: 1, alignItems: 'center' }}>
                    <Text style={{ marginBottom: 8, color: '#6B7280' }}>시간</Text>
                    <Picker
                      selectedValue={goalHoursWheel}
                      onValueChange={(v) => setGoalHoursWheel(Number(v))}
                      itemStyle={{ color: '#111827', fontSize: 18 }}
                      style={{ width: '100%', height: PICKER_HEIGHT }}
                    >
                      {hourOptions.map((h) => (
                        <Picker.Item key={h} label={`${h}`} value={h} color="#111827" />
                      ))}
                    </Picker>
                  </View>

                  <Text style={{ width: 24, textAlign: 'center', fontSize: 18, fontWeight: '700' }}>:</Text>

                  {/* Minutes */}
                  <View style={{ flex: 1, alignItems: 'center' }}>
                    <Text style={{ marginBottom: 8, color: '#6B7280' }}>분</Text>
                    <Picker
                      selectedValue={goalMinsWheel}
                      onValueChange={(v) => setGoalMinsWheel(Number(v))}
                      itemStyle={{ color: '#111827', fontSize: 18 }}
                      style={{ width: '100%', height: PICKER_HEIGHT }}
                    >
                      {minuteOptions.map((m) => (
                        <Picker.Item key={m} label={`${m}`} value={m} color="#111827" />
                      ))}
                    </Picker>
                  </View>
                </View>

                <View style={{ marginTop: 12, marginBottom: 20 }}>
                  <Text style={{ fontSize: 16, fontWeight: '700', marginBottom: 4 }}>
                    현재 목표: {goalHoursWheel}시간 {goalMinsWheel}분
                  </Text>
                  <Text style={{ fontSize: 14, color: '#3B82F6' }}>{feedback}</Text>
                </View>

                {/* 추천 목표 */}
                <View style={{ marginTop: 16 }}>
                  <Text style={{ fontSize: 14, fontWeight: '700', marginBottom: 8 }}>추천 목표 시간</Text>

                  {/* 최근 평균 */}
                  <View style={recommendBoxStyle}>
                    <View>
                      <Text style={{ fontSize: 13, color: '#6B7280' }}>최근 7일 평균</Text>
                      <Text style={{ fontSize: 15, fontWeight: '700' }}>
                        {recentAvgMin == null
                          ? '데이터 없음'
                          : `${Math.floor(recentAvgMin / 60)}시간${recentAvgMin % 60 ? ` ${recentAvgMin % 60}분` : ''}`}
                      </Text>
                    </View>
                    <TouchableOpacity
                      onPress={() => recentAvgMin != null && setGoalByMinutes(recentAvgMin)}
                      disabled={recentAvgMin == null}
                      style={{
                        backgroundColor: recentAvgMin == null ? '#D1D5DB' : '#3B82F6',
                        paddingHorizontal: 12,
                        paddingVertical: 8,
                        borderRadius: 10,
                      }}
                    >
                      <Text style={{ color: '#fff', fontWeight: '700' }}>적용</Text>
                    </TouchableOpacity>
                  </View>

                  {/* 최애 목표 */}
                  <View style={[recommendBoxStyle, { marginBottom: 20 }]}>
                    <View>
                      <Text style={{ fontSize: 13, color: '#6B7280' }}>자주 설정한 목표</Text>
                      <Text style={{ fontSize: 15, fontWeight: '700' }}>
                        {favoriteGoalMin == null
                          ? '기록 없음'
                          : `${Math.floor(favoriteGoalMin / 60)}시간${
                              favoriteGoalMin % 60 ? ` ${favoriteGoalMin % 60}분` : ''
                            }`}
                      </Text>
                    </View>
                    <TouchableOpacity
                      onPress={() => favoriteGoalMin != null && setGoalByMinutes(favoriteGoalMin)}
                      disabled={favoriteGoalMin == null}
                      style={{
                        backgroundColor: favoriteGoalMin == null ? '#D1D5DB' : '#10B981',
                        paddingHorizontal: 12,
                        paddingVertical: 8,
                        borderRadius: 10,
                      }}
                    >
                      <Text style={{ color: '#fff', fontWeight: '700' }}>적용</Text>
                    </TouchableOpacity>
                  </View>
                </View>

                {/* 목표 시간 가이드 */}
                {!guideDismissed && (
                  <>
                    {showGoalGuide && (
                      <View style={{ marginTop: 16 }}>
                        <Text style={{ fontSize: 14, fontWeight: '700', marginBottom: 8 }}>목표 시간 가이드</Text>

                        <View
                          style={{
                            backgroundColor: '#F9FAFB',
                            borderRadius: 12,
                            borderWidth: 1,
                            borderColor: '#E5E7EB',
                            padding: 12,
                          }}
                        >
                          <Text style={{ fontSize: 14 }}>
                            <Text style={{ fontWeight: '700' }}>공부 시간 설정을 도와주는 가이드 입니다</Text>
                          </Text>

                          <View style={{ marginTop: 8 }}>
                            <Point text="추천 목표 → 적용버튼 누르면 휠에 즉시 반영되요" />
                            <Point text="처음엔 낮게 시작하고, 내일 조금씩 ↑ (지속가능이 최우선)" />
                            <Point text="시험·숙제 등 상황에 맞춰 유연하게 조정해봐요 " />
                          </View>

                          <View style={{ marginTop: 12 }}>
                            <Text style={{ fontSize: 13, fontWeight: '700', marginBottom: 6 }}>상황별 추천 목표 시간</Text>
                            <MiniHint title="시험 대비" value="4–6시간+" />
                            <MiniHint title="과제 수행" value="2–3시간" />
                            <MiniHint title="개념 복습" value="1–2시간" />
                          </View>

                          <View style={{ flexDirection: 'row', marginTop: 12, gap: 8 }}>
                            <TouchableOpacity onPress={() => { setShowGoalGuide(false); setGuideCollapsed(true); }} style={chipBtn('#E5E7EB')}>
                              <Text style={{ fontWeight: '700', color: '#111827' }}>가이드 접기 ∨</Text>
                            </TouchableOpacity>
                            <TouchableOpacity onPress={async () => {
                              if (!uid) return;
                              try { await AsyncStorage.setItem(k(GOAL_GUIDE_DISMISSED_KEY_BASE, uid), '1'); } catch {}
                              setShowGoalGuide(false); setGuideCollapsed(false); setGuideDismissed(true);
                            }} style={chipBtn('#111827')}>
                              <Text style={{ fontWeight: '700', color: '#fff' }}>다음부터 보지 않기</Text>
                            </TouchableOpacity>
                          </View>
                        </View>
                      </View>
                    )}

                    {guideCollapsed && (
                      <TouchableOpacity
                        onPress={() => { setShowGoalGuide(true); setGuideCollapsed(false); }}
                        activeOpacity={0.7}
                        style={{
                          marginTop: 8,
                          alignSelf: 'center',
                          backgroundColor: '#F3F4F6',
                          borderRadius: 999,
                          paddingVertical: 6,
                          paddingHorizontal: 12,
                          borderWidth: 1,
                          borderColor: '#E5E7EB',
                        }}
                      >
                        <Text style={{ fontSize: 12, color: '#374151' }}>가이드 열기 ∨</Text>
                      </TouchableOpacity>
                    )}
                  </>
                )}
              </Card>
            </View>
          ) : (
            // ===== Step 1: 메모 + 계획 =====
            <View>
              {/* 학습 메모 */}
              <Card style={{ marginTop: 12 }}>
                <Text style={{ fontSize: 16, fontWeight: '700', marginBottom: 10 }}> 오늘의 학습 메모</Text>
                <TextInput
                  value={memo}
                  onChangeText={setMemo}
                  placeholder="예: 과학 수행평가 자료 챙기기"
                  style={{ backgroundColor: '#F3F4F6', borderRadius: 10, padding: 12, fontSize: 16 }}
                  autoCorrect={false}
                  autoCapitalize="none"
                  blurOnSubmit={false}
                  returnKeyType="done"
                  onFocus={() => setIsTyping(true)}
                  onBlur={() => setIsTyping(false)}
                />
              </Card>

              {/* 공부 계획 */}
              <Card>
                <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12 }}>
                  <Text style={{ flex: 1, fontSize: 16, fontWeight: '700' }}>📚 오늘의 공부 계획</Text>
                  <TouchableOpacity onPress={() => setShowPriorityHelp((v) => !v)} activeOpacity={0.7}>
                    <Text style={{ color: '#3B82F6', fontWeight: '700' }}>
                      {showPriorityHelp ? '기준 닫기' : '중요도 기준 보기'}
                    </Text>
                  </TouchableOpacity>
                </View>

                {showPriorityHelp && (
                  <View
                    style={{
                      backgroundColor: '#F9FAFB',
                      borderRadius: 12,
                      padding: 12,
                      marginBottom: 10,
                      borderWidth: 1,
                      borderColor: '#E5E7EB',
                    }}
                  >
                    <RowDot text="필수" color={PRIORITY_COLOR['필수']} desc="오늘 반드시 해야 하는 핵심 학습 (숙제/시험 대비/필수 진도)" />
                    <RowDot text="중요" color={PRIORITY_COLOR['중요']} desc="오늘 진행하면 좋은 학습 (개념 복습/오답 정리)" />
                    <RowDot text="선택" color={PRIORITY_COLOR['선택']} desc="여유 있을 때 하면 좋은 학습 (추가 문제/심화/예습)" last />
                  </View>
                )}

                {/* 입력 + 추가 */}
                <View style={{ flexDirection: 'row', marginBottom: 10 }}>
                  <TextInput
                    placeholder="예: 수학 문제집 3p 풀기"
                    value={planContent}
                    onChangeText={setPlanContent}
                    style={{
                      flex: 1,
                      backgroundColor: '#F3F4F6',
                      borderRadius: 10,
                      padding: 12,
                      fontSize: 16,
                      marginRight: 8,
                    }}
                    autoCorrect={false}
                    autoCapitalize="none"
                    onSubmitEditing={addPlan}
                    returnKeyType="done"
                    blurOnSubmit={false}
                    onFocus={() => setIsTyping(true)}
                    onBlur={() => setIsTyping(false)}
                  />
                  <TouchableOpacity
                    onPress={addPlan}
                    style={{ backgroundColor: '#3B82F6', paddingHorizontal: 16, justifyContent: 'center', borderRadius: 10 }}
                  >
                    <Text style={{ color: '#fff', fontWeight: '700' }}>추가</Text>
                  </TouchableOpacity>
                </View>

                {/* 중요도 칩 */}
                <View style={{ flexDirection: 'row', marginBottom: 6 }}>
                  {(['필수', '중요', '선택'] as Priority[]).map((p, idx) => {
                    const selected = planPriority === p;
                    return (
                      <TouchableOpacity
                        key={p}
                        onPress={() => setPlanPriority(p)}
                        activeOpacity={0.7}
                        style={{
                          flexBasis: 0,
                          flexGrow: 1,
                          minWidth: 0,
                          height: 44,
                          borderRadius: 12,
                          borderWidth: 1.5,
                          borderColor: selected ? PRIORITY_COLOR[p] : '#E5E7EB',
                          backgroundColor: selected ? '#FFF7ED' : '#FFFFFF',
                          alignItems: 'center',
                          justifyContent: 'center',
                          paddingHorizontal: 10,
                          marginRight: idx < 2 ? 8 : 0,
                        }}
                      >
                        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                          <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: PRIORITY_COLOR[p], marginRight: 6 }} />
                          <Text style={{ fontWeight: '600', color: selected ? PRIORITY_COLOR[p] : '#374151' }}>{p}</Text>
                        </View>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                {/* 추가된 계획 리스트 */}
                <View style={{ marginTop: 10 }}>
                  {plans.length > 0 ? (
                    plans.map((item) => (
                      <View
                        key={item.id}
                        style={{
                          flexDirection: 'row',
                          alignItems: 'center',
                          backgroundColor: '#FFFFFF',
                          borderRadius: 12,
                          paddingHorizontal: 14,
                          paddingVertical: 12,
                          marginBottom: 8,
                          shadowColor: '#000',
                          shadowOpacity: 0.06,
                          shadowRadius: 6,
                          shadowOffset: { width: 0, height: 3 },
                          elevation: 2,
                        }}
                      >
                        <Text style={{ flexShrink: 1, minWidth: 0, flex: 1, fontSize: 16 }} numberOfLines={1} ellipsizeMode="tail">
                          {item.content}
                        </Text>
                        <TouchableOpacity onPress={() => changePriority(item.id)} activeOpacity={0.7} style={{ paddingHorizontal: 4 }}>
                          <View style={{ width: 16, height: 16, borderRadius: 8, backgroundColor: PRIORITY_COLOR[item.priority], marginRight: 10 }} />
                        </TouchableOpacity>
                        <TouchableOpacity onPress={() => deletePlan(item.id)}>
                          <Text style={{ color: '#EF4444', fontWeight: '700' }}>삭제</Text>
                        </TouchableOpacity>
                      </View>
                    ))
                  ) : (
                    <Text style={{ color: '#9CA3AF' }}>아직 오늘의 계획이 없어요. 내용을 입력하고 추가해 보세요.</Text>
                  )}
                </View>
              </Card>
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>

      {/* 하단 고정: 인디케이터 + 내비 버튼 */}
      <View
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          paddingHorizontal: 24,
          paddingTop: 10,
          paddingBottom: 18,
          backgroundColor: '#FFFFFF',
          borderTopWidth: 1,
          borderTopColor: '#E5E7EB',
        }}
        pointerEvents="box-none"
      >
        {/* dots */}
        <View style={{ alignSelf: 'center', flexDirection: 'row', gap: 6, marginBottom: 12 }}>
          <Dot active={step === 0} />
          <Dot active={step === 1} />
        </View>

        {/* buttons */}
        {step === 0 ? (
          <TouchableOpacity
            onPress={() => !isTyping && setStep(1)}
            disabled={isTyping}
            style={{
              backgroundColor: isTyping ? '#9CA3AF' : '#3B82F6',
              paddingVertical: 14,
              borderRadius: 12,
              alignItems: 'center',
            }}
          >
            <Text style={{ color: '#fff', fontSize: 16, fontWeight: 'bold' }}>다음으로 가기</Text>
          </TouchableOpacity>
        ) : (
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <TouchableOpacity
              onPress={() => !isTyping && setStep(0)}
              disabled={isTyping}
              style={{
                flex: 1,
                backgroundColor: isTyping ? '#D1D5DB' : '#E5E7EB',
                paddingVertical: 14,
                borderRadius: 12,
                alignItems: 'center',
              }}
            >
              <Text style={{ color: '#111827', fontSize: 16, fontWeight: 'bold' }}>이전</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={handleSaveAndStart}
              style={{ flex: 2, backgroundColor: '#059669', paddingVertical: 14, borderRadius: 12, alignItems: 'center' }}
            >
              <Text style={{ color: '#fff', fontSize: 16, fontWeight: 'bold' }}>저장하고 시작</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}

const recommendBoxStyle = {
  backgroundColor: '#FFFFFF',
  borderRadius: 12,
  borderWidth: 1,
  borderColor: '#E5E7EB',
  padding: 12,
  marginBottom: 8,
  flexDirection: 'row' as const,
  alignItems: 'center' as const,
  justifyContent: 'space-between' as const,
};

const chipBtn = (bg: string) => ({
  backgroundColor: bg,
  paddingHorizontal: 12,
  paddingVertical: 8,
  borderRadius: 10,
});

function Dot({ active }: { active: boolean }) {
  return (
    <View
      style={{
        width: active ? 18 : 8,
        height: 8,
        borderRadius: 4,
        backgroundColor: active ? '#3B82F6' : '#D1D5DB',
      }}
    />
  );
}

function RowDot({ text, color, desc, last }: { text: string; color: string; desc: string; last?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: last ? 0 : 6 }}>
      <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: color, marginRight: 8 }} />
      <Text style={{ fontSize: 14, fontWeight: '700' }}>{text}</Text>
      <Text style={{ fontSize: 13, color: '#6B7280', marginLeft: 8, flexShrink: 1 }}>{desc}</Text>
    </View>
  );
}

function Point({ text }: { text: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: '#3B82F6', marginRight: 8 }} />
      <Text style={{ fontSize: 13, color: '#374151' }}>{text}</Text>
    </View>
  );
}

function MiniHint({ title, value }: { title: string; value: string }) {
  return (
    <View
      style={{
        flexDirection: 'row',
        justifyContent: 'space-between',
        backgroundColor: '#FFFFFF',
        borderRadius: 10,
        borderWidth: 1,
        borderColor: '#E5E7EB',
        paddingVertical: 10,
        paddingHorizontal: 12,
        marginBottom: 6,
      }}
    >
      <Text style={{ fontSize: 13, color: '#6B7280' }}>{title}</Text>
      <Text style={{ fontSize: 13, fontWeight: '700' }}>{value}</Text>
    </View>
  );
}
