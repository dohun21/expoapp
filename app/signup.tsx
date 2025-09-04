import { useRouter } from 'expo-router';
import { createUserWithEmailAndPassword } from 'firebase/auth';
import { doc, setDoc, Timestamp } from 'firebase/firestore';
import { useState } from 'react';
import { Text, TextInput, TouchableOpacity, View } from 'react-native';
import { auth, db } from '../firebaseConfig';

export default function SignupPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [error, setError] = useState('');

  const handleSignup = async () => {
    if (!email || !pw || !confirmPw) {
      setError('모든 항목을 입력하세요.');
      return;
    }

    if (pw.length < 8 || pw.length > 16) {
      setError('비밀번호는 8자 이상 16자 이하로 입력해주세요.');
      return;
    }

    if (pw !== confirmPw) {
      setError('비밀번호가 일치하지 않습니다.');
      return;
    }

    try {
      const userCredential = await createUserWithEmailAndPassword(auth, email, pw);
      const user = userCredential.user;

      // Firestore에 사용자 정보 저장
      await setDoc(doc(db, 'users', user.uid), {
        email: user.email,
        createdAt: Timestamp.now(),
        totalStudyMinutes: 0,
        settings: {
          pushEnabled: true,
        },
      });

      alert('회원가입 성공!');
      router.push('/login');
    } catch (error: any) {
      setError(error.message);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: '#fff', paddingHorizontal: 30, paddingTop: 120 }}>
      <Text style={{ fontSize: 32, fontWeight: '700', marginBottom: 40 }}>회원가입</Text>

      {/* 이메일 입력 */}
      <View style={{ marginBottom: 16 }}>
        <Text style={{ fontSize: 13, color: '#6B7280', marginBottom: 6 }}>이메일 입력</Text>
        <TextInput
          value={email}
          onChangeText={(text) => {
            setEmail(text);
            setError('');
          }}
          placeholder="example@email.com"
          placeholderTextColor="#9CA3AF"
          style={{
            height: 48,
            backgroundColor: '#F2F2F2',
            borderRadius: 8,
            paddingHorizontal: 16,
            fontSize: 14,
            color: '#111827',
          }}
        />
      </View>

      {/* 비밀번호 입력 */}
      <View style={{ marginBottom: 16 }}>
        <Text style={{ fontSize: 13, color: '#6B7280', marginBottom: 6 }}>비밀번호 (8~16자)</Text>
        <TextInput
          value={pw}
          onChangeText={(text) => {
            setPw(text);
            setError('');
          }}
          placeholder="••••••••"
          placeholderTextColor="#9CA3AF"
          secureTextEntry
          style={{
            height: 48,
            backgroundColor: '#F2F2F2',
            borderRadius: 8,
            paddingHorizontal: 16,
            fontSize: 14,
            color: '#111827',
          }}
        />
      </View>

      {/* 비밀번호 확인 */}
      <View style={{ marginBottom: 20 }}>
        <Text style={{ fontSize: 13, color: '#6B7280', marginBottom: 6 }}>비밀번호 확인</Text>
        <TextInput
          value={confirmPw}
          onChangeText={(text) => {
            setConfirmPw(text);
            setError('');
          }}
          placeholder="••••••••"
          placeholderTextColor="#9CA3AF"
          secureTextEntry
          style={{
            height: 48,
            backgroundColor: '#F2F2F2',
            borderRadius: 8,
            paddingHorizontal: 16,
            fontSize: 14,
            color: '#111827',
          }}
        />
      </View>

      {/* 회원가입 버튼 */}
      <TouchableOpacity
        style={{
          backgroundColor: '#3B82F6',
          height: 48,
          borderRadius: 24,
          justifyContent: 'center',
          alignItems: 'center',
          marginBottom: 40,
        }}
        onPress={handleSignup}
      >
        <Text style={{ color: '#fff', fontSize: 16, fontWeight: '500' }}>회원가입</Text>
      </TouchableOpacity>

      {/* 오류 메시지 */}
      {error !== '' && (
        <Text style={{ fontSize: 13, color: 'red', textAlign: 'center' }}>{error}</Text>
      )}

      {/* 로그인 이동 */}
      <TouchableOpacity onPress={() => router.push('/login')}>
        <Text style={{ fontSize: 13, color: '#9CA3AF', textAlign: 'right' }}>로그인으로</Text>
      </TouchableOpacity>
    </View>
  );
}
