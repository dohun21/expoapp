// app/(tabs)/StudySummaryPage.tsx
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import { onAuthStateChanged } from 'firebase/auth';
import { addDoc, collection, doc, getDoc, Timestamp, updateDoc } from 'firebase/firestore';
import React, { useEffect, useState } from 'react';
import { Alert, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { auth, db } from '../../firebaseConfig';

/* ===================== Utils ===================== */
// ✅ toLocaleString(timeZone) 대신 UTC 오프셋으로 KST 계산 (NaN-NaN-NaN 방지)
function getTodayKSTDateString() {
  const now = new Date();
  const utcMs = now.getTime() + now.getTimezoneOffset() * 60000; // UTC 기준 ms
  const kst = new Date(utcMs + 9 * 60 * 60 * 1000);              // UTC+9
  const y = kst.getFullYear();
  const m = String(kst.getMonth() + 1).padStart(2, '0');
  const d = String(kst.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;                                       // "YYYY-MM-DD"
}

// "x시간 y분 z초" 문자열 → 총 초
function extractSeconds(str: string) {
  const h = Number(str.match(/(\d+)\s*시간/)?.[1] ?? 0);
  const m = Number(str.match(/(\d+)\s*분/)?.[1] ?? 0);
  const s = Number(str.match(/(\d+)\s*초/)?.[1] ?? 0);
  return h * 3600 + m * 60 + s;
}

/* ===================== Component ===================== */
export default function StudySummaryPage() {
  const router = useRouter();

  const [subject, setSubject] = useState('');
  const [content, setContent] = useState('');
  const [studyTime, setStudyTime] = useState('');
  const [memo, setMemo] = useState('');
  const [stars, setStars] = useState(0);
  const [feelings, setFeelings] = useState<string[]>([]);
  const [goalStatus, setGoalStatus] = useState('');
  const [uid, setUid] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      setSubject((await AsyncStorage.getItem('subject')) || '수학');
      setContent((await AsyncStorage.getItem('content')) || '문제집 3장 풀기');
      setStudyTime((await AsyncStorage.getItem('studyTime')) || '0분 0초');
      setMemo((await AsyncStorage.getItem('memo')) || '');
    };

    const unsubscribe = onAuthStateChanged(auth, (user) => {
      if (user) setUid(user.uid);
    });

    load();
    return () => unsubscribe();
  }, []);

  const toggleFeeling = (tag: string) => {
    setFeelings((prev) => (prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]));
  };

  const handleSubmit = async () => {
    if (!uid) {
      Alert.alert('로그인이 필요해요', '다시 로그인한 뒤 저장해 주세요.');
      return;
    }

    const seconds = extractSeconds(studyTime || '0분 0초');
    const prev = parseInt((await AsyncStorage.getItem('studiedSeconds')) || '0', 10);
    const newTotal = prev + seconds;

    const record = {
      subject,
      content,
      studyTime,
      studySeconds: seconds,            // ✅ 숫자(초)
      memo,
      stars,
      feelings,
      goalStatus,
      recordDate: getTodayKSTDateString(), // ✅ KST 날짜
      createdAt: Timestamp.now(),          // 표시/정렬용
      uid,
    };

    try {
      await addDoc(collection(db, 'studyRecords'), record);
      await AsyncStorage.setItem('studiedSeconds', String(newTotal));
      await AsyncStorage.setItem('checkBadge', 'true');

      // 누적 공부 시간(분) 갱신
      const userRef = doc(db, 'users', uid);
      const userSnap = await getDoc(userRef);
      const oldMinutes = userSnap.exists() ? userSnap.data().totalStudyMinutes || 0 : 0;
      await updateDoc(userRef, { totalStudyMinutes: oldMinutes + Math.floor(seconds / 60) });

      Alert.alert('✅ 저장 완료', '기록이 저장되었어요. 홈으로 이동합니다.');
      router.replace('/home');
    } catch (err) {
      console.error('❌ 저장 실패:', err);
      Alert.alert('오류', '기록 저장에 실패했어요.');
    }
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: 'white', paddingHorizontal: 24, paddingTop: 50 }}>
      <Text style={{ fontSize: 18, fontWeight: 'bold', textAlign: 'center', marginBottom: 20, marginTop: 60 }}>
        오늘의 공부 기록
      </Text>

      <View style={{ marginBottom: 28 }}>
        <Text style={{ fontSize: 14, fontWeight: 'bold', marginBottom: 8 }}>📘 공부한 내용</Text>
        <View style={{ backgroundColor: '#F5F5F5', borderRadius: 12, padding: 12 }}>
          <Text style={{ fontSize: 13 }}>과목: {subject}</Text>
          <Text style={{ fontSize: 13 }}>내용: {content}</Text>
          <Text style={{ fontSize: 13 }}>공부 시간: {studyTime}</Text>
        </View>
      </View>

      <View style={{ marginBottom: 32 }}>
        <Text style={{ fontSize: 14, fontWeight: 'bold', marginBottom: 8 }}>📈 집중도는 어땠나요?</Text>
        <View style={{ flexDirection: 'row', gap: 6 }}>
          {[1, 2, 3, 4, 5].map((n) => (
            <Text key={n} onPress={() => setStars(n)} style={{ fontSize: 22 }}>
              {stars >= n ? '⭐️' : '☆'}
            </Text>
          ))}
        </View>
      </View>

      <View style={{ marginBottom: 32 }}>
        <Text style={{ fontSize: 14, fontWeight: 'bold', marginBottom: 8 }}>🧠 오늘의 느낌은?</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {['#완전집중', '#조금힘들었음', '#의욕부활', '#몰입성공', '#다음엔더잘할래'].map((tag) => (
            <TouchableOpacity
              key={tag}
              onPress={() => toggleFeeling(tag)}
              style={{
                paddingHorizontal: 10,
                paddingVertical: 4,
                borderRadius: 20,
                backgroundColor: feelings.includes(tag) ? '#3B82F6' : '#F4F4F5',
              }}
            >
              <Text style={{ fontSize: 12, color: feelings.includes(tag) ? '#fff' : '#000' }}>{tag}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      <View style={{ marginBottom: 40 }}>
        <Text style={{ fontSize: 14, fontWeight: 'bold', marginBottom: 8 }}>🎯 오늘의 목표는 달성했나요?</Text>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {[
            { label: '✅ 완전히 달성', value: 'full', bg: '#ECFDF5', text: '#059669' },
            { label: '🟡 일부 달성', value: 'partial', bg: '#FEF9C3', text: '#CA8A04' },
            { label: '❌ 미달성', value: 'none', bg: '#FEE2E2', text: '#DC2626' },
          ].map((opt) => (
            <TouchableOpacity
              key={opt.value}
              onPress={() => setGoalStatus(opt.value)}
              style={{
                paddingHorizontal: 10,
                paddingVertical: 4,
                borderRadius: 20,
                backgroundColor: goalStatus === opt.value ? opt.bg : '#F3F4F6',
              }}
            >
              <Text style={{ fontSize: 12, color: goalStatus === opt.value ? opt.text : '#000' }}>{opt.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      <TouchableOpacity
        onPress={handleSubmit}
        style={{
          width: '100%',
          height: 44,
          backgroundColor: '#3B82F6',
          borderRadius: 20,
          justifyContent: 'center',
          alignItems: 'center',
          marginBottom: 100,
          shadowColor: '#000',
          shadowOpacity: 0.2,
          shadowRadius: 4,
          elevation: 3,
        }}
      >
        <Text style={{ color: '#fff', fontWeight: '600', fontSize: 14 }}>기록 저장하고 홈으로</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}
