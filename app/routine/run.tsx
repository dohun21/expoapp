// app/routine/run.tsx
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { onAuthStateChanged } from 'firebase/auth';
import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Platform, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { auth, db } from '../../firebaseConfig';

type StepItem = { step: string; minutes: number };

/* ---------- KST logical date helpers ---------- */
const DAY_START_OFFSET_KEY_BASE = 'dayStartOffsetMin';
const DEFAULT_DAY_START_MIN = 240;
const k = (base: string, uid: string) => `${base}_${uid}`;
function ymdKST(offsetMin: number) {
  const now = new Date();
  const kstNow = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
  const shifted = new Date(kstNow.getTime() - (offsetMin || 0) * 60000);
  const y = shifted.getFullYear();
  const m = String(shifted.getMonth() + 1).padStart(2, '0');
  const d = String(shifted.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** steps 쿼리 파라미터(string | string[]) 안전 파싱 */
function parseSteps(raw: string | string[] | undefined): StepItem[] {
  const s = typeof raw === 'string' ? raw : Array.isArray(raw) ? raw.join('|') : '';
  if (!s) return [];
  return s
    .split('|')
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map((chunk) => {
      const [text, m] = chunk.split(',');
      const min = Number(m);
      return { step: (text ?? '').trim(), minutes: Number.isFinite(min) && min > 0 ? min : 0 };
    })
    .filter(it => it.step.length > 0 && it.minutes >= 0);
}

export default function RoutineRunScreen() {
  const router = useRouter();

  // --- params ---
  const { title, steps } = useLocalSearchParams();
  const routineTitle = typeof title === 'string' ? title : '루틴';
  const stepList: StepItem[] = useMemo(() => parseSteps(steps), [steps]);

  // --- auth ---
  const [uid, setUid] = useState<string | null>(null);
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => setUid(user ? user.uid : null));
    return () => unsub();
  }, []);

  // --- state ---
  const [isStarted, setIsStarted] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [isFinished, setIsFinished] = useState(false);
  const [isSaved, setIsSaved] = useState(false);

  const [stepIndex, setStepIndex] = useState(0);
  const [remainingTime, setRemainingTime] = useState(stepList[0]?.minutes ? stepList[0].minutes * 60 : 0);

  // refs(인터벌/현재 인덱스/스텝리스트 스냅샷/실행상태)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stepIndexRef = useRef(0);
  const stepsRef = useRef(stepList);
  const runningRef = useRef(false);

  useEffect(() => { stepsRef.current = stepList; }, [stepList]);
  useEffect(() => { stepIndexRef.current = stepIndex; }, [stepIndex]);
  useEffect(() => { runningRef.current = isRunning; }, [isRunning]);

  // --- totals/progress ---
  const totalSeconds = useMemo(
    () => stepList.reduce((acc, s) => acc + Math.max(0, s.minutes) * 60, 0),
    [stepList]
  );
  const currentStepTotalSec = (stepList[stepIndex]?.minutes || 0) * 60;

  const completedSeconds = useMemo(() => {
    const prevSec = stepList.slice(0, stepIndex).reduce((acc, s) => acc + Math.max(0, s.minutes) * 60, 0);
    const curDone = Math.max(0, currentStepTotalSec - remainingTime);
    return Math.min(totalSeconds, prevSec + curDone);
  }, [stepList, stepIndex, remainingTime, currentStepTotalSec, totalSeconds]);

  const progress = totalSeconds > 0 ? completedSeconds / totalSeconds : 0;

  // --- 단일 타이머 ---
  const startTick = useCallback(() => {
    if (timerRef.current) return;
    timerRef.current = setInterval(() => {
      setRemainingTime((prev) => {
        if (!runningRef.current) return prev;

        if (prev <= 1) {
          const curIdx = stepIndexRef.current;
          const nextIdx = curIdx + 1;
          const steps = stepsRef.current;

          if (nextIdx < steps.length) {
            const next = steps[nextIdx];
            setStepIndex(nextIdx);
            return Math.max(0, (next?.minutes || 0) * 60);
          } else {
            setIsFinished(true);
            setIsRunning(false);
            runningRef.current = false;
            if (timerRef.current) {
              clearInterval(timerRef.current);
              timerRef.current = null;
            }
            return 0;
          }
        }
        return prev - 1;
      });
    }, 1000);
  }, []);

  const stopTick = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (isStarted && isRunning && !isFinished) startTick();
    else stopTick();
    return () => stopTick();
  }, [isStarted, isRunning, isFinished, startTick, stopTick]);

  // 포커스 아웃 시 깔끔 정리
  useFocusEffect(
    useCallback(() => {
      return () => {
        stopTick();
        runningRef.current = false;
        setIsRunning(false);
      };
    }, [stopTick])
  );

  // --- utils ---
  const formatMMSS = (s: number) => {
    const m = Math.floor(Math.max(0, s) / 60);
    const sec = Math.max(0, s) % 60;
    return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  };
  const formatHM = (sec: number) => {
    const safe = Math.max(0, sec);
    const h = Math.floor(safe / 3600);
    const m = Math.ceil((safe % 3600) / 60);
    if (h > 0 && m > 0) return `${h}시간 ${m}분`;
    if (h > 0) return `${h}시간`;
    return `${m}분`;
  };

  // 저장(홈 합산과 호환되도록 필드 포함)
  const saveRoutineRecord = async () => {
    if (!uid) {
      Alert.alert('로그인 필요', '로그인이 필요합니다.');
      return;
    }
    try {
      // 개인별 논리적 시작시간 반영 → logicalDateKST 저장
      const offsetRaw = await AsyncStorage.getItem(k(DAY_START_OFFSET_KEY_BASE, uid));
      const v = Number(offsetRaw);
      const offsetMin = Number.isFinite(v) ? v : DEFAULT_DAY_START_MIN;
      const logicalDateKST = ymdKST(offsetMin);

      await addDoc(collection(db, 'routineRecords'), {
        uid,
        title: routineTitle,
        steps: stepList,
        totalSeconds,
        totalMinutes: Math.round(totalSeconds / 60),
        logicalDateKST,            // ✅ 홈 집계 1순위 키
        createdAt: serverTimestamp(),
        completedAt: serverTimestamp(),
        endedAt: serverTimestamp(), // ✅ 명시적 종료타임스탬프
        platform: Platform.OS,
      });
      setIsSaved(true);
    } catch (e) {
      console.error(e);
      Alert.alert('오류', '저장 실패');
    }
  };

  // --- derived ---
  const TOP_SPACING = Platform.OS === 'android' ? 24 : 44;
  const hasSteps = stepList.length > 0;
  const nextStep = stepList[stepIndex + 1];

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: '#FFFFFF' }}
      contentContainerStyle={{ paddingBottom: 40 }}
      keyboardShouldPersistTaps="handled"
    >
      {/* Header */}
      <View style={{ paddingTop: TOP_SPACING, paddingHorizontal: 20, paddingBottom: 6 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <TouchableOpacity
            onPress={() => {
              stopTick();
              setIsRunning(false);
              router.back(); // 뒤로가기 안정 처리
            }}
            style={{ padding: 8, marginRight: 6, borderRadius: 10 }}
          >
            <Text style={{ fontSize: 18, marginTop: 20 }}>〈</Text>
          </TouchableOpacity>
          <Text style={{ fontSize: 18, fontWeight: '800', marginTop: 20 }}>{routineTitle}</Text>
        </View>
      </View>

      <View style={{ paddingHorizontal: 20 }}>
        {!isFinished ? (
          !isStarted ? (
            <>
              {/* 소개 섹션 */}
              <View style={{ marginTop: 30, marginBottom: 14 }}>
                <Text style={{ fontSize: 22, fontWeight: '800', color: '#111827', marginBottom: 10 }}>
                  {routineTitle} 시작하기
                </Text>
                <View
                  style={{
                    backgroundColor: '#F9FAFB',
                    borderWidth: 1,
                    borderColor: '#E5E7EB',
                    borderRadius: 14,
                    paddingVertical: 14,
                    paddingHorizontal: 14,
                  }}
                >
                  {!hasSteps ? (
                    <Text style={{ color: '#EF4444' }}>스텝이 없습니다. 루틴 편집에서 스텝을 추가해주세요.</Text>
                  ) : (
                    <View>
                      {stepList.map((st, idx) => (
                        <View
                          key={`${idx}-${st.step}`}
                          style={{
                            flexDirection: 'row',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            paddingVertical: 6,
                            borderBottomWidth: idx === stepList.length - 1 ? 0 : 1,
                            borderColor: '#F3F4F6',
                          }}
                        >
                          <Text style={{ fontSize: 14, color: '#111827' }}>
                            {idx + 1}. {st.step}
                          </Text>
                          <Text style={{ fontSize: 13, color: '#6B7280' }}>{st.minutes}분</Text>
                        </View>
                      ))}
                      <View style={{ marginTop: 10, flexDirection: 'row', justifyContent: 'space-between' }}>
                        <Text style={{ fontSize: 13, color: '#6B7280' }}> 총 시간</Text>
                        <Text style={{ fontSize: 14, fontWeight: '700', color: '#1F2937' }}>
                          {formatHM(totalSeconds)}
                        </Text>
                      </View>
                    </View>
                  )}
                </View>
              </View>

              {/* 시작 버튼 */}
              <TouchableOpacity
                disabled={!hasSteps}
                onPress={() => {
                  if (!hasSteps) return;
                  setIsStarted(true);
                  setIsRunning(true);
                  runningRef.current = true;
                  setStepIndex(0);
                  stepIndexRef.current = 0;
                  setRemainingTime((stepList[0]?.minutes || 0) * 60);
                  // 즉시 인터벌 시작(첫 프레임 지연 방지)
                  startTick();
                }}
                style={{
                  backgroundColor: hasSteps ? '#3B82F6' : '#93C5FD',
                  paddingVertical: 14,
                  borderRadius: 16,
                  alignItems: 'center',
                  marginTop: 10,
                }}
              >
                <Text style={{ color: '#fff', fontSize: 16, fontWeight: '700' }}>▶ 루틴 시작하기</Text>
              </TouchableOpacity>
            </>
          ) : (
            <>
              {/* 실행 중 헤더 */}
              <View style={{ marginTop: 10, marginBottom: 12 }}>
                <Text style={{ fontSize: 22, fontWeight: '800', color: '#111827' }}>{routineTitle} 실행 중</Text>
                <Text style={{ fontSize: 13, color: '#6B7280', marginTop: 6 }}>
                  스텝 {stepIndex + 1} / {stepList.length}
                  {nextStep ? `  ·  다음: ${nextStep.step} (${nextStep.minutes}분)` : ''}
                </Text>
              </View>

              {/* 전체 진행률 바 */}
              <View style={{ marginBottom: 14 }}>
                <View style={{ height: 10, borderRadius: 999, backgroundColor: '#E5E7EB', overflow: 'hidden' }}>
                  <View style={{ width: `${Math.round(progress * 100)}%`, height: '100%', backgroundColor: '#60A5FA' }} />
                </View>
                <Text style={{ marginTop: 6, fontSize: 12, color: '#6B7280' }}>
                  전체 진행률 {Math.round(progress * 100)}% · 남은 시간 {formatHM(totalSeconds - completedSeconds)}
                </Text>
              </View>

              {/* 현재 단계 카드 */}
              <View
                style={{
                  backgroundColor: '#EFF6FF',
                  borderRadius: 16,
                  padding: 22,
                  marginTop: 8,
                  marginBottom: 18,
                  alignItems: 'center',
                  borderWidth: 1,
                  borderColor: '#DBEAFE',
                }}
              >
                <Text style={{ fontSize: 12, color: '#6B7280', marginBottom: 8 }}>현재 단계</Text>
                <Text style={{ fontSize: 20, fontWeight: '700', marginBottom: 10, color: '#1F2937', textAlign: 'center' }}>
                  {stepList[stepIndex]?.step ?? '—'}
                </Text>
                <Text style={{ fontSize: 44, fontWeight: '800', color: '#1D4ED8', letterSpacing: 1 }}>
                  {formatMMSS(remainingTime)}
                </Text>
              </View>

              {/* 스텝 목록 (현재 단계 표시) */}
              <View
                style={{
                  backgroundColor: '#F9FAFB',
                  borderWidth: 1,
                  borderColor: '#E5E7EB',
                  borderRadius: 14,
                  paddingVertical: 10,
                  paddingHorizontal: 12,
                  marginBottom: 16,
                }}
              >
                <Text style={{ fontSize: 13, color: '#6B7280', marginBottom: 6 }}>스텝 목록</Text>
                {stepList.map((st, idx) => {
                  const active = idx === stepIndex;
                  return (
                    <View
                      key={`${idx}-${st.step}`}
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        paddingVertical: 6,
                        borderBottomWidth: idx === stepList.length - 1 ? 0 : 1,
                        borderColor: '#F3F4F6',
                      }}
                    >
                      <Text style={{ fontSize: 14, color: active ? '#1F2937' : '#374151', fontWeight: active ? '800' : '400' }}>
                        {idx + 1}. {st.step}
                      </Text>
                      <Text style={{ fontSize: 12, color: active ? '#1D4ED8' : '#6B7280', fontWeight: active ? '700' : '400' }}>
                        {st.minutes}분
                      </Text>
                    </View>
                  );
                })}
              </View>

              {/* 컨트롤 버튼들 */}
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <TouchableOpacity
                  onPress={() => {
                    const next = !isRunning;
                    setIsRunning(next);
                    runningRef.current = next;
                    if (next) startTick();
                    else stopTick();
                  }}
                  style={{
                    flex: 1,
                    backgroundColor: '#3B82F6',
                    paddingVertical: 14,
                    borderRadius: 14,
                    alignItems: 'center',
                  }}
                >
                  <Text style={{ color: '#fff', fontSize: 15, fontWeight: '700' }}>
                    {isRunning ? ' 일시정지' : '▶ 다시 시작'}
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  onPress={() => {
                    const curIdx = stepIndexRef.current;
                    const steps = stepsRef.current;
                    const nextIdx = curIdx + 1;
                    if (nextIdx < steps.length) {
                      const next = steps[nextIdx];
                      setStepIndex(nextIdx);
                      stepIndexRef.current = nextIdx;
                      setRemainingTime(Math.max(0, (next?.minutes || 0) * 60));
                    } else {
                      setIsFinished(true);
                      setIsRunning(false);
                      runningRef.current = false;
                      stopTick();
                      setRemainingTime(0);
                    }
                  }}
                  style={{
                    paddingVertical: 14,
                    paddingHorizontal: 16,
                    borderRadius: 14,
                    borderWidth: 1,
                    borderColor: '#93C5FD',
                    backgroundColor: '#EEF2FF',
                  }}
                >
                  <Text style={{ color: '#1E40AF', fontWeight: '700' }}>다음 ▶</Text>
                </TouchableOpacity>
              </View>
            </>
          )
        ) : (
          // 완료 화면
          <View style={{ marginTop: 24, alignItems: 'center' }}>
            <Text style={{ fontSize: 22, fontWeight: '800', color: '#059669', marginBottom: 8 }}>루틴 완료!</Text>
            <Text style={{ fontSize: 14, color: '#374151', marginBottom: 12 }}>
              총 {stepList.length}단계를 모두 마쳤어요! ({formatHM(totalSeconds)})
            </Text>

            {/* 이번에 한 일 요약 */}
            <View
              style={{
                backgroundColor: '#F0FDF4',
                borderWidth: 1,
                borderColor: '#BBF7D0',
                borderRadius: 14,
                paddingVertical: 12,
                paddingHorizontal: 14,
                width: '100%',
                maxWidth: 520,
              }}
            >
              {stepList.map((st, idx) => (
                <View
                  key={`${idx}-${st.step}`}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    paddingVertical: 6,
                    borderBottomWidth: idx === stepList.length - 1 ? 0 : 1,
                    borderColor: '#DCFCE7',
                  }}
                >
                  <Text style={{ fontSize: 14, color: '#065F46' }}>
                    {idx + 1}. {st.step}
                  </Text>
                  <Text style={{ fontSize: 13, color: '#047857' }}>{st.minutes}분</Text>
                </View>
              ))}
            </View>

            {isSaved ? (
              <Text style={{ fontSize: 14, color: '#10B981', fontWeight: '700', marginTop: 12 }}>
                ✅ 기록이 저장되었습니다!
              </Text>
            ) : (
              <TouchableOpacity
                onPress={saveRoutineRecord}
                style={{
                  backgroundColor: '#10B981',
                  paddingVertical: 14,
                  paddingHorizontal: 24,
                  borderRadius: 16,
                  alignItems: 'center',
                  minWidth: 200,
                  marginTop: 16,
                }}
              >
                <Text style={{ color: '#fff', fontSize: 15, fontWeight: '700' }}>기록 저장하기</Text>
              </TouchableOpacity>
            )}

            <TouchableOpacity
              onPress={() => {
                stopTick();
                setIsRunning(false);
                router.back();
              }}
              style={{ paddingVertical: 14, paddingHorizontal: 18, marginTop: 16 }}
            >
              <Text style={{ color: '#6B7280' }}>뒤로가기</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    </ScrollView>
  );
}
