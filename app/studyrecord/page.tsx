import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import {
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

export default function StudyRecordPage() {
  const router = useRouter();
  const [subject, setSubject] = useState('');
  const [content, setContent] = useState('');
  const [methods, setMethods] = useState<string[]>([]);
  const [mode, setMode] = useState<'goal' | 'flow'>('goal');
  const [customTime, setCustomTime] = useState('');
  const [modalVisible, setModalVisible] = useState(false);

  const handleStart = () => {
    const time = parseInt(customTime);
    if (!subject || !content || (mode === 'goal' && (isNaN(time) || time <= 0))) {
      alert('모든 필수 항목을 입력해주세요!');
      return;
    }

    const query = new URLSearchParams({
      subject,
      content,
      method: methods.join(','),
      ...(mode === 'goal' ? { time: String(time) } : {}),
    }).toString();

    router.push(`/studyrecord/${mode}?${query}`);
  };

  const toggleMethod = (m: string) => {
    setMethods((prev) =>
      prev.includes(m) ? prev.filter((item) => item !== m) : [...prev, m]
    );
  };

  const handlePresetClick = (time: number) => {
    if (parseInt(customTime) === time) {
      setCustomTime(''); // 다시 누르면 해제
    } else {
      setCustomTime(String(time));
    }
  };


  const subjectList = ['수학', '영어', '과학', '국어', '사회', '역사', '기타'];

  return (
    <ScrollView style={{ flex: 1, backgroundColor: '#F9FAFB' }} contentContainerStyle={{ alignItems: 'center', paddingBottom: 120 }}>
      <TouchableOpacity onPress={() => router.back()} style={{ position: 'absolute', top: 75, left: 20, zIndex: 10 }}>
        <Text style={{ fontSize: 30, color: '#3B82F6' }}>←</Text>
      </TouchableOpacity>

      <Text style={styles.title}>공부 기록하기 📚</Text>

      <View style={styles.box}>
        <Text style={styles.label}>공부 과목</Text>
        <TouchableOpacity style={styles.dropdownButton} onPress={() => setModalVisible(true)}>
          <Text style={{ fontSize: 12, color: subject ? '#000' : '#999' }}>{subject || '과목을 선택하세요'}</Text>
          <Ionicons name="chevron-down" size={16} color="#000" />
        </TouchableOpacity>

        <Modal transparent visible={modalVisible} animationType="fade">
          <TouchableOpacity style={styles.modalOverlay} onPress={() => setModalVisible(false)} activeOpacity={1}>
            <View style={styles.modalBox}>
              <FlatList
                data={subjectList}
                keyExtractor={(item) => item}
                renderItem={({ item }) => (
                  <Pressable style={styles.modalItem} onPress={() => { setSubject(item); setModalVisible(false); }}>
                    <Text>{item}</Text>
                  </Pressable>
                )}
              />
            </View>
          </TouchableOpacity>
        </Modal>

        <Text style={styles.label}>공부할 내용</Text>
        <TextInput
          value={content}
          onChangeText={setContent}
          placeholder="예: 수학 문제집 3p 풀기"
          placeholderTextColor="#9CA3AF" // ✅ placeholder 색 추가
          style={styles.input}
        />


        <Text style={styles.label}>공부 방식 (선택)</Text>
        <View style={styles.methodBox}>
          {['자습', '인강', '문제 풀이', '암기'].map((m) => (
            <TouchableOpacity
              key={m}
              onPress={() => toggleMethod(m)}
              style={[styles.methodButton, { backgroundColor: methods.includes(m) ? '#10B981' : '#E5E7EB' }]}
            >
              <Text style={{ fontSize: 12, color: methods.includes(m) ? '#fff' : '#000' }}>{m}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      <View style={styles.box}>
        <Text style={styles.label}>타이머 모드 선택</Text>
        <TouchableOpacity style={styles.radioRow} onPress={() => setMode('goal')}>
          <View style={getRadioOuterStyle(mode === 'goal')}>
            {mode === 'goal' && <View style={radioInnerStyle} />}
          </View>
          <Text style={styles.radioText}>목표 시간 모드</Text>
        </TouchableOpacity>
        {mode === 'goal' && (
          <View style={{ marginLeft: 20, marginBottom: 10 }}>
            <View style={styles.presetRow}>
              {[25, 50].map((time) => (
                <TouchableOpacity
                  key={time}
                  onPress={() => handlePresetClick(time)}
                  style={[styles.presetButton, { backgroundColor: parseInt(customTime) === time ? '#10B981' : '#E5E7EB' }]}
                >
                  <Text style={{ fontSize: 13, color: parseInt(customTime) === time ? '#fff' : '#000' }}>{time}분</Text>
                </TouchableOpacity>
              ))}
            </View>
            <TextInput
              placeholder="직접 입력 (분)"
              value={customTime}
              onChangeText={setCustomTime}
              keyboardType="numeric"
              style={[styles.input]}
            />
          </View>
        )}
        <TouchableOpacity style={styles.radioRow} onPress={() => setMode('flow')}>
          <View style={getRadioOuterStyle(mode === 'flow')}>
            {mode === 'flow' && <View style={radioInnerStyle} />}
          </View>
          <Text style={styles.radioText}>자유 흐름 모드</Text>
        </TouchableOpacity>
        <Text style={styles.radioSubText}>타이머는 0부터 시작하며, 사용자가 수동으로 종료합니다.</Text>
      </View>

      <TouchableOpacity onPress={handleStart} style={styles.startButton}>
        <Text style={styles.startButtonText}>공부 시작하기 →</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const getRadioOuterStyle = (selected: boolean) => ({
  width: 20,
  height: 20,
  borderRadius: 10,
  borderWidth: 2,
  borderColor: '#3B82F6',
  justifyContent: 'center' as const,
  alignItems: 'center' as const,
  backgroundColor: '#fff',
  marginRight: 8,
});

const radioInnerStyle = {
  width: 10,
  height: 10,
  borderRadius: 5,
  backgroundColor: '#3B82F6',
};

const styles = StyleSheet.create({
  title: {
    fontSize: 20,
    fontWeight: 'bold',
    marginTop: 80,
    marginBottom: 40,
  },
  box: {
    width: 345,
    backgroundColor: '#fff',
    padding: 20,
    borderRadius: 16,
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
    marginBottom: 30,
  },
  label: {
    fontSize: 14,
    fontWeight: 'bold',
    marginBottom: 12,
  },
  input: {
    height: 39,
    backgroundColor: '#FCFCFC',
    borderColor: '#E5E7EB',
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 12,
    fontSize: 12,
    marginBottom: 15,
  },
  dropdownButton: {
    height: 39,
    backgroundColor: '#FCFCFC',
    borderColor: '#E5E7EB',
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 12,
    justifyContent: 'space-between',
    alignItems: 'center',
    flexDirection: 'row',
    marginBottom: 15,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.2)',
    justifyContent: 'center',
    paddingHorizontal: 40,
  },
  modalBox: {
    backgroundColor: '#fff',
    borderRadius: 12,
    paddingVertical: 12,
  },
  modalItem: {
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderBottomColor: '#E5E7EB',
    borderBottomWidth: 1,
  },
  methodBox: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  methodButton: {
    paddingHorizontal: 12,
    height: 31,
    borderRadius: 16,
    justifyContent: 'center',
  },
  radioRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
    marginLeft: 2,
  },
  radioText: {
    fontSize: 14,
    marginLeft: 2,
    fontWeight: 'bold',
  },
  radioSubText: {
    marginLeft: 24,
    fontSize: 12,
    color: '#6B7280',
    marginTop: 4,
  },
  presetRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 10,
  },
  presetButton: {
    width: 50,
    height: 32,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  startButton: {
    marginTop: 24,
    width: '85%',
    height: 44,
    backgroundColor: '#3B82F6',
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  startButtonText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '600',
  },
});
