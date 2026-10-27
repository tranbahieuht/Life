import {translate,type Language} from '@/i18n/core';
import { emptyData, type AppData, type LifeEvent } from "./types";
import { shiftDate } from "./schedule";

/** Explicit, isolated sample workspace. Never call this for a new account automatically. */
export function createDemoData(day: string,language:Language="vi"): AppData {
  const tr=(key:string)=>translate(language,key);
  const data = emptyData();
  data.preferences.language=language;
  data.preferences.displayName = "Hiếu";
  const createEvent = (id: string, title: string, category: LifeEvent["category"], startTime: string, endTime: string, description: string, completed = false): LifeEvent => ({
    id, title, category, startTime, endTime, description, date: day,
    status: completed ? "completed" : "planned", fixed: category === "study", location: "", notes: "",
  });
  data.events = [
    createEvent("demo-morning", tr("demo.morning"), "personal", "06:30", "07:00", tr("demo.walk"), true),
    createEvent("demo-java", tr("demo.java"), "study", "07:00", "09:30", tr("demo.javaDescription"), true),
    createEvent("demo-breakfast", tr("demo.breakfast"), "nutrition", "09:30", "10:00", tr("demo.breakfastDescription"), true),
    createEvent("demo-project", tr("demo.project"), "work", "10:15", "12:00", tr("demo.projectDescription")),
    createEvent("demo-lunch", tr("demo.lunch"), "nutrition", "12:00", "12:45", tr("demo.lunchDescription")),
    createEvent("demo-assignment", tr("demo.assignment"), "study", "13:30", "15:00", tr("demo.assignmentDescription")),
    { ...createEvent("demo-workout", tr("Push day"), "workout", "16:00", "17:15", tr("demo.workoutDescription")), details: { workoutPlanId: "demo-push" } },
    createEvent("demo-dinner", tr("demo.dinner"), "nutrition", "18:30", "19:00", tr("demo.dinnerDescription")),
    createEvent("demo-english", tr("demo.english"), "personal", "20:00", "21:00", tr("demo.englishDescription")),
    createEvent("demo-rest", tr("demo.rest"), "rest", "22:00", "23:00", tr("demo.restDescription")),
  ];
  data.events[1].location = tr("demo.room");
  data.events[3].checklist = [
    { id: "demo-check-1", text: tr("demo.check1"), done: true },
    { id: "demo-check-2", text: tr("demo.check2"), done: false },
    { id: "demo-check-3", text: tr("demo.check3"), done: false },
  ];
  data.tasks = [
    { id: "demo-task-java", title: tr("demo.assignment"), description: tr("demo.taskDescription"), priority: "high", deadline: `${shiftDate(day, 2)}T23:59`, estimatedMinutes: 180, category: "study", completed: false },
    { id: "demo-task-life", title: tr("demo.review"), description: tr("demo.reviewDescription"), priority: "medium", deadline: `${shiftDate(day, 4)}T17:00`, estimatedMinutes: 120, category: "work", completed: false },
  ];
  data.mealTemplates = [
    { id: "demo-meal-chicken", name: tr("Cơm gà & vegetables"), description: tr("demo.chickenDescription"), calories: 620, protein: 38, carbs: 75, fat: 18 },
    { id: "demo-meal-banhmi", name: "Bánh mì trứng", description: tr("demo.banhmiDescription"), calories: 420, protein: 19, carbs: 48, fat: 17 },
  ];
  data.workoutPlans = [{
    id: "demo-push", name: tr("Push day"), type: "Push", description: tr("demo.planDescription"),
    exercises: [
      { id: "demo-bench", name: tr("Bench press"), sets: 3, reps: 10, weight: 20, restSeconds: 90 },
      { id: "demo-shoulder", name: tr("demo.shoulder"), sets: 3, reps: 12, weight: 8, restSeconds: 60 },
      { id: "demo-triceps", name: tr("demo.triceps"), sets: 3, reps: 12, weight: 10, restSeconds: 60 },
    ],
  }];
  return data;
}
