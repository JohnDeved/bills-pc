import { readFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { loadBoxSave, pokemonApiResponse, type BoxGame } from './box-fixtures'

async function inspectSave(page: Page, bytes: Uint8Array) {
  return page.evaluate(
    async values => {
      const parserModule = '/src/lib/parser/core/PokemonSaveParser.ts'
      const { PokemonSaveParser } = await import(parserModule)
      const save = await new PokemonSaveParser().parse(new Uint8Array(values).buffer)
      const [target] = save.boxes[0].pokemon
      return {
        boxCount: save.boxes.length as number,
        lastSlotName: save.boxes[save.boxes.length - 1].pokemon[29]?.nickname ?? 'Empty',
        target: { nickname: target.nickname as string, iv: target.ivs[0] as number, nature: target.nature as string },
        party: save.party_pokemon.map((pokemon: { rawBytes: Uint8Array }) => [...pokemon.rawBytes]) as number[][],
      }
    },
    [...bytes]
  )
}

for (const game of ['emerald', 'quetzal'] as const satisfies readonly BoxGame[]) {
  test(`${game}: open PC, edit, undo/redo, download and reopen`, async ({ page }, testInfo) => {
    test.setTimeout(60000)
    // Save editing tests do not need the optional animated background or install prompt.
    await page.addInitScript(() => {
      localStorage.setItem('ui-settings', JSON.stringify({ version: 3, state: { shaderEnabled: false, pwaInstall: { dismissed: true } } }))
    })
    await page.route('https://pokeapi.co/api/v2/**', route => route.fulfill({ json: pokemonApiResponse(route.request().url()) }))
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    const originalBytes = game === 'emerald' && process.env.BILLS_PC_EMERALD_SAVE ? new Uint8Array(readFileSync(process.env.BILLS_PC_EMERALD_SAVE)) : loadBoxSave(game)
    await page.goto('/')
    const original = await inspectSave(page, originalBytes)
    const { nickname, iv: initialIv } = original.target
    const editedIv = initialIv === 31 ? 0 : 31

    await page.locator('input[type=file]').setInputFiles({ name: `${game}.sav`, mimeType: 'application/octet-stream', buffer: Buffer.from(originalBytes) })
    await expect(page.getByRole('tab', { name: 'Party', exact: true })).toBeVisible()
    await page.getByRole('tab', { name: 'PC boxes', exact: true }).click()
    await page.getByRole('combobox', { name: 'PC box', exact: true }).selectOption('0')
    const selectedSlot = page.getByRole('button', { name: `Box 1, slot 1: ${nickname}`, exact: true })
    await selectedSlot.click()
    await expect(page.getByRole('heading', { name: nickname, exact: true })).toBeVisible()
    await expect(selectedSlot).toHaveAttribute('aria-pressed', 'true')

    if (testInfo.project.use.isMobile) {
      const viewportWidth = page.viewportSize()!.width
      const layout = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth }))
      expect(layout.width, 'Use the device viewport instead of a scaled desktop layout').toBe(viewportWidth)
      expect(layout.scrollWidth, 'PC boxes and the editor should fit without horizontal scrolling').toBeLessThanOrEqual(viewportWidth)
    }

    await page.getByRole('button', { name: `Set HP IV to ${editedIv}`, exact: true }).click()
    await page.getByRole('heading', { name: nickname, exact: true }).hover()
    await expect(page.getByRole('button', { name: `Set HP IV to ${editedIv === 31 ? 0 : 31}`, exact: true })).toHaveText(String(editedIv))
    await page.getByRole('menuitem', { name: 'Edit', exact: true }).click()
    await page.getByRole('menuitem', { name: /^Undo/ }).click()
    await expect(page.getByRole('button', { name: `Set HP IV to ${editedIv}`, exact: true })).toHaveText(String(initialIv))
    await expect(selectedSlot).toHaveAttribute('aria-pressed', 'true')
    await page.getByRole('menuitem', { name: 'Edit', exact: true }).click()
    await page.getByRole('menuitem', { name: /^Redo/ }).click()
    await expect(page.getByRole('button', { name: `Set HP IV to ${editedIv === 31 ? 0 : 31}`, exact: true })).toHaveText(String(editedIv))

    const nature = original.target.nature === 'Adamant' ? 'Modest' : 'Adamant'
    await page.getByRole('combobox', { name: 'Edit nature', exact: true }).click()
    await page.getByRole('option', { name: new RegExp(`^${nature}`) }).click()
    await expect(page.getByRole('combobox', { name: 'Edit nature', exact: true })).toContainText(nature)
    await page.screenshot({ path: testInfo.outputPath(`${game}-pc-editor.png`), fullPage: true })

    await page.getByRole('menuitem', { name: 'File', exact: true }).click()
    const downloadPromise = page.waitForEvent('download')
    await page.getByRole('menuitem', { name: 'Download', exact: true }).click()
    const download = await downloadPromise
    expect(download.suggestedFilename()).toBe(`${game}.sav`)
    const downloadedPath = testInfo.outputPath(`${game}-edited.sav`)
    await download.saveAs(downloadedPath)
    const downloaded = new Uint8Array(readFileSync(downloadedPath))
    const restored = await inspectSave(page, downloaded)
    expect(restored.target.iv).toBe(editedIv)
    expect(restored.target.nature).toBe(nature)
    expect(restored.party).toEqual(original.party)

    await page.locator('input[type=file]').setInputFiles(downloadedPath)
    await page.getByRole('tab', { name: 'PC boxes', exact: true }).click()
    await page.getByRole('combobox', { name: 'PC box', exact: true }).selectOption('0')
    await selectedSlot.click()
    await expect(page.getByRole('combobox', { name: 'Edit nature', exact: true })).toContainText(nature)
    await expect(page.getByRole('button', { name: `Set HP IV to ${editedIv === 31 ? 0 : 31}`, exact: true })).toHaveText(String(editedIv))

    const lastBoxIndex = original.boxCount - 1
    await page.getByRole('combobox', { name: 'PC box', exact: true }).selectOption(String(lastBoxIndex))
    await expect(page.getByRole('button', { name: 'Next box', exact: true })).toBeDisabled()
    await expect(page.getByRole('button', { name: `Box ${lastBoxIndex + 1}, slot 30: ${original.lastSlotName}`, exact: true })).toBeVisible()
    expect(errors).toEqual([])
  })
}
