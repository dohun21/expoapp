import AsyncStorage from '@react-native-async-storage/async-storage';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

type Step = { step: string; minutes: number };

function parsePackedSteps(packed?: string): Step[] {
  if (!packed) return [];
  return (packed.split('|') || []).map((pair) => {
    const [s, m] = pair.split(',');
    return { step: (s || '').trim(), minutes: Math.max(0, Number(m) || 0) };
  });
}
function formatStudyTime(totalSec: number) {
  const safe = Math.max(0, Math.floor(totalSec));
  const h = Math.floor(safe / 3600);
  const m = Math.floor((safe % 3600) / 60);
  const s = safe % 60;
  if (h > 0) return `${h}시간 ${m}분 ${s}초`;
  return `${m}분 ${s}초`;
}

export default function RoutinePlayer() {
  const router = useRouter();
  const params = useLocalSearchParams();

  const routineTitle = Array.isArray(params?.routineTitle) ? params.routineTitle[0] : (params?.routineTitle as string | undefined);
  const stepsPacked = Array.isArray(params?.steps) ? params.steps[0] : (params?.steps as string | undefined);
  const setCount = Number(Array.isArray(params?.setCount) ? params.setCount[0] : params?.setCount) || 1;

  const subject = Array.isArray(params?.subject) ? params.subject[0] : (params?.subject as string | undefined);
  const content = Array.isArray(params?.content) ? params.content[0] : (params?.content as string | undefined);
  const planId = Array.isArray(params?.planId) ? params.planId[0] : (params?.planId as string | undefined);
  const queueParam = Array.isArray(params?.queue) ? params.queue[0] : (params?.queue as string | undefined);

  const steps = useMemo(() => parsePackedSteps(stepsPacked), [stepsPacked]);

  const [ready, setReady] = useState(true);
  const [setIdx, setSetIdx] = useState(0);
  const [stepIdx, setStepIdx] = useState(0);
  const [running, setRunning] = useState(false);
  const [leftSec, setLeftSec] = useState(() => (steps[0]?.minutes || 0) * 60);
  const elapsedRef = useRef(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const totalSteps = steps.length;
  const isLastStepInSet = stepIdx === totalSteps - 1;
  const isLastSet = setIdx === setCount - 1;

  useEffect(() => {
    if (!running) return;
    if (intervalRef.current) return;
    intervalRef.current = setInterval(() => {
      setLeftSec((prev) => {
        if (prev <= 1) {
          elapsedRef.current += 1;
          clearInterval(intervalRef.current as any);
          intervalRef.current = null;
          handleNextStep();
          return 0;
        }
        elapsedRef.current += 1;
        return prev - 1;
      });
    }, 1000);
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [running, stepIdx, setIdx]);

  useEffect(() => {
    const sec = (steps[stepIdx]?.minutes || 0) * 60;
    setLeftSec(sec);
  }, [stepIdx, steps]);

  const formatLeft = (s: number) => {
    const mm = Math.floor(s / 60);
    const ss = s % 60;
    return `${mm}분 ${String(ss).padStart(2, '0')}초`;
  };

  function stopTimer() {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    setRunning(false);
  }

  function handleNextStep() {
    stopTimer();
    if (isLastStepInSet) {
      if (isLastSet) {
        finishAndGoSummary();
      } else {
        setSetIdx((v) => v + 1);
        setStepIdx(0);
        setTimeout(() => setRunning(true), 200);
      }
    } else {
      setStepIdx((v) => v + 1);
      setTimeout(() => setRunning(true), 200);
    }
  }

  async function finishAndGoSummary() {
    stopTimer();
    const planned = steps.reduce((a, s) => a + (s.minutes || 0), 0) * 60 * Math.max(1, setCount);
    const totalElapsed = elapsedRef.current > 0 ? elapsedRef.current : planned;
    const timeStr = formatStudyTime(totalElapsed);

    await AsyncStorage.setItem('subject', String(subject || '기타'));
    await AsyncStorage.setItem('content', String(content || ''));
    await AsyncStorage.setItem('studyTime', timeStr);
    await AsyncStorage.setItem('memo', routineTitle ? `[루틴] ${routineTitle} 완료` : '');

    router.replace({
      pathname: '/session/summary',
      params: {
        backTo: '/plan/batch',
        donePlanId: String(planId || ''),
        queue: String(queueParam || ''),
        mode: 'routine',
      },
    } as any);
  }

  // ⭐ 임시저장 후 나가기: 경과시간만 저장하고 홈으로 복귀(큐 이어가기 X)
  async function saveDraftAndExit() {
    stopTimer();
    const total = Math.max(0, elapsedRef.current); // 진행분만 저장
    const timeStr = formatStudyTime(total);

    await AsyncStorage.setItem('subject', String(subject || '기타'));
    await AsyncStorage.setItem('content', String(content || ''));
    await AsyncStorage.setItem('studyTime', timeStr);
    await AsyncStorage.setItem('memo', routineTitle ? `[임시저장] ${routineTitle} 진행 중` : '[임시저장] 진행 중');

    router.replace({
      pathname: '/session/summary',
      params: {
        backTo: '/home',
        donePlanId: '',
        queue: '',
        mode: 'routine',
        pause: '1', // 요약 화면에서 홈으로
      },
    } as any);
  }

  if (!steps.length || !routineTitle) {
    return (
      <View style={[styles.page, { justifyContent: 'center', alignItems: 'center' }]}>
        <Text style={{ fontSize: 16, marginBottom: 10 }}>루틴 정보가 없어요.</Text>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Text style={styles.backText}>뒤로가기</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const current = steps[stepIdx];

  // 진행률
  const stepProgress = totalSteps > 0 ? (stepIdx + 1) / totalSteps : 0;
  const setProgress = (setIdx + 1) / Math.max(1, setCount);

  if (ready) {
    return (
      <View style={styles.page}>
        <Text style={styles.title}>오늘의 루틴 시작</Text>

        {/* 상단 요약 카드 */}
        <View style={styles.card}>
          <View style={styles.badgeRow}>
            <Text style={[styles.badge, styles.badgeGray]}>{subject || '기타'}</Text>
      
          </View>
          <Text style={styles.cardTitle}>{routineTitle}</Text>
          {!!content && <Text style={styles.metaDim}>내용: {content}</Text>}

          {/* 스텝 목록(간단) */}
          <View style={styles.stepList}>
            {steps.map((s, i) => (
              <Text key={i} style={styles.stepChip}>• {s.step} ({s.minutes}분)</Text>
            ))}
          </View>
        </View>

        {/* 진행 바(프리뷰) */}
        <View style={styles.progressBlock}>
         

          <Text style={styles.progressLabel}>스텝 진행</Text>
          <View style={styles.progressBar}><View style={[styles.progressFillBlue, { width: `${Math.round(stepProgress * 100)}%` }]} /></View>
        </View>

        <TouchableOpacity onPress={() => { setReady(false); setRunning(true); }} style={styles.readyBtn}>
          <Text style={styles.readyText}>시작하기</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.page}>
      <Text style={styles.title}>루틴 진행 중</Text>

      {/* 상단 요약 */}
      <View style={styles.card}>
        <View style={styles.badgeRow}>
          <Text style={[styles.badge, styles.badgeGray]}>{subject || '기타'}</Text>
          
        </View>
        <Text style={styles.cardTitle}>{routineTitle}</Text>
        {!!content && <Text style={styles.metaDim}>내용: {content}</Text>}

        {/* 진행 바 */}
        <View style={styles.progressBlock}>
         
          <Text style={styles.progressLabel}>스텝 진행</Text>
          <View style={styles.progressBar}><View style={[styles.progressFillBlue, { width: `${Math.round(stepProgress * 100)}%` }]} /></View>
        </View>
      </View>

      {/* 현재 스텝 */}
      <View style={styles.nowBox}>
        <Text style={styles.nowLabel}>지금 할 일</Text>
        <Text style={styles.nowTitle} numberOfLines={2}>{current.step}</Text>
        <Text style={styles.nowTimer}>{formatLeft(leftSec)}</Text>

        <View style={styles.btnRow}>
          <TouchableOpacity onPress={() => setRunning((r) => !r)} style={[styles.btn, styles.primary]}>
            <Text style={styles.btnText}>{running ? '일시정지' : '재개'}</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={handleNextStep} style={[styles.btn, styles.blue]}>
            <Text style={styles.btnText}>{isLastStepInSet && isLastSet ? '마치기' : '다음'}</Text>
          </TouchableOpacity>
        </View>

        {/* ⭐ 임시저장 후 나가기 */}
        <TouchableOpacity onPress={saveDraftAndExit} style={[styles.btn, styles.gray, { marginTop: 8 }]}>
          <Text style={styles.btnText}>임시저장 후 나가기</Text>
        </TouchableOpacity>
      </View>

      {/* 스텝 목록 하이라이트 */}
      <View style={styles.stepsCard}>
        <Text style={styles.stepsHeader}>이번 스텝</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingVertical: 4 }}>
          {steps.map((s, i) => {
            const active = i === stepIdx;
            return (
              <View key={i} style={[styles.stepPill, active ? styles.stepPillActive : null]}>
                <Text style={[styles.stepPillText, active ? styles.stepPillTextActive : null]}>
                  {i + 1}. {s.step}
                </Text>
              </View>
            );
          })}
        </ScrollView>
      </View>

      {/* 다음 미리보기 */}
      <View style={styles.preview}>
        <Text style={styles.previewTitle}>다음 순서</Text>
        <Text style={styles.previewText}>
          {isLastStepInSet
            ? (isLastSet ? '없음 (마무리)' : `세트 ${setIdx + 2} 시작`)
            : steps[stepIdx + 1]?.step}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  /* 레이아웃 */
  page: { flex: 1, backgroundColor: '#FFFFFF', paddingHorizontal: 20, paddingTop: 50, paddingBottom: 16 },
  title: { fontSize: 18, fontWeight: 'bold', textAlign: 'center', marginBottom: 14, marginTop: 60, color: '#111827' },

  /* 카드 & 배지 */
  card: {
    backgroundColor: '#F8FAFC',
    borderRadius: 16,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  badgeRow: { flexDirection: 'row', gap: 6, marginBottom: 6 },
  badge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, fontSize: 12, fontWeight: '800', overflow: 'hidden' },
  badgeGray: { backgroundColor: '#E5E7EB', color: '#374151' },
  badgeBlue: { backgroundColor: '#DBEAFE', color: '#1D4ED8' },
  cardTitle: { fontSize: 16, fontWeight: '900', color: '#0F172A' },
  metaDim: { fontSize: 12, color: '#6B7280', marginTop: 4 },

  stepList: { marginTop: 8, backgroundColor: '#FFF', borderRadius: 12, padding: 10, borderWidth: 1, borderColor: '#E5E7EB' },
  stepChip: { fontSize: 12, color: '#111', marginBottom: 4 },

  /* 진행바 */
  progressBlock: { marginTop: 8 },
  progressLabel: { fontSize: 11, color: '#6B7280', marginTop: 6, marginBottom: 4, fontWeight: '700' },
  progressBar: { height: 10, backgroundColor: '#E5E7EB', borderRadius: 999, overflow: 'hidden' },
  progressFill: { height: '100%', backgroundColor: '#10B981' },
  progressFillBlue: { height: '100%', backgroundColor: '#2563EB' },

  /* 준비 버튼 */
  readyBtn: { height: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: '#3B82F6', marginTop: 14 },
  readyText: { color: '#fff', fontWeight: '900', fontSize: 15 },

  /* 현재 스텝 영역 */
  nowBox: { backgroundColor: '#EEF2FF', borderRadius: 16, padding: 16, marginTop: 8 },
  nowLabel: { fontSize: 12, color: '#374151' },
  nowTitle: { fontSize: 18, fontWeight: '900', marginTop: 4, color: '#1F2937' },
  nowTimer: { marginTop: 10, fontSize: 32, fontWeight: '900', color: '#111', letterSpacing: 0.5 },

  btnRow: { flexDirection: 'row', gap: 10, marginTop: 14 },
  btn: { flex: 1, height: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  primary: { backgroundColor: '#059669' },
  blue: { backgroundColor: '#2563EB' },
  gray: { backgroundColor: '#6B7280' },
  btnText: { color: '#fff', fontWeight: '800', fontSize: 15 },

  /* 스텝 목록 하이라이트 */
  stepsCard: {
    marginTop: 12,
    backgroundColor: '#F8FAFC',
    borderRadius: 14,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  stepsHeader: { fontSize: 12, color: '#374151', fontWeight: '700', marginBottom: 6 },
  stepPill: { paddingHorizontal: 10, paddingVertical: 6, backgroundColor: '#E5E7EB', borderRadius: 999, marginRight: 8 },
  stepPillActive: { backgroundColor: '#1D4ED8' },
  stepPillText: { fontSize: 12, color: '#374151', fontWeight: '800' },
  stepPillTextActive: { color: '#FFFFFF' },

  /* 다음 미리보기 */
  preview: { marginTop: 12, backgroundColor: '#F5F5F5', borderRadius: 12, padding: 12, borderWidth: 1, borderColor: '#E5E7EB' },
  previewTitle: { fontSize: 12, fontWeight: '700', color: '#374151' },
  previewText: { fontSize: 14, marginTop: 6, color: '#111' },

  /* 에러/뒤로 버튼 */
  backBtn: { backgroundColor: '#3B82F6', paddingHorizontal: 16, paddingVertical: 10, borderRadius: 10 },
  backText: { color: '#fff', fontWeight: '700' },
});
