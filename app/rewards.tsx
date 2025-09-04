// app/rewards.tsx
import { useRouter } from 'expo-router';
import { onAuthStateChanged } from 'firebase/auth';
import {
  Timestamp,
  collection,
  getDocs,
  query,
  where,
} from 'firebase/firestore';
import React, { useEffect, useMemo, useState } from 'react';
import {
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View
} from 'react-native';
import { auth, db } from '../firebaseConfig'; // 경로는 프로젝트 구조에 맞게

/** =========================================================
 * Firestore 기반 보상함 (배지 + 스탬프)
 * - studyRecords / routineRecords를 읽어 통계 → 배지/스탬프 갱신
 * - 배지 8종: 일일목표, 연속달성, 집중력, 루틴완주, (루틴별) 암기/복습/집중, 총공부시간
 * - 스탬프 3종: 일일목표 누적, 스트릭, 루틴완주
 * - 필드/컬렉션 누락 시에도 안전하게 0 처리
 * ========================================================= */

const BRAND = '#059669';

/* ==================== 타입 ==================== */
type BadgeProgress = {
  key: string;
  name: string;
  level: number;
  current: number;
  target: number;
  ratio: number;
  leftIcon: string;
  rightIcon?: string;
  earnedTitle: string;
  desc: string;
  unit?: string;
};

type StampItem = {
  key: string;
  title: string;
  unlocked: boolean;
};

type StudyRecord = {
  uid: string;
  studyTime?: string; // "12분 30초" 형태
  goalStatus?: 'full' | 'partial' | 'none';
  stars?: number; // 집중도(1~5)
  createdAt?: Timestamp;
};

type RoutineRecord = {
  uid: string;
  completed?: boolean;
  type?: 'memorize' | 'review' | 'focus';
  createdAt?: Timestamp;
  durationMinutes?: number;
};

