import { readFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { loadBoxSave, pokemonApiResponse } from './box-fixtures'

async function fitViewport(page: Page) {
  const size = await page.evaluate(() => ({ viewport: innerWidth, width: document.documentElement.scrollWidth }))
  expect(size.width, 'The transfer flow fits the device without horizontal scrolling').toBeLessThanOrEqual(size.viewport)
}

test('Emerald → Quetzal: review, download, preserve originals and open the arrival', async ({ page }, testInfo) => {
  test.setTimeout(90000)
  const source = process.env.BILLS_PC_EMERALD_SAVE ? new Uint8Array(readFileSync(process.env.BILLS_PC_EMERALD_SAVE)) : loadBoxSave('emerald')
  const destination = loadBoxSave('quetzal')
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.addInitScript(() => localStorage.setItem('ui-settings', JSON.stringify({ version: 3, state: { shaderEnabled: false, pwaInstall: { dismissed: true } } })))
  // Only editor presentation uses this response stub; transfer conversion is offline.
  await page.route('https://pokeapi.co/api/v2/**', route => route.fulfill({ json: pokemonApiResponse(route.request().url()) }))
  await page.goto('/')
  await page.getByRole('button', { name: 'Transfer Pokémon', exact: true }).click()
  const next = page.getByRole('button', { name: 'Continue to Pokémon', exact: true })
  await expect(next).toBeDisabled()
  await page.getByLabel('Emerald source save', { exact: true }).setInputFiles({ name: 'wrong.sav', mimeType: 'application/octet-stream', buffer: Buffer.from(destination) })
  await expect(page.getByRole('alert')).toContainText('vanilla Pokémon Emerald')
  await expect(next).toBeDisabled()
  await page.getByLabel('Emerald source save', { exact: true }).setInputFiles({ name: 'emerald.sav', mimeType: 'application/octet-stream', buffer: Buffer.from(source) })
  await expect(page.getByRole('button', { name: 'Change Emerald save', exact: true })).toBeEnabled()
  await page.getByLabel('Quetzal destination save', { exact: true }).setInputFiles({ name: 'quetzal.sav', mimeType: 'application/octet-stream', buffer: Buffer.from(destination) })
  await expect(next).toBeEnabled()
  await fitViewport(page)
  await next.click()

  await page.getByRole('combobox', { name: 'Source location', exact: true }).selectOption('party')
  await page.getByRole('group', { name: 'Source Pokémon', exact: true }).locator('button:enabled').first().click()
  await page.getByRole('combobox', { name: 'Source location', exact: true }).selectOption('box:0')
  await page.getByRole('group', { name: 'Source Pokémon', exact: true }).locator('button:enabled').first().click()
  const destinationSelect = page.getByRole('combobox', { name: 'Destination box', exact: true })
  const chosenBox = Number(await destinationSelect.inputValue())
  const fullBox = await destinationSelect.locator('option').evaluateAll(options => options.find(option => option.textContent?.endsWith('· 0 free'))?.getAttribute('value'))
  expect(fullBox, 'The real Quetzal fixture exercises occupied-box protection').not.toBeUndefined()
  await destinationSelect.selectOption(fullBox!)
  await expect(page.getByRole('button', { name: 'Review transfer', exact: true })).toBeDisabled()
  await expect(page.getByRole('status')).toContainText('0 empty slots')
  await destinationSelect.selectOption(String(chosenBox))
  await expect(page.getByRole('group', { name: 'Destination box preview', exact: true }).locator('[title$="(new copy)"]')).toHaveCount(2)
  await fitViewport(page)
  await page.getByRole('button', { name: 'Review transfer', exact: true }).click()
  await expect(page.getByText(/Quetzal compact boxes do not store the original trainer/)).toBeVisible()
  const create = page.getByRole('button', { name: 'Create Quetzal save', exact: true })
  const acknowledge = page.getByRole('checkbox', { name: /I’ve reviewed the Quetzal changes above/ })
  await expect(create).toBeDisabled()
  await acknowledge.check()
  await expect(create).toBeEnabled()
  await page.getByRole('button', { name: 'Back', exact: true }).click()
  await page.getByRole('button', { name: 'Review transfer', exact: true }).click()
  await expect(acknowledge).not.toBeChecked()
  await expect(create).toBeDisabled()
  await acknowledge.check()
  await fitViewport(page)
  await create.click()
  await expect(page.getByRole('heading', { name: 'Transfer complete', exact: true })).toBeVisible()
  await fitViewport(page)

  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download new Quetzal save', exact: true }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toBe('quetzal-with-emerald-pokemon.sav')
  const outputPath = testInfo.outputPath('quetzal-with-emerald-pokemon.sav')
  await download.saveAs(outputPath)
  const exported = new Uint8Array(readFileSync(outputPath))
  const backupPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download Emerald backup', exact: true }).click()
  const backup = await backupPromise
  const backupPath = testInfo.outputPath('emerald-backup.sav')
  await backup.saveAs(backupPath)
  expect(new Uint8Array(readFileSync(backupPath))).toEqual(source)

  const audit = await page.evaluate(
    async ({ before, after, boxIndex }) => {
      const module = '/src/lib/parser/core/PokemonSaveParser.ts'
      const { PokemonSaveParser } = await import(module)
      const parser = new PokemonSaveParser()
      const original = await parser.parse(new Uint8Array(before).buffer)
      const result = await new PokemonSaveParser().parse(new Uint8Array(after).buffer)
      // This helper must live inside Playwright's serialized browser callback.
      // eslint-disable-next-line unicorn/consistent-function-scoping
      const same = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((value, index) => value === b[index])
      let existingUnchanged = original.party_pokemon.every((pokemon: { rawBytes: Uint8Array }, index: number) => same(pokemon.rawBytes, result.party_pokemon[index].rawBytes))
      const arrivals: { box: number; slot: number; nickname: string }[] = []
      const allowed = new Set<number>()
      original.boxes.forEach((box: { name: string; pokemon: ({ rawBytes: Uint8Array } | null)[] }, index: number) => {
        if (box.name !== result.boxes[index].name) existingUnchanged = false
        box.pokemon.forEach((pokemon, slot) => {
          const target = result.boxes[index].pokemon[slot]
          if (pokemon) {
            if (!target || !same(pokemon.rawBytes, target.rawBytes)) existingUnchanged = false
          } else if (target) {
            arrivals.push({ box: index, slot, nickname: target.nickname })
            const start = 0x461 + (index * 30 + slot) * 31
            for (let byte = start; byte < start + 31; byte++) {
              const physical = original.sector_map.get(5 + Math.floor(byte / 0xf80)) * 0x1000
              allowed.add(physical + (byte % 0xf80))
              allowed.add(physical + 0xff6)
              allowed.add(physical + 0xff7)
            }
          }
        })
      })
      const storeModule = '/src/stores/useSaveFileStore.ts'
      const { useSaveFileStore } = await import(storeModule)
      return {
        existingUnchanged,
        arrivals,
        expectedSlots: original.boxes[boxIndex].pokemon.flatMap((pokemon: unknown, slot: number) => (!pokemon ? [slot] : [])).slice(0, 2),
        unexpectedChangedBytes: after.flatMap((byte: number, index: number) => (byte !== before[index] && !allowed.has(index) ? [index] : [])),
        hasFile: useSaveFileStore.getState().hasFile,
        sameSize: before.length === after.length,
        boxError: result.box_error ?? null,
      }
    },
    { before: [...destination], after: [...exported], boxIndex: chosenBox }
  )
  expect(audit.existingUnchanged).toBe(true)
  expect(audit.arrivals).toHaveLength(2)
  expect(audit.arrivals.map(pokemon => pokemon.box)).toEqual([chosenBox, chosenBox])
  expect(audit.arrivals.map(pokemon => pokemon.slot)).toEqual(audit.expectedSlots)
  expect(audit.unexpectedChangedBytes).toEqual([])
  expect(audit.hasFile, 'Preparing/downloading a transfer must not replace the current editor').toBe(false)
  expect(audit.sameSize).toBe(true)
  expect(audit.boxError).toBeNull()

  await page.getByRole('button', { name: 'Open result in editor', exact: true }).click()
  await expect(page.getByRole('tab', { name: 'PC boxes', exact: true })).toHaveAttribute('data-state', 'active')
  await expect(page.getByRole('combobox', { name: 'PC box', exact: true })).toHaveValue(String(chosenBox))
  await expect(page.getByRole('button', { name: `Box ${chosenBox + 1}, slot ${audit.arrivals[0]!.slot + 1}: ${audit.arrivals[0]!.nickname}`, exact: true })).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('menuitem', { name: 'File', exact: true }).click()
  const roundTripPromise = page.waitForEvent('download')
  await page.getByRole('menuitem', { name: 'Download', exact: true }).click()
  const roundTrip = await roundTripPromise
  const roundTripPath = testInfo.outputPath('reopened-without-edits.sav')
  await roundTrip.saveAs(roundTripPath)
  expect(new Uint8Array(readFileSync(roundTripPath))).toEqual(exported)
  await page.getByRole('menuitem', { name: 'File', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Transfer Pokémon…', exact: true }).click()
  await expect(page.getByText('From your open save, including edits', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Change Quetzal save', exact: true })).toBeEnabled()
  await expect(page.getByRole('button', { name: 'Continue to Pokémon', exact: true })).toBeDisabled()
  await page.getByRole('button', { name: 'Back to Bill’s PC', exact: true }).click()
  await expect(page.getByRole('combobox', { name: 'PC box', exact: true })).toHaveValue(String(chosenBox))
  expect(errors).toEqual([])
})

test('opening a result backs up the initial edited save even after replacing the destination', async ({ page }, testInfo) => {
  test.setTimeout(60000)
  await page.addInitScript(() => localStorage.setItem('ui-settings', JSON.stringify({ version: 3, state: { shaderEnabled: false, pwaInstall: { dismissed: true } } })))
  await page.route('https://pokeapi.co/api/v2/**', route => route.fulfill({ json: pokemonApiResponse(route.request().url()) }))
  await page.goto('/')
  // Wait for the usable landing screen, after the recent-file restore check.
  await expect(page.getByRole('heading', { name: 'Drop your Savegame here', exact: true })).toBeVisible()
  const destination = loadBoxSave('quetzal')
  await page.locator('input[type=file]').setInputFiles({ name: 'my-quetzal.sav', mimeType: 'application/octet-stream', buffer: Buffer.from(destination) })
  await page.getByRole('tab', { name: 'PC boxes', exact: true }).click()
  await page.getByRole('combobox', { name: 'PC box', exact: true }).selectOption('0')
  const target = await page.evaluate(async () => {
    const module = '/src/stores/useSaveFileStore.ts'
    const { useSaveFileStore } = await import(module)
    const [pokemon] = useSaveFileStore.getState().saveData.boxes[0].pokemon
    return { nickname: pokemon.nickname as string, iv: pokemon.ivs[0] as number }
  })
  await page.getByRole('button', { name: `Box 1, slot 1: ${target.nickname}`, exact: true }).click()
  const edited = target.iv === 31 ? 0 : 31
  await page.getByRole('button', { name: `Set HP IV to ${edited}`, exact: true }).click()
  await page.getByRole('heading', { name: target.nickname, exact: true }).hover()
  await expect(page.getByRole('button', { name: `Set HP IV to ${target.iv === 31 ? 31 : 0}`, exact: true })).toHaveText(String(edited))
  const expectedBackup = await page.evaluate(async () => {
    const module = '/src/stores/useSaveFileStore.ts'
    const { useSaveFileStore } = await import(module)
    const { parser, saveData } = useSaveFileStore.getState()
    return [...parser.reconstructSaveFile(saveData.party_pokemon, saveData.boxes)] as number[]
  })
  expect(new Uint8Array(expectedBackup)).not.toEqual(destination)
  await page.getByRole('menuitem', { name: 'File', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Transfer Pokémon…', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Change Quetzal save', exact: true })).toBeEnabled()
  await page.getByLabel('Quetzal destination save', { exact: true }).setInputFiles({ name: 'replacement.sav', mimeType: 'application/octet-stream', buffer: Buffer.from(destination) })
  await expect(page.getByRole('button', { name: 'Choose Emerald save', exact: true })).toBeEnabled()
  await page.getByLabel('Emerald source save', { exact: true }).setInputFiles({ name: 'emerald.sav', mimeType: 'application/octet-stream', buffer: Buffer.from(loadBoxSave('emerald')) })
  await page.getByRole('button', { name: 'Continue to Pokémon', exact: true }).click()
  await page.getByRole('group', { name: 'Source Pokémon', exact: true }).locator('button:enabled').first().click()
  await page.getByRole('button', { name: 'Review transfer', exact: true }).click()
  await page.getByRole('checkbox', { name: /I’ve reviewed the Quetzal changes above/ }).check()
  await page.getByRole('button', { name: 'Create Quetzal save', exact: true }).click()
  const open = page.getByRole('button', { name: 'Back up current save & open', exact: true })
  await expect(open).toBeVisible()
  const backupPromise = page.waitForEvent('download')
  await open.click()
  const backup = await backupPromise
  expect(backup.suggestedFilename()).toBe('my-quetzal-before-transfer.sav')
  const path = testInfo.outputPath(backup.suggestedFilename())
  await backup.saveAs(path)
  expect(new Uint8Array(readFileSync(path))).toEqual(new Uint8Array(expectedBackup))
  await expect(page.getByRole('tab', { name: 'PC boxes', exact: true })).toHaveAttribute('data-state', 'active')
  const opened = await page.evaluate(async () => {
    const module = '/src/stores/useSaveFileStore.ts'
    const { useSaveFileStore } = await import(module)
    const { parser, saveData } = useSaveFileStore.getState()
    return { filename: parser.saveFileName as string, hasWriteHandle: Boolean(parser.fileHandle), originalIv: saveData.boxes[0].pokemon[0].ivs[0] as number }
  })
  expect(opened.filename).toBe('replacement-with-emerald-pokemon.sav')
  expect(opened.hasWriteHandle).toBe(false)
  expect(opened.originalIv).toBe(target.iv)
})
