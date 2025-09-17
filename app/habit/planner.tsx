// app/habit/planner.tsx
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import { onAuthStateChanged } from 'firebase/auth';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { auth } from '../../firebaseConfig';

type Step = { step: string; minutes: number };
type ProgramItem = {
  id: string;
  weekday: number;     // 0=일..6=토
  startMin: number;    // 0~1439
  title: string;
  steps: Step[];
  setCount?: number;
};

const PRESET_LIBRARY: { title: string; steps: Step[] }[] = [
  {
    title: '영단어 암기 루틴',
    steps: [
      { step: '영단어 외우기', minutes: 20 },
      { step: '예문 만들기', minutes: 15 },
      { step: '퀴즈 테스트', minutes: 10 },
    ],
  },
  {
    title: '오답 집중 루틴',
    steps: [
      { step: '최근 오답 복습', minutes: 20 },
      { step: '유형 문제 풀기', minutes: 25 },
      { step: '오답 이유 정리', minutes: 15 },
    ],
  },
  {
    title: '핵심 개념 정리 루틴',
    steps: [
      { step: '개념 선택/요약', minutes: 10 },
      { step: '예시 추가', minutes: 10 },
      { step: '문제 적용', minutes: 15 },
    ],
  },
  {
    title: '전 범위 빠른 복습 루틴',
    steps: [
      { step: '요점 스캔', minutes: 10 },
      { step: '핵심문제 5개', minutes: 15 },
      { step: '오답 체크', minutes: 10 },
    ],
  },
];

const weekdayLabels = ['일','월','화','수','목','금','토'];
const k = (base: string, uid: string) => `${base}_${uid}`;
const HABIT_PROGRAM_KEY_BASE = 'habitProgramV1';

