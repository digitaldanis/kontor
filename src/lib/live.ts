import { useEffect, useState } from 'react'
import { subscribeChanges } from './remote'

/**
 * Runs an async query and runs it again whenever data changes, locally or
 * on another device. Same contract as before: undefined while loading.
 */
export function useLiveQuery<T>(query: () => Promise<T> | T, deps: unknown[] = [], initial?: T): T | undefined {
  const [value, setValue] = useState<T | undefined>(initial)
  const [version, setVersion] = useState(0)

  useEffect(() => subscribeChanges(() => setVersion((v) => v + 1)), [])

  useEffect(() => {
    let alive = true
    Promise.resolve()
      .then(query)
      .then(
        (v) => alive && setValue(v),
        () => undefined,
      )
    return () => {
      alive = false
    }
    // the query closes over deps; re-run on them and on every change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, version])

  return value
}
