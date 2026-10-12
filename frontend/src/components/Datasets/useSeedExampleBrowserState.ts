import { useEffect, useMemo, useState } from 'react'
import { useLocation, useSearchParams } from 'react-router'

import { useRuntime } from '@/hooks/useRuntime'

import {
  isKnownRuntimeGeneration,
  runtimeGenerationChanged,
  seedBrowserQueryFromSearchParams,
  seedBrowserSearchParams,
  seedCursorIsStale,
  seedCursorsFromNavigationState,
  seedNavigationState,
  seedQueryWithoutPaging,
  type SeedBrowserQuery,
} from './seedExampleQuery'

function pagingDirty(query: SeedBrowserQuery, cursors: readonly (string | null)[]): boolean {
  return query.cursor != null
    || query.exampleId != null
    || query.cursorRepeated
    || query.exampleRepeated
    || cursors.length > 0
}

export interface SeedExampleBrowserState {
  readonly query: SeedBrowserQuery
  readonly visitedCursors: readonly (string | null)[]
  readonly generation: string
  readonly commit: (
    next: SeedBrowserQuery,
    cursors: readonly (string | null)[],
    replace: boolean,
  ) => void
}

/**
 * Owns the example table URL: filters, page cursor, and open example.
 * Paging resets only when one known runtime generation is replaced by another.
 */
export function useSeedExampleBrowserState(selectionKey: string): SeedExampleBrowserState {
  const runtime = useRuntime()
  const { generation, ready } = runtime
  const location = useLocation()
  const [searchParams, setSearchParams] = useSearchParams()
  const searchKey = searchParams.toString()
  const rawQuery = useMemo(
    () => seedBrowserQueryFromSearchParams(new URLSearchParams(searchKey)),
    [searchKey],
  )
  const recordedCursors = seedCursorsFromNavigationState(location.state)
  const cursorStale = seedCursorIsStale(location.state, generation, ready)
  const runtimeKnown = isKnownRuntimeGeneration(runtime)
  const [boundGeneration, setBoundGeneration] = useState<string | null>(runtimeKnown ? generation : null)
  const [suppressPaging, setSuppressPaging] = useState(false)
  const knownChanged = runtimeGenerationChanged(
    { generation: boundGeneration ?? '', ready: boundGeneration != null },
    runtime,
  )
  const dirty = pagingDirty(rawQuery, recordedCursors)
  const dropPaging = cursorStale || ((suppressPaging || knownChanged) && dirty)
  if (runtimeKnown && boundGeneration !== generation) {
    setBoundGeneration(generation)
    if (knownChanged) setSuppressPaging(true)
  } else if (suppressPaging && !dirty && !cursorStale) {
    setSuppressPaging(false)
  }
  const parsedQuery = dropPaging ? seedQueryWithoutPaging(rawQuery) : rawQuery
  const queryIdentity = `${dropPaging ? 'drop' : 'keep'}:${searchKey}`
  const [seenQueryIdentity, setSeenQueryIdentity] = useState(queryIdentity)
  const [stableQuery, setStableQuery] = useState(parsedQuery)
  if (seenQueryIdentity !== queryIdentity) {
    setSeenQueryIdentity(queryIdentity)
    setStableQuery(parsedQuery)
  }
  const query = seenQueryIdentity === queryIdentity ? stableQuery : parsedQuery
  const visitedCursors = dropPaging ? [] : recordedCursors
  const stateGeneration = runtimeKnown ? generation : (boundGeneration ?? '')

  const commit = (
    next: SeedBrowserQuery,
    cursors: readonly (string | null)[],
    replace: boolean,
  ): void => {
    setSearchParams(seedBrowserSearchParams(selectionKey, next), {
      replace,
      state: seedNavigationState(location.state, cursors, stateGeneration),
    })
  }

  useEffect(() => {
    if (!dropPaging) return
    const nextParams = seedBrowserSearchParams(selectionKey, seedQueryWithoutPaging(rawQuery)).toString()
    const cursorsRemain = seedCursorsFromNavigationState(location.state).length > 0
    const stillStale = seedCursorIsStale(location.state, generation, ready)
    if (searchParams.toString() === nextParams && !cursorsRemain && !stillStale) return
    setSearchParams(seedBrowserSearchParams(selectionKey, seedQueryWithoutPaging(rawQuery)), {
      replace: true,
      state: seedNavigationState(location.state, [], stateGeneration),
    })
  }, [
    dropPaging,
    generation,
    location.state,
    rawQuery,
    ready,
    searchParams,
    selectionKey,
    setSearchParams,
    stateGeneration,
  ])

  return { query, visitedCursors, generation, commit }
}
