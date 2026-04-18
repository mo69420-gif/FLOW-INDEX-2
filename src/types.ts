export type Mood = 'HOSTILE BUT HELPFUL' | 'JUDGING YOU HEAVILY' | 'CAUTIOUSLY OPTIMISTIC' | 'MILDLY IMPRESSED' | 'BEGRUDGINGLY PROUD' | 'MAXIMUM RESPECT UNLOCKED';

export interface Target {
  id: string;
  label: string;
  tier: 1 | 2 | 3;
  why: string;
  effort: number;
  value: number;
}

export interface ImpactMetrics {
  flow: number;     // 1-5
  psych: number;    // 1-5
  ergonomic: number; // 1-5
}

export interface Directive {
  id: string;
  label: string;
  instruction: string;
}

export interface Sector {
  key: string;
  name: string;
  desc: string;
  est: number;
  targets: Target[];
  impact: ImpactMetrics;
  inventory: Record<string, string[]>;
  recommendation?: string;
  assessment?: string;
}

export interface OperationSettings {
  sound: boolean;
  notifications: boolean;
  hostility: number;
  hostilityAuto: boolean;
}

export interface OperationHistory {
  date: string;
  op: string;
  score: number;
  mood: Mood;
  maxStreak: number;
  time: number;
}

export interface UserProfile {
  uid: string;
  callsign: string;
  totalScore: number;
  maxStreak: number;
  scenariosCompleted: number;
  settings: OperationSettings;
  currentScreen?: string;
  activeOpId?: string;
}

export interface Operation {
  id?: string;
  userId: string;
  name: string;
  status: 'active' | 'completed' | 'archived';
  scanPhoto?: string;
  scanIntent?: string;
  directives: Directive[];
  sectors: Sector[];
  completedTargets: string[];
  targetActions: Record<string, 'purge' | 'claim' | 'exile'>;
  totalScore: number;
  streak: number;
  maxStreak: number;
  startedAt: string;
  completedAt?: string;
  mood: Mood;
}
