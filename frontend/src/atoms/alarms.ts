import { atom } from "jotai";
import { api } from "../api/endpoints";
import type { Alarm, Diagnosis, AlarmScenario } from "../types/domain";

export const selectedAlarmAtom = atom<Alarm | null>(null);
export const diagnosisAtom = atom<Diagnosis | null>(null);

export const selectAlarmAction = atom(null, (get, set, alarmId: string | null) => {
  const alarms = get(getAlarmsAtom());
  set(selectedAlarmAtom, alarmId ? alarms.find((a) => a.id === alarmId) ?? null : null);
  set(diagnosisAtom, null);
});

import { alarmsAtom } from "./room";
function getAlarmsAtom() { return alarmsAtom; }

export const triggerDemoAlarmAction = atom(null, async (get, set, scenario: AlarmScenario) => {
  const alarm = await api.demo.triggerAlarm({ scenario });
  set(selectedAlarmAtom, alarm);
  set(diagnosisAtom, null);
  return alarm;
});

export const acknowledgeAlarmAction = atom(null, async (get, set, alarmId: string) => {
  const alarm = await api.alarms.acknowledge(alarmId);
  const alarms = await api.alarms.list();
  set(getAlarmsRef(), alarms.items);
  set(selectedAlarmAtom, alarm);
  return alarm;
});

export const diagnoseAlarmAction = atom(null, async (get, set, alarmId: string) => {
  const diagnosis = await api.alarms.diagnose(alarmId);
  const alarms = await api.alarms.list();
  set(getAlarmsRef(), alarms.items);
  set(selectedAlarmAtom, alarms.items.find((a) => a.id === alarmId) ?? null);
  set(diagnosisAtom, diagnosis);
  return diagnosis;
});

export const createRemediationAction = atom(null, async (get, set, alarmId: string) => {
  const plan = await api.alarms.remediation(alarmId);
  const alarms = await api.alarms.list();
  set(getAlarmsRef(), alarms.items);
  set(selectedAlarmAtom, alarms.items.find((a) => a.id === alarmId) ?? null);
  set(getCurrentPlanRef(), plan);
  return plan;
});

import { currentPlanAtom } from "./plans";
function getAlarmsRef() { return alarmsAtom; }
function getCurrentPlanRef() { return currentPlanAtom; }
