import { useLiveQuery } from 'dexie-react-hooks'
import { AlertTriangle, Archive, ArchiveRestore, FolderKanban, Pencil, Plus } from 'lucide-react'
import { useState } from 'react'
import { db, now } from '../lib/db'
import { customerName } from '../lib/defaults'
import { formatDuration } from '../lib/dates'
import { useSettings } from '../lib/hooks'
import { formatMoney, formatNumber } from '../lib/money'
import { emptyProject, projectUsage, saveProject, type ProjectUsage } from '../lib/projects'
import type { Customer, Project } from '../lib/types'
import { useFeedback } from './feedback'
import { Button, Dialog, EmptyState, Field, IconButton, MoneyInput, NumberInput, TextField } from './ui'

const STATE_COLOR = { none: 'var(--accent)', ok: 'var(--accent)', warning: 'var(--orange)', over: 'var(--red)' }

export function BudgetBar({ usage, project }: { usage: ProjectUsage; project: Project }) {
  if (usage.state === 'none') return null
  const parts = [
    project.budgetMinutes ? `${formatDuration(usage.minutes)} von ${formatNumber(project.budgetMinutes / 60, 1)} h` : '',
    project.budgetCents ? `${formatMoney(usage.cents)} von ${formatMoney(project.budgetCents)}` : '',
  ].filter(Boolean)
  return (
    <div className="stack-sm" style={{ gap: 4 }}>
      <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(usage.ratio * 100)} aria-label={`Budget ${project.name}`}>
        <span style={{ width: `${Math.min(100, usage.ratio * 100)}%`, background: STATE_COLOR[usage.state] }} />
      </div>
      <span className="sub" style={{ color: usage.state === 'over' ? 'var(--red)' : usage.state === 'warning' ? 'var(--orange)' : undefined }}>
        {parts.join(' · ')} · {Math.round(usage.ratio * 100)} %{usage.state === 'over' ? ' – Budget überschritten' : usage.state === 'warning' ? ' – bald ausgeschöpft' : ''}
      </span>
    </div>
  )
}

export function ProjectsPanel({ customers, showCustomer }: { customers: Customer[]; showCustomer?: boolean }) {
  const settings = useSettings()
  const { run } = useFeedback()
  const ids = customers.map((c) => c.id).join(',')
  const data = useLiveQuery(async () => {
    const list = customers.map((c) => c.id)
    const [projects, entries] = await Promise.all([db.projects.where('customerId').anyOf(list).toArray(), db.timeEntries.where('customerId').anyOf(list).toArray()])
    return { projects, entries }
  }, [ids])
  const [editing, setEditing] = useState<Project | null>(null)
  const [showArchived, setShowArchived] = useState(false)
  if (!data || !settings) return null
  const byId = new Map(customers.map((c) => [c.id, c]))
  const rows = data.projects
    .filter((p) => showArchived || !p.archived)
    .map((p) => ({ p, usage: projectUsage(p, data.entries, byId.get(p.customerId), settings) }))
    .sort((a, b) => Number(a.p.archived) - Number(b.p.archived) || b.usage.ratio - a.usage.ratio || a.p.name.localeCompare(b.p.name, 'de'))

  return (
    <>
      {rows.length === 0 ? (
        <EmptyState icon={FolderKanban} title="Noch keine Projekte" compact action={customers.length === 1 ? <Button icon={Plus} onClick={() => setEditing(emptyProject(customers[0].id))}>Projekt anlegen</Button> : undefined}>
          Projekte entstehen automatisch, sobald du bei einer Zeit ein Projekt einträgst. Hinterlege ein Stunden- oder Euro-Budget, um den Verbrauch zu sehen.
        </EmptyState>
      ) : (
        <ul className="list">
          {rows.map(({ p, usage }) => {
            const c = byId.get(p.customerId)
            return (
              <li key={p.id} className="list-item" style={{ alignItems: 'flex-start' }}>
                {usage.state === 'over' || usage.state === 'warning' ? (
                  <AlertTriangle size={18} color={STATE_COLOR[usage.state]} aria-hidden style={{ marginTop: 2 }} />
                ) : (
                  <FolderKanban size={18} className="faint" aria-hidden style={{ marginTop: 2 }} />
                )}
                <div className="grow stack-sm" style={{ gap: 6 }}>
                  <div>
                    <div className="title">
                      {p.name}
                      {p.archived && <span className="badge" style={{ marginLeft: 8 }}>Archiviert</span>}
                    </div>
                    <div className="sub">
                      {[showCustomer && c ? customerName(c) : '', `${formatDuration(usage.minutes)} erfasst`, usage.cents ? `${formatMoney(usage.cents)} Wert` : '', usage.state === 'none' ? 'kein Budget' : ''].filter(Boolean).join(' · ')}
                    </div>
                  </div>
                  <BudgetBar usage={usage} project={p} />
                </div>
                <IconButton icon={Pencil} label="Bearbeiten" onClick={() => setEditing(p)} />
                <IconButton
                  icon={p.archived ? ArchiveRestore : Archive}
                  label={p.archived ? 'Wiederherstellen' : 'Archivieren'}
                  onClick={() => run(() => db.projects.update(p.id, { archived: !p.archived, updatedAt: now() }), p.archived ? 'Projekt aktiv' : 'Projekt archiviert')}
                />
              </li>
            )
          })}
        </ul>
      )}
      {((customers.length === 1 && rows.length > 0) || data.projects.some((p) => p.archived)) && <div className="card-body row wrap">
        {customers.length === 1 && rows.length > 0 && (
          <Button size="sm" icon={Plus} onClick={() => setEditing(emptyProject(customers[0].id))}>
            Projekt anlegen
          </Button>
        )}
        {data.projects.some((p) => p.archived) && (
          <Button size="sm" variant="ghost" onClick={() => setShowArchived(!showArchived)}>
            {showArchived ? 'Archivierte ausblenden' : 'Archivierte zeigen'}
          </Button>
        )}
      </div>}
      <ProjectDialog project={editing} onClose={() => setEditing(null)} />
    </>
  )
}

