// app/routine/run.tsx
import { Picker } from '@react-native-picker/picker';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { onAuthStateChanged } from 'firebase/auth';
import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { useEffect, useState } from 'react';
import { Alert, Platform, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { auth, db } from '../../firebaseConfig';

export default function RoutineRunScreen() {
  const router = useRouter();

  const { title, steps } = useLocalSearchParams();
  const routineTitle = typeof title === 'string' ? title : '루틴';
  const stepsRaw = typeof steps === 'string' ? steps : '';
  const stepList = stepsRaw
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

  const [setCount, setSetCount] = useState(1);
  const [currentSet, setCurrentSet] = useState(1);
  const [isStarted, setIsStarted] = useState(false);

  /* ---------- auth ---------- */
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => setUid(user ? user.uid : null));
    return () => unsub();
  }, []);

  /* ---------- timer ---------- */
  useEffect(() => {
    if (!isRunning || isFinished || !isStarted) return;

    if (remainingTime <= 0) {
      // 다음 스텝으로
      if (stepIndex + 1 < stepList.length) {
        const nextStep = stepList[stepIndex + 1];
        setStepIndex((i) => i + 1);
        setRemainingTime((nextStep?.minutes || 0) * 60);
      } else {
        // 다음 세트 or 종료
        if (currentSet < setCount) {
          setCurrentSet((s) => s + 1);
          setStepIndex(0);
          setRemainingTime((stepList[0]?.minutes || 0) * 60);
        } else {
          setIsFinished(true);
          setIsRunning(false);
        }
      }
      return;
    }

    const timer = setInterval(() => setRemainingTime((prev) => prev - 1), 1000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remainingTime, isRunning, isFinished, isStarted, stepIndex, currentSet, setCount]);

  /* ---------- utils ---------- */
  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    const mm = String(Math.max(0, m)).padStart(2, '0');
    const ss = String(Math.max(0, sec)).padStart(2, '0');
    return `${mm}:${ss}`;
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
        setCount,
        completedAt: serverTimestamp(),
      });
      setIsSaved(true);
    } catch {
      Alert.alert('오류', '저장 실패');
    }
  };

  /* ---------- UI ---------- */
  const TOP_SPACING = Platform.OS === 'android' ? 24 : 44;

  // 스텝이 없을 때 가드
  const hasSteps = stepList.length > 0;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: '#FFFFFF' }}
      contentContainerStyle={{ paddingBottom: 40 }}
    >
      {/* Header */}
      <View style={{ paddingTop: TOP_SPACING, paddingHorizontal: 20, paddingBottom: 6 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <TouchableOpacity
            onPress={() => router.back()}
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
              {/* 시작 섹션 */}
              <View style={{ marginTop: 30, marginBottom: 24 }}>
                <Text style={{ fontSize: 22, fontWeight: '800', color: '#111827', marginBottom: 10 }}>
                  {routineTitle} 시작하기
                </Text>
                
              </View>

              {/* 세트 선택 카드 */}
              <View
                style={{
                  backgroundColor: '#F9FAFB',
                  borderWidth: 1,
                  borderColor: '#E5E7EB',
                  borderRadius: 14,
                  paddingVertical: 10,
                  paddingHorizontal: 12,
                  marginBottom: 30,
                }}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                  <Text style={{ fontSize: 14, color: '#374151', fontWeight: '700' }}>반복할 횟수</Text>

                  {/* ✅ 색 입힌 세트 선택 박스 */}
                  <View
                    style={{
                      width: 160,
                      borderWidth: 1,
                      borderColor: '#93C5FD',
                      borderRadius: 12,
                      overflow: 'hidden',
                      backgroundColor: '#DBEAFE', // 파랑 톤 배경
                    }}
                  >
                    <Picker
                      selectedValue={setCount}
                      onValueChange={(val: number | string) => setSetCount(Number(val))}
                      style={{
                        height: 44,
                        width: '100%',
                        backgroundColor: '#DBEAFE',
                        color: '#1E40AF', // 텍스트 컬러(안드로이드)
                        paddingHorizontal: 8,
                      }}
                      itemStyle={{
                        color: '#1E40AF', // 텍스트 컬러(iOS)
                        fontSize: 14,
                      }}
                      dropdownIconColor="#1D4ED8" // 드롭다운 아이콘 컬러(안드로이드)
                    >
                      {[1, 2, 3, 4, 5].map((n) => (
                        <Picker.Item key={n} label={`${n}세트`} value={n} />
                      ))}
                    </Picker>
                  </View>
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
                <Text style={{ color: '#fff', fontSize: 16, fontWeight: '700' }}>
                  ▶ 루틴 시작하기
                </Text>
              </TouchableOpacity>

              {!hasSteps && (
                <Text style={{ marginTop: 10, color: '#EF4444' }}>
                  스텝이 없습니다. 루틴 편집에서 스텝을 추가해주세요.
                </Text>
              )}

              {/* 뒤로가기 */}
              <TouchableOpacity
                onPress={() => router.back()}
                style={{ alignSelf: 'center', paddingVertical: 14, paddingHorizontal: 18, marginTop: 18 }}
              >
                <Text style={{ color: '#6B7280' }}>뒤로가기</Text>
              </TouchableOpacity>
            </>
          ) : (
            <>
              {/* 실행 중 */}
              <View style={{ marginTop: 10, marginBottom: 12 }}>
                <Text style={{ fontSize: 22, fontWeight: '800', color: '#111827' }}>
                  {routineTitle} 실행 중
                </Text>
                <Text style={{ fontSize: 13, color: '#6B7280', marginTop: 6 }}>
                  ({currentSet}세트 / 총 {setCount}세트)
                </Text>
              </View>

              <View
                style={{
                  backgroundColor: '#EFF6FF',
                  borderRadius: 16,
                  padding: 22,
                  marginTop: 8,
                  marginBottom: 28,
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
                  {formatTime(remainingTime)}
                </Text>
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
                    // 스킵(다음 단계로)
                    if (stepIndex + 1 < stepList.length) {
                      const nextStep = stepList[stepIndex + 1];
                      setStepIndex((i) => i + 1);
                      setRemainingTime((nextStep?.minutes || 0) * 60);
                    } else {
                      // 마지막이면 세트 증가 또는 종료
                      if (currentSet < setCount) {
                        setCurrentSet((s) => s + 1);
                        setStepIndex(0);
                        setRemainingTime((stepList[0]?.minutes || 0) * 60);
                      } else {
                        setIsFinished(true);
                        setIsRunning(false);
                      }
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
            <Text style={{ fontSize: 22, fontWeight: '800', color: '#059669', marginBottom: 8 }}>
               루틴 완료!
            </Text>
            <Text style={{ fontSize: 14, color: '#374151', marginBottom: 22 }}>
              총 {setCount}세트를 완주했어요! 대단해요 
            </Text>

            {isSaved ? (
              <Text style={{ fontSize: 14, color: '#10B981', fontWeight: '700', marginBottom: 12 }}>
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
                }}
              >
                <Text style={{ color: '#fff', fontSize: 15, fontWeight: '700' }}>
                  기록 저장하기
                </Text>
              </TouchableOpacity>
            )}

            <TouchableOpacity
              onPress={() => router.back()}
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
