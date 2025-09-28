// app/setup/index.tsx
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Picker } from '@react-native-picker/picker';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { onAuthStateChanged } from 'firebase/auth';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  AppState,
  AppStateStatus,
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import { auth } from '../firebaseConfig';

/* ---------- Types ---------- */
type Priority = '필수' | '중요' | '선택';
type Plan = { id: string; content: string; priority: Priority; done: boolean; createdAt: string };

/* ---------- Design tokens ---------- */
const COLOR_TEXT = '#0F172A';
const COLOR_MUTED = '#6B7280';
const COLOR_SOFT = '#9CA3AF';
const COLOR_LINK = '#2563EB';
const COLOR_BORDER = '#E5E7EB';
const COLOR_BG = '#FFFFFF';
const COLOR_PRIMARY = '#3B82F6';
const COLOR_CARD = '#FFFFFF';

const COLOR_WARN_BG = '#FEF3C7';
const COLOR_WARN_TXT = '#B45309';

const PRIORITY_COLOR: Record<Priority, string> = { 필수: '#EF4444', 중요: '#F59E0B', 선택: '#10B981' };
const PICKER_HEIGHT = 230;

const CARD_SHADOW =
  Platform.OS === 'ios'
    ? { shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 12, shadowOffset: { width: 0, height: 4 } }
    : { elevation: 3 };

/* ---------- uid별 키 ---------- */
const k = (base: string, uid: string) => `${base}_${uid}`;

/* ---------- Base Keys ---------- */
const PLANS_KEY_BASE = 'todayPlans';
const GOAL_KEY_BASE = 'todayGoalMinutes';
const LAST_SETUP_DATE_KEY_BASE = 'lastSetupLogicalDateKST';

// ✅ 목표 시간 통계(최빈값) 저장용
const GOAL_STATS_KEY_BASE = 'goalMinutesStatsV1'; // JSON: { [minutes:string]: number }
const FAVORITE_GOAL_KEY_BASE = 'favoriteGoalMinutesV1'; // number(분)