/* ==================== 유틸 ==================== */
function toKSTDateString(ts: Date | Timestamp) {
  const d = ts instanceof Timestamp ? ts.toDate() : ts;
  const kstStr = d.toLocaleString('en-US', { timeZone: 'Asia/Seoul' });
  const kst = new Date(kstStr);
  const y = kst.getFullYear();
  const m = String(kst.getMonth() + 1).padStart(2, '0');
  const day = String(kst.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function parseStudyTimeToMinutes(str?: string) {
  if (!str) return 0;
  const m = Number(str.match(/(\d+)분/)?.[1] || 0);
  const s = Number(str.match(/(\d+)초/)?.[1] || 0);
  return m + Math.floor(s / 60);
}

function clampLevelByThreshold(current: number, thresholds: number[]) {
  let level = 1;
  for (let i = 0; i < thresholds.length; i++) {
    if (current >= thresholds[i]) level = i + 2;
  }
  return level;
}

function nextTargetForLevel(level: number, thresholds: number[]) {
  const idx = Math.max(0, level - 1);
  return thresholds[Math.min(idx, thresholds.length - 1)];
}

function toHoursMinutes(totalMinutes: number) {
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${h}시간 ${m}분`;
}

/* ==================== 칭호 테이블 ==================== */
const Titles = {
  daily: ['첫걸음', '꾸준한 도전자', '일주일의 승부사', '습관 장착', '공부 머신'],
  streak: ['불씨 점화', '불타는 집중러', '꾸준함의 달인', '공부 불사조', '끝판왕 스트릭'],
  focus: ['집중 입문자', '몰입러', '집중력 장인', '집중 괴물', '포커스 마스터'],
  routine: ['루틴 도전자', '루틴 지킴이', '루틴 고수', '루틴 달인', '루틴 마스터'],
  memorize: ['단어 전사', '암기꾼', '암기 마스터', '암기 달인', '암기의 신'],
  review: ['복습 도전자', '복습 장인', '복습 고수', '복습 달인', '복습의 제왕'],
  focusRoutine: ['집중 입문자', '집중러', '집중 장인', '집중 달인', '집중 끝판왕'],
  totalTime: ['시작의 시간', '꾸준의 시간', '몰입의 시간', '장인의 시간', '전설의 시간'],
} as const;

/* ==================== 통계 수집 ==================== */
type Stats = {
  daysGoalMet: number;
  streak: number;
  focusAvg: number;
  routinesCompleted: number;
  memorizeCompleted: number;
  reviewCompleted: number;
  focusRoutineCompleted: number;
  totalStudyMinutes: number;
};

async function fetchStats(uid: string): Promise<Stats> {
  // ✅ uid 없으면 즉시 기본값 반환 (파베 호출 금지)
  if (!uid) {
    return {
      daysGoalMet: 0,
      streak: 0,
      focusAvg: 0,
      routinesCompleted: 0,
      memorizeCompleted: 0,
      reviewCompleted: 0,
      focusRoutineCompleted: 0,
      totalStudyMinutes: 0,
    };
  }

  // --- studyRecords ---
  const srSnap = await getDocs(
    query(collection(db, 'studyRecords'), where('uid', '==', uid))
  );
  const studyRecords: StudyRecord[] = srSnap.docs.map((d) => d.data() as StudyRecord);

  // goal full인 날짜(중복 제거)
  const fullDays = new Set<string>();
  let totalMinutes = 0;
  let starsSum = 0;
  let starsCount = 0;

  for (const r of studyRecords) {
    if (r.createdAt) {
      const day = toKSTDateString(r.createdAt);
      if (r.goalStatus === 'full') fullDays.add(day);
    }
    totalMinutes += parseStudyTimeToMinutes(r.studyTime);
    if (typeof r.stars === 'number') {
      starsSum += r.stars;
      starsCount += 1;
    }
  }

  const daysGoalMet = fullDays.size;
  const focusAvg = starsCount > 0 ? Number((starsSum / starsCount).toFixed(2)) : 0;

  // 스트릭 계산: 오늘부터 과거로 연속된 full 날짜 수
  let streak = 0;
  {
    const daySet = new Set(fullDays); // clone
    let cursor = new Date(
      new Date().toLocaleString('en-US', { timeZone: 'Asia/Seoul' })
    );
    while (true) {
      const y = cursor.getFullYear();
      const m = String(cursor.getMonth() + 1).padStart(2, '0');
      const d = String(cursor.getDate()).padStart(2, '0');
      const k = `${y}-${m}-${d}`;
      if (daySet.has(k)) {
        streak += 1;
        cursor.setDate(cursor.getDate() - 1);
        continue;
      }
      break;
    }
  }

  // --- routineRecords (있으면) ---
  let routinesCompleted = 0;
  let memorizeCompleted = 0;
  let reviewCompleted = 0;
  let focusRoutineCompleted = 0;

  try {
    const rrSnap = await getDocs(
      query(collection(db, 'routineRecords'), where('uid', '==', uid))
    );
    const routineRecords: RoutineRecord[] = rrSnap.docs.map(
      (d) => d.data() as RoutineRecord
    );
    for (const r of routineRecords) {
      if (r.completed) {
        routinesCompleted += 1;
        const t = r.type;
        if (t === 'memorize') memorizeCompleted += 1;
        else if (t === 'review') reviewCompleted += 1;
        else if (t === 'focus') focusRoutineCompleted += 1;
      }
    }
  } catch {
    // 컬렉션이 없거나 권한 이슈 → 0 유지
  }

  return {
    daysGoalMet,
    streak,
    focusAvg,
    routinesCompleted,
    memorizeCompleted,
    reviewCompleted,
    focusRoutineCompleted,
    totalStudyMinutes: totalMinutes,
  };
}

/* ==================== 배지/스탬프 빌더 ==================== */
function buildBadges(s: Stats): BadgeProgress[] {
  // 임계값 테이블
  const thDaily = [1, 3, 7, 15, 30, 60, 100];
  const thStreak = [3, 7, 14, 30, 50, 100];
  const thFocus = [3.0, 3.5, 4.0, 4.5, 4.8];
  const thRoutine = [5, 10, 20, 50, 100];
  const thType = [3, 10, 20, 40, 80];
  const thTotal = [60, 300, 1000, 3000, 6000]; // 분

  const lvDaily = clampLevelByThreshold(s.daysGoalMet, thDaily);
  const lvStreak = clampLevelByThreshold(s.streak, thStreak);
  const lvFocus = clampLevelByThreshold(s.focusAvg, thFocus);
  const lvRoutine = clampLevelByThreshold(s.routinesCompleted, thRoutine);
  const lvMem = clampLevelByThreshold(s.memorizeCompleted, thType);
  const lvRev = clampLevelByThreshold(s.reviewCompleted, thType);
  const lvFoc = clampLevelByThreshold(s.focusRoutineCompleted, thType);
  const lvTime = clampLevelByThreshold(s.totalStudyMinutes, thTotal);

  const tgDaily = nextTargetForLevel(lvDaily, thDaily);
  const tgStreak = nextTargetForLevel(lvStreak, thStreak);
  const tgFocus = nextTargetForLevel(lvFocus, thFocus);
  const tgRoutine = nextTargetForLevel(lvRoutine, thRoutine);
  const tgMem = nextTargetForLevel(lvMem, thType);
  const tgRev = nextTargetForLevel(lvRev, thType);
  const tgFoc = nextTargetForLevel(lvFoc, thType);
  const tgTime = nextTargetForLevel(lvTime, thTotal);

  const list: BadgeProgress[] = [
    {
      key: 'daily',
      name: '일일 목표 달성',
      level: lvDaily,
      current: s.daysGoalMet,
      target: tgDaily,
      ratio: Math.min(1, s.daysGoalMet / (tgDaily || 1)),
      leftIcon: '🎯',
      rightIcon: lvDaily >= 3 ? '🥉' : undefined,
      earnedTitle: Titles.daily[Math.min(lvDaily - 1, Titles.daily.length - 1)],
      desc: '하루 목표 공부 시간을 채운 누적 일수예요.',
      unit: '일',
    },
    {
      key: 'streak',
      name: '연속 달성',
      level: lvStreak,
      current: s.streak,
      target: tgStreak,
      ratio: Math.min(1, s.streak / (tgStreak || 1)),
      leftIcon: '🔥',
      rightIcon: lvStreak >= 4 ? '🥈' : undefined,
      earnedTitle: Titles.streak[Math.min(lvStreak - 1, Titles.streak.length - 1)],
      desc: '며칠 연속으로 목표를 성공했는지 보여줘요.',
      unit: '일 연속',
    },
    {
      key: 'focus',
      name: '집중력',
      level: lvFocus,
      current: Number(s.focusAvg.toFixed(1)),
      target: tgFocus,
      ratio: Math.min(1, s.focusAvg / (tgFocus || 1)),
      leftIcon: '⭐',
      rightIcon: lvFocus >= 4 ? '🥇' : undefined,
      earnedTitle: Titles.focus[Math.min(lvFocus - 1, Titles.focus.length - 1)],
      desc: '최근 공부들의 평균 집중도(별점)예요.',
      unit: '평균★',
    },
    {
      key: 'routine',
      name: '루틴 완주',
      level: lvRoutine,
      current: s.routinesCompleted,
      target: tgRoutine,
      ratio: Math.min(1, s.routinesCompleted / (tgRoutine || 1)),
      leftIcon: '🧩',
      rightIcon: lvRoutine >= 3 ? '🏅' : undefined,
      earnedTitle: Titles.routine[Math.min(lvRoutine - 1, Titles.routine.length - 1)],
      desc: '어떤 루틴이든 끝까지 실행한 누적 횟수예요.',
      unit: '회',
    },
    {
      key: 'memorize',
      name: '암기 루틴 마스터',
      level: lvMem,
      current: s.memorizeCompleted,
      target: tgMem,
      ratio: Math.min(1, s.memorizeCompleted / (tgMem || 1)),
      leftIcon: '📚',
      rightIcon: lvMem >= 3 ? '🥉' : undefined,
      earnedTitle: Titles.memorize[Math.min(lvMem - 1, Titles.memorize.length - 1)],
      desc: '“암기 루틴”을 완주한 누적 횟수예요.',
      unit: '회',
    },
    {
      key: 'review',
      name: '복습 루틴 마스터',
      level: lvRev,
      current: s.reviewCompleted,
      target: tgRev,
      ratio: Math.min(1, s.reviewCompleted / (tgRev || 1)),
      leftIcon: '📝',
      rightIcon: lvRev >= 3 ? '🥉' : undefined,
      earnedTitle: Titles.review[Math.min(lvRev - 1, Titles.review.length - 1)],
      desc: '“복습 루틴”을 완주한 누적 횟수예요.',
      unit: '회',
    },
    {
      key: 'focusRoutine',
      name: '집중 루틴 마스터',
      level: lvFoc,
      current: s.focusRoutineCompleted,
      target: tgFoc,
      ratio: Math.min(1, s.focusRoutineCompleted / (tgFoc || 1)),
      leftIcon: '🔎',
      rightIcon: lvFoc >= 3 ? '🥉' : undefined,
      earnedTitle: Titles.focusRoutine[Math.min(lvFoc - 1, Titles.focusRoutine.length - 1)],
      desc: '“집중 루틴”을 완주한 누적 횟수예요.',
      unit: '회',
    },
    {
      key: 'totalTime',
      name: '총 공부 시간',
      level: lvTime,
      current: s.totalStudyMinutes,
      target: tgTime,
      ratio: Math.min(1, s.totalStudyMinutes / (tgTime || 1)),
      leftIcon: '⏱️',
      rightIcon: lvTime >= 4 ? '🏆' : undefined,
      earnedTitle: Titles.totalTime[Math.min(lvTime - 1, Titles.totalTime.length - 1)],
      desc: `지금까지 공부한 총 시간이에요. (${toHoursMinutes(s.totalStudyMinutes)})`,
      unit: '분',
    },
  ];

  return list;
}

function buildStamps(s: Stats) {
  const stampGoal: StampItem[] = [
    { key: 'g-1', title: '첫 달성(1회)', unlocked: s.daysGoalMet >= 1 },
    { key: 'g-3', title: '3회 달성', unlocked: s.daysGoalMet >= 3 },
    { key: 'g-7', title: '7회 달성', unlocked: s.daysGoalMet >= 7 },
    { key: 'g-15', title: '15회 달성', unlocked: s.daysGoalMet >= 15 },
    { key: 'g-30', title: '30회 달성', unlocked: s.daysGoalMet >= 30 },
    { key: 'g-60', title: '60회 달성', unlocked: s.daysGoalMet >= 60 },
    { key: 'g-100', title: '100회 달성', unlocked: s.daysGoalMet >= 100 },
  ];

  const stampStreak: StampItem[] = [
    { key: 's-3', title: '3일 연속', unlocked: s.streak >= 3 },
    { key: 's-7', title: '7일 연속', unlocked: s.streak >= 7 },
    { key: 's-14', title: '14일 연속', unlocked: s.streak >= 14 },
    { key: 's-30', title: '30일 연속', unlocked: s.streak >= 30 },
    { key: 's-50', title: '50일 연속', unlocked: s.streak >= 50 },
    { key: 's-100', title: '100일 연속', unlocked: s.streak >= 100 },
  ];

  const stampRoutine: StampItem[] = [
    { key: 'r-1', title: '루틴 1회 완주', unlocked: s.routinesCompleted >= 1 },
    { key: 'r-5', title: '루틴 5회 완주', unlocked: s.routinesCompleted >= 5 },
    { key: 'r-10', title: '루틴 10회 완주', unlocked: s.routinesCompleted >= 10 },
    { key: 'r-30', title: '루틴 30회 완주', unlocked: s.routinesCompleted >= 30 },
    { key: 'r-50', title: '루틴 50회 완주', unlocked: s.routinesCompleted >= 50 },
    { key: 'r-100', title: '루틴 100회 완주', unlocked: s.routinesCompleted >= 100 },
  ];

  return { stampGoal, stampStreak, stampRoutine };
}

/* ==================== UI 컴포넌트 ==================== */
function ProgressBar({ value }: { value: number }) {
  const w = `${Math.min(1, Math.max(0, value)) * 100}%`;
  return (
    <View style={styles.progressTrack}>
      {/* ✅ width 반영 */}
      <View style={[styles.progressFill, ]} />
    </View>
  );
}

/* ==================== 화면 ==================== */
export default function RewardsPage() {
  const router = useRouter();
  const [uid, setUid] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<Stats>({
    daysGoalMet: 0,
    streak: 0,
    focusAvg: 0,
    routinesCompleted: 0,
    memorizeCompleted: 0,
    reviewCompleted: 0,
    focusRoutineCompleted: 0,
    totalStudyMinutes: 0,
  });

  // ✅ 무한 로딩 방지: 워치독 + 언마운트 가드
  useEffect(() => {
    let aborted = false;

    // 8초 뒤에도 로딩이면 강제로 끊기
    const watchdog = setTimeout(() => {
      if (!aborted && loading) {
        setLoading(false);
      }
    }, 8000);

    const unsub = onAuthStateChanged(auth, async (user) => {
      if (aborted) return;

      if (!user) {
        setUid(null);
        setLoading(false);
        return;
      }
      setUid(user.uid);

      try {
        setLoading(true);
        const s = await fetchStats(user.uid);
        if (!aborted) setStats(s);
      } catch (e) {
        console.warn('fetchStats error:', e);
      } finally {
        if (!aborted) setLoading(false);
      }
    });

    return () => {
      aborted = true;
      clearTimeout(watchdog);
      unsub();
    };
  }, [loading]);

  const badges = useMemo(() => buildBadges(stats), [stats]);
  const { stampGoal, stampStreak, stampRoutine } = useMemo(
    () => buildStamps(stats),
    [stats]
  );
  const earnedTitles = badges.map((b) => `${b.leftIcon} ${b.earnedTitle}`);

 

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#FFFFFF' }}>
      {/* ===== 상단 헤더 / 탭 ===== */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>마이페이지</Text>
        <View style={styles.tabRow}>
          {/* 파일 위치가 /(tabs)/settings.tsx 이면 router.push('/(tabs)/settings') 사용 */}
          <TouchableOpacity onPress={() => router.push('/(tabs)/settings')}>
            <Text style={[styles.tabText, styles.tabInactive]}>내정보</Text>
          </TouchableOpacity>
          <Text style={[styles.tabText, styles.tabActive]}>배지/스탬프</Text>
        </View>
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: 24 }}
        showsVerticalScrollIndicator={false}
      >
        {/* ===== 칭호 하이라이트 ===== */}
        <View style={styles.card}>
          <View style={styles.cardHeaderRow}>
            <Text style={styles.cardTitle}>획득한 칭호</Text>
          </View>
          {earnedTitles.length === 0 ? (
            <Text style={{ color: '#9CA3AF' }}>아직 획득한 칭호가 없어요.</Text>
          ) : (
            <View style={{ gap: 6 }}>
              {earnedTitles.map((t, i) => (
                <Text key={i} style={styles.titleChip}>• {t}</Text>
              ))}
            </View>
          )}
        </View>

        {/* ===== 배지 리스트 ===== */}
        <View style={styles.card}>
          <View style={styles.cardHeaderRow}>
            <Text style={styles.cardTitle}>보유 배지</Text>
          </View>

          {badges.map((b) => (
            <View key={b.key} style={{ marginBottom: 18 }}>
              <Text style={styles.sectionSmallTitle}>{b.name}</Text>

              <View style={styles.badgeRow}>
                <Text style={styles.badgeIcon}>{b.leftIcon}</Text>
                <View style={{ flex: 1 }}>
                  <ProgressBar value={b.ratio} />
                  <View style={styles.levelRow}>
                    <Text style={styles.levelText}>Lv.{b.level}</Text>
                    <Text style={styles.levelTextGreen}>
                      {b.current}/{b.target}{b.unit ? ` ${b.unit}` : ''}
                    </Text>
                    <Text style={styles.levelText}>Lv.{b.level + 1}</Text>
                  </View>
                </View>
                {!!b.rightIcon && <Text style={styles.badgeIcon}>{b.rightIcon}</Text>}
              </View>

              {/* 부가 설명 + 칭호 */}
              <Text style={styles.badgeDesc}>{b.desc}</Text>
              <View style={styles.titleRow}>
                <Text style={styles.titleLabel}>칭호</Text>
                <Text style={styles.titleValue}>{b.earnedTitle}</Text>
              </View>
            </View>
          ))}
        </View>

        {/* ===== 스탬프: 일일 목표 달성 ===== */}
        <View style={styles.card}>
          <Text style={[styles.cardTitle, { marginBottom: 10 }]}>🎯 일일 목표 달성 스탬프</Text>
          <View style={styles.grid}>
            {stampGoal.map(m => (
              <View key={m.key} style={styles.stampItem}>
                <View style={[styles.stampIcon, m.unlocked ? styles.unlocked : styles.locked]} />
                <Text style={[styles.stampLabel, m.unlocked ? styles.unlockedText : styles.lockedText]} numberOfLines={1}>
                  {m.title}
                </Text>
              </View>
            ))}
          </View>
        </View>

        {/* ===== 스탬프: 연속 달성 ===== */}
        <View style={styles.card}>
          <Text style={[styles.cardTitle, { marginBottom: 10 }]}>🔥 연속 달성 스탬프</Text>
          <View style={styles.grid}>
            {stampStreak.map(m => (
              <View key={m.key} style={styles.stampItem}>
                <View style={[styles.stampIcon, m.unlocked ? styles.unlocked : styles.locked]} />
                <Text style={[styles.stampLabel, m.unlocked ? styles.unlockedText : styles.lockedText]} numberOfLines={1}>
                  {m.title}
                </Text>
              </View>
            ))}
          </View>
        </View>

        {/* ===== 스탬프: 루틴 완주 ===== */}
        <View style={styles.card}>
          <Text style={[styles.cardTitle, { marginBottom: 10 }]}>🧩 루틴 완주 스탬프</Text>
          <View style={styles.grid}>
            {stampRoutine.map(m => (
              <View key={m.key} style={styles.stampItem}>
                <View style={[styles.stampIcon, m.unlocked ? styles.unlocked : styles.locked]} />
                <Text style={[styles.stampLabel, m.unlocked ? styles.unlockedText : styles.lockedText]} numberOfLines={1}>
                  {m.title}
                </Text>
              </View>
            ))}
          </View>
        </View>

        <View style={{ height: 24 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

/* ==================== 스타일 ==================== */
const styles = StyleSheet.create({
  header: {
    paddingHorizontal: 20,
    paddingTop: 6,
    backgroundColor: '#FFFFFF',
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: BRAND,
    marginTop: 20,
    marginBottom: 20,
    marginLeft: 10,
  },
  tabRow: {
    flexDirection: 'row',
    gap: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
    paddingBottom: 8,
    marginTop: 10,
  },
  tabText: {
    fontSize: 16,
    fontWeight: '700',
    marginLeft: 80,
  },
  tabInactive: { color: '#D1D5DB' },
  tabActive: {
    color: BRAND,
    fontWeight: 'bold',
    borderBottomColor: BRAND,
    paddingBottom: 6,
  },

  card: {
    marginTop: 14,
    marginHorizontal: 16,
    padding: 16,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
  },
  cardHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  cardTitle: { fontSize: 18, fontWeight: '700', color: '#1F2937' },

  sectionSmallTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#374151',
    marginBottom: 8,
  },
  badgeRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  badgeIcon: { fontSize: 22, width: 28, textAlign: 'center' },

  progressTrack: {
    height: 12,
    backgroundColor: '#E5E7EB',
    borderRadius: 9999,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: BRAND,
    borderRadius: 9999,
  },
  levelRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 },
  levelText: { fontSize: 12, color: '#6B7280' },
  levelTextGreen: { fontSize: 12, color: BRAND, fontWeight: '700' },
  badgeDesc: { marginTop: 6, fontSize: 12, color: '#6B7280' },

  titleRow: {
    marginTop: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  titleLabel: {
    fontSize: 12,
    color: '#374151',
    backgroundColor: '#F3F4F6',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    fontWeight: '700',
  },
  titleValue: { fontSize: 12, color: BRAND, fontWeight: '700' },
  titleChip: { fontSize: 13, color: '#374151' },

  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 6 },
  stampItem: { width: '30%', alignItems: 'center', gap: 6 },
  stampIcon: {
    width: 72,
    height: 88,
    borderRadius: 12,
    backgroundColor: '#F3F4F6',
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  stampLabel: { fontSize: 12, textAlign: 'center' },
  unlocked: { backgroundColor: '#ECFDF5', borderColor: '#A7F3D0' },
  locked: { backgroundColor: '#F3F4F6', borderColor: '#E5E7EB' },
  unlockedText: { color: BRAND, fontWeight: '700' },
  lockedText: { color: '#9CA3AF' },
});

