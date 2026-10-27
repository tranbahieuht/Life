export const categories = ["study", "work", "nutrition", "workout", "personal", "rest"] as const;
export type Category = (typeof categories)[number];
export type EventStatus = "planned" | "completed" | "skipped";
export type TimelineStatus = "active" | "upcoming" | "unconfirmed" | "completed" | "skipped";

export interface LifeEvent {
  id: string;
  title: string;
  description: string;
  category: Category;
  date: string;
  startTime: string;
  endTime: string;
  endDate?: string;
  status: EventStatus;
  fixed: boolean;
  location: string;
  notes: string;
  recurrence?: { frequency: "weekly"; daysOfWeek: number[]; until: string };
  excludedDates?: string[];
  parentId?: string;
  checklist?: { id: string; text: string; done: boolean }[];
  details?: Record<string, unknown>;
}

export interface Task {
  id: string;
  title: string;
  description: string;
  priority: "low" | "medium" | "high";
  deadline: string;
  estimatedMinutes: number;
  category: Category;
  completed: boolean;
}

export interface Preferences {
  displayName: string;
  timezone: string;
  language: "en" | "vi";
  theme: "light" | "dark" | "system";
  timeFormat: "12" | "24";
  wakeTime: string;
  bedTime: string;
  mealTimes: string;
  focusHours: string;
  breakMinutes: number;
  workoutDays: number[];
  workoutDuration: number;
  fitnessGoal: string;
  experience: string;
  dietaryPreferences: string;
  allergies: string;
  budget: string;
  personalGoal: string;
}

export interface MealTemplate {
  id: string;
  name: string;
  description: string;
  calories?: number;
  protein?: number;
  carbs?: number;
  fat?: number;
}

export interface Exercise {
  id: string;
  name: string;
  sets: number;
  reps: number;
  weight: number;
  restSeconds: number;
}

export interface WorkoutPlan {
  id: string;
  name: string;
  type: string;
  description: string;
  exercises: Exercise[];
}

export interface ExerciseLog {
  id: string;
  eventId: string;
  exerciseId: string;
  date: string;
  sets: number;
  reps: number;
  weight: number;
  notes: string;
}

export interface AppData {
  events: LifeEvent[];
  tasks: Task[];
  preferences: Preferences;
  mealTemplates: MealTemplate[];
  workoutPlans: WorkoutPlan[];
  exerciseLogs: ExerciseLog[];
}

export interface PlanProposal {
  summary: string;
  events: LifeEvent[];
  changes?: { eventId: string; before: string; after: string; reason: string }[];
}

export const categoryLabels: Record<Category, string> = {
  study: "Study", work: "Work", nutrition: "Nutrition", workout: "Workout", personal: "Personal", rest: "Rest",
};

export const defaultPreferences: Preferences = {
  displayName: "Bạn",
  timezone: "Asia/Ho_Chi_Minh",
  language: "vi",
  theme: "light",
  timeFormat: "24",
  wakeTime: "06:30",
  bedTime: "23:00",
  mealTimes: "07:00, 12:00, 18:30",
  focusHours: "09:00–11:30, 14:00–16:00",
  breakMinutes: 15,
  workoutDays: [1, 3, 5],
  workoutDuration: 75,
  fitnessGoal: "",
  experience: "Beginner",
  dietaryPreferences: "",
  allergies: "",
  budget: "",
  personalGoal: "",
};

export function emptyData(): AppData {
  return {
    events: [], tasks: [], preferences: { ...defaultPreferences, workoutDays: [...defaultPreferences.workoutDays] },
    mealTemplates: [], workoutPlans: [], exerciseLogs: [],
  };
}
