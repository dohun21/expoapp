// app/index.tsx
import { useRouter } from 'expo-router';
import { Text, TouchableOpacity, View } from 'react-native';

export default function StartPage() {
  const router = useRouter();

  return (
    <View style={{
      flex: 1,
      backgroundColor: '#ffffff',
      alignItems: 'center',
      paddingHorizontal: 24
    }}>
      {/* StudyFit 텍스트 */}
      <Text style={{
        fontSize: 40,
        fontWeight: 'bold',
        color: '#059669',
        marginTop: 190,
        marginBottom: 300,
      }}>
        StudyFit
      </Text>


      {/* 로고 이미지 */}
      

      {/* 시작하기 버튼 */}
      <TouchableOpacity
        onPress={() => router.push('/login')}
        style={{
          marginTop: 50,
          width: '100%',
          maxWidth: 320,
          height: 48,
          backgroundColor: '#3B82F6',
          borderRadius: 20,
          justifyContent: 'center',
          alignItems: 'center'
        }}
      >
        <Text style={{
          color: '#ffffff',
          fontSize: 14,
          fontWeight: '500'
        }}>
          시작하기
        </Text>
      </TouchableOpacity>
    </View>
  );
}
