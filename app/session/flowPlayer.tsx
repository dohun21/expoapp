// app/session/flowPlayer.tsx
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
  const mins = Number(Array.isArray(minutes) ? minutes[0] : minutes) || 25;
  const plan = Array.isArray(planId) ? planId[0] : planId || '';
  const queueRaw = Array.isArray(queue) ? queue[0] : queue || '';

  const [ready, setReady] = useState(true);
  const [left, setLeft] = useState(mins * 60);
  const [running, setRunning] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const elapsedRef = useRef(0);

  useEffect(() => {
    if (!running) return;
    if (intervalRef.current) return;
    intervalRef.current = setInterval(() => {
      setLeft((prev) => {
        if (prev <= 1) {
          elapsedRef.current += 1;
          clearInterval(intervalRef.current as any);
          intervalRef.current = null;
          finish();
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
  }, [running]);

  const format = (s: number) => {
    const mm = Math.floor(s / 60);
    const ss = s % 60;
    return `${mm}분 ${String(ss).padStart(2, '0')}초`;
  };

  function stopTimer() {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }

  async function finish() {
    stopTimer();
    const total = elapsedRef.current > 0 ? elapsedRef.current : mins * 60;
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
      },
    } as any);
  }

  if (ready) {
    return (
      <View style={styles.page}>
        <Text style={styles.title}>오늘의 공부 시작</Text>
        <View style={styles.card}>
          <Text style={styles.meta}>과목: {subj}</Text>
          {!!cont && <Text style={styles.meta}>내용: {cont}</Text>}
          <Text style={[styles.meta, { fontWeight: '700', marginTop: 6 }]}>목표 {mins}분 자유 흐름</Text>
        </View>
        <TouchableOpacity onPress={() => { setReady(false); setRunning(true); }} style={styles.readyBtn}>
          <Text style={styles.readyText}>시작하기</Text>
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
        <Text style={styles.nowLabel}>남은 시간</Text>
        <Text style={styles.nowTimer}>{format(left)}</Text>

        <View style={styles.btnRow}>
          <TouchableOpacity onPress={() => setRunning((r) => !r)} style={[styles.btn, styles.primary]}>
            <Text style={styles.btnText}>{running ? '일시정지' : '재개'}</Text>
          </TouchableOpacity>

          <TouchableOpacity onPress={finish} style={[styles.btn, styles.blue]}>
            <Text style={styles.btnText}>마치기</Text>
          </TouchableOpacity>
        </View>
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
  btn: { flex: 1, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  primary: { backgroundColor: '#059669' },
  blue: { backgroundColor: '#3B82F6' },
  btnText: { color: '#fff', fontWeight: '800' },
});
