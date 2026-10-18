import type {
  Attachment,
  CatalogItem,
  Customer,
  Expense,
  InvoiceDocument,
  Project,
  RecurringInvoice,
  Reminder,
  RunningTimer,
  Settings,
  TimeEntry,
} from './types'

/**
 * A small document store with the query surface the domain code needs.
 * The same code runs on the server (SQLite), in the browser (HTTP API)
 * and in tests (memory); only the backend differs.
 */
export interface Backend<T> {
  all(): Promise<T[]>
  get(id: string): Promise<T | undefined>
  put(record: T): Promise<void>
  remove(id: string): Promise<void>
}

type Key = string | number
type Row = Record<string, unknown>

function field(record: unknown, index: string): unknown {
  if (index.startsWith('[')) {
    return index
      .slice(1, -1)
      .split('+')
      .map((f) => (record as Row)[f])
  }
  return (record as Row)[index]
}

function same(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => x === b[i])
  return a === b
}

export type Changes<T> = Partial<T> | ((record: T) => void | boolean)

function apply<T>(record: T, changes: Changes<T>): T {
  const copy = structuredClone(record)
  if (typeof changes === 'function') {
    changes(copy)
    return copy
  }
  return Object.assign(copy as object, changes) as T
}

export class Collection<T extends { id: string }> {
  private table: Table<T>
  private load: () => Promise<T[]>

  constructor(table: Table<T>, load: () => Promise<T[]>) {
    this.table = table
    this.load = load
  }

  filter(fn: (record: T) => boolean): Collection<T> {
    return new Collection(this.table, async () => (await this.load()).filter(fn))
  }

  toArray(): Promise<T[]> {
    return this.load()
  }

  async count(): Promise<number> {
    return (await this.load()).length
  }

  async first(): Promise<T | undefined> {
    return (await this.load())[0]
  }

  async primaryKeys(): Promise<string[]> {
    return (await this.load()).map((r) => r.id)
  }

  async modify(changes: Changes<T>): Promise<number> {
    const list = await this.load()
    for (const r of list) await this.table.put(apply(r, changes))
    return list.length
  }

  async delete(): Promise<number> {
    const list = await this.load()
    for (const r of list) await this.table.delete(r.id)
    return list.length
  }
}

export class WhereClause<T extends { id: string }> {
  private table: Table<T>
  private index: string

  constructor(table: Table<T>, index: string) {
    this.table = table
    this.index = index
  }

  private select(pred: (value: unknown) => boolean) {
    return new Collection(this.table, async () => (await this.table.toArray()).filter((r) => pred(field(r, this.index))))
  }

  equals(value: unknown): Collection<T> {
    return this.select((v) => same(v, value))
  }

  anyOf(values: unknown[]): Collection<T> {
    return this.select((v) => values.some((x) => same(v, x)))
  }

  /** Lower bound inclusive, upper bound exclusive, like IndexedDB ranges. */
  between(lower: Key, upper: Key): Collection<T> {
    return this.select((v) => typeof v === typeof lower && (v as Key) >= lower && (v as Key) < upper)
  }
}

export class Table<T extends { id: string }> {
  readonly name: string
  private backend: Backend<T>

  constructor(name: string, backend: Backend<T>) {
    this.name = name
    this.backend = backend
  }

  get(id: string): Promise<T | undefined> {
    return this.backend.get(id)
  }

  async bulkGet(ids: string[]): Promise<(T | undefined)[]> {
    return Promise.all(ids.map((id) => this.backend.get(id)))
  }

  toArray(): Promise<T[]> {
    return this.backend.all()
  }

  async count(): Promise<number> {
    return (await this.backend.all()).length
  }

  async put(record: T): Promise<string> {
    await this.backend.put(record)
    return record.id
  }

  async bulkPut(records: T[]): Promise<void> {
    for (const r of records) await this.backend.put(r)
  }

  async update(id: string, changes: Changes<T>): Promise<number> {
    const current = await this.backend.get(id)
    if (!current) return 0
    await this.backend.put(apply(current, changes))
    return 1
  }

