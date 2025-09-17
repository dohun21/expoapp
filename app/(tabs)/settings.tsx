// app/(tabs)/settings.tsx
import { useRouter } from 'expo-router';
import { onAuthStateChanged, signOut, updatePassword } from 'firebase/auth';
import {
  collection,
  doc,
  documentId,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  startAfter,
  updateDoc,
  where,
} from 'firebase/firestore';
import { useEffect, useState } from 'react';
import {
  Alert,
  Platform,
  ScrollView,
  Text,
  TouchableOpacity,
  View
} from 'react-native';
import { auth, db } from '../../firebaseConfig';

/* ===================== Types & Helpers ===================== */
type StudyRecord = {
  studyTime?: string;
  minutes?: number;
  totalMinutes?: number;
  seconds?: number;
  uid?: string; userId?: string; ownerId?: string; userUID?: string;
  email?: string; userEmail?: string;
  createdAt?: any; completedAt?: any; timestamp?: any; date?: any;
};
type RoutineRecord = {
  totalMinutes?: number;
  steps?: { minutes?: number }[];
  setCount?: number;
  uid?: string; userId?: string; ownerId?: string; userUID?: string;
  email?: string; userEmail?: string;
  createdAt?: any; completedAt?: any; timestamp?: any; date?: any;
};

const ALT_UID_FIELDS = ['userId','ownerId','userUID'] as const;
const ALT_EMAIL_FIELDS = ['email','userEmail'] as const;

