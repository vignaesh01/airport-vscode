import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { AGENTS } from './agents'
import { DUPLICATE_WITH_FAVORITE_PREFIX, orderAgentsForPicker, toggleFavorite } from './favorite-agent'

const ids = (entries: ReturnType<typeof orderAgentsForPicker>): string[] => entries.map((e) => e.agent.id)

describe('orderAgentsForPicker', () => {
  it('keeps the original order and marks nothing when there is no favourite', () => {
    const result = orderAgentsForPicker(AGENTS, undefined)
    expect(ids(result)).toEqual(AGENTS.map((a) => a.id))
    expect(result.some((e) => e.isFavorite)).toBe(false)
  })

  it('moves the favourite to the top and marks only it', () => {
    const result = orderAgentsForPicker(AGENTS, 'devin')
    expect(ids(result)).toEqual(['devin', 'claude', 'codex', 'antigravity', 'shell'])
    expect(result.filter((e) => e.isFavorite).map((e) => e.agent.id)).toEqual(['devin'])
  })

  it('ignores an unknown favourite id', () => {
    const result = orderAgentsForPicker(AGENTS, 'no-such-agent')
    expect(ids(result)).toEqual(AGENTS.map((a) => a.id))
    expect(result.some((e) => e.isFavorite)).toBe(false)
  })
})

describe('toggleFavorite', () => {
  it('sets a new favourite', () => {
    expect(toggleFavorite(undefined, 'codex')).toBe('codex')
    expect(toggleFavorite('claude', 'codex')).toBe('codex')
  })

  it('clears the favourite when its own star is clicked', () => {
    expect(toggleFavorite('codex', 'codex')).toBeUndefined()
  })
})

describe('package.json favourite-agent contributions', () => {
  const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf-8'))
  const agentIds = AGENTS.map((a) => a.id)

  it('lists every agent in the favoriteAgent setting enum', () => {
    expect(pkg.contributes.configuration.properties['airport.favoriteAgent'].enum).toEqual(['', ...agentIds])
  })

  it('contributes a duplicate-with-favourite command and menu item per agent', () => {
    const commands = pkg.contributes.commands.map((c: { command: string }) => c.command)
    const menu = pkg.contributes.menus['view/item/context'].map((m: { command: string }) => m.command)
    for (const id of agentIds) {
      expect(commands).toContain(`${DUPLICATE_WITH_FAVORITE_PREFIX}${id}`)
      expect(menu).toContain(`${DUPLICATE_WITH_FAVORITE_PREFIX}${id}`)
    }
  })
})