/* ---------- KST 날짜 ---------- */
function getTodayKST() {
  const now = new Date();
  const kst = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
  const y = kst.getFullYear();
  const m = String(kst.getMonth() + 1).padStart(2, '0');
  const d = String(kst.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/* ---------- Helper ---------- */
function minutesToHourMin(total: number) {
  const safe = Math.max(0, total);
  const h = Math.floor(safe / 60);
  const m = safe % 60;
  return { h, m };
}
function labelFromMinutes(mins: number) {
  const { h, m } = minutesToHourMin(mins);
  if (h === 0) return `${m}분`;
  if (m === 0) return `${h}시간`;
  return `${h}시간 ${m}분`;
}

// 최빈값 계산
function favoriteFromStats(stats: Record<string, number>): number {
  let bestMin = 0;
  let bestCnt = -1;
  for (const [minsStr, cnt] of Object.entries(stats || {})) {
    const mins = parseInt(minsStr, 10) || 0;
    if (cnt > bestCnt || (cnt === bestCnt && mins > bestMin)) {
      bestCnt = cnt;
      bestMin = mins;
    }
  }
  return bestCnt > 0 ? bestMin : 0;
}

export default function SetupScreen() {
  const router = useRouter();
  const { from } = useLocalSearchParams<{ from?: string }>();
  const showBack = from === 'home'; // 홈의 '계획 추가'에서 진입한 경우만 표시

  const [uid, setUid] = useState<string | null>(null);

  /* ---------- 상태 ---------- */
  const [plans, setPlans] = useState<Plan[]>([]);
  const [newPlanText, setNewPlanText] = useState('');
  const [newPlanPriority, setNewPlanPriority] = useState<Priority>('필수');

  // 목표 시간(휠)
  const [hours, setHours] = useState(0);
  const [minutes, setMinutes] = useState(0);

  // 최빈값 기반 "자주 설정한 목표" (없으면 0)
  const [favoriteGoalMins, setFavoriteGoalMins] = useState<number>(0);

  // 슬라이드
  const [pageIndex, setPageIndex] = useState(0);
  const pagerRef = useRef<ScrollView | null>(null);
  const layoutWidthRef = useRef(0);

  // 자정 감지
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ✅ 휠 자동적용 디바운스 타이머
  const autoApplyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* ---------- 로그인 확인 ---------- */
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      if (user?.uid) setUid(user.uid);
      else router.replace('/login');
    });
    return () => unsub();
  }, [router]);

  /* ---------- 날짜 점검 & 필요 시 초기화 ---------- */
  const checkAndResetIfNeeded = useCallback(async () => {
    if (!uid) return;
    const today = getTodayKST();
    const last = await AsyncStorage.getItem(k(LAST_SETUP_DATE_KEY_BASE, uid));
    if (last && last === today) return;

    await AsyncStorage.multiRemove([k(PLANS_KEY_BASE, uid), k(GOAL_KEY_BASE, uid)]);
    await AsyncStorage.setItem(k(LAST_SETUP_DATE_KEY_BASE, uid), today);

    setPlans([]);
    setHours(0);
    setMinutes(0);
  }, [uid]);

  /* ---------- 통계 업데이트 ---------- */
  const updateGoalStats = useCallback(
    async (totalMinutes: number) => {
      if (!uid) return;
      const key = k(GOAL_STATS_KEY_BASE, uid);
      const raw = await AsyncStorage.getItem(key);
      let stats: Record<string, number> = {};
      if (raw) {
        try {
          stats = JSON.parse(raw) || {};
        } catch {
          stats = {};
        }
      }
      const curr = String(totalMinutes);
      stats[curr] = (stats[curr] || 0) + 1;

      const fav = favoriteFromStats(stats);
      await AsyncStorage.setItem(key, JSON.stringify(stats));
      await AsyncStorage.setItem(k(FAVORITE_GOAL_KEY_BASE, uid), String(fav));
      setFavoriteGoalMins(fav);
    },
    [uid]
  );

  /* ---------- 저장값 불러오기 + 첫 로드 시 날짜검사 ---------- */
  useEffect(() => {
    if (!uid) return;
    (async () => {
      await checkAndResetIfNeeded();

      // 계획 복구
      const savedPlans = await AsyncStorage.getItem(k(PLANS_KEY_BASE, uid));
      if (savedPlans) {
        try {
          const parsed = JSON.parse(savedPlans) as Plan[];
          setPlans(Array.isArray(parsed) ? parsed : []);
        } catch {
          setPlans([]);
        }
      } else {
        setPlans([]);
      }

      // 기존 목표 시간(분) → 휠
      const savedGoal = await AsyncStorage.getItem(k(GOAL_KEY_BASE, uid));
      if (savedGoal) {
        const total = Math.max(0, parseInt(savedGoal, 10) || 0);
        const { h, m } = minutesToHourMin(total);
        setHours(h);
        setMinutes(m);
      } else {
        setHours(0);
        setMinutes(0);
      }

      // ✅ 최빈값 불러오기: 없으면 0(= 없음)
      const savedFav = await AsyncStorage.getItem(k(FAVORITE_GOAL_KEY_BASE, uid));
      if (savedFav) {
        setFavoriteGoalMins(Math.max(0, parseInt(savedFav, 10) || 0));
      } else {
        const rawStats = await AsyncStorage.getItem(k(GOAL_STATS_KEY_BASE, uid));
        if (rawStats) {
          try {
            const stats = JSON.parse(rawStats) || {};
            setFavoriteGoalMins(favoriteFromStats(stats)); // 통계가 비었으면 자연히 0
          } catch {
            setFavoriteGoalMins(0);
          }
        } else {
          setFavoriteGoalMins(0);
        }
      }
    })();
  }, [uid, checkAndResetIfNeeded]);

  /* ---------- 앱 포그라운드 복귀 시 날짜 재확인 ---------- */
  useEffect(() => {
    if (!uid) return;
    const onChange = (state: AppStateStatus) => {
      if (state === 'active') checkAndResetIfNeeded();
    };
    const sub = AppState.addEventListener('change', onChange);
    return () => sub.remove();
  }, [uid, checkAndResetIfNeeded]);

  /* ---------- 자정 경과 감지 (1분 주기) ---------- */
  useEffect(() => {
    if (!uid) return;
    if (intervalRef.current) clearInterval(intervalRef.current);
    intervalRef.current = setInterval(() => checkAndResetIfNeeded(), 60 * 1000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      intervalRef.current = null;
    };
  }, [uid, checkAndResetIfNeeded]);

  /* ---------- 계획 추가/삭제/토글 ---------- */
  const addPlan = useCallback(() => {
    const text = newPlanText.trim();
    if (!uid) return;
    if (!text) {
      Alert.alert('알림', '공부 계획 내용을 입력하세요.');
      return;
    }
    const item: Plan = {
      id: `${Date.now()}`,
      content: text,
      priority: newPlanPriority,
      done: false,
      createdAt: new Date().toISOString(),
    };
    setPlans((prev) => [item, ...prev]);
    setNewPlanText('');
    Keyboard.dismiss();
  }, [newPlanText, newPlanPriority, uid]);

  const removePlan = useCallback((id: string) => {
    setPlans((prev) => prev.filter((p) => p.id !== id));
  }, []);

  const toggleDone = useCallback((id: string) => {
    setPlans((prev) => prev.map((p) => (p.id === id ? { ...p, done: !p.done } : p)));
  }, []);

  /* ---------- 저장 (입력창 내용도 함께 저장!) ---------- */
  const savePlansAndGoal = useCallback(async () => {
    if (!uid) return;
    try {
      const totalMinutes = Math.max(0, hours * 60 + minutes);

      // 🔥 패치: 입력창에 남아있는 내용도 강제로 포함
      const withTyping = newPlanText.trim()
        ? [
            {
              id: `${Date.now()}`,
              content: newPlanText.trim(),
              priority: newPlanPriority,
              done: false,
              createdAt: new Date().toISOString(),
            },
            ...plans,
          ]
        : plans;

      await AsyncStorage.setItem(k(PLANS_KEY_BASE, uid), JSON.stringify(withTyping));
      await AsyncStorage.setItem(k(GOAL_KEY_BASE, uid), String(totalMinutes));
      await AsyncStorage.setItem(k(LAST_SETUP_DATE_KEY_BASE, uid), getTodayKST());

      // 통계 갱신(최빈값)
      await updateGoalStats(totalMinutes);

      Alert.alert('저장 완료', '오늘의 설정이 저장되었습니다.');
      router.replace('/home');
    } catch (e) {
      console.error(e);
      Alert.alert('에러', '저장 중 문제가 발생했습니다.');
    }
  }, [uid, plans, newPlanText, newPlanPriority, hours, minutes, router, updateGoalStats]);

  /* ---------- 휠 변경 시 자동 적용(무알림) ---------- */
  const scheduleAutoApply = useCallback(
    async (nextTotalMinutes: number) => {
      if (!uid) return;
      if (autoApplyTimerRef.current) clearTimeout(autoApplyTimerRef.current);
      autoApplyTimerRef.current = setTimeout(async () => {
        try {
          await AsyncStorage.setItem(k(GOAL_KEY_BASE, uid), String(nextTotalMinutes));
          await AsyncStorage.setItem(k(LAST_SETUP_DATE_KEY_BASE, uid), getTodayKST());
          await updateGoalStats(nextTotalMinutes);
        } catch (e) {
          console.error('auto-apply failed', e);
        }
      }, 350);
    },
    [uid, updateGoalStats]
  );

  // 최빈값 적용(휠 값 변경 + 자동적용)
  const applyFavoriteGoal = useCallback(async () => {
    if (favoriteGoalMins <= 0) return; // 없음일 때는 동작 안 함
    const { h, m } = minutesToHourMin(favoriteGoalMins);
    setHours(h);
    setMinutes(m);
    scheduleAutoApply(favoriteGoalMins);
  }, [favoriteGoalMins, scheduleAutoApply]);

  /* ---------- 렌더러 ---------- */
  const renderPlan = ({ item }: { item: Plan }) => (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        borderWidth: 1,
        borderColor: COLOR_BORDER,
        borderRadius: 14,
        padding: 12,
        marginBottom: 10,
        backgroundColor: COLOR_CARD,
        ...CARD_SHADOW,
      }}
    >
      <View
        style={{
          width: 10,
          height: 10,
          borderRadius: 999,
          backgroundColor: PRIORITY_COLOR[item.priority],
          marginRight: 10,
        }}
      />
      <Pressable style={{ flex: 1 }} onPress={() => toggleDone(item.id)}>
        <Text
          style={{
            color: COLOR_TEXT,
            fontSize: 16,
            fontWeight: '600',
            textDecorationLine: item.done ? 'line-through' : 'none',
            opacity: item.done ? 0.6 : 1,
          }}
        >
          {item.content}
        </Text>
      </Pressable>
      <TouchableOpacity onPress={() => removePlan(item.id)}>
        <Text style={{ color: COLOR_MUTED, fontSize: 14 }}>삭제</Text>
      </TouchableOpacity>
    </View>
  );

  const PriorityToggle = () => {
    const items: Priority[] = ['필수', '중요', '선택'];
    return (
      <View
        style={{
          flexDirection: 'row',
          borderWidth: 1,
          borderColor: COLOR_BORDER,
          borderRadius: 12,
          overflow: 'hidden',
          backgroundColor: COLOR_CARD,
          ...CARD_SHADOW,
        }}
      >
        {items.map((p, idx) => {
          const selected = newPlanPriority === p;
          return (
            <Pressable
              key={p}
              onPress={() => setNewPlanPriority(p)}
              style={{
                flex: 1,
                paddingVertical: 10,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: selected ? `${PRIORITY_COLOR[p]}22` : COLOR_CARD,
                borderRightWidth: idx < items.length - 1 ? 1 : 0,
                borderRightColor: COLOR_BORDER,
              }}
            >
              <Text
                style={{
                  fontWeight: '800',
                  color: selected ? PRIORITY_COLOR[p] : COLOR_TEXT,
                }}
              >
                {p}
              </Text>
            </Pressable>
          );
        })}
      </View>
    );
  };

  /* ---------- 슬라이드 ---------- */
  const onPagerLayout = (w: number) => {
    layoutWidthRef.current = w;
    pagerRef.current?.scrollTo({ x: pageIndex * w, animated: false });
  };
  const onScrollEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const w = layoutWidthRef.current || e.nativeEvent.layoutMeasurement.width;
    const idx = Math.round(e.nativeEvent.contentOffset.x / w);
    setPageIndex(idx);
  };

  /* ---------- UI ---------- */
  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: COLOR_BG }}
      behavior={Platform.select({ ios: 'padding', android: undefined })}
    >
      {/* 페이저 */}
      <View style={{ flex: 1 }} onLayout={(e) => onPagerLayout(e.nativeEvent.layout.width)}>
        <ScrollView
          ref={pagerRef}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          onMomentumScrollEnd={onScrollEnd}
          keyboardShouldPersistTaps="handled"
        >
          {/* === Page 1: 목표 시간 === */}
          <ScrollView
            style={{ width: layoutWidthRef.current || '100%' }}
            contentContainerStyle={{ padding: 20, paddingBottom: 80, marginTop: 50 }}
            keyboardShouldPersistTaps="handled"
          >
            <Pressable onPress={Keyboard.dismiss} style={{ flex: 1 }}>
              {/* ▶︎ 뒤로가기: 홈에서 '계획 추가'로 진입한 경우에만, 박스 없이 "<"만 표시 */}
              {showBack && (
                <View style={{ marginBottom: 8 }}>
                  <TouchableOpacity
                    onPress={() => router.back()}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    style={{ alignSelf: 'flex-start', paddingVertical: 4, paddingHorizontal: 2 }}
                  >
                    <Text style={{ fontSize: 22, color: COLOR_TEXT }}>{'<'}</Text>
                  </TouchableOpacity>
                </View>
              )}

              {/* 배너 */}
              <View
                style={{
                  borderWidth: 1,
                  borderColor: '#FCD34D',
                  backgroundColor: COLOR_WARN_BG,
                  padding: 12,
                  borderRadius: 12,
                  marginBottom: 40,
                  marginTop: 12,
                  ...CARD_SHADOW,
                }}
              >
                <Text style={{ color: COLOR_WARN_TXT, fontWeight: '800' }}>목표 공부 시간 설정</Text>
                <Text style={{ color: COLOR_WARN_TXT, marginTop: 4, fontSize: 12 }}>
                  오늘 집중할 시간을 먼저 선택하고 공부해야할 것을 추가하세요.
                </Text>
              </View>

              {/* 목표 공부 시간 카드(휠 + 자주 설정 포함) */}
              <View
                style={{
                  borderWidth: 1,
                  borderColor: COLOR_BORDER,
                  borderRadius: 16,
                  padding: 14,
                  marginBottom: 18,
                  backgroundColor: COLOR_CARD,
                  ...CARD_SHADOW,
                }}
              >
                <Text style={{ fontSize: 16, fontWeight: '800', color: COLOR_TEXT, marginBottom: 8 }}>
                  목표 공부 시간
                </Text>
                <Text style={{ color: COLOR_MUTED, marginBottom: 8 }}>
                  휠을 돌리거나 ‘자주 설정한 목표’로 빠르게 선택하세요.
                </Text>

                <View style={{ flexDirection: 'row', gap: 16 }}>
                  <View style={{ flex: 1, borderWidth: 1, borderColor: COLOR_BORDER, borderRadius: 12, ...CARD_SHADOW }}>
                    <Picker
                      selectedValue={hours}
                      onValueChange={(v) => {
                        setHours(Number(v));
                        const nextTotal = Number(v) * 60 + minutes;
                        scheduleAutoApply(nextTotal);
                      }}
                      style={{ height: PICKER_HEIGHT }}
                      dropdownIconColor={COLOR_MUTED}
                    >
                      {Array.from({ length: 13 }).map((_, i) => (
                        <Picker.Item key={i} label={`${i} 시간`} value={i} color={COLOR_TEXT} />
                      ))}
                    </Picker>
                  </View>

                  <View style={{ flex: 1, borderWidth: 1, borderColor: COLOR_BORDER, borderRadius: 12, ...CARD_SHADOW }}>
                    <Picker
                      selectedValue={minutes}
                      onValueChange={(v) => {
                        const mv = Number(v);
                        setMinutes(mv);
                        const nextTotal = hours * 60 + mv;
                        scheduleAutoApply(nextTotal);
                      }}
                      style={{ height: PICKER_HEIGHT }}
                      dropdownIconColor={COLOR_MUTED}
                    >
                      {Array.from({ length: 60 }).map((_, i) => (
                        <Picker.Item key={i} label={`${i} 분`} value={i} color={COLOR_TEXT} />
                      ))}
                    </Picker>
                  </View>
                </View>

                {/* 현재 설정 */}
                <View
                  style={{
                    marginTop: 12,
                    padding: 10,
                    borderWidth: 1,
                    borderColor: COLOR_BORDER,
                    borderRadius: 12,
                    backgroundColor: '#F9FAFB',
                  }}
                >
                  <Text style={{ color: COLOR_TEXT, fontSize: 14 }}>
                    현재 설정: <Text style={{ fontWeight: '800' }}>{hours}시간 {minutes}분</Text>
                  </Text>
                  {hours === 0 && minutes === 0 && (
                    <Text style={{ fontSize: 12, marginTop: 6 }}>아직 목표 시간을 설정하지 않았어요.</Text>
                  )}
                </View>

                {/* ✅ 자주 설정한 목표 */}
                <View
                  style={{
                    marginTop: 12,
                    padding: 12,
                    borderWidth: 1,
                    borderColor: COLOR_BORDER,
                    backgroundColor: '#F9FAFB',
                    borderRadius: 12,
                  }}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: COLOR_TEXT, fontWeight: '800' }}>자주 설정한 목표</Text>
                      <Text style={{ color: COLOR_MUTED, marginTop: 4 }}>
                        {favoriteGoalMins > 0 ? labelFromMinutes(favoriteGoalMins) : '없음'}
                      </Text>
                    </View>
                    <TouchableOpacity
                      onPress={applyFavoriteGoal}
                      disabled={favoriteGoalMins <= 0}
                      style={{
                        backgroundColor: favoriteGoalMins > 0 ? '#10B981' : '#D1D5DB',
                        borderRadius: 10,
                        paddingHorizontal: 14,
                        paddingVertical: 8,
                      }}
                    >
                      <Text style={{ color: '#FFFFFF', fontWeight: '900' }}>
                        {favoriteGoalMins > 0 ? '적용' : '적용 불가'}
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </View>

              {/* ✅ Page1 하단: '다음' 버튼 (0시간이면 비활성/진행 불가) */}
              <TouchableOpacity
                onPress={() => {
                  if (hours === 0 && minutes === 0) {
                    Alert.alert('목표 시간 필요', '목표 공부 시간을 설정한 뒤 다음으로 이동할 수 있어요.');
                    return;
                  }
                  const w = layoutWidthRef.current || 0;
                  setPageIndex(1);
                  pagerRef.current?.scrollTo({ x: w, animated: true });
                }}
                disabled={hours === 0 && minutes === 0}
                style={{
                  backgroundColor: hours === 0 && minutes === 0 ? '#9CA3AF' : COLOR_PRIMARY,
                  borderRadius: 12,
                  height: 48,
                  alignItems: 'center',
                  justifyContent: 'center',
                  opacity: hours === 0 && minutes === 0 ? 0.8 : 1,
                  ...CARD_SHADOW,
                }}
              >
                <Text style={{ color: '#FFF', fontWeight: '900' }}>
                  {hours === 0 && minutes === 0 ? '목표 시간을 설정하세요' : '다음'}
                </Text>
              </TouchableOpacity>

            </Pressable>
          </ScrollView>

          {/* === Page 2: 오늘의 공부 계획 === */}
          <ScrollView
            style={{ width: layoutWidthRef.current || '100%' }}
            contentContainerStyle={{ padding: 20, paddingBottom: 80, marginTop: 100 }}
            keyboardShouldPersistTaps="handled"
          >
            <Pressable onPress={Keyboard.dismiss} style={{ flex: 1 }}>
              <View
                style={{
                  borderWidth: 1,
                  borderColor: COLOR_BORDER,
                  borderRadius: 16,
                  padding: 14,
                  marginBottom: 18,
                  backgroundColor: COLOR_CARD,
                  ...CARD_SHADOW,
                }}
              >
                <Text style={{ fontSize: 16, fontWeight: '800', color: COLOR_TEXT, marginBottom: 10, marginTop: 10 }}>
                  오늘의 공부 계획
                </Text>
                <Text style={{ color: COLOR_MUTED, marginBottom: 20 }}>
                  우선순위를 선택하고 오늘 공부할 것을 적어보세요
                </Text>

                <PriorityToggle />

                {/* 입력 + 추가 버튼 행 */}
                <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center', marginTop: 20 }}>
                  <View style={{ flex: 1 }}>
                    <TextInput
                      value={newPlanText}
                      onChangeText={setNewPlanText}
                      placeholder="계획을 입력하세요 (예: 수학 문제집 20p 풀이)"
                      placeholderTextColor={COLOR_SOFT}
                      selectionColor={COLOR_LINK}
                      style={{
                        borderWidth: 1,
                        borderColor: COLOR_BORDER,
                        borderRadius: 12,
                        padding: 12,
                        fontSize: 15,
                        color: COLOR_TEXT,
                        backgroundColor: '#FFFFFF',
                        ...CARD_SHADOW,
                      }}
                      returnKeyType="done"
                      onSubmitEditing={() => {
                        addPlan();
                        Keyboard.dismiss();
                      }}
                    />
                  </View>
                </View>

                {/* --- 일자(실선) 구분선 --- */}
                <View
                  style={{
                    height: 1,
                    backgroundColor: COLOR_BORDER,
                    marginTop: 20,
                    marginBottom: 8,
                    width: '100%',
                  }}
                />

                {/* 목록 영역 */}
                <View style={{ marginTop: 12 }}>
                  {plans.length === 0 ? (
                    <Text style={{ color: COLOR_SOFT, fontSize: 14 }}>
                      아직 추가된 계획이 없어요. 위에서 우선순위를 선택하고 계획을 입력해보세요.
                    </Text>
                  ) : (
                    <FlatList
                      data={plans}
                      keyExtractor={(i) => i.id}
                      renderItem={renderPlan}
                      scrollEnabled={false}
                      contentContainerStyle={{ paddingTop: 8 }}
                    />
                  )}
                </View>

                <View style={{ flexDirection: 'row', gap: 10, marginTop: 16 }}>
                  <TouchableOpacity
                    onPress={() => {
                      setPageIndex(0);
                      pagerRef.current?.scrollTo({ x: 0, animated: true });
                    }}
                    style={{
                      width: 120,
                      backgroundColor: '#111827',
                      borderRadius: 12,
                      height: 48,
                      alignItems: 'center',
                      justifyContent: 'center',
                      ...CARD_SHADOW,
                    }}
                  >
                    <Text style={{ color: '#FFF', fontWeight: '900' }}>이전</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    onPress={savePlansAndGoal}
                    style={{
                      flex: 1,
                      backgroundColor: COLOR_PRIMARY,
                      borderRadius: 12,
                      height: 48,
                      alignItems: 'center',
                      justifyContent: 'center',
                      ...CARD_SHADOW,
                    }}
                  >
                    <Text style={{ color: '#FFF', fontWeight: '900' }}>저장하고 홈으로</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </Pressable>
          </ScrollView>
        </ScrollView>

        {/* 하단 슬라이드 인디케이터 */}
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 16,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {[0, 1].map((i) => (
              <View
                key={i}
                style={{
                  width: pageIndex === i ? 28 : 10,
                  height: 8,
                  borderRadius: 999,
                  backgroundColor: pageIndex === i ? COLOR_PRIMARY : '#E5E7EB',
                  ...CARD_SHADOW,
                }}
              />
            ))}
          </View>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}
