import type { ConfidenceLevel } from './confidence';

export type TaskSource = 'ai-suggested' | 'user-added';
export type PhaseSource = 'ai-suggested' | 'user-added';

export interface EditableTask {
  taskCode: string;
  taskName: string;
  hours: string;
  amount: string;
  suggestedHours: number;
  suggestedAmount: number;
  source: TaskSource;
}

export interface EditablePhase {
  phaseCode: string;
  phaseName: string;
  confidence: ConfidenceLevel;
  sampleSize: number;
  isCollapsed: boolean;
  source: PhaseSource;
  tasks: EditableTask[];
}

export function parseNum(s: string): number {
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

export function phaseSubtotals(phase: EditablePhase): { hours: number; amount: number } {
  return phase.tasks.reduce(
    (acc, t) => ({ hours: acc.hours + parseNum(t.hours), amount: acc.amount + parseNum(t.amount) }),
    { hours: 0, amount: 0 },
  );
}

export function isTaskDirty(task: EditableTask): boolean {
  if (task.source === 'user-added') return false;
  return (
    Math.round(parseNum(task.hours)) !== Math.round(task.suggestedHours) ||
    Math.round(parseNum(task.amount)) !== Math.round(task.suggestedAmount)
  );
}

export function isTaskEmpty(task: EditableTask): boolean {
  return parseNum(task.hours) === 0 && parseNum(task.amount) === 0;
}

export function deepCopyPhases(phases: EditablePhase[]): EditablePhase[] {
  return phases.map((p) => ({ ...p, tasks: p.tasks.map((t) => ({ ...t })) }));
}

export function getNextTaskCode(phase: EditablePhase): string {
  const match = phase.phaseCode.match(/^L(\d+)$/);
  if (!match) return `${phase.phaseCode}.${phase.tasks.length + 1}`;
  const centuryBase = Math.floor(parseInt(match[1], 10) / 100) * 100;
  const existingNums = phase.tasks
    .filter((t) => t.source === 'user-added')
    .map((t) => {
      const m = t.taskCode.match(/^L(\d+)$/);
      return m ? parseInt(m[1], 10) : 0;
    })
    .filter((n) => n >= centuryBase + 91);
  if (existingNums.length === 0) return `L${centuryBase + 91}`;
  return `L${Math.max(...existingNums) + 1}`;
}

export function getNextPhaseCode(phases: EditablePhase[]): string {
  const existing = phases
    .map((p) => {
      const m = p.phaseCode.match(/^L(\d+)$/);
      return m ? parseInt(m[1], 10) : 0;
    })
    .filter((n) => n > 0 && n % 100 === 0);
  if (existing.length === 0) return 'L100';
  return `L${Math.max(...existing) + 100}`;
}

export interface ForecastDiff {
  editedTasks: number;
  addedTasks: number;
  deletedTasks: number;
  addedPhases: number;
  deletedPhases: number;
}

export function diffForecasts(
  suggested: EditablePhase[],
  working: EditablePhase[],
): ForecastDiff {
  const suggestedPhaseMap = new Map(suggested.map((p) => [p.phaseCode, p]));
  let editedTasks = 0;
  let addedTasks = 0;
  let deletedTasks = 0;
  const addedPhases = working.filter((p) => p.source === 'user-added').length;
  const deletedPhases = suggested.filter(
    (p) => !working.some((w) => w.phaseCode === p.phaseCode),
  ).length;

  for (const wPhase of working) {
    for (const wTask of wPhase.tasks) {
      if (wTask.source === 'user-added') addedTasks++;
      else if (isTaskDirty(wTask)) editedTasks++;
    }
    const sugPhase = suggestedPhaseMap.get(wPhase.phaseCode);
    if (sugPhase) {
      const wCodes = new Set(wPhase.tasks.map((t) => t.taskCode));
      deletedTasks += sugPhase.tasks.filter((t) => !wCodes.has(t.taskCode)).length;
    }
  }

  return { editedTasks, addedTasks, deletedTasks, addedPhases, deletedPhases };
}

export function sumPhases(phases: EditablePhase[]): { hours: number; amount: number } {
  return phases.reduce(
    (acc, p) => {
      const s = phaseSubtotals(p);
      return { hours: acc.hours + s.hours, amount: acc.amount + s.amount };
    },
    { hours: 0, amount: 0 },
  );
}