export function ProjectDialog({ project, onClose }: { project: Project | null; onClose: () => void }) {
  const { run } = useFeedback()
  const [draft, setDraft] = useState<Project | null>(project)
  const [lastId, setLastId] = useState(project?.id)
  if (project?.id !== lastId) {
    setLastId(project?.id)
    setDraft(project)
  }
  if (!draft) return null
  const save = async () => {
    const saved = await run(() => saveProject(draft), 'Projekt gespeichert')
    if (saved) onClose()
  }
  return (
    <Dialog
      open={!!project}
      onClose={onClose}
      title={project?.name ? 'Projekt bearbeiten' : 'Neues Projekt'}
      description="Ab 80 % des Budgets warnt Kontor in der Zeiterfassung und in der Übersicht."
      footer={
        <>
          <Button onClick={onClose}>Abbrechen</Button>
          <Button variant="primary" onClick={save}>
            Speichern
          </Button>
        </>
      }
    >
      <form
        className="form-grid"
        onSubmit={(e) => {
          e.preventDefault()
          void save()
        }}
      >
        <TextField className="span-6" label="Name" value={draft.name} onChange={(name) => setDraft({ ...draft, name })} autoFocus hint="Eine Umbenennung gilt auch für alle bisherigen Zeiten." />
        <Field className="span-3" label="Stundenbudget" hint="leer = ohne">
          <NumberInput value={draft.budgetMinutes ? draft.budgetMinutes / 60 : 0} onChange={(h) => setDraft({ ...draft, budgetMinutes: h > 0 ? Math.round(h * 60) : null })} suffix="h" maxFraction={2} aria-label="Stundenbudget" />
        </Field>
        <Field className="span-3" label="Budget netto" hint="leer = ohne">
          <MoneyInput value={draft.budgetCents} onChange={(budgetCents) => setDraft({ ...draft, budgetCents: budgetCents && budgetCents > 0 ? budgetCents : null })} allowEmpty aria-label="Budget netto" />
        </Field>
        <button type="submit" hidden />
      </form>
    </Dialog>
  )
}

/** Projects of all customers that are at or above the warning threshold. */
export function useBudgetWarnings() {
  const settings = useSettings()
  return useLiveQuery(async () => {
    if (!settings) return []
    const [projects, entries, customers] = await Promise.all([db.projects.filter((p) => !p.archived && (!!p.budgetMinutes || !!p.budgetCents)).toArray(), db.timeEntries.toArray(), db.customers.toArray()])
    const byId = new Map(customers.map((c) => [c.id, c]))
    return projects
      .map((p) => ({ project: p, customer: byId.get(p.customerId), usage: projectUsage(p, entries, byId.get(p.customerId), settings) }))
      .filter((x) => x.usage.state === 'warning' || x.usage.state === 'over')
      .sort((a, b) => b.usage.ratio - a.usage.ratio)
  }, [settings?.timeRounding.minutes, settings?.timeRounding.mode, settings?.defaults.hourlyRateCents])
}
