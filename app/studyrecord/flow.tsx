import AsyncStorage from '@react-native-async-storage/async-storage';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, ScrollView, Text, TouchableOpacity, View } from 'react-native';

export default function FlowTimerPage() {
  const { subject = '', content = '' } = useLocalSearchParams();
  const router = useRouter();

  const [seconds, setSeconds] = useState(0);
  const [isRunning, setIsRunning] = useState(true);
  const [memo, setMemo] = useState('');

  useEffect(() => {
    let timer: number;
    if (isRunning) {
      timer = setInterval(() => setSeconds(prev => prev + 1), 1000);
    }
    return () => clearInterval(timer);
  }, [isRunning]);

  const formatTime = (sec: number) => {
    const m = String(Math.floor(sec / 60)).padStart(2, '0');
    const s = String(sec % 60).padStart(2, '0');
    return `${m}:${s}`;
  };

  const handleEnd = async () => {
    const minutes = Math.floor(seconds / 60);
    const remainSec = seconds % 60;
    const formattedTime = `${minutes}분 ${remainSec}초`;

    try {
      await AsyncStorage.setItem('subject', subject as string);
      await AsyncStorage.setItem('content', content as string);
      await AsyncStorage.setItem('studyTime', formattedTime);
      await AsyncStorage.setItem('memo', memo);
      await AsyncStorage.setItem('checkBadge', 'true');
      router.push('/studyrecord/summary');
    } catch (error) {
      Alert.alert('저장 실패', '로컬 저장소에 데이터를 저장하는 데 실패했어요.');
    }
  };

  return (
    <ScrollView style={{ flex: 1, paddingHorizontal: 24, paddingTop: 63, backgroundColor: '#FFFFFF' }}>
      <Text style={{ fontSize: 16, fontWeight: 'bold', marginBottom: 60, marginLeft: 30, marginTop:50}}>자유 흐름 모드</Text>

      {/* 과목 박스 */}
      <View style={{
        width: '100%', height: 90, backgroundColor: '#FFFFFF',
        borderRadius: 16, shadowColor: '#000', shadowOpacity: 0.1, shadowOffset: { width: 0, height: 4 },
        justifyContent: 'center', paddingHorizontal: 30, marginBottom: 24
      }}>
        <Text style={{ fontSize: 14, fontWeight: '500' }}>과목 : {subject}</Text>
      </View>

      {/* 타이머 및 내용 박스 */}
      <View style={{
        width: '100%', height: 291, backgroundColor: '#FFFFFF',
        borderRadius: 16, shadowColor: '#000', shadowOpacity: 0.1, shadowOffset: { width: 0, height: 4 },
        padding: 20, alignItems: 'center', justifyContent: 'center', marginBottom: 60
      }}>
        <Text style={{ fontSize: 14, fontWeight: '800', color: '#4B5563', marginBottom: 10 }}>{content}</Text>
        <Text style={{ fontSize: 56, fontWeight: '900', color: '#3B82F6', marginBottom: 30 }}>{formatTime(seconds)}</Text>

        <View style={{ flexDirection: 'row', gap: 15 }}>
          <TouchableOpacity onPress={() => setIsRunning(!isRunning)} style={buttonStyle('#FCFCFC')}>
            <Text style={textStyle('#000')}>{isRunning ? '일시정지' : '다시시작'}</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => { setSeconds(0); setIsRunning(false); }} style={buttonStyle('#E5E7EB')}>
            <Text style={textStyle('#000')}>리셋</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={handleEnd} style={buttonStyle('#3B82F6')}>
            <Text style={textStyle('#fff')}>종료</Text>
          </TouchableOpacity>
        </View>
      </View>

      
    </ScrollView>
  );
}

const buttonStyle = (bg: string) => ({
  backgroundColor: bg,
  borderRadius: 10,
  paddingHorizontal: 20,
  paddingVertical: 10,
});

const textStyle = (color: string) => ({
  fontSize: 14,
  color,
});
