// Shared motion presets for the `motion` library.
// Keep in sync with the durations/easings documented in docs/DESIGN.md.
import type { Transition } from 'motion/react'

export const spring: Transition = { type: 'spring', stiffness: 520, damping: 38, mass: 0.9 }
export const springSoft: Transition = { type: 'spring', stiffness: 320, damping: 32, mass: 1 }
export const springSnappy: Transition = { type: 'spring', stiffness: 700, damping: 42, mass: 0.8 }

export const fade = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
  transition: { duration: 0.16 }
} as const

/** Standard page transition: subtle rise + fade */
export const page = {
  initial: { opacity: 0, y: 12, scale: 0.995 },
  animate: { opacity: 1, y: 0, scale: 1 },
  exit: { opacity: 0, y: -8, scale: 0.995, transition: { duration: 0.14 } },
  transition: spring
} as const

/** Popovers/menus: scale from origin */
export const pop = {
  initial: { opacity: 0, scale: 0.94, y: -4 },
  animate: { opacity: 1, scale: 1, y: 0 },
  exit: { opacity: 0, scale: 0.96, y: -4, transition: { duration: 0.12 } },
  transition: springSnappy
} as const

export const dialogMotion = {
  initial: { opacity: 0, scale: 0.95, y: 16 },
  animate: { opacity: 1, scale: 1, y: 0 },
  exit: { opacity: 0, scale: 0.97, y: 10, transition: { duration: 0.15 } },
  transition: spring
} as const
