/** Emerald's six integer growth curves, in the order used by its species table. */
export function experienceForLevel(rate: number, level: number): number {
  if (!Number.isInteger(level) || level < 1 || level > 100 || !Number.isInteger(rate) || rate < 0 || rate > 5) throw new Error('Invalid experience curve')
  if (level === 1) return 0
  const cube = level ** 3
  switch (rate) {
    case 0:
      return cube
    case 1:
      if (level <= 50) return Math.floor((cube * (100 - level)) / 50)
      if (level <= 68) return Math.floor((cube * (150 - level)) / 100)
      if (level <= 98) return Math.floor((cube * Math.floor((1911 - 10 * level) / 3)) / 500)
      return Math.floor((cube * (160 - level)) / 100)
    case 2:
      if (level <= 15) return Math.floor((cube * (Math.floor((level + 1) / 3) + 24)) / 50)
      if (level <= 36) return Math.floor((cube * (level + 14)) / 50)
      return Math.floor((cube * (Math.floor(level / 2) + 32)) / 50)
    case 3:
      return Math.floor((6 * cube) / 5) - 15 * level ** 2 + 100 * level - 140
    case 4:
      return Math.floor((4 * cube) / 5)
    default:
      return Math.floor((5 * cube) / 4)
  }
}

export function levelForExperience(rate: number, experience: number): number {
  if (!Number.isInteger(experience) || experience < 0 || experience > experienceForLevel(rate, 100)) throw new Error('Experience is outside the valid Emerald range')
  let level = 1
  while (level < 100 && experience >= experienceForLevel(rate, level + 1)) level++
  return level
}

/** Keep the same level and relative progress, constrained to Quetzal's units of 10. */
export function quetzalExperience(rate: number, experience: number): { level: number; experience: number } {
  const level = levelForExperience(rate, experience)
  if (level === 100) return { level, experience: 1059860 }
  const originalStart = experienceForLevel(rate, level)
  const originalEnd = experienceForLevel(rate, level + 1)
  const targetStart = experienceForLevel(3, level)
  const targetEnd = experienceForLevel(3, level + 1)
  const progress = (experience - originalStart) / (originalEnd - originalStart)
  const desired = Math.round((targetStart + progress * (targetEnd - targetStart)) / 10) * 10
  const minimum = Math.ceil(targetStart / 10) * 10
  const maximum = Math.floor((targetEnd - 1) / 10) * 10
  if (minimum > maximum) throw new Error(`Level ${level} cannot be represented in this Quetzal box format`)
  return { level, experience: Math.max(minimum, Math.min(maximum, desired)) }
}