function safeToDate(v: any): Date | null {
  if (!v) return null;
  if (v instanceof Date) return v;
  if (typeof v?.toDate === 'function') {
    try { const d = v.toDate(); return d instanceof Date && !isNaN(d.getTime()) ? d : null; } catch { return null; }
  }
  if (typeof v === 'string' || typeof v === 'number') {
    const d = new Date(v);
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
}

function minutesFromStudy(r: StudyRecord): number {
  if (typeof r.totalMinutes === 'number') return r.totalMinutes;
  if (typeof r.minutes === 'number')      return r.minutes;
  if (typeof r.seconds === 'number')      return Math.floor(r.seconds / 60);
  const s = r.studyTime ?? '';
  const h = Number(s.match(/(\d+)\s*시간/)?.[1] ?? 0);
  const m = Number(s.match(/(\d+)\s*분/)?.[1] ?? 0);
  const sc= Number(s.match(/(\d+)\s*초/)?.[1] ?? 0);
  const total = h*60 + m + Math.floor(sc/60);
  return Number.isFinite(total) ? total : 0;
}
function totalMinutesFromRoutine(r: RoutineRecord): number {
  if (typeof r.totalMinutes === 'number') return r.totalMinutes;
  const sets = typeof r.setCount === 'number' ? r.setCount : 1;
  const sumSteps = (r.steps ?? []).reduce((a, s) => a + (s?.minutes ?? 0), 0);
  const total = sumSteps * sets;
  return Number.isFinite(total) ? total : 0;
}
function formatHM(min: number) {
  const m = Math.max(0, Math.round(min || 0));
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (h === 0) return `${r}분`;
  if (r === 0) return `${h}시간`;
  return `${h}시간 ${r}분`;
}

function belongsToUser(row: any, uid: string, email: string | null) {
  if (!row || typeof row !== 'object') return false;
  if (row.uid === uid) return true;
  for (const k of ALT_UID_FIELDS) if (row[k] === uid) return true;
  if (email) for (const k of ALT_EMAIL_FIELDS) if (row[k] === email) return true;
  return false;
}

/** 특정 필드(where)로 페이지 끝까지 읽기 */
async function fetchAllByField<T extends object>(
  colName: 'studyRecords' | 'routineRecords',
  whereField: string,
  whereValue: any
): Promise<T[]> {
  const PAGE = 500;
  const out: T[] = [];
  let cursor: any = null;

  // createdAt/완료일/기타 날짜 필드 → 없으면 문서ID 정렬로 폴백
  const orderFields: Array<'createdAt'|'completedAt'|'timestamp'|'date'|'__id__'> =
    ['createdAt','completedAt','timestamp','date','__id__'];

  for (const ofield of orderFields) {
    try {
      out.length = 0;
      cursor = null;
      while (true) {
        const parts: any[] = [collection(db, colName), where(whereField as any, '==', whereValue)];
        if (ofield === '__id__') parts.push(orderBy(documentId()));
        else                      parts.push(orderBy(ofield as any, 'desc'));
        if (cursor) parts.push(startAfter(cursor));
        parts.push(limit(PAGE));
        const qref = query.apply(null as any, parts as any);
        const snap = await getDocs(qref);
        if (snap.empty) break;
        out.push(...snap.docs.map(d => d.data() as T));
        cursor = snap.docs[snap.docs.length - 1];
        if (snap.size < PAGE) break;
      }
      if (out.length) return [...out];
    } catch { /* 다음 필드로 재시도 */ }
  }
  return [];
}

/** 전체 스캔 후 JS에서 소유자 필터 (최후 수단) */
async function fetchAllAndFilter<T extends object>(
  colName: 'studyRecords' | 'routineRecords',
  uid: string,
  email: string | null
): Promise<T[]> {
  const PAGE = 500;
  const out: T[] = [];
  let cursor: any = null;
  while (true) {
    try {
      const parts: any[] = [collection(db, colName), orderBy(documentId())];
      if (cursor) parts.push(startAfter(cursor));
      parts.push(limit(PAGE));
      const qref = query.apply(null as any, parts as any);
      const snap = await getDocs(qref);
      if (snap.empty) break;
      const rows = snap.docs.map(d => d.data() as any).filter(r => belongsToUser(r, uid, email));
      out.push(...rows);
      cursor = snap.docs[snap.docs.length - 1];
      if (snap.size < PAGE) break;
    } catch {
      break;
    }
  }
  return out;
}

/** 현재 사용자 모든 레코드 읽기 (uid/보조필드/이메일 시도 → 폴백 전체스캔) */
async function fetchAllForUser<T extends object>(
  colName: 'studyRecords' | 'routineRecords',
  uid: string,
  email: string | null
): Promise<T[]> {
  const fields: string[] = ['uid', ...ALT_UID_FIELDS, ...(email ? ALT_EMAIL_FIELDS : [])] as any;
  for (const f of fields) {
    const val = f.includes('mail') ? email : uid;
    if (val == null) continue;
    const rows = await fetchAllByField<T>(colName, f, val);
    if (rows.length) return rows;
  }
  return await fetchAllAndFilter<T>(colName, uid, email);
}

/** ✅ 전체 기간 누적(공부+루틴) 계산 */
async function computeTotalMinutesAll(uid: string): Promise<number> {
  const email = auth.currentUser?.email ?? null;
  const [studyRows, routineRows] = await Promise.all([
    fetchAllForUser<StudyRecord>('studyRecords', uid, email),
    fetchAllForUser<RoutineRecord>('routineRecords', uid, email),
  ]);
  const studyMin = studyRows.reduce((a, r) => a + minutesFromStudy(r), 0);
  const routineMin = routineRows.reduce((a, r) => a + totalMinutesFromRoutine(r), 0);
  return studyMin + routineMin;
}

/* ===================== Screen ===================== */
export default function SettingsPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [joinDate, setJoinDate] = useState('');
  const [totalMinutes, setTotalMinutes] = useState(0);
  const [pushEnabled, setPushEnabled] = useState(true);
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (!user) return;

      setEmail(user.email || '');

      // 사용자 기본 정보
      const userRef = doc(db, 'users', user.uid);
      const snap = await getDoc(userRef);
      if (snap.exists()) {
        const data = snap.data() as any;
        const d = safeToDate(data.createdAt);
        if (d) {
          const y = d.getFullYear();
          const m = String(d.getMonth() + 1).padStart(2, '0');
          const day = String(d.getDate()).padStart(2, '0');
          setJoinDate(`${y}-${m}-${day}`);
        } else if (typeof data.createdAt === 'string') {
          setJoinDate(data.createdAt);
        } else {
          setJoinDate('정보 없음');
        }
        setPushEnabled(data.settings?.pushEnabled ?? true);
        setIsDark(data.settings?.darkMode ?? false);
      }

      // ✅ 지금까지 모든 기록의 누적 공부 시간
      try {
        const total = await computeTotalMinutesAll(user.uid);
        setTotalMinutes(total);
      } catch {
        setTotalMinutes(0);
      }
    });
    return unsubscribe;
  }, []);

  const handleChangePassword = () => {
    if (!auth.currentUser) return;
    if (Platform.OS === 'ios') {
      Alert.prompt('비밀번호 변경', '새 비밀번호를 입력하세요', async (pw) => {
        if (pw) {
          try {
            await updatePassword(auth.currentUser!, pw);
            Alert.alert('완료', '비밀번호가 변경되었습니다.');
          } catch {
            Alert.alert('오류', '변경 실패');
          }
        }
      });
    } else {
      Alert.alert('안내', '비밀번호 변경은 iOS에서만 가능합니다.');
    }
  };

  const handleLogout = async () => {
    await signOut(auth);
    router.push('/login');
  };

  const togglePush = async () => {
    const user = auth.currentUser;
    if (!user) return;
    const ref = doc(db, 'users', user.uid);
    const newVal = !pushEnabled;
    await updateDoc(ref, { 'settings.pushEnabled': newVal });
    setPushEnabled(newVal);
  };

  const toggleDark = async () => {
    const user = auth.currentUser;
    if (!user) return;
    const ref = doc(db, 'users', user.uid);
    const newVal = !isDark;
    await updateDoc(ref, { 'settings.darkMode': newVal });
    setIsDark(newVal);
  };

  return (
    <View style={{ flex: 1, backgroundColor: '#FFFFFF' }}>
      <ScrollView
        contentContainerStyle={{
          padding: 20,
          paddingBottom: 60,
          backgroundColor: '#FFFFFF',
          minHeight: '100%',
        }}
      >
        <Text
          style={{
            fontSize: 24,
            fontWeight: 'bold',
            color: '#0000000',
            marginBottom: 50,
            marginTop: 70,
            marginLeft: 10,
          }}
        >
          마이페이지
        </Text>

        {/* 탭 */}
       

        <View style={{ width: '100%', height: 1, backgroundColor: '#E5E7EB', marginBottom: 20 }} />

        {/* 사용자 정보 카드 */}
        <View
          style={{
            backgroundColor: '#FFFFFF',
            borderRadius: 20,
            padding: 15,
            marginBottom: 30,
            shadowColor: '#000',
            shadowOffset: { width: 0, height: 2 },
            shadowOpacity: 0.1,
            shadowRadius: 4,
            elevation: 3,
          }}
        >
          <Text style={{ fontSize: 16, fontWeight: '600', color: '#3B82F6', marginBottom: 20, marginTop: 10 }}>
            👤 사용자 정보
          </Text>

          <View style={{ marginBottom: 15 }}>
            <Text style={{ color: '#888', marginBottom: 4 }}>이메일</Text>
            <Text>{email}</Text>
          </View>

          <View style={{ marginBottom: 15 }}>
            <Text style={{ color: '#888', marginBottom: 4 }}>가입일</Text>
            <Text>{joinDate}</Text>
          </View>

          <View>
            <Text style={{ color: '#888', marginBottom: 4 }}>누적 공부 시간</Text>
            {/* ✅ 모든 기간 합계: "X시간 Y분" */}
            <Text>{formatHM(totalMinutes)}</Text>
          </View>
        </View>

        {/* 설정 카드 */}
        <View
          style={{
            backgroundColor: '#FFFFFF',
            borderRadius: 20,
            shadowColor: '#000',
            shadowOffset: { width: 0, height: 2 },
            shadowOpacity: 0.1,
            shadowRadius: 4,
            elevation: 3,
            marginBottom: 20
          }}
        >
          <SettingItem label=" 비밀번호 변경" onPress={handleChangePassword} />
          <Divider />
          
        
          <SettingItem label=" 목표 설정 화면 이동" onPress={() => router.push('/setup')} />
        </View>

        {/* 로그아웃 */}
        <TouchableOpacity
          onPress={handleLogout}
          style={{
            backgroundColor: '#EF4444',
            marginTop: 40,
            paddingVertical: 14,
            borderRadius: 25,
            alignItems: 'center',
            shadowColor: '#000',
            shadowOffset: { width: 0, height: 2 },
            shadowOpacity: 0.2,
            shadowRadius: 4,
            elevation: 3,
          }}
        >
          <Text style={{ color: '#fff', fontSize: 16, fontWeight: '600' }}>로그아웃</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

/* ===================== UI bits ===================== */
function SettingItem({
  label,
  onPress,
  right,
}: {
  label: string;
  onPress?: () => void;
  right?: React.ReactNode;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={onPress ? 0.7 : 1}
      style={{
        flexDirection: 'row',
        justifyContent: 'space-between',
        paddingVertical: 16,
        paddingHorizontal: 16,
      }}
    >
      <Text style={{ fontSize: 15 }}>{label}</Text>
      {right}
    </TouchableOpacity>
  );
}

function Divider() {
  return (
    <View
      style={{
        height: 1,
        backgroundColor: '#E5E7EB',
        marginHorizontal: 16,
      }}
    />
  );
}
