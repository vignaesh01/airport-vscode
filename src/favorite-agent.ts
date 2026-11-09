import type { AgentDefinition } from './agents'

export const FAVORITE_AGENT_SETTING = 'favoriteAgent'
/** Context key holding the favourite agent's id ('' when none), used by menu `when` clauses. */
export const FAVORITE_AGENT_CONTEXT = 'airport.favoriteAgent'
export const DUPLICATE_WITH_FAVORITE_PREFIX = 'airport.duplicateWithFavorite.'

export interface AgentPickEntry {
  agent: AgentDefinition
  isFavorite: boolean
}

/**
 * Orders agents for the picker: the favourite (if it names a known agent)
 * comes first, the rest keep their original order.
 */
export function orderAgentsForPicker(agents: readonly AgentDefinition[], favoriteId: string | undefined): AgentPickEntry[] {
  const favorite = agents.find((a) => a.id === favoriteId)
  const ordered = favorite ? [favorite, ...agents.filter((a) => a !== favorite)] : [...agents]
  return ordered.map((agent) => ({ agent, isFavorite: agent === favorite }))
}

/** Clicking the star on the current favourite clears it; on any other agent, makes it the favourite. */
export function toggleFavorite(currentId: string | undefined, clickedId: string): string | undefined {
  return currentId === clickedId ? undefined : clickedId
}
