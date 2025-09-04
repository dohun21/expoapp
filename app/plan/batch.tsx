// app/plan/batch.tsx
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

/** ===== 타입 ===== */
type Priority = '필수' | '중요' | '선택';
type Plan = { id: string; content: string; priority: Priority; done: boolean; createdAt: string };

type Routine = {
  title: string;
  steps: { step: string; minutes: number }[];
  tags: string[];
};

type QueueItem = {
  id: string;
  content: string;
  subject: string;
  priority: Priority;
  // 루틴이 선택된 경우만 채워짐
  routineTitle?: string;
  stepsPacked?: string;
  setCount?: number;
  // 자유흐름(Flow)일 때 추천 분
  minutes?: number;
};

/** ===== 유틸 ===== */
const ORDER: Priority[] = ['필수', '중요', '선택'];

function guessSubject(text: string) {
  const t = (text || '').toLowerCase();
  if (t.includes('수학')) return '수학';
  if (t.includes('영어') || t.includes('단어')) return '영어';
  if (t.includes('국어') || t.includes('문법') || t.includes('비문학')) return '국어';
  if (t.includes('과학')) return '과학';
  if (t.includes('사회') || t.includes('역사')) return '사회';
  return '기타';
}
function minutesByPriority(p: Priority) {
  if (p === '필수') return 60;
  if (p === '중요') return 40;
  return 25;
}
function serializeSteps(steps: { step: string; minutes: number }[]) {
  return steps
    .map((s) =>
      `${(s.step || '')
        .replace(/\|/g, ' ')
        .replace(/,/g, ' ')
        .replace(/\n/g, ' ')
        .trim()},${Math.max(0, Math.floor(s.minutes || 0))}`
    )
    .join('|');
}

/** ===== 심플 루틴 카탈로그 ===== */
const CATALOG: Routine[] = [
  // 수학
  { title: '수학 문제풀이', tags: ['#수학', '#문제풀이'], steps: [
    { step: '유형 3문제 집중 풀이', minutes: 30 },
    { step: '풀이 점검/오답 체크', minutes: 10 },
    { step: '유사문제 2개 추가', minutes: 10 },
  ]},
  { title: '수학 서술형', tags: ['#수학', '#서술형'], steps: [
    { step: '서술형 3문제', minutes: 20 },
    { step: '풀이 과정 점검', minutes: 10 },
    { step: '모범답안 비교', minutes: 10 },
  ]},
  // 영어
  { title: '영단어 암기', tags: ['#영어', '#암기'], steps: [
    { step: '단어 20개 보기', minutes: 5 },
    { step: '소리 내어 말하기', minutes: 5 },
    { step: '쓰기 테스트', minutes: 10 },
  ]},
  { title: '영어 독해', tags: ['#영어', '#독해'], steps: [
    { step: '짧은 지문 1개', minutes: 10 },
    { step: '핵심 문장/요지 파악', minutes: 10 },
    { step: '표현 정리', minutes: 10 },
  ]},
  // 국어
  { title: '국어 비문학', tags: ['#국어', '#비문학'], steps: [
    { step: '지문 1개 읽기', minutes: 10 },
    { step: '글 구조 그리기', minutes: 10 },
    { step: '문제 풀이+해설', minutes: 10 },
  ]},
  { title: '국어 문법', tags: ['#국어', '#문법'], steps: [
    { step: '개념 정리', minutes: 10 },
    { step: '문제 적용', minutes: 10 },
    { step: '헷갈린 부분 복습', minutes: 10 },
  ]},
  // 공통
  { title: '빠른 오답 복구', tags: ['#오답', '#복습정리'], steps: [
    { step: '최근 오답 훑기', minutes: 8 },
    { step: '틀린 이유 요약', minutes: 7 },
    { step: '유사문제 1개', minutes: 10 },
  ]},
  { title: '개념 3줄 정리', tags: ['#개념이해', '#정리'], steps: [
    { step: '핵심 개념 선택', minutes: 5 },
    { step: '핵심 3줄 요약', minutes: 10 },
    { step: '예시/그림 보강', minutes: 10 },
  ]},
];

function matchScore(subject: string, content: string, r: Routine) {
  const s = subject || guessSubject(content);
  const t = (content || '').toLowerCase();
  let score = 0;

  if (s === '수학' && r.tags.includes('#수학')) score += 4;
  if (s === '영어' && r.tags.includes('#영어')) score += 4;
  if (s === '국어' && (r.tags.includes('#국어') || r.tags.includes('#비문학'))) score += 4;
  if ((s === '과학' || s === '사회') && (r.tags.includes('#개념이해') || r.tags.includes('#정리'))) score += 2;

  if (t.includes('문제') || t.includes('풀이')) score += r.tags.includes('#문제풀이') ? 3 : 0;
  if (t.includes('오답')) score += (r.tags.includes('#오답') || r.tags.includes('#복습정리')) ? 3 : 0;
  if (t.includes('암기') || t.includes('단어')) score += r.tags.includes('#암기') ? 3 : 0;
  if (t.includes('비문학')) score += r.tags.includes('#비문학') ? 3 : 0;
  if (t.includes('문법')) score += r.tags.includes('#문법') ? 3 : 0;
  if (t.includes('개념') || t.includes('정리')) score += (r.tags.includes('#개념이해') || r.tags.includes('#정리')) ? 2 : 0;

  return score;
}

