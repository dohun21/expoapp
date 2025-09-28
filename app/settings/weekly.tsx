// app/settings/weekly-planner.tsx
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import DraggableFlatList, { RenderItemParams, ScaleDecorator } from 'react-native-draggable-flatlist';
import { auth } from '../../firebaseConfig';

type Step = { step: string; minutes: number };
type Routine = { id: string; title: string; steps: Step[]; tags?: string[]; origin?: 'preset'|'custom' };
type WeeklyTemplate = { mon: string[]; tue: string[]; wed: string[]; thu: string[]; fri: string[]; sat: string[]; sun: string[] };

const STORAGE_KEY = '@userRoutinesV1';
const WEEKLY_TEMPLATE_KEY_BASE = 'weeklyTemplate_v1';
const k = (base: string, uid: string) => `${base}_${uid}`;

const emptyTpl = (): WeeklyTemplate => ({ mon:[], tue:[], wed:[], thu:[], fri:[], sat:[], sun:[] });
const DAY_LABEL: Record<keyof WeeklyTemplate, string> = { mon:'월', tue:'화', wed:'수', thu:'목', fri:'금', sat:'토', sun:'일' };

/** Draggable 리스트 아이템 타입 */
type DayItem = { key: string; title: string };
/** onDragEnd 콜백 파라미터(라이브러리 타입과 구조만 맞추면 됨) */
type DragEnd<T> = { data: T[]; from: number; to: number };

