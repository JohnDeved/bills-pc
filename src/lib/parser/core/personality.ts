/** Gen 3 personality-dependent traits, as defined in pret/pokeemerald's pokemon.c. */
function unownLetter(personality: number): number {
  return ((((personality >>> 24) & 3) << 6) | (((personality >>> 16) & 3) << 4) | (((personality >>> 8) & 3) << 2) | (personality & 3)) % 28
}

/** Find a bounded, uint32 PID change without changing the Pokémon's other traits. */
export function personalityForNature(personality: number, otId: number, speciesId: number, nature: number): number {
  const original = personality >>> 0
  const trainerXor = (otId >>> 16) ^ (otId & 0xffff)
  const originalShinyValue = (original >>> 16) ^ (original & 0xffff) ^ trainerXor
  const wasShiny = originalShinyValue < 8
  const originalLetter = unownLetter(original)
  const evolvesToSilcoon = (original >>> 16) % 10 < 5
  const matches = (candidate: number) => {
    if (candidate % 25 !== nature) return false
    const shinyValue = (candidate >>> 16) ^ (candidate & 0xffff) ^ trainerXor
    if (shinyValue < 8 !== wasShiny) return false
    if (speciesId === 201 && unownLetter(candidate) !== originalLetter) return false
    if (speciesId === 265 && (candidate >>> 16) % 10 < 5 !== evolvesToSilcoon) return false
    return true
  }

  if (wasShiny) {
    // With OT fixed, every shiny PID is determined by its low half and one of
    // eight shiny XOR values. Search these directly instead of random retries.
    const originalLow = original & 0xffff
    const tryLowHalf = (low: number): number | undefined => {
      for (let index = 0; index < 8; index++) {
        const high = low ^ trainerXor ^ ((originalShinyValue + index) & 7)
        const candidate = (high * 0x10000 + low) >>> 0
        if (matches(candidate)) return candidate
      }
      return undefined
    }
    for (let index = 0; index < 256; index++) {
      const candidate = tryLowHalf((originalLow + index * 256) & 0xffff)
      if (candidate !== undefined) return candidate
    }
    // Some shiny Unown/Wurmple cannot reach every nature with an identical low
    // byte. Retain parity and actual gender instead: Unown is genderless;
    // Wurmple's fixed female threshold is 127. Letter/evolution still must match.
    if (speciesId === 201 || speciesId === 265) {
      const wasFemale = (originalLow & 0xff) < 127
      for (let index = 1; index < 0x8000; index++) {
        const low = (originalLow + index * 2) & 0xffff
        if (speciesId === 265 && (low & 0xff) < 127 !== wasFemale) continue
        const candidate = tryLowHalf(low)
        if (candidate !== undefined) return candidate
      }
    }
  } else {
    // Hold the low byte fixed, preserving every Gen 3 gender ratio and PID
    // parity. Since 256^-1 mod 25 = 21, all generated PIDs have the wanted nature.
    const low = original & 0xff
    const residue = ((((nature - low) % 25) + 25) * 21) % 25
    const count = Math.floor((0xffffff - residue) / 25) + 1
    const start = Math.max(0, Math.floor(((original >>> 8) - residue) / 25))
    for (let index = 0; index < count; index++) {
      const upper = residue + ((start + index) % count) * 25
      const candidate = upper * 256 + low
      if (matches(candidate)) return candidate
    }
  }
  throw new Error('No personality value preserves this Pokémon’s traits with the selected nature')
}
