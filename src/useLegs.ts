import { useMemo } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type Route, type Stop } from './db'
import { tripLegs, type LegInfo } from './legs'

/** I tratti di un viaggio con i percorsi salvati; si aggiorna da solo quando arrivano. */
export function useLegs(tripId: string | undefined, stops: Stop[] | undefined): LegInfo[] {
  const routes = useLiveQuery(async () => (tripId ? await db.routes.where('tripId').equals(tripId).toArray() : []), [tripId])
  return useMemo(() => {
    const map = new Map<string, Route>((routes ?? []).map((r) => [r.id, r]))
    return tripLegs(stops ?? [], map)
  }, [routes, stops])
}
