// The daily practice goal: minutes a day to aim for, across every kind of practice. It is a target to show
// progress against, never a judgement: a day without practice is just a day off, never "missed".
import { useSyncExternalStore } from 'react'

export const GOAL_KEY = 'practice-goal'
export const GOAL_CHOICES = [15, 20, 30, 45, 60] as const
export type GoalMin = (typeof GOAL_CHOICES)[number]
export const DEFAULT_GOAL: GoalMin = 30

const isChoice = (v: unknown): v is GoalMin => GOAL_CHOICES.includes(v as GoalMin)

/** The stored goal ({"min": 30}); anything unreadable or not one of the choices is the default. */
export function parseGoal(raw: string | null): GoalMin {
  if (!raw) return DEFAULT_GOAL
  try {
    const o = JSON.parse(raw) as { min?: unknown } | null
    return o && typeof o === 'object' && isChoice(o.min) ? o.min : DEFAULT_GOAL
  } catch {
    return DEFAULT_GOAL
  }
}

/** How far a day's seconds are towards the goal, 0 to 1. */
export const goalFraction = (sec: number, min: number): number => (min > 0 ? Math.min(1, Math.max(0, sec) / (min * 60)) : 0)

/** True once the day's practice reaches the goal. */
export const reachedGoal = (sec: number, min: number): boolean => min > 0 && sec >= min * 60

// The top bar's ring, in its 100 path units (a 2-unit stroke on a circle of r 6.25, about 39.3 units around).
const RING_CAPS = 5.1 // the round ends reach past the dash by half the stroke each
const RING_GAP = 4 // stays open until the goal is met, so the ring never looks closed too early

/**
 * The ring's dash length: 100 once the goal is met (square ends), 0 before anything counted. In between it
 * shrinks to leave room for the round ends, and a sliver shows as soon as anything counted.
 */
export function ringDash(sec: number, min: number): number {
  if (reachedGoal(sec, min)) return 100
  if (sec <= 0) return 0
  return Math.max(1, goalFraction(sec, min) * (100 - RING_CAPS - RING_GAP))
}

/** Whole minutes played so far: "12 / 30 min" never rounds up to a goal that isn't reached yet. */
export const wholeMin = (sec: number): number => Math.floor(Math.max(0, sec) / 60)

function readRaw(): string | null {
  try {
    return localStorage.getItem(GOAL_KEY)
  } catch {
    return null
  }
}

export const getDailyGoal = (): GoalMin => parseGoal(readRaw())

const listeners = new Set<() => void>()

export function setDailyGoal(min: GoalMin): void {
  try {
    localStorage.setItem(GOAL_KEY, JSON.stringify({ min }))
  } catch {
    /* storage unavailable: nothing to keep it in */
  }
  listeners.forEach((fn) => fn())
}

// Another tab changed it (or cleared storage).
const onStorage = (ev: StorageEvent) => {
  if (ev.key === GOAL_KEY || ev.key === null) listeners.forEach((fn) => fn())
}

export function subscribeGoal(fn: () => void): () => void {
  if (!listeners.size) window.addEventListener('storage', onStorage)
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
    if (!listeners.size) window.removeEventListener('storage', onStorage)
  }
}

/** The goal in minutes, live. */
export function useDailyGoal(): GoalMin {
  return useSyncExternalStore(subscribeGoal, getDailyGoal)
}