/** ===== 컴포넌트 ===== */
export default function PlanBatch() {
  const router = useRouter();
  const params = useLocalSearchParams();

  // 홈에서 받아온 plans(JSON 인코딩)
  const plans: Plan[] = useMemo(() => {
    const raw = params?.plans;
    try {
      const encoded = Array.isArray(raw) ? raw[0] : raw;
      if (!encoded) return [];
      const parsed = JSON.parse(decodeURIComponent(encoded));
      if (!Array.isArray(parsed)) return [];
      return parsed.map((p) => ({
        id: String(p?.id ?? `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`),
        content: String(p?.content ?? ''),
        priority: (['필수', '중요', '선택'].includes(p?.priority) ? p.priority : '중요') as Priority,
        done: !!p?.done,
        createdAt: String(p?.createdAt ?? new Date().toISOString()),
      })) as Plan[];
    } catch {
      return [];
    }
  }, [params?.plans]);

  // 정렬: 필수→중요→선택, 미완료 우선, createdAt 오름차순
  const orderedPlans = useMemo(() => {
    const cmp = (a: Plan, b: Plan) => {
      const pa = ORDER.indexOf(a.priority);
      const pb = ORDER.indexOf(b.priority);
      if (pa !== pb) return pa - pb;
      if (a.done !== b.done) return a.done ? 1 : -1;
      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    };
    return [...plans].sort(cmp);
  }, [plans]);

  // 루틴 선택 상태
  const [chosen, setChosen] = useState<Record<string, Routine | null>>({});
  const selectRoutine = (pid: string, r: Routine | null) =>
    setChosen((prev) => ({ ...prev, [pid]: r }));

  const recommendFor = (p: Plan) => {
    const subject = guessSubject(p.content);
    return CATALOG
      .map((r) => ({ ...r, _score: matchScore(subject, p.content, r) }))
      .sort((a, b) => b._score - a._score)
      .slice(0, 3);
  };

  /** ================== 실행(큐) ================== */
  const launch = (item: QueueItem, restQueue: QueueItem[]) => {
    const queueEncoded = encodeURIComponent(JSON.stringify(restQueue));
    if (item.routineTitle && item.stepsPacked) {
      router.replace({
        pathname: '/session/routinePlayer',
        params: {
          routineTitle: item.routineTitle,
          steps: item.stepsPacked,
          setCount: String(item.setCount || 1),
          subject: item.subject,
          content: item.content,
          planId: item.id,
          plans: '',               // (옵션) 필요 시 전달
          // 다음 단계들이 summary에서 돌아올 때 사용
          returnTo: '/plan/batch',
          queue: queueEncoded,
        },
      } as any);
    } else {
      router.replace({
        pathname: '/session/flowPlayer',
        params: {
          subject: item.subject,
          content: item.content,
          minutes: String(item.minutes || 25),
          planId: item.id,
          // 다음 단계들이 summary에서 돌아올 때 사용
          returnTo: '/plan/batch',
          queue: queueEncoded,
        },
      } as any);
    }
  };

  // 첫 실행
  const startToday = () => {
    if (!orderedPlans.length) return;

    // 큐 생성
    const queue: QueueItem[] = orderedPlans.map((p) => {
      const subject = guessSubject(p.content);
      const chosenR = chosen[p.id];
      if (chosenR) {
        return {
          id: p.id,
          content: p.content,
          subject,
          priority: p.priority,
          routineTitle: chosenR.title,
          stepsPacked: serializeSteps(chosenR.steps),
          setCount: 1,
        };
      }
      return {
        id: p.id,
        content: p.content,
        subject,
        priority: p.priority,
        minutes: minutesByPriority(p.priority),
      };
    });

    // 첫 항목 실행
    const [first, ...rest] = queue;
    launch(first, rest);
  };

  /** ===== 요약에서 복귀 시 자동 다음/홈 이동 ===== */
  const { donePlanId, queue: queueParam } = useLocalSearchParams();
  const autoHandledRef = useRef(false);
  useEffect(() => {
    const done = Array.isArray(donePlanId) ? donePlanId[0] : (donePlanId as string | undefined);
    const queueRaw = Array.isArray(queueParam) ? queueParam[0] : (queueParam as string | undefined);

    // 요약에서 돌아온 경우만 처리
    if (!done || autoHandledRef.current) return;
    autoHandledRef.current = true;

    // 큐가 없으면 홈으로
    if (!queueRaw) {
      router.replace('/home');
      return;
    }

    try {
      const queue: QueueItem[] = JSON.parse(decodeURIComponent(queueRaw));
      if (!Array.isArray(queue) || queue.length === 0) {
        router.replace('/home'); // 남은 공부 없음 → 홈
        return;
      }
      const [next, ...rest] = queue;
      launch(next, rest);
    } catch {
      router.replace('/home'); // 파싱 실패 시에도 안전하게 홈
    }
  }, [donePlanId, queueParam]);

  /** ===== UI ===== */
  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.header}>오늘의 공부</Text>
      <Text style={styles.subheader}>필수 → 중요 → 선택 순으로 정리했어요. 필요하면 루틴을 선택하고 시작하세요.</Text>

      {!orderedPlans.length && (
        <Text style={styles.emptyText}>오늘의 계획이 없어요. 홈에서 계획을 추가해 주세요.</Text>
      )}

      {orderedPlans.map((p, idx) => {
        const subject = guessSubject(p.content);
        const picks = recommendFor(p);
        const picked = chosen[p.id];

        return (
          <View key={p.id} style={styles.card}>
            {/* 상단 라인 */}
            <View style={styles.rowTop}>
              <Text style={styles.index}>{idx + 1}</Text>
              <Text style={[styles.badge, getPrioBadgeStyle(p.priority)]}>{p.priority}</Text>
              <Text style={[styles.badge, styles.subjectBadge]}>{subject}</Text>
            </View>

            {/* 내용 */}
            <Text style={styles.content}>{p.content}</Text>

            {/* 루틴 선택 (선택형, 칩 UI) */}
            <View style={styles.recsBox}>
              {picks.map((r) => {
                const active = picked?.title === r.title;
                const total = r.steps.reduce((a, s) => a + (s.minutes || 0), 0);
                return (
                  <TouchableOpacity
                    key={`${p.id}-${r.title}`}
                    onPress={() => selectRoutine(p.id, active ? null : r)}
                    style={[styles.chip, active && styles.chipActive]}
                  >
                    <Text style={[styles.chipText, active && styles.chipTextActive]}>
                      {r.title} · {total}분
                    </Text>
                  </TouchableOpacity>
                );
              })}
              {!picks.length && (
                <Text style={styles.noRecText}>추천 루틴이 없어요. 그냥 타이머로 기록해도 좋아요.</Text>
              )}
            </View>

            {/* 선택 요약 */}
            {!!picked && (
              <View style={styles.previewLine}>
                <Text style={styles.previewText}>선택된 루틴: {picked.title}</Text>
                <TouchableOpacity onPress={() => selectRoutine(p.id, null)}>
                  <Text style={styles.previewClear}>해제</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        );
      })}

      {/* 하단 시작 버튼 */}
      {!!orderedPlans.length && (
        <TouchableOpacity onPress={startToday} style={styles.startBtn}>
          <Text style={styles.startText}>오늘 공부 시작하기</Text>
        </TouchableOpacity>
      )}
    </ScrollView>
  );
}

