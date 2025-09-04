import AsyncStorage from '@react-native-async-storage/async-storage';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';

export default function GoalTimerPage() {
  const { subject = '', content = '', time = '0' } = useLocalSearchParams();
  const router = useRouter();

  const totalSeconds = parseInt(time as string) * 60;
  const [timeLeft, setTimeLeft] = useState(totalSeconds);
  const [isRunning, setIsRunning] = useState(true);
  const [memo, setMemo] = useState('');

  useEffect(() => {
    let timer: ReturnType<typeof setInterval>;

    if (isRunning && timeLeft > 0) {
      timer = setInterval(() => setTimeLeft(prev => prev - 1), 1000);
    } else if (timeLeft === 0) {
      handleEnd();
    }

    return () => clearInterval(timer);
  }, [isRunning, timeLeft]);

  const formatTime = (sec: number) => {
    const m = String(Math.floor(sec / 60)).padStart(2, '0');
    const s = String(sec % 60).padStart(2, '0');
    return `${m}:${s}`;
  };

  const handleEnd = async () => {
    const studiedSeconds = totalSeconds - timeLeft;
    const minutes = Math.floor(studiedSeconds / 60);
    const seconds = studiedSeconds % 60;
    const formatted = `${minutes}분 ${seconds}초`;

    // ✅ AsyncStorage로 저장
    await AsyncStorage.setItem('subject', subject as string);
    await AsyncStorage.setItem('content', content as string);
    await AsyncStorage.setItem('studyTime', formatted);
    await AsyncStorage.setItem('memo', memo);
    await AsyncStorage.setItem('checkBadge', 'true');

    router.push('/studyrecord/summary');
  };

  return (
    <ScrollView style={{ flex: 1, paddingHorizontal: 24, paddingTop: 63, backgroundColor: '#FFFFFF' }}>
      <Text style={{ fontSize: 16, fontWeight: 'bold', marginBottom: 60, marginLeft: 30 }}>목표 모드</Text>

      <View style={{
        width: '100%', height: 90, backgroundColor: '#FFFFFF',
        borderRadius: 16, shadowColor: '#000', shadowOpacity: 0.1, shadowOffset: { width: 0, height: 4 },
        justifyContent: 'center', paddingHorizontal: 30, marginBottom: 24
      }}>
        <Text style={{ fontSize: 14, fontWeight: '500' }}>과목 : {subject}</Text>
      </View>

      <View style={{
        width: '100%', height: 291, backgroundColor: '#FFFFFF',
        borderRadius: 16, shadowColor: '#000', shadowOpacity: 0.1, shadowOffset: { width: 0, height: 4 },
        padding: 20, alignItems: 'center', justifyContent: 'center', marginBottom: 60
      }}>
        <Text style={{ fontSize: 14, fontWeight: '800', color: '#4B5563', marginBottom: 10 }}>{content}</Text>
        <Text style={{ fontSize: 56, fontWeight: '900', color: '#3B82F6', marginBottom: 30 }}>{formatTime(timeLeft)}</Text>

        <View style={{ flexDirection: 'row', gap: 15 }}>
          <TouchableOpacity onPress={() => setIsRunning(!isRunning)} style={buttonStyle('#FCFCFC')}>
            <Text style={textStyle('#000')}>{isRunning ? '일시정지' : '다시시작'}</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => { setTimeLeft(totalSeconds); setIsRunning(false); }} style={buttonStyle('#E5E7EB')}>
            <Text style={textStyle('#000')}>리셋</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={handleEnd} style={buttonStyle('#3B82F6')}>
            <Text style={textStyle('#fff')}>종료</Text>
          </TouchableOpacity>
        </View>
      </View>

      <View style={{ backgroundColor: '#FFFFFF', borderRadius: 20, padding: 10, marginBottom: 100 }}>
        <View style={{
          height: 90, backgroundColor: '#F3F3F3', borderRadius: 16, borderColor: '#E5E7EB', borderWidth: 1,
          paddingHorizontal: 16, paddingVertical: 12, justifyContent: 'center'
        }}>
          <TextInput
            multiline
            placeholder="메모를 입력해보세요 . . ."
            value={memo}
            onChangeText={setMemo}
            style={{
              height: '100%', fontSize: 14, color: '#374151',
              textAlignVertical: 'top'
            }}
          />
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
