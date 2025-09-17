import AsyncStorage from '@react-native-async-storage/async-storage';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

function formatStudyTime(totalSec: number) {
  const safe = Math.max(0, Math.floor(totalSec));
  const h = Math.floor(safe / 3600);
  const m = Math.floor((safe % 3600) / 60);
  const s = safe % 60;
  if (h > 0) return `${h}시간 ${m}분 ${s}초`;
  return `${m}분 ${s}초`;
}

export default function FlowPlayer() {
  const router = useRouter();
  const { subject, content, minutes, planId, queue } = useLocalSearchParams<{
    subject?: string | string[];
    content?: string | string[];
    minutes?: string | string[];
    planId?: string | string[];
    queue?: string | string[];
  }>();

  const subj = Array.isArray(subject) ? subject[0] : subject || '기타';
  const cont = Array.isArray(content) ? content[0] : content || '';
  const minsRaw = Array.isArray(minutes) ? minutes[0] : minutes;
  const targetMinutes = minsRaw ? Number(minsRaw) : NaN; // 없을 수 있음
  const isCountdown = Number.isFinite(targetMinutes) && targetMinutes > 0; // true면 카운트다운
  const plan = Array.isArray(planId) ? planId[0] : planId || '';
  const queueRaw = Array.isArray(queue) ? queue[0] : queue || '';

  // 공통 상태
  const [ready, setReady] = useState(true);
  const [running, setRunning] = useState(false);

  // 타이머 상태
  const initialSeconds = isCountdown ? Math.floor(targetMinutes * 60) : 0;
  const [seconds, setSeconds] = useState<number>(initialSeconds);

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // label/표시용 formatter
  const formatMMSS = (s: number) => {
    const mm = Math.floor(Math.max(0, s) / 60);
    const ss = Math.max(0, s) % 60;
    return `${mm}분 ${String(ss).padStart(2, '0')}초`;
  };

  function stopTimer() {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }

  // 타이머 루프
  useEffect(() => {
    if (!running) return;
    if (intervalRef.current) return;

    intervalRef.current = setInterval(() => {
      setSeconds((prev) => {
        if (isCountdown) {
          // 카운트다운: 0이 되면 종료
          if (prev <= 1) {
            stopTimer();
            // finish는 setState 이후로 호출
            setTimeout(() => finish(prev <= 0 ? 0 : prev - 1, true), 0);
            return 0;
          }
          return prev - 1;
        } else {
          // 카운트업
          return prev + 1;
        }
      });
    }, 1000);

    return () => {
      stopTimer();
    };
  }, [running, isCountdown]);

  // 시작 시 seconds 초기화
  const onStart = () => {
    setReady(false);
    setSeconds(isCountdown ? Math.floor(targetMinutes * 60) : 0);
    setRunning(true);
  };

  async function finish(currentSeconds?: number, autoEnd = false) {
    stopTimer();

    // 기록 시간 계산
    let total: number;
    if (isCountdown) {
      const target = Math.floor((Number.isFinite(targetMinutes) ? targetMinutes : 0) * 60);
      const leftNow = typeof currentSeconds === 'number' ? currentSeconds : seconds;
      total = Math.max(0, target - Math.max(0, leftNow));
    } else {
      total = Math.max(0, typeof currentSeconds === 'number' ? currentSeconds : seconds);
    }

    const timeStr = formatStudyTime(total);
    await AsyncStorage.setItem('subject', String(subj));
    await AsyncStorage.setItem('content', String(cont));
    await AsyncStorage.setItem('studyTime', timeStr);
    await AsyncStorage.setItem('memo', '');

    router.replace({
      pathname: '/session/summary',
      params: {
        backTo: '/plan/batch',
        donePlanId: String(plan),
        queue: String(queueRaw || ''),
        mode: 'flow',
        ...(autoEnd ? {} : {}), // 유지
      },
    } as any);
  }

  // ⭐ 임시저장 후 나가기(진행 중 화면) → 곧장 홈으로
  async function saveDraftAndExit() {
    stopTimer();

    let elapsed: number;
    if (isCountdown) {
      const target = Math.floor((Number.isFinite(targetMinutes) ? targetMinutes : 0) * 60);
      elapsed = Math.max(0, target - Math.max(0, seconds));
    } else {
      elapsed = Math.max(0, seconds);
    }

    const timeStr = formatStudyTime(elapsed);
    await AsyncStorage.setItem('subject', String(subj));
    await AsyncStorage.setItem('content', String(cont));
    await AsyncStorage.setItem('studyTime', timeStr);
    await AsyncStorage.setItem('memo', '[임시저장] 진행 중 나가기');

    // ✅ summary 거치지 않고 홈으로 바로 이동
    router.replace('/home' as any);
  }

  // ✅ 시작 전(소개 화면)에서도 임시저장 후 나가기 → 곧장 홈
  async function saveDraftAndExitFromReady() {
    const timeStr = formatStudyTime(0); // 아직 시작 전이므로 0초
    await AsyncStorage.setItem('subject', String(subj));
    await AsyncStorage.setItem('content', String(cont));
    await AsyncStorage.setItem('studyTime', timeStr);
    await AsyncStorage.setItem('memo', '[임시저장] 시작 전 나가기');

    // ✅ summary 거치지 않고 홈으로 바로 이동
    router.replace('/home' as any);
  }

  // 화면
  if (ready) {
    return (
      <View style={styles.page}>
        <Text style={styles.title}>오늘의 공부 시작</Text>
        <View style={styles.card}>
          <Text style={styles.meta}>과목: {subj}</Text>
          {!!cont && <Text style={styles.meta}>내용: {cont}</Text>}
          {isCountdown ? (
            <Text style={[styles.meta, { fontWeight: '700', marginTop: 6 }]}>
              목표 {targetMinutes}분 (카운트다운)
            </Text>
          ) : (
            <Text style={[styles.meta, { fontWeight: '700', marginTop: 6 }]}>자유 흐름 (카운트업)</Text>
          )}
        </View>

        <TouchableOpacity onPress={onStart} style={styles.readyBtn}>
          <Text style={styles.readyText}>시작하기</Text>
        </TouchableOpacity>

        {/* ✅ 시작 전에도 임시저장 후 나가기 */}
        <TouchableOpacity
          onPress={saveDraftAndExitFromReady}
          style={[styles.readyBtn, { backgroundColor: '#6B7280', marginTop: 10 }]}
        >
          <Text style={styles.readyText}>임시저장 후 나가기</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.page}>
      <Text style={styles.title}>진행 중</Text>
      <View style={styles.infoRow}>
        <Text style={styles.infoText}>{subj}</Text>
        {!!cont && <Text style={[styles.infoText, { color: '#6B7280' }]} numberOfLines={1}>· {cont}</Text>}
      </View>

      <View style={styles.nowBox}>
        <Text style={styles.nowLabel}>{isCountdown ? '남은 시간' : '경과 시간'}</Text>
        <Text style={styles.nowTimer}>{formatMMSS(seconds)}</Text>

        <View style={styles.btnRow}>
          <TouchableOpacity onPress={() => setRunning((r) => !r)} style={[styles.btn, styles.primary]}>
            <Text style={styles.btnText}>{running ? '일시정지' : '재개'}</Text>
          </TouchableOpacity>

          <TouchableOpacity onPress={() => finish()} style={[styles.btn, styles.blue]}>
            <Text style={styles.btnText}>마치기</Text>
          </TouchableOpacity>
        </View>

        {/* ⭐ 임시저장 후 나가기 → 홈 */}
        <TouchableOpacity onPress={saveDraftAndExit} style={[styles.btn, styles.gray, { marginTop: 8 }]}>
          <Text style={styles.btnText}>임시저장 후 나가기</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: 'white', paddingHorizontal: 24, paddingTop: 50 },
  title: { fontSize: 18, fontWeight: 'bold', textAlign: 'center', marginBottom: 18, marginTop: 60 },
  card: { backgroundColor: '#F5F5F5', borderRadius: 12, padding: 12, marginBottom: 16 },
  meta: { fontSize: 13 },

  readyBtn: { height: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: '#3B82F6' },
  readyText: { color: '#fff', fontWeight: '900', fontSize: 15 },

  infoRow: { flexDirection: 'row', justifyContent: 'center', gap: 6, marginBottom: 10 },
  infoText: { fontSize: 14, fontWeight: '800', color: '#111827' },

  nowBox: { backgroundColor: '#EEF2FF', borderRadius: 16, padding: 16 },
  nowLabel: { fontSize: 12, color: '#374151' },
  nowTimer: { marginTop: 8, fontSize: 30, fontWeight: '900', color: '#111' },
  btnRow: { flexDirection: 'row', gap: 8, marginTop: 12 },
  btn: { height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center', flex: 1 },
  primary: { backgroundColor: '#059669' },
  blue: { backgroundColor: '#3B82F6' },
  gray: { backgroundColor: '#6B7280' },
  btnText: { color: '#fff', fontWeight: '800' },
});