function pad2(n: number) { return String(n).padStart(2,'0'); }
function toHHMM(min: number) { return `${pad2(Math.floor(min/60))}:${pad2(min%60)}`; }
function parseHHMM(s: string): number | null {
  const m = (s || '').match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const hh = Number(m[1]), mm = Number(m[2]);
  if (hh<0||hh>23||mm<0||mm>59) return null;
  return hh*60 + mm;
}
function nowKST() {
  const n = new Date();
  return new Date(n.toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
}

export default function HabitPlanner() {
  const router = useRouter();
  const [uid, setUid] = useState<string | null>(null);
  const [items, setItems] = useState<ProgramItem[]>([]);

  // 폼 상태
  const [weekday, setWeekday] = useState(1); // 월
  const [timeStr, setTimeStr] = useState('19:30');
  const [title, setTitle] = useState(PRESET_LIBRARY[0].title);
  const [stepsText, setStepsText] = useState(
    PRESET_LIBRARY[0].steps.map(s => `${s.step},${s.minutes}`).join('|')
  );
  const [editId, setEditId] = useState<string | null>(null); // null=추가모드

  // 다중 요일 복사 선택
  const [copyDays, setCopyDays] = useState<number[]>([]);

  /* ---------- load/save ---------- */
  const load = useCallback(async (_uid: string) => {
    const raw = await AsyncStorage.getItem(k(HABIT_PROGRAM_KEY_BASE, _uid));
    if (!raw) { setItems([]); return; }
    try {
      const parsed = JSON.parse(raw) as ProgramItem[];
      setItems(Array.isArray(parsed) ? parsed : []);
    } catch {
      setItems([]);
    }
  }, []);

  const saveAll = useCallback(async (_uid: string, arr: ProgramItem[]) => {
    const sorted = [...arr].sort((a,b)=> a.weekday===b.weekday ? a.startMin-b.startMin : a.weekday-b.weekday);
    await AsyncStorage.setItem(k(HABIT_PROGRAM_KEY_BASE, _uid), JSON.stringify(sorted));
    setItems(sorted);
  }, []);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      if (!user) { setUid(null); setItems([]); return; }
      setUid(user.uid);
      load(user.uid);
    });
    return unsub;
  }, [load]);

  /* ---------- helpers ---------- */
  const parseSteps = (raw: string): Step[] => {
    try {
      return (raw||'').split('|').map(t => {
        const [name, mins] = t.split(',');
        return { step: (name||'').trim(), minutes: Math.max(0, Number(mins)||0) };
      }).filter(s => s.step);
    } catch { return []; }
  };

  const hasConflict = (arr: ProgramItem[], wd: number, sm: number, ignoreId?: string) =>
    arr.some(it => it.weekday===wd && it.startMin===sm && it.id!==ignoreId);

  const resetForm = () => {
    setEditId(null);
    setWeekday(1);
    setTimeStr('19:30');
    setTitle(PRESET_LIBRARY[0].title);
    setStepsText(PRESET_LIBRARY[0].steps.map(s => `${s.step},${s.minutes}`).join('|'));
    setCopyDays([]);
  };

  const adjustTime = (deltaMin: number) => {
    const m = parseHHMM(timeStr);
    const base = m===null ? 19*60+30 : m;
    const next = Math.min(1439, Math.max(0, base + deltaMin));
    setTimeStr(toHHMM(next));
  };

  const applyPreset = (presetTitle: string) => {
    const p = PRESET_LIBRARY.find(x => x.title === presetTitle);
    setTitle(presetTitle);
    if (p) setStepsText(p.steps.map(s => `${s.step},${s.minutes}`).join('|'));
  };

  /* ---------- CRUD ---------- */
  const upsertItem = async () => {
    if (!uid) return;
    const m = parseHHMM(timeStr);
    if (m===null) { Alert.alert('시간 형식', 'HH:MM 형식으로 입력해 주세요. 예) 19:30'); return; }

    const steps = parseSteps(stepsText);
    if (steps.length === 0) { Alert.alert('단계 입력', '예) 개념정리,10|문제풀기,20|오답정리,10'); return; }

    // 수정
    if (editId) {
      if (hasConflict(items, weekday, m, editId)) {
        Alert.alert('중복', '같은 요일/시간에 이미 루틴이 있어요.');
        return;
      }
      const next = items.map(it => it.id===editId ? {
        ...it, weekday, startMin:m, title: title.trim()||'루틴', steps
      } : it);
      await saveAll(uid, next);
      resetForm();
      return;
    }

    // 추가 (+ 복사 요일 포함)
    const base: ProgramItem = {
      id: `prog-${Date.now()}-${Math.random().toString(36).slice(2,7)}`,
      weekday,
      startMin: m,
      title: title.trim() || '루틴',
      steps,
      setCount: 1,
    };

    const targets = [weekday, ...copyDays.filter(d=>d!==weekday)];
    const newOnes: ProgramItem[] = [];
    for (const wd of targets) {
      if (hasConflict(items, wd, m)) continue; // 충돌 항목은 건너뜀
      newOnes.push({ ...base, id:`prog-${wd}-${Date.now()}-${Math.random().toString(36).slice(2,7)}`, weekday: wd });
    }
    if (newOnes.length === 0) {
      Alert.alert('중복', '선택한 요일/시간에 모두 기존 항목이 있어 추가되지 않았어요.');
      return;
    }
    await saveAll(uid, [...items, ...newOnes]);
    resetForm();
  };

  const startEdit = (it: ProgramItem) => {
    setEditId(it.id);
    setWeekday(it.weekday);
    setTimeStr(toHHMM(it.startMin));
    setTitle(it.title);
    setStepsText((it.steps||[]).map(s => `${s.step},${s.minutes}`).join('|'));
    setCopyDays([]);
  };

  const cancelEdit = () => resetForm();

  const removeItem = async (id: string) => {
    if (!uid) return;
    await saveAll(uid, items.filter(i => i.id !== id));
    if (editId === id) resetForm();
  };

  /* ---------- one-click sample ---------- */
  const addSampleToday = async () => {
    if (!uid) return;
    const kst = nowKST();
    const wd = kst.getDay();
    const nowMin = kst.getHours()*60 + kst.getMinutes();
    const startMin = Math.min(1439, nowMin + 5);
    const sample: ProgramItem = {
      id: `prog-sample-${Date.now()}`,
      weekday: wd,
      startMin,
      title: '테스트 루틴',
      steps: [{ step: '빠른 정리', minutes: 10 }, { step: '핵심문제', minutes: 15 }],
      setCount: 1,
    };
    await saveAll(uid, [...items, sample]);
    Alert.alert('완료', '오늘 지금+5분에 테스트 루틴을 추가했어요. 홈에서 보일 거예요.');
  };

  /* ---------- derived ---------- */
  const grouped = useMemo(() => {
    const g: Record<number, ProgramItem[]> = {0:[],1:[],2:[],3:[],4:[],5:[],6:[]};
    items.forEach(it => g[it.weekday].push(it));
    (Object.keys(g) as any[]).forEach((wd:number)=> g[wd].sort((a,b)=>a.startMin-b.startMin));
    return g;
  }, [items]);

  /* ---------- UI ---------- */
  return (
    <ScrollView contentContainerStyle={s.wrap}>
      <Text style={s.h1}>주간 루틴 프로그램</Text>
      <Text style={s.desc}>요일·시간대별 루틴을 등록하면 홈의 “오늘의 프로그램/담기/지금 실행”이 자동 연동됩니다.</Text>

      {/* 폼 */}
      <View style={s.card}>
        <Text style={s.label}>요일</Text>
        <View style={s.rowWrap}>
          {weekdayLabels.map((lb, i)=>(
            <TouchableOpacity key={i} onPress={()=>setWeekday(i)} style={[s.chip, weekday===i && s.chipActive]}>
              <Text style={[s.chipTxt, weekday===i && s.chipTxtActive]}>{lb}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={[s.label,{marginTop:12}]}>시간 (HH:MM)</Text>
        <View style={s.rowWrap}>
          <TextInput
            value={timeStr}
            onChangeText={setTimeStr}
            placeholder="19:30"
            style={[s.input,{flex:1,minWidth:120}]}
          />
          <TouchableOpacity onPress={()=>adjustTime(-5)} style={s.smallBtn}><Text style={s.smallBtnTxt}>-5분</Text></TouchableOpacity>
          <TouchableOpacity onPress={()=>adjustTime(+5)} style={s.smallBtn}><Text style={s.smallBtnTxt}>+5분</Text></TouchableOpacity>
        </View>

        <Text style={[s.label,{marginTop:12}]}>루틴 제목</Text>
        <View style={s.rowWrap}>
          {PRESET_LIBRARY.map(p=>(
            <TouchableOpacity key={p.title} onPress={()=>applyPreset(p.title)} style={[s.chip, title===p.title && s.chipActive]}>
              <Text style={[s.chipTxt, title===p.title && s.chipTxtActive]}>{p.title}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <TextInput value={title} onChangeText={setTitle} placeholder="루틴 이름" style={s.input}/>

        <Text style={[s.label,{marginTop:12}]}>단계(이름,분 | 이름,분 ...)</Text>
        <TextInput
          value={stepsText}
          onChangeText={setStepsText}
          placeholder="개념정리,10|문제풀기,20|오답정리,10"
          style={[s.input,{height:88}]}
          multiline
        />

        {/* 다중 요일 복사 */}
        <Text style={[s.label,{marginTop:12}]}>다른 요일에도 복사</Text>
        <View style={s.rowWrap}>
          {weekdayLabels.map((lb, i)=>(
            <TouchableOpacity
              key={i}
              onPress={()=>{
                setCopyDays(prev=>{
                  const has = prev.includes(i);
                  if (has) return prev.filter(d=>d!==i);
                  return [...prev, i].sort();
                });
              }}
              style={[s.chip, copyDays.includes(i) && s.chipActive, {opacity: i===weekday ? 0.4 : 1}]}
              disabled={i===weekday}
            >
              <Text style={[s.chipTxt, copyDays.includes(i) && s.chipTxtActive]}>{lb}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <View style={s.rowWrap}>
          <TouchableOpacity style={[s.primaryBtn,{flex:1}]} onPress={upsertItem}>
            <Text style={s.primaryTxt}>{editId ? '수정 저장' : '추가'}</Text>
          </TouchableOpacity>
          {editId ? (
            <TouchableOpacity style={[s.secondaryBtn,{flex:1}]} onPress={cancelEdit}>
              <Text style={s.secondaryTxt}>취소</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity style={[s.secondaryBtn,{flex:1}]} onPress={addSampleToday}>
              <Text style={s.secondaryTxt}>오늘 테스트(지금+5분)</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* 목록 */}
      {Array.from({length:7}).map((_,wd)=>(
        <View key={wd} style={s.card}>
          <Text style={s.dayTitle}>{weekdayLabels[wd]}요일</Text>
          {grouped[wd].length===0 ? (
            <Text style={s.empty}>등록된 루틴이 없어요.</Text>
          ) : grouped[wd].map(it=>(
            <View key={it.id} style={s.itemRow}>
              <TouchableOpacity onPress={()=>startEdit(it)} style={{flex:1}}>
                <Text style={s.itemTitle}>{toHHMM(it.startMin)} · {it.title}</Text>
                <Text style={s.itemSteps}>
                  {(it.steps||[]).map(s=>`${s.step}(${s.minutes}분)`).join(' · ')}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={()=>removeItem(it.id)} style={s.delBtn}>
                <Text style={{color:'#991B1B',fontWeight:'700'}}>삭제</Text>
              </TouchableOpacity>
            </View>
          ))}
        </View>
      ))}

      <TouchableOpacity style={[s.secondaryBtn,{marginBottom:40}]} onPress={()=>router.back()}>
        <Text style={s.secondaryTxt}>뒤로</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  wrap:{padding:20, backgroundColor:'#fff'},
  h1:{fontSize:20,fontWeight:'800',marginTop:12,marginBottom:6,color:'#111827'},
  desc:{fontSize:13,color:'#374151',marginBottom:12},
  card:{backgroundColor:'#FFFFFF',borderWidth:1,borderColor:'#E5E7EB',borderRadius:14,padding:14,marginBottom:12},
  label:{fontSize:12,color:'#6B7280',marginBottom:6,fontWeight:'700'},
  rowWrap:{flexDirection:'row',flexWrap:'wrap',gap:8,alignItems:'center'},
  chip:{paddingVertical:6,paddingHorizontal:10,borderRadius:999,backgroundColor:'#F3F4F6',borderWidth:1,borderColor:'#E5E7EB'},
  chipActive:{backgroundColor:'#DBEAFE',borderColor:'#3B82F6'},
  chipTxt:{fontSize:12,color:'#374151'},
  chipTxtActive:{color:'#1E40AF',fontWeight:'800'},
  input:{borderWidth:1,borderColor:'#E5E7EB',borderRadius:10,paddingHorizontal:12,paddingVertical:10,fontSize:14, color:'#111827', backgroundColor:'#FFFFFF'},
  primaryBtn:{marginTop:14,backgroundColor:'#3B82F6',paddingVertical:12,borderRadius:10,alignItems:'center'},
  primaryTxt:{color:'#fff',fontWeight:'800'},
  secondaryBtn:{marginTop:14,backgroundColor:'#F3F4F6',paddingVertical:12,borderRadius:10,alignItems:'center',borderWidth:1,borderColor:'#E5E7EB'},
  secondaryTxt:{color:'#111827',fontWeight:'800'},
  smallBtn:{paddingVertical:8,paddingHorizontal:10,backgroundColor:'#F3F4F6',borderRadius:8,borderWidth:1,borderColor:'#E5E7EB'},
  smallBtnTxt:{fontSize:12,color:'#111827',fontWeight:'700'},

  dayTitle:{fontSize:16,fontWeight:'800',color:'#111827',marginBottom:8},
  empty:{fontSize:12,color:'#6B7280'},
  itemRow:{flexDirection:'row',alignItems:'center',gap:10,marginTop:10},
  itemTitle:{fontSize:14,fontWeight:'700',color:'#111827'},
  itemSteps:{fontSize:12,color:'#374151',marginTop:2},
  delBtn:{paddingVertical:6,paddingHorizontal:10,backgroundColor:'#FEE2E2',borderRadius:8,borderWidth:1,borderColor:'#FCA5A5'},
});