export default function WeeklyPlanner() {
  const router = useRouter();
  const [uid, setUid] = useState<string | null>(null);
  const [tpl, setTpl] = useState<WeeklyTemplate>(emptyTpl());
  const [routines, setRoutines] = useState<Routine[]>([]);
  const [activeDay, setActiveDay] = useState<keyof WeeklyTemplate>('mon');

  useEffect(() => {
    const unsub = auth.onAuthStateChanged(async (user) => {
      if (!user) { setUid(null); return; }
      setUid(user.uid);

      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        const list = raw ? JSON.parse(raw) : [];
        setRoutines(Array.isArray(list) ? list : []);
      } catch { setRoutines([]); }

      try {
        const t = await AsyncStorage.getItem(k(WEEKLY_TEMPLATE_KEY_BASE, user.uid));
        setTpl(t ? JSON.parse(t) : emptyTpl());
      } catch { setTpl(emptyTpl()); }
    });
    return unsub;
  }, []);

  const save = useCallback(async () => {
    if (!uid) return;
    await AsyncStorage.setItem(k(WEEKLY_TEMPLATE_KEY_BASE, uid), JSON.stringify(tpl));
    router.back();
  }, [uid, tpl, router]);

  const addRoutineToDay = (day: keyof WeeklyTemplate, rid: string) => {
    setTpl(prev => ({ ...prev, [day]: [...(prev[day] ?? []), rid] }));
  };
  const removeRoutineFromDay = (day: keyof WeeklyTemplate, index: number) => {
    setTpl(prev => {
      const next = [...(prev[day] ?? [])];
      if (index >= 0 && index < next.length) next.splice(index, 1);
      return { ...prev, [day]: next };
    });
  };
  const reorderDay = (day: keyof WeeklyTemplate, data: string[]) => {
    setTpl(prev => ({ ...prev, [day]: data }));
  };

  const routinesById = useMemo(() => {
    const map: Record<string, Routine> = {};
    for (const r of routines) map[r.id] = r;
    return map;
  }, [routines]);

  const DayBox = ({ day }: { day: keyof WeeklyTemplate }) => {
    const ids = tpl[day] ?? [];
    const data: DayItem[] = ids.map((id) => ({
      key: id,
      title: routinesById[id]?.title || '삭제된 루틴',
    }));

    const renderItem = ({ item, drag, isActive, getIndex }: RenderItemParams<DayItem>) => {
      const currentIndex = (typeof getIndex === 'function' ? getIndex() : undefined) ?? data.findIndex(d => d.key === item.key);
      return (
        <ScaleDecorator>
          <View style={[s.row, isActive && s.rowActive]}>
            <TouchableOpacity onLongPress={drag} disabled={isActive} style={{ flex: 1 }}>
              <Text style={s.rowText} numberOfLines={1}>≡ {item.title}</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => removeRoutineFromDay(day, currentIndex)} style={s.rowRemove}>
              <Text style={{ color:'#EF4444', fontWeight:'700' }}>삭제</Text>
            </TouchableOpacity>
          </View>
        </ScaleDecorator>
      );
    };

    return (
      <View style={s.dayBox}>
        <View style={s.dayHeader}>
          <Text style={s.dayTitle}>{DAY_LABEL[day]}요일</Text>
          <TouchableOpacity onPress={() => setActiveDay(day)} style={[s.dayChip, activeDay === day && s.dayChipOn]}>
            <Text style={[s.dayChipText, activeDay === day && s.dayChipTextOn]}>선택</Text>
          </TouchableOpacity>
        </View>

        <DraggableFlatList<DayItem>
          data={data}
          keyExtractor={(item: DayItem) => item.key}
          onDragEnd={(params: DragEnd<DayItem>) => {
            const newData = params.data;
            reorderDay(day, newData.map((x: DayItem) => x.key));
          }}
          renderItem={renderItem}
          // ScrollView 안 중첩 리스트 충돌 방지
          scrollEnabled={false}
          activationDistance={8}
        />
      </View>
    );
  };

  return (
    <ScrollView contentContainerStyle={s.container} keyboardShouldPersistTaps="handled">
      <Text style={s.h1}>주간 루틴 플래너</Text>
      <Text style={s.sub}>아래 루틴을 탭하여 {DAY_LABEL[activeDay]}요일 칸에 추가하고, 칸 안에서는 길게 눌러 순서를 바꾸세요.</Text>

      {/* 2열 그리드(7칸) */}
      <View style={s.grid}>
        {(['mon','tue','wed','thu','fri','sat','sun'] as const).map((d) => (
          <View key={d} style={s.gridCell}>
            <DayBox day={d} />
          </View>
        ))}
      </View>

      {/* 루틴 팔레트 */}
      <View style={s.paletteCard}>
        <Text style={s.paletteTitle}>루틴 목록</Text>
        {routines.length === 0 && <Text style={s.emptyText}>루틴이 없습니다. 루틴 탭에서 먼저 만들어 주세요.</Text>}
        <View style={{ gap: 8 }}>
          {routines.map((r: Routine) => (
            <TouchableOpacity key={r.id} style={s.paletteItem} onPress={() => addRoutineToDay(activeDay, r.id)}>
              <Text style={s.paletteText} numberOfLines={1}>+ {r.title}</Text>
              <Text style={s.paletteHint}>{(r.steps?.length ?? 0)}단계</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      <View style={{ flexDirection:'row', gap: 10, marginTop: 10 }}>
        <TouchableOpacity onPress={save} style={[s.btn, { backgroundColor:'#3B82F6' }]}>
          <Text style={s.btnTextPrimary}>저장</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => Alert.alert('초기화','모든 요일 배치를 비울까요?',[
            { text:'취소', style:'cancel' },
            { text:'비우기', style:'destructive', onPress:() => setTpl(emptyTpl()) }
          ])}
          style={[s.btn, { backgroundColor:'#F3F4F6' }]}
        >
          <Text style={s.btnText}>비우기</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  container: { padding: 16, backgroundColor:'#fff' },
  h1: { fontSize:18, fontWeight:'800', color:'#111827', marginBottom:6 },
  sub: { fontSize:12, color:'#6B7280', marginBottom:12 },

  grid: { flexDirection:'row', flexWrap:'wrap', gap:12 },
  gridCell: { width:'48%' },

  dayBox: { borderWidth:1, borderColor:'#E5E7EB', borderRadius:12, padding:10, minHeight:160, backgroundColor:'#FFFFFF' },
  dayHeader: { flexDirection:'row', justifyContent:'space-between', alignItems:'center', marginBottom:6 },
  dayTitle: { fontSize:14, fontWeight:'700', color:'#111827' },
  dayChip: { paddingHorizontal:10, paddingVertical:6, borderRadius:999, backgroundColor:'#F3F4F6' },
  dayChipOn: { backgroundColor:'#EEF2FF' },
  dayChipText: { fontSize:12, color:'#111827', fontWeight:'700' },
  dayChipTextOn: { color:'#3730A3' },

  row: {
    borderWidth:1, borderColor:'#E5E7EB', borderRadius:10,
    padding:10, backgroundColor:'#FAFAFA', marginBottom:8,
    flexDirection:'row', justifyContent:'space-between', alignItems:'center'
  },
  rowActive: { backgroundColor:'#EEF2FF', borderColor:'#C7D2FE' },
  rowText: { color:'#111827', fontWeight:'700', flex:1, marginRight:8 },
  rowRemove: { paddingHorizontal:8, paddingVertical:4, backgroundColor:'#FEF2F2', borderRadius:8 },

  emptyText: { color:'#9CA3AF', fontSize:12, marginTop:4 },

  paletteCard: { marginTop:16, borderWidth:1, borderColor:'#E5E7EB', borderRadius:12, padding:12, backgroundColor:'#FFFFFF' },
  paletteTitle: { fontSize:14, fontWeight:'800', color:'#111827', marginBottom:8 },
  paletteItem: { borderWidth:1, borderColor:'#E5E7EB', borderRadius:10, padding:10, backgroundColor:'#FFFFFF', flexDirection:'row', justifyContent:'space-between', alignItems:'center' },
  paletteText: { color:'#111827', fontWeight:'700', maxWidth:'70%' },
  paletteHint: { color:'#6B7280', fontSize:12 },

  btn: { flex:1, paddingVertical:12, borderRadius:12, alignItems:'center' },
  btnTextPrimary: { color: '#fff', fontWeight:'800' },
  btnText: { color:'#111827', fontWeight:'700' },
});
