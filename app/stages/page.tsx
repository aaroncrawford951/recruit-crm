'use client'

import { useEffect, useMemo, useState } from 'react'
import { supabaseBrowser } from '../../lib/supabase-browser'
import PageTitle from "@/app/components/PageTitle";


import {
  DndContext,
  closestCenter,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
  sortableKeyboardCoordinates,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

type Stage = {
  id: string
  name: string
  sort_order: number | null
  created_at: string
  is_default: boolean
  is_locked: boolean
}

function sortStagesPinned(rows: Stage[]) {
  const copy = [...rows]
  copy.sort((a, b) => {
    // Locked Intake always first
    if (a.is_locked && !b.is_locked) return -1
    if (!a.is_locked && b.is_locked) return 1

    // Then by sort_order then created_at
    const ao = a.sort_order ?? 999999
    const bo = b.sort_order ?? 999999
    if (ao !== bo) return ao - bo
    return new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  })
  return copy
}

function Row({
  stage,
  busy,
  onNameChange,
  onNameBlurSave,
  onDelete,
}: {
  stage: Stage
  busy: boolean
  onNameChange: (id: string, val: string) => void
  onNameBlurSave: (id: string, val: string) => void
  onDelete: (id: string) => void
}) {
  // Only non-locked stages are sortable (we render Intake separately)
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: stage.id,
  })

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    border: '1px solid #ddd',
    borderRadius: 12,
    padding: 12,
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
    background: 'white',
    opacity: isDragging ? 0.7 : 1,
  }

  return (
    <div ref={setNodeRef} style={style}>
      {/* Left side */}
      <div style={{ flex: 1, minWidth: 280 }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          {/* Drag handle */}
          <button
            type="button"
            {...attributes}
            {...listeners}
            disabled={busy}
            title="Drag to reorder"
            style={{
              cursor: busy ? 'not-allowed' : 'grab',
              border: '1px solid #e5e5e5',
              background: 'white',
              borderRadius: 10,
              padding: '8px 10px',
              lineHeight: 1,
            }}
          >
            ☰
          </button>

          <input
            value={stage.name}
            disabled={busy}
            onChange={(e) => onNameChange(stage.id, e.target.value)}
            onBlur={() => onNameBlurSave(stage.id, stage.name)}
            title="Click to rename (then click away)"
            style={{
              padding: 10,
              borderRadius: 10,
              border: '1px solid #e5e5e5',
              fontWeight: 700,
              width: 260,
              background: 'white',
            }}
          />
        </div>

        <div style={{ fontSize: 12, opacity: 0.75, marginTop: 6 }}>
          sort_order: {stage.sort_order ?? 0}
        </div>
      </div>

      {/* Right side */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <button
          onClick={() => onDelete(stage.id)}
          disabled={busy}
          style={{
            border: '1px solid #ef4444',
            background: 'white',
            color: '#ef4444',
            padding: '6px 10px',
            borderRadius: 10,
            cursor: busy ? 'not-allowed' : 'pointer',
          }}
        >
          Delete
        </button>
      </div>
    </div>
  )
}

export default function StagesPage() {
  const supabase = supabaseBrowser()

  const [stages, setStages] = useState<Stage[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const [newStageName, setNewStageName] = useState('')

  const stageNamesLower = useMemo(
    () => new Set(stages.map((s) => (s.name ?? '').trim().toLowerCase())),
    [stages]
  )

  const intakeStage = useMemo(() => {
    return stages.find((s) => s.is_locked) ?? null
  }, [stages])

  const draggableStages = useMemo(() => {
    // Everything except Intake
    return sortStagesPinned(stages).filter((s) => !s.is_locked)
  }, [stages])

  const draggableIds = useMemo(() => draggableStages.map((s) => s.id), [draggableStages])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  async function load() {
    setLoading(true)
    setErr(null)

    const { data, error } = await supabase
      .from('stages')
      .select('id, name, sort_order, created_at, is_default, is_locked')
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true })

    if (error) setErr(error.message)

    const rows = ((data as Stage[]) ?? []).map((s) => ({
      ...s,
      sort_order: s.sort_order ?? 0,
      is_default: !!s.is_default,
      is_locked: !!s.is_locked,
    })) as Stage[]

    setStages(sortStagesPinned(rows))
    setLoading(false)
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function addStage() {
    setErr(null)
    setBusy(true)

    const name = newStageName.trim()
    if (!name) {
      setErr('Stage name is required.')
      setBusy(false)
      return
    }
    if (stageNamesLower.has(name.toLowerCase())) {
      setErr('That stage already exists.')
      setBusy(false)
      return
    }

    const { data: authData } = await supabase.auth.getUser()
    const userId = authData?.user?.id

    if (!userId) {
      setErr('Not logged in.')
      setBusy(false)
      return
    }

    // Append at end in increments of 10
    const nonLocked = stages.filter((s) => !s.is_locked)
    const maxSort = Math.max(0, ...nonLocked.map((s) => s.sort_order ?? 0))

    const { error } = await supabase.from('stages').insert([
      {
        owner_user_id: userId,
        name,
        sort_order: maxSort + 10,
        is_default: false,
        is_locked: false,
      },
    ])

    if (error) {
      setErr(error.message)
      setBusy(false)
      return
    }

    setNewStageName('')
    await load()
    setBusy(false)
  }

  function onNameChange(id: string, val: string) {
    setStages((prev) => prev.map((s) => (s.id === id ? { ...s, name: val } : s)))
  }

  async function renameStage(id: string, name: string) {
    setErr(null)

    const trimmed = name.trim()
    if (!trimmed) {
      setErr('Stage name cannot be empty.')
      await load()
      return
    }

    // prevent duplicates
    const existing = stages.find(
      (s) => s.id !== id && s.name.trim().toLowerCase() === trimmed.toLowerCase()
    )
    if (existing) {
      setErr('Another stage already has that name.')
      await load()
      return
    }

    const { error } = await supabase.from('stages').update({ name: trimmed }).eq('id', id)
    if (error) {
      setErr(error.message)
      await load()
      return
    }
  }

  async function deleteStage(id: string) {
    setErr(null)
    setBusy(true)

    const stage = stages.find((s) => s.id === id)
    if (!stage) {
      setBusy(false)
      return
    }

    if (stage.is_locked) {
      setErr('Intake is permanent and cannot be deleted.')
      setBusy(false)
      return
    }

    const ok = confirm(`Delete stage "${stage.name}"?\n\nRecruits in this stage will be moved back to Intake.`)
    if (!ok) {
      setBusy(false)
      return
    }

    const intake = stages.find((s) => s.is_locked || s.is_default || s.name.trim().toLowerCase() === 'intake')
    if (!intake) {
      setErr('No Intake/default stage found. (Create Intake first in the database.)')
      setBusy(false)
      return
    }

    // Move recruits back to Intake first
    const { error: moveErr } = await supabase
      .from('recruits')
      .update({ stage_id: intake.id })
      .eq('stage_id', id)

    if (moveErr) {
      setErr(moveErr.message)
      setBusy(false)
      return
    }

    const { error } = await supabase.from('stages').delete().eq('id', id)

    if (error) {
      setErr(error.message)
      setBusy(false)
      return
    }

    await load()
    setBusy(false)
  }

  async function persistOrder(nonLockedInOrder: Stage[]) {
    // We’ll reassign sort_order in increments of 10, starting at 10 (Intake stays at 0)
    // This makes ordering stable and avoids weird duplicates.
    const updates = nonLockedInOrder.map((s, idx) => ({
      id: s.id,
      sort_order: (idx + 1) * 10,
    }))

    // Update sequentially (small list; super reliable)
    for (const u of updates) {
      const { error } = await supabase.from('stages').update({ sort_order: u.sort_order }).eq('id', u.id)
      if (error) throw error
    }
  }

  async function onDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over) return
    if (active.id === over.id) return

    // local reorder
    const oldIndex = draggableStages.findIndex((s) => s.id === active.id)
    const newIndex = draggableStages.findIndex((s) => s.id === over.id)
    if (oldIndex === -1 || newIndex === -1) return

    const reordered = arrayMove(draggableStages, oldIndex, newIndex)

    // Optimistic UI update: merge Intake + reordered
    setStages((prev) => {
      const intake = prev.find((s) => s.is_locked) ?? null
      const others = prev.filter((s) => !s.is_locked)
      const othersById = new Map(others.map((s) => [s.id, s]))

      const rebuiltOthers = reordered.map((r) => othersById.get(r.id)!).filter(Boolean)
      const merged = intake ? [intake, ...rebuiltOthers] : rebuiltOthers
      return sortStagesPinned(merged)
    })

    // persist
    setBusy(true)
    setErr(null)
    try {
      await persistOrder(reordered)
      await load()
    } catch (e: any) {
      setErr(e?.message ?? 'Failed to save order.')
      await load()
    } finally {
      setBusy(false)
    }
  }

  return (
    <main style={{ padding: 40, maxWidth: 900 }}>
<PageTitle>Stages</PageTitle>

      <p style={{ marginTop: 8, opacity: 0.8 }}>
        Drag stages to reorder your pipeline. <b>Intake</b> is permanent, pinned at the top.
      </p>

      <div style={{ display: 'flex', gap: 12, marginTop: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <button onClick={load} disabled={busy}>
          Refresh
        </button>
      </div>

      {/* Add stage */}
      <div style={{ marginTop: 16, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <input
          value={newStageName}
          onChange={(e) => setNewStageName(e.target.value)}
          placeholder="New stage name…"
          style={{
            padding: 10,
            borderRadius: 10,
            border: '1px solid #e5e5e5',
            minWidth: 260,
          }}
          disabled={busy}
        />
        <button onClick={addStage} disabled={busy || !newStageName.trim()}>
          Add stage
        </button>
      </div>

      {err && <p style={{ color: 'crimson', marginTop: 12 }}>{err}</p>}

      <hr style={{ margin: '24px 0' }} />

      {loading ? (
        <p>Loading…</p>
      ) : stages.length === 0 ? (
        <p>No stages yet.</p>
      ) : (
        <div style={{ display: 'grid', gap: 10 }}>
          {/* Intake pinned */}
          {intakeStage && (
            <div
              style={{
                border: '1px solid #ddd',
                borderRadius: 12,
                padding: 12,
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: 12,
                background: '#f9fafb',
              }}
            >
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                  <div
                    style={{
                      border: '1px solid #e5e5e5',
                      borderRadius: 10,
                      padding: '8px 10px',
                      opacity: 0.6,
                    }}
                    title="Intake is pinned"
                  >
                    ☰
                  </div>

                  <input
                    value={intakeStage.name}
                    disabled
                    title="Intake is permanent and cannot be renamed"
                    style={{
                      padding: 10,
                      borderRadius: 10,
                      border: '1px solid #e5e5e5',
                      fontWeight: 800,
                      width: 260,
                      background: '#f3f4f6',
                    }}
                  />

                  <span
                    style={{
                      fontSize: 12,
                      padding: '4px 8px',
                      borderRadius: 999,
                      border: '1px solid #e5e5e5',
                      opacity: 0.85,
                    }}
                  >
                    Default • Locked
                  </span>
                </div>

                <div style={{ fontSize: 12, opacity: 0.75, marginTop: 6 }}>
                  sort_order: {intakeStage.sort_order ?? 0}
                </div>
              </div>

              <button
                disabled
                title="Intake is permanent and cannot be deleted"
                style={{
                  border: '1px solid #ef4444',
                  background: '#f3f4f6',
                  color: '#ef4444',
                  padding: '6px 10px',
                  borderRadius: 10,
                  opacity: 0.6,
                  cursor: 'not-allowed',
                }}
              >
                Delete
              </button>
            </div>
          )}

          {/* Draggable list */}
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={draggableIds} strategy={verticalListSortingStrategy}>
              <div style={{ display: 'grid', gap: 10 }}>
                {draggableStages.map((s) => (
                  <Row
                    key={s.id}
                    stage={s}
                    busy={busy}
                    onNameChange={onNameChange}
                    onNameBlurSave={renameStage}
                    onDelete={deleteStage}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        </div>
      )}
    </main>
  )
}