  async bulkUpdate(list: { key: string; changes: Partial<T> }[]): Promise<void> {
    for (const { key, changes } of list) await this.update(key, changes)
  }

  delete(id: string): Promise<void> {
    return this.backend.remove(id)
  }

  async bulkDelete(ids: string[]): Promise<void> {
    for (const id of ids) await this.backend.remove(id)
  }

  async clear(): Promise<void> {
    for (const r of await this.backend.all()) await this.backend.remove(r.id)
  }

  where(index: string): WhereClause<T> {
    return new WhereClause(this, index)
  }

  filter(fn: (record: T) => boolean): Collection<T> {
    return this.toCollection().filter(fn)
  }

  toCollection(): Collection<T> {
    return new Collection(this, () => this.backend.all())
  }
}

export const COLLECTIONS = ['settings', 'customers', 'documents', 'timeEntries', 'timer', 'reminders', 'catalog', 'recurring', 'expenses', 'attachments', 'projects'] as const
export type CollectionName = (typeof COLLECTIONS)[number]

export interface Records {
  settings: Settings
  customers: Customer
  documents: InvoiceDocument
  timeEntries: TimeEntry
  timer: RunningTimer
  reminders: Reminder
  catalog: CatalogItem
  recurring: RecurringInvoice
  expenses: Expense
  attachments: Attachment
  projects: Project
}

export type BackendFactory = <K extends CollectionName>(name: K) => Backend<Records[K]>

type TxFn<R> = () => Promise<R>

export class Database {
  settings: Table<Settings>
  customers: Table<Customer>
  documents: Table<InvoiceDocument>
  timeEntries: Table<TimeEntry>
  timer: Table<RunningTimer>
  reminders: Table<Reminder>
  catalog: Table<CatalogItem>
  recurring: Table<RecurringInvoice>
  expenses: Table<Expense>
  attachments: Table<Attachment>
  projects: Table<Project>
  private runTx: <R>(fn: TxFn<R>) => Promise<R>

  constructor(factory: BackendFactory, runTx: <R>(fn: TxFn<R>) => Promise<R> = (fn) => fn()) {
    this.settings = new Table('settings', factory('settings'))
    this.customers = new Table('customers', factory('customers'))
    this.documents = new Table('documents', factory('documents'))
    this.timeEntries = new Table('timeEntries', factory('timeEntries'))
    this.timer = new Table('timer', factory('timer'))
    this.reminders = new Table('reminders', factory('reminders'))
    this.catalog = new Table('catalog', factory('catalog'))
    this.recurring = new Table('recurring', factory('recurring'))
    this.expenses = new Table('expenses', factory('expenses'))
    this.attachments = new Table('attachments', factory('attachments'))
    this.projects = new Table('projects', factory('projects'))
    this.runTx = runTx
  }

  table<K extends CollectionName>(name: K): Table<Records[K]> {
    return this[name] as unknown as Table<Records[K]>
  }

  /** Same call shapes as before: transaction('rw', tableA, tableB, fn) or transaction('rw', [tables], fn). */
  transaction<R>(_mode: 'r' | 'rw', ...args: [...unknown[], TxFn<R>]): Promise<R> {
    const fn = args[args.length - 1] as TxFn<R>
    return this.runTx(fn)
  }
}

/** In-memory backend, used by tests and as the default before a real store is attached. */
export function memoryDatabase(): Database & { reset(): void } {
  const data = new Map<string, Map<string, unknown>>()
  const map = (name: string) => {
    let m = data.get(name)
    if (!m) data.set(name, (m = new Map()))
    return m
  }
  const factory: BackendFactory = (name) => ({
    all: async () => [...map(name).values()].map((v) => structuredClone(v)) as never,
    get: async (id) => (map(name).has(id) ? structuredClone(map(name).get(id)) : undefined) as never,
    put: async (record) => void map(name).set(record.id, structuredClone(record)),
    remove: async (id) => void map(name).delete(id),
  })
  const database = new Database(factory) as Database & { reset(): void }
  database.reset = () => data.clear()
  return database
}
