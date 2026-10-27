import { z } from "zod";
import { categories } from "./types";
import { isValidDateKey, timeToMinutes, validateEventTimezone } from "./schedule";

const dateSchema = z.string().refine(isValidDateKey, "Choose a valid date.");
const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use a valid 24-hour time.");
const text = (maximum = 4000) => z.string().max(maximum);
const idSchema = z.string().min(1).max(160);
const nonnegative = z.number().finite().min(0);
const categorySchema = z.enum(categories);

export const lifeEventSchema = z.object({
  id: idSchema,
  title: z.string().trim().min(1, "Give your activity a name.").max(200),
  description: text(), category: categorySchema, date: dateSchema,
  startTime: timeSchema, endTime: timeSchema, endDate: dateSchema.optional(),
  status: z.enum(["planned", "completed", "skipped"]), fixed: z.boolean(),
  location: text(500), notes: text(10_000),
  recurrence: z.object({ frequency: z.literal("weekly"), daysOfWeek: z.array(z.number().int().min(0).max(6)).min(1).max(7), until: dateSchema }).optional(),
  excludedDates: z.array(dateSchema).max(2000).optional(), parentId: idSchema.optional(),
  checklist: z.array(z.object({ id: idSchema, text: text(500), done: z.boolean() })).max(100).optional(),
  details: z.record(z.string(), z.unknown()).optional(),
}).superRefine((value, context) => {
  if (value.endDate && (value.endDate < value.date || (value.endDate === value.date && timeToMinutes(value.endTime) <= timeToMinutes(value.startTime)))) {
    context.addIssue({ code: "custom", path: ["endDate"], message: "The end must be after the start. Choose the next date for an overnight activity." });
  }
  if (value.recurrence && value.recurrence.until < value.date) {
    context.addIssue({ code: "custom", path: ["recurrence", "until"], message: "The recurrence must end on or after its first date." });
  }
});

const deadlineSchema = z.string().max(64).refine((value) => {
  if (!value) return true;
  if (isValidDateKey(value)) return true;
  if (!/^\d{4}-\d{2}-\d{2}T/.test(value)) return false;
  return isValidDateKey(value.slice(0, 10)) && /^([01]\d|2[0-3]):[0-5]\d/.test(value.slice(11)) && Number.isFinite(Date.parse(value));
}, "Choose a valid deadline.");

export const taskSchema = z.object({
  id: idSchema, title: z.string().trim().min(1).max(200), description: text(),
  priority: z.enum(["low", "medium", "high"]), deadline: deadlineSchema,
  estimatedMinutes: z.number().int().min(5).max(100_000), category: categorySchema, completed: z.boolean(),
});

export const preferencesSchema = z.object({
  displayName: z.string().trim().min(1).max(80),
  timezone: z.string().max(100).refine((value) => { try { new Intl.DateTimeFormat("en", { timeZone: value }); return true; } catch { return false; } }, "Choose a valid timezone."),
  language: z.enum(["en", "vi"]), theme: z.enum(["light", "dark", "system"]), timeFormat: z.enum(["12", "24"]),
  wakeTime: timeSchema, bedTime: timeSchema, mealTimes: text(500), focusHours: text(500),
  breakMinutes: z.number().int().min(0).max(120), workoutDays: z.array(z.number().int().min(0).max(6)).max(7),
  workoutDuration: z.number().int().min(5).max(480), fitnessGoal: text(1000), experience: text(100),
  dietaryPreferences: text(1000), allergies: text(1000), budget: text(200), personalGoal: text(2000),
});

export const mealTemplateSchema = z.object({
  id: idSchema, name: z.string().trim().min(1).max(200), description: text(),
  calories: nonnegative.max(20_000).optional(), protein: nonnegative.max(2000).optional(),
  carbs: nonnegative.max(5000).optional(), fat: nonnegative.max(2000).optional(),
});
export const exerciseSchema = z.object({
  id: idSchema, name: z.string().trim().min(1).max(200), sets: z.number().int().min(1).max(100),
  reps: z.number().int().min(1).max(10_000), weight: nonnegative.max(2000), restSeconds: z.number().int().min(0).max(3600),
});
export const workoutPlanSchema = z.object({
  id: idSchema, name: z.string().trim().min(1).max(200), type: text(100), description: text(),
  exercises: z.array(exerciseSchema).max(100),
});
export const exerciseLogSchema = z.object({
  id: idSchema, eventId: idSchema, exerciseId: idSchema, date: dateSchema,
  sets: z.number().int().min(1).max(100), reps: z.number().int().min(1).max(10_000), weight: nonnegative.max(2000), notes: text(),
});
export const appDataSchema = z.object({
  events: z.array(lifeEventSchema).max(10_000), tasks: z.array(taskSchema).max(10_000), preferences: preferencesSchema,
  mealTemplates: z.array(mealTemplateSchema).max(1000), workoutPlans: z.array(workoutPlanSchema).max(1000),
  exerciseLogs: z.array(exerciseLogSchema).max(50_000),
}).superRefine((value, context) => {
  for (const message of validateEventTimezone(value.events, value.preferences.timezone).errors) {
    context.addIssue({ code: "custom", path: ["events"], message });
  }
});
export const planProposalSchema = z.object({
  summary: z.string().min(1).max(5000), events: z.array(lifeEventSchema).min(1).max(100),
  changes: z.array(z.object({ eventId: idSchema, before: text(500), after: text(500), reason: text(2000) })).max(100).optional(),
});
