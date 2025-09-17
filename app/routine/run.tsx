// app/routine/run.tsx
import { useLocalSearchParams, useRouter } from 'expo-router';
import { onAuthStateChanged } from 'firebase/auth';
import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Platform, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { auth, db } from '../../firebaseConfig';

type StepItem = { step: string; minutes: number };

export default function RoutineRunScreen() {
  const router = useRouter();

  const { title, steps } = useLocalSearchParams();
  const routineTitle = typeof title === 'string' ? title : '루틴';
  const stepsRaw = typeof steps === 'string' ? steps : '';
  const stepList: StepItem[] = stepsRaw
    .split('|')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const [text, minutes] = s.split(',');
      return { step: (text ?? '').trim(), minutes: Number(minutes) || 0 };
    });

  const [stepIndex, setStepIndex] = useState(0);
  const [remainingTime, setRemainingTime] = useState(stepList[0]?.minutes ? stepList[0].minutes * 60 : 0);
  const [isRunning, setIsRunning] = useState(false);
  const [isFinished, setIsFinished] = useState(false);
  const [uid, setUid] = useState<string | null>(null);
  const [isSaved, setIsSaved] = useState(false);
  const [isStarted, setIsStarted] = useState(false);

  /* ---------- auth ---------- */
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => setUid(user ? user.uid : null));
    return () => unsub();
  }, []);

  /* ---------- memoized totals ---------- */
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

  /* ---------- timer ---------- */
  useEffect(() => {
    if (!isRunning || isFinished || !isStarted) return;

    if (remainingTime <= 0) {
      // 다음 스텝 또는 종료
      if (stepIndex + 1 < stepList.length) {
        const nextStep = stepList[stepIndex + 1];
        setStepIndex((i) => i + 1);
        setRemainingTime((nextStep?.minutes || 0) * 60);
      } else {
        setIsFinished(true);
        setIsRunning(false);
      }
      return;
    }

    const timer = setInterval(() => setRemainingTime((prev) => prev - 1), 1000);
    return () => clearInterval(timer);
  }, [remainingTime, isRunning, isFinished, isStarted, stepIndex, stepList]);

  /* ---------- utils ---------- */
  const formatMMSS = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    const mm = String(Math.max(0, m)).padStart(2, '0');
    const ss = String(Math.max(0, sec)).padStart(2, '0');
    return `${mm}:${ss}`;
  };

  const formatHM = (sec: number) => {
    const h = Math.floor(sec / 3600);
    const m = Math.ceil((sec % 3600) / 60);
    if (h > 0 && m > 0) return `${h}시간 ${m}분`;
    if (h > 0) return `${h}시간`;
    return `${m}분`;
  };

  const saveRoutineRecord = async () => {
    if (!uid) {
      Alert.alert('로그인 필요', '로그인이 필요합니다.');
      return;
    }
    try {
      await addDoc(collection(db, 'routineRecords'), {
        uid,
        title: routineTitle,
        steps: stepList,
        completedAt: serverTimestamp(),
      });
      setIsSaved(true);
    } catch {
      Alert.alert('오류', '저장 실패');
    }
  };

  /* ---------- UI ---------- */
  const TOP_SPACING = Platform.OS === 'android' ? 24 : 44;
  const hasSteps = stepList.length > 0;
  const nextStep = stepList[stepIndex + 1];

  return (
    <ScrollView style={{ flex: 1, backgroundColor: '#FFFFFF' }} contentContainerStyle={{ paddingBottom: 40 }}>
      {/* Header */}
      <View style={{ paddingTop: TOP_SPACING, paddingHorizontal: 20, paddingBottom: 6 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <TouchableOpacity onPress={() => router.back()} style={{ padding: 8, marginRight: 6, borderRadius: 10 }}>
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
                {/* 스텝 요약 카드: 이 루틴이 무엇을 하는지 */}
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
                  setIsStarted(true);
                  setIsRunning(true);
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
                <View
                  style={{
                    height: 10,
                    borderRadius: 999,
                    backgroundColor: '#E5E7EB',
                    overflow: 'hidden',
                  }}
                >
                  <View
                    style={{
                      width: `${Math.round(progress * 100)}%`,
                      height: '100%',
                      backgroundColor: '#60A5FA',
                    }}
                  />
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
                <Text
                  style={{
                    fontSize: 20,
                    fontWeight: '700',
                    marginBottom: 10,
                    color: '#1F2937',
                    textAlign: 'center',
                  }}
                >
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
                      <Text
                        style={{
                          fontSize: 14,
                          color: active ? '#1F2937' : '#374151',
                          fontWeight: active ? '800' : '400',
                        }}
                      >
                        {idx + 1}. {st.step}
                      </Text>
                      <Text
                        style={{
                          fontSize: 12,
                          color: active ? '#1D4ED8' : '#6B7280',
                          fontWeight: active ? '700' : '400',
                        }}
                      >
                        {st.minutes}분
                      </Text>
                    </View>
                  );
                })}
              </View>

              {/* 컨트롤 버튼들 */}
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <TouchableOpacity
                  onPress={() => setIsRunning((r) => !r)}
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
                    if (stepIndex + 1 < stepList.length) {
                      const next = stepList[stepIndex + 1];
                      setStepIndex((i) => i + 1);
                      setRemainingTime((next?.minutes || 0) * 60);
                    } else {
                      setIsFinished(true);
                      setIsRunning(false);
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

              {/* 뒤로가기 */}
              <TouchableOpacity
                onPress={() => router.back()}
                style={{ alignSelf: 'center', paddingVertical: 14, paddingHorizontal: 18, marginTop: 16 }}
              >
                <Text style={{ color: '#6B7280' }}>뒤로가기</Text>
              </TouchableOpacity>
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

            <TouchableOpacity onPress={() => router.back()} style={{ paddingVertical: 14, paddingHorizontal: 18, marginTop: 16 }}>
              <Text style={{ color: '#6B7280' }}>뒤로가기</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    </ScrollView>
  );
}
