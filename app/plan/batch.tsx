import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

/* ================== 타입 ================== */
type Priority = '필수' | '중요' | '선택';
type Plan = { id: string; content: string; priority: Priority; done: boolean; createdAt: string };

type Step = { step: string; minutes: number };
type Routine = {
  title: string;
  steps: Step[];
  tags: string[];
};

type QueueItem =
  | {
      mode: 'routine';
      planId: string;
      subject: string;
      content: string;
      routineTitle: string;
      stepsPacked: string;
      setCount: number;
    }
  | {
      mode: 'flow';
      planId: string;
      subject: string;
      content: string;
      /** 자유 흐름에서는 minutes를 넘기지 않음 (optional) */
      minutes?: number;
    };

const ORDER: Priority[] = ['필수', '중요', '선택'];

/* ================== 유틸 ================== */
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
function serializeSteps(steps: Step[]) {
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
function getPrioPill(p: Priority) {
  if (p === '필수') return { bg: '#FEE2E2', fg: '#991B1B' };
  if (p === '중요') return { bg: '#FEF3C7', fg: '#92400E' };
  return { bg: '#D1FAE5', fg: '#065F46' };
}

/* ================== 간단 루틴 카탈로그 ================== */
const CATALOG: Routine[] = [
  {
    title: '수학 문제풀이',
    tags: ['#수학', '#문제풀이'],
    steps: [
      { step: '유형 3문제 집중 풀이', minutes: 30 },
      { step: '풀이 점검/오답 체크', minutes: 10 },
      { step: '유사문제 2개 추가', minutes: 10 },
    ],
  },
  {
    title: '수학 서술형',
    tags: ['#수학', '#서술형'],
    steps: [
      { step: '서술형 3문제', minutes: 20 },
      { step: '풀이 과정 점검', minutes: 10 },
      { step: '모범답안 비교', minutes: 10 },
    ],
  },
  {
    title: '영단어 암기',
    tags: ['#영어', '#암기'],
    steps: [
      { step: '단어 20개 보기', minutes: 5 },
      { step: '소리 내어 말하기', minutes: 5 },
      { step: '쓰기 테스트', minutes: 10 },
    ],
  },
  {
    title: '영어 독해',
    tags: ['#영어', '#독해'],
    steps: [
      { step: '짧은 지문 1개', minutes: 10 },
      { step: '핵심 문장/요지 파악', minutes: 10 },
      { step: '표현 정리', minutes: 10 },
    ],
  },
  {
    title: '국어 비문학',
    tags: ['#국어', '#비문학'],
    steps: [
      { step: '지문 1개 읽기', minutes: 10 },
      { step: '글 구조 그리기', minutes: 10 },
      { step: '문제 풀이+해설', minutes: 10 },
    ],
  },
  {
    title: '국어 문법',
    tags: ['#국어', '#문법'],
    steps: [
      { step: '개념 정리', minutes: 10 },
      { step: '문제 적용', minutes: 10 },
      { step: '헷갈린 부분 복습', minutes: 10 },
    ],
  },
  {
    title: '빠른 오답 복구',
    tags: ['#오답', '#복습정리'],
    steps: [
      { step: '최근 오답 훑기', minutes: 8 },
      { step: '틀린 이유 요약', minutes: 7 },
      { step: '유사문제 1개', minutes: 10 },
    ],
  },
  {
    title: '개념 3줄 정리',
    tags: ['#개념이해', '#정리'],
    steps: [
      { step: '핵심 개념 선택', minutes: 5 },
      { step: '핵심 3줄 요약', minutes: 10 },
      { step: '예시/그림 보강', minutes: 10 },
    ],
  },
];

/** 과목/키워드 기반 매칭 */
function matchScore(subject: string, content: string, r: Routine) {
  const s = subject || guessSubject(content);
  const t = (content || '').toLowerCase();
  let score = 0;

  // 과목 태그
  if (s === '수학' && r.tags.includes('#수학')) score += 5;
  if (s === '영어' && r.tags.includes('#영어')) score += 5;
  if (s === '국어' && (r.tags.includes('#국어') || r.tags.includes('#비문학'))) score += 5;
  if ((s === '과학' || s === '사회') && (r.tags.includes('#개념이해') || r.tags.includes('#정리'))) score += 3;

  // 내용 키워드
  if (t.includes('문제') || t.includes('풀이')) score += r.tags.includes('#문제풀이') ? 3 : 0;
  if (t.includes('서술') || t.includes('서술형')) score += r.tags.includes('#서술형') ? 3 : 0;
  if (t.includes('오답')) score += r.tags.includes('#오답') || r.tags.includes('#복습정리') ? 3 : 0;
  if (t.includes('암기') || t.includes('단어')) score += r.tags.includes('#암기') ? 3 : 0;
  if (t.includes('독해')) score += r.tags.includes('#독해') ? 3 : 0;
  if (t.includes('비문학')) score += r.tags.includes('#비문학') ? 3 : 0;
  if (t.includes('문법')) score += r.tags.includes('#문법') ? 3 : 0;
  if (t.includes('개념') || t.includes('정리')) score += r.tags.includes('#개념이해') || r.tags.includes('#정리') ? 2 : 0;

  return score;
}

/* ================== 컴포넌트 ================== */
export default function PlanBatch() {
  const router = useRouter();
  const { plans: plansParam, donePlanId, queue: queueParam } = useLocalSearchParams<{
    plans?: string | string[];
    donePlanId?: string | string[];
    queue?: string | string[];
  }>();

  // URL 파라미터 → 계획 파싱
  const plans: Plan[] = useMemo(() => {
    const raw = Array.isArray(plansParam) ? plansParam[0] : plansParam;
    try {
      if (!raw) return [];
      const arr = JSON.parse(decodeURIComponent(raw));
      if (!Array.isArray(arr)) return [];
      return arr.map((p) => ({
        id: String(p?.id ?? `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`),
        content: String(p?.content ?? ''),
        priority: (ORDER.includes(p?.priority) ? p.priority : '중요') as Priority,
        done: !!p?.done,
        createdAt: String(p?.createdAt ?? new Date().toISOString()),
      })) as Plan[];
    } catch {
      return [];
    }
  }, [plansParam]);

  // 정렬
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

  // 상태
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [chosen, setChosen] = useState<Record<string, Routine | null>>({});
  // ✅ 이번 세션에서 완료한 계획 id
  const [completedIds, setCompletedIds] = useState<Set<string>>(new Set());

  const toggleExpand = (id: string) => setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));
  const togglePick = (planId: string, r: Routine | null) =>
    setChosen((prev) => {
      const cur = prev[planId];
      if (cur && r && cur.title === r.title) return { ...prev, [planId]: null };
      return { ...prev, [planId]: r };
    });

  // 완료 후 자동 이어하기 + 완료 id 로컬 기록
  const autoHandledRef = useRef(false);
  useEffect(() => {
    const done = Array.isArray(donePlanId) ? donePlanId[0] : donePlanId;
    const queueRaw = Array.isArray(queueParam) ? queueParam[0] : queueParam;
    if (!queueRaw || autoHandledRef.current) return;

    // ✅ 방금 완료한 계획은 로컬에서 숨김
    if (done) setCompletedIds((prev) => new Set(prev).add(done));

    autoHandledRef.current = true;
    try {
      const queue: QueueItem[] = JSON.parse(decodeURIComponent(queueRaw));
      const [, ...rest] = queue;
      if (!rest.length) {
        Alert.alert('완료', '오늘의 공부를 모두 마쳤어요!', [
          { text: '확인', onPress: () => router.replace('/home' as any) },
        ]);
        return;
      }
      launch(rest[0], rest);
    } catch {
      // 무시
    }
  }, [donePlanId, queueParam]);

  // ✅ 화면/큐에 표시할 대상: 완료/체크된 건 제외
  const visiblePlans = useMemo(
    () => orderedPlans.filter((p) => !p.done && !completedIds.has(p.id)),
    [orderedPlans, completedIds]
  );

  // 큐 구성 (루틴 미선택 시: 자유 흐름 → minutes를 넘기지 않음)
  const buildQueue = (): QueueItem[] => {
    const targets = (visiblePlans.length ? visiblePlans : plans).filter(
      (p) => !p.done && !completedIds.has(p.id)
    );
    return targets.map<QueueItem>((p) => {
      const subject = guessSubject(p.content);
      const picked = chosen[p.id];
      if (picked) {
        return {
          mode: 'routine',
          planId: p.id,
          subject,
          content: p.content,
          routineTitle: picked.title,
          stepsPacked: serializeSteps(picked.steps),
          setCount: 1,
        };
      }
      // ✅ 자유 흐름: minutes 전달 X
      return {
        mode: 'flow',
        planId: p.id,
        subject,
        content: p.content,
        // minutes: minutesByPriority(p.priority), // ❌ 전달 안 함
      };
    });
  };

  const handleStartAll = () => {
    const queue = buildQueue();
    if (!queue.length) {
      Alert.alert('알림', '진행할 공부가 없어요.');
      return;
    }
    launch(queue[0], queue);
  };

  function launch(item: QueueItem, queue: QueueItem[]) {
    const encodedQueue = encodeURIComponent(JSON.stringify(queue));
    if (item.mode === 'routine') {
      router.replace({
        pathname: '/session/routinePlayer',
        params: {
          routineTitle: item.routineTitle,
          steps: item.stepsPacked,
          setCount: String(item.setCount),
          subject: item.subject,
          content: item.content,
          planId: item.planId,
          queue: encodedQueue,
        },
      } as any);
    } else {
      // ✅ 자유 흐름: minutes 파라미터 미전달
      router.replace({
        pathname: '/session/flowPlayer',
        params: {
          subject: item.subject,
          content: item.content,
          planId: item.planId,
          queue: encodedQueue,
        },
      } as any);
    }
  }

  // 추천 생성: 매칭 점수 > 0 인 루틴만
  const recommendFor = (p: Plan) => {
    const subject = guessSubject(p.content);
    return CATALOG
      .map((r) => ({ ...r, _score: matchScore(subject, p.content, r) } as Routine & { _score: number }))
      .filter((r) => r._score > 0)
      .sort((a, b) => b._score - a._score);
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      {/* ===== 헤더 ===== */}
      <View style={styles.headerRow}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Text style={styles.backIcon}>←</Text>
          <Text style={styles.backText}>뒤로</Text>
        </TouchableOpacity>
        <Text style={styles.header}>오늘의 공부</Text>
        <View style={{ width: 56 }} />
      </View>
      <Text style={styles.subheader}>계획을 순서대로 확인하고, 루틴은 필요할 때만 적용하세요.</Text>

      {/* ===== 비어있을 때 ===== */}
      {visiblePlans.length === 0 && (
        <Text style={styles.emptyText}>오늘의 계획이 없어요. 홈에서 계획을 추가해 주세요.</Text>
      )}

      {/* ===== 계획 카드들 ===== */}
      {visiblePlans.map((p, idx) => {
        const subject = guessSubject(p.content);
        const pr = getPrioPill(p.priority);
        const picked = chosen[p.id];
        const recs = recommendFor(p); // 이미 score>0만 남음
        const isOpen = !!expanded[p.id];

        return (
          <View key={p.id} style={styles.card}>
            {/* 상단: 번호/우선순위/과목 */}
            <View style={styles.rowTop}>
              <View style={styles.circleNo}>
                <Text style={styles.circleNoText}>{idx + 1}</Text>
              </View>
              <Text style={[styles.pill, { backgroundColor: pr.bg, color: pr.fg }]}>{p.priority}</Text>
              <Text style={[styles.pill, styles.subjectPill]}>{subject}</Text>
              <View style={{ flex: 1 }} />
              <TouchableOpacity onPress={() => toggleExpand(p.id)} style={styles.expandBtn}>
                <Text style={styles.expandText}>{isOpen ? '추천 닫기' : '추천 루틴'}</Text>
              </TouchableOpacity>
            </View>

            {/* 내용 */}
            <Text style={styles.content}>{p.content}</Text>

            {/* 선택된 루틴 안내 */}
            {!!picked && (
              <View style={styles.selectedBox}>
                <Text style={styles.selectedTitle}>선택된 루틴</Text>
                <Text style={styles.selectedName}>{picked.title}</Text>
                <Text style={styles.selectedHint}>필요 없으면 탭해서 해제하세요.</Text>
              </View>
            )}

            {/* 추천 루틴 (가로 스크롤) */}
            {isOpen && recs.length > 0 && (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.hList}>
                {recs.map((r) => {
                  const total = r.steps.reduce((a, s) => a + (s.minutes || 0), 0);
                  const active = picked?.title === r.title;

                  return (
                    <TouchableOpacity
                      key={`${p.id}-${r.title}`}
                      onPress={() => togglePick(p.id, active ? null : r)}
                      style={[styles.routineCard, active && styles.routineActive]}
                      activeOpacity={0.85}
                    >
                      <Text style={[styles.routineTitle, active && styles.routineTitleActive]} numberOfLines={1}>
                        {r.title}
                      </Text>

                      <View style={styles.tagsRow}>
                        {r.tags.slice(0, 2).map((t) => (
                          <Text key={t} style={[styles.tag, active && styles.tagActive]}>
                            {t}
                          </Text>
                        ))}
                      </View>

                      <Text style={[styles.totalMin, active && styles.totalMinActive]}>총 {total}분</Text>

                      <View style={[styles.stepsBox, active && styles.stepsBoxActive]}>
                        {r.steps.slice(0, 4).map((s, i) => (
                          <View key={i} style={styles.stepRow}>
                            <View style={[styles.bullet, active && styles.bulletActive]} />
                            <Text style={[styles.stepText, active && styles.stepTextActive]} numberOfLines={1}>
                              {s.step} · {s.minutes}분
                            </Text>
                          </View>
                        ))}
                      </View>

                      <View style={[styles.applyBtn, active && styles.applyBtnActive]}>
                        <Text style={[styles.applyText, active && styles.applyTextActive]}>
                          {active ? '적용됨' : '적용'}
                        </Text>
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            )}

            {/* 추천 없음 */}
            {isOpen && recs.length === 0 && (
              <View style={styles.noRecBox}>
                <Text style={styles.noRecText}>이 계획에 딱 맞는 추천이 없어요. 자유 흐름으로 진행해도 좋아요.</Text>
              </View>
            )}
          </View>
        );
      })}

      {/* 시작 버튼 */}
      <TouchableOpacity onPress={handleStartAll} style={styles.startBtn}>
        <Text style={styles.startText}>오늘의 공부 시작하기</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

/* ================== 스타일 ================== */
const styles = StyleSheet.create({
  container: { padding: 20, backgroundColor: '#FFFFFF', flexGrow: 1 },

  // 헤더
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 12,
    marginBottom: 6,
  },
  backBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    paddingHorizontal: 10,
    backgroundColor: '#F3F4F6',
    borderRadius: 10,
  },
  backIcon: { fontSize: 14, color: '#111827', marginRight: 4 },
  backText: { fontSize: 13, color: '#111827', fontWeight: '700' },
  header: { fontSize: 18, fontWeight: '800', color: '#111827', textAlign: 'center' },
  subheader: { fontSize: 12, color: '#6B7280', textAlign: 'center', marginTop: 6, marginBottom: 16 },
  emptyText: { color: '#374151', marginTop: 8, textAlign: 'center' },

  // 카드
  card: {
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 16,
    padding: 14,
    backgroundColor: '#FFFFFF',
    marginBottom: 14,
    shadowColor: '#000000',
    shadowOpacity: 0.06,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 6,
    elevation: 2,
  },
  rowTop: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  circleNo: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: '#111827',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
  },
  circleNoText: { color: '#FFFFFF', fontWeight: '900', fontSize: 12 },
  pill: {
    paddingVertical: 2,
    paddingHorizontal: 8,
    borderRadius: 999,
    fontSize: 11,
    fontWeight: '800',
    marginRight: 6,
    overflow: 'hidden',
  },
  subjectPill: { backgroundColor: '#E5E7EB', color: '#374151' },
  expandBtn: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    backgroundColor: '#EEF2FF',
    borderRadius: 999,
  },
  expandText: { fontSize: 12, color: '#4338CA', fontWeight: '800' },

  content: { fontSize: 14, color: '#111827' },

  // 선택됨 안내
  selectedBox: {
    marginTop: 10,
    borderWidth: 1,
    borderColor: '#DBEAFE',
    backgroundColor: '#EFF6FF',
    borderRadius: 12,
    padding: 10,
  },
  selectedTitle: { fontSize: 11, color: '#1E3A8A', fontWeight: '900', marginBottom: 2 },
  selectedName: { fontSize: 13, color: '#1E40AF', fontWeight: '900' },
  selectedHint: { fontSize: 11, color: '#1E40AF', marginTop: 2 },

  // 가로 리스트
  hList: { paddingTop: 10, paddingBottom: 4 },

  // 루틴 카드
  routineCard: {
    width: 220,
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#93C5FD',
    backgroundColor: '#DBEAFE',
    marginRight: 10,
  },
  routineActive: {
    backgroundColor: '#1D4ED8',
    borderColor: '#1D4ED8',
  },
  routineTitle: { fontSize: 13, fontWeight: '900', color: '#1D4ED8' },
  routineTitleActive: { color: '#FFFFFF' },

  tagsRow: { flexDirection: 'row', gap: 6, marginTop: 6 },
  tag: {
    fontSize: 10,
    fontWeight: '800',
    color: '#1D4ED8',
    backgroundColor: '#BFDBFE',
    borderRadius: 999,
    overflow: 'hidden',
    paddingVertical: 2,
    paddingHorizontal: 6,
  },
  tagActive: { color: '#FFFFFF', backgroundColor: 'rgba(255,255,255,0.25)' },

  totalMin: { marginTop: 8, fontSize: 12, fontWeight: '800', color: '#1D4ED8' },
  totalMinActive: { color: '#FFFFFF' },

  // 스텝 카드
  stepsBox: {
    marginTop: 8,
    borderWidth: 1,
    borderColor: '#BFDBFE',
    backgroundColor: '#EFF6FF',
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 8,
  },
  stepsBoxActive: {
    borderColor: 'rgba(255,255,255,0.55)',
    backgroundColor: 'rgba(255,255,255,0.15)',
  },
  stepRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  bullet: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#1D4ED8',
    marginRight: 8,
  },
  bulletActive: { backgroundColor: '#FFFFFF' },
  stepText: { fontSize: 11, color: '#1F2937' },
  stepTextActive: { color: '#FFFFFF' },

  applyBtn: {
    marginTop: 10,
    alignSelf: 'flex-start',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: '#3B82F6',
  },
  applyBtnActive: { backgroundColor: '#FFFFFF' },
  applyText: { color: '#FFFFFF', fontSize: 12, fontWeight: '900' },
  applyTextActive: { color: '#1D4ED8' },

  // 추천 없음
  noRecBox: {
    marginTop: 8,
    padding: 10,
    borderRadius: 10,
    backgroundColor: '#F3F4F6',
  },
  noRecText: { fontSize: 12, color: '#374151' },

  // 시작 버튼
  startBtn: {
    marginTop: 18,
    backgroundColor: '#3B82F6',
    height: 52,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  startText: { color: '#fff', fontWeight: '900', fontSize: 15 },
});