/** ===== 스타일 ===== */
function getPrioBadgeStyle(p: Priority) {
  if (p === '필수') return { backgroundColor: '#FEE2E2', color: '#991B1B' };
  if (p === '중요') return { backgroundColor: '#FEF3C7', color: '#92400E' };
  return { backgroundColor: '#D1FAE5', color: '#065F46' };
}

const styles = StyleSheet.create({
  container: { padding: 20, backgroundColor: '#FFFFFF', flexGrow: 1 },
  header: { fontSize: 20, fontWeight: '800', marginTop: 12, textAlign: 'center', color: '#111827' },
  subheader: { fontSize: 12, color: '#6B7280', textAlign: 'center', marginTop: 6, marginBottom: 16 },
  emptyText: { color: '#374151', marginTop: 8, textAlign: 'center' },

  card: {
    borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 14,
    padding: 14, backgroundColor: '#FFFFFF', marginBottom: 12,
  },
  rowTop: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  index: { fontSize: 13, fontWeight: '900', color: '#1F2937', marginRight: 8 },

  badge: {
    paddingVertical: 2, paddingHorizontal: 8, borderRadius: 999,
    fontSize: 11, fontWeight: '800', marginRight: 6, overflow: 'hidden',
  },
  subjectBadge: { backgroundColor: '#E5E7EB', color: '#374151' },

  content: { fontSize: 14, color: '#111827', marginTop: 4 },

  recsBox: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 10 },
  chip: {
    paddingVertical: 6, paddingHorizontal: 10, borderRadius: 999,
    backgroundColor: '#DBEAFE', borderWidth: 1, borderColor: '#93C5FD',
    marginRight: 8, marginBottom: 8,
  },
  chipActive: { backgroundColor: '#1D4ED8', borderColor: '#1D4ED8' },
  chipText: { fontSize: 12, color: '#1D4ED8', fontWeight: '800' },
  chipTextActive: { color: '#FFFFFF' },

  noRecText: { fontSize: 12, color: '#6B7280' },

  previewLine: {
    marginTop: 8, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
  },
  previewText: { fontSize: 12, color: '#374151', fontWeight: '700' },
  previewClear: { fontSize: 12, color: '#EF4444', fontWeight: '800' },

  startBtn: {
    marginTop: 10, backgroundColor: '#3B82F6', borderRadius: 14,
    alignItems: 'center', paddingVertical: 12,
  },
  startText: { color: '#fff', fontWeight: '900', fontSize: 14 },
});
