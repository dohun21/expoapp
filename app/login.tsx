// app/login.tsx
import { useRouter } from 'expo-router';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { useState } from 'react';
import {
  Pressable,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { auth } from '../firebaseConfig';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(false);

  const emailDomains = ['gmail.com', 'naver.com', 'daum.net', 'icloud.com',];

  const handleLogin = async () => {
    if (!email || !pw) {
      alert('이메일과 비밀번호를 입력해주세요.');
      return;
    }

    if (pw.length < 8 || pw.length > 16) {
      alert('비밀번호는 8자 이상으로 입력해주세요.');
      return;
    }

    try {
      await signInWithEmailAndPassword(auth, email, pw);
      router.push('/home');
    } catch (error: any) {
      alert('로그인 실패: ' + error.message);
    }
  };

  const handleEmailChange = (text: string) => {
    setEmail(text);
    setShowSuggestions(text.includes('@') && !text.split('@')[1]);
  };

  const handleDomainSelect = (domain: string) => {
    const [local] = email.split('@');
    const completed = `${local}@${domain}`;
    setEmail(completed);
    setShowSuggestions(false);
  };

  return (
    <View style={{ flex: 1, backgroundColor: '#fff', paddingHorizontal: 30, paddingTop: 120 }}>
      <Text style={{ fontSize: 36, fontWeight: '700', marginBottom: 60, marginTop: 40 }}>로그인</Text>

      {/* 이메일 입력 */}
      <View style={{ marginBottom: 16 }}>
        <Text style={{ fontSize: 13, color: '#6B7280', marginBottom: 8 }}>이메일 입력</Text>
        <TextInput
          value={email}
          onChangeText={handleEmailChange}
          placeholder="이메일을 입력하세요"
          placeholderTextColor="#9CA3AF"
          autoCapitalize="none"
          style={{
            height: 48,
            backgroundColor: '#F2F2F2',
            borderRadius: 8,
            paddingHorizontal: 16,
            fontSize: 14,
            color: '#111827',
          }}
        />
        {showSuggestions && (
          <View style={{
            backgroundColor: '#F2F2F2',
            borderRadius: 8,
            marginTop: 4,
            overflow: 'hidden',
          }}>
            {emailDomains.map((domain, index) => (
              <View key={domain}>
                <Pressable
                  onPress={() => handleDomainSelect(domain)}
                  style={{
                    paddingVertical: 10,
                    paddingHorizontal: 12,
                  }}
                >
                  <Text style={{ fontSize: 14, color: '#111827' }}>
                    {email.split('@')[0]}@{domain}
                  </Text>
                </Pressable>
                {index < emailDomains.length - 1 && (
                  <View style={{ height: 1, backgroundColor: '#D1D5DB', marginHorizontal: 12 }} />
                )}
              </View>
            ))}
          </View>
        )}
      </View>

      {/* 비밀번호 입력 */}
      <View style={{ marginBottom: 40 }}>
        <Text style={{ fontSize: 13, color: '#6B7280', marginBottom: 6 }}>비밀번호 입력</Text>
        <TextInput
          value={pw}
          onChangeText={setPw}
          placeholder="비밀번호를 입력하세요"
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

      {/* 로그인 버튼 */}
      <TouchableOpacity
        style={{
          backgroundColor: '#3B82F6',
          height: 48,
          borderRadius: 24,
          justifyContent: 'center',
          alignItems: 'center',
          marginBottom: 80,
        }}
        onPress={handleLogin}
      >
        <Text style={{ color: '#fff', fontSize: 16, fontWeight: '500' }}>로그인</Text>
      </TouchableOpacity>

      {/* 회원가입 이동 */}
      <TouchableOpacity onPress={() => router.push('/signup')}>
        <Text style={{ fontSize: 13, color: '#9CA3AF', textAlign: 'right' }}>회원가입</Text>
      </TouchableOpacity>
    </View>
  );
}
