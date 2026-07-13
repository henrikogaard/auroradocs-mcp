import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildWeekPlan,
  normalizeCanvasContent,
} from './planningTools.js'

test('buildWeekPlan returns scheduled days, unscheduled queue, and time-block metadata', () => {
  const plan = buildWeekPlan([
    task({ id: 'scheduled', title: 'Scheduled', due_date: '2026-07-07T09:00' }),
    task({ id: 'block', title: 'Focus', due_date: '2026-07-07T13:30', labels: ['time-block', 'duration:60m'] }),
    task({ id: 'unscheduled', title: 'Unscheduled', due_date: null }),
    task({ id: 'done', title: 'Done', status: 'Done', due_date: '2026-07-07T08:00' }),
  ], {
    anchorDate: '2026-07-07',
    includeUnscheduled: true,
    unscheduledLimit: 12,
  })

  assert.deepEqual(plan.range, { start: '2026-07-06', end: '2026-07-12' })
  assert.deepEqual(plan.days.map((day) => day.date), [
    '2026-07-06',
    '2026-07-07',
    '2026-07-08',
    '2026-07-09',
    '2026-07-10',
    '2026-07-11',
    '2026-07-12',
  ])
  assert.deepEqual(plan.days[1].tasks.map((entry) => entry.id), ['scheduled', 'block'])
  assert.deepEqual(plan.days[1].tasks[1].timeBlock, { isTimeBlock: true, durationMinutes: 60 })
  assert.deepEqual(plan.unscheduled.map((entry) => entry.id), ['unscheduled'])
})

test('normalizeCanvasContent returns cards, edges, and frames with stored metadata intact', () => {
  const result = normalizeCanvasContent(
    { id: 'canvas-1', title: 'Launch map', type: 'canvas' },
    {
      cards: [
        { id: 'a', type: 'text', x: 10, y: 20, w: 200, h: 100, text: 'Plan', color: 'yellow' },
        { id: 'b', type: 'object', x: 240, y: 20, w: 200, h: 100, objectId: 'obj-1', objectTitle: 'Source' },
      ],
      edges: [
        {
          id: 'e1',
          fromCard: 'a',
          toCard: 'b',
          fromSide: 'right',
          toSide: 'left',
          label: 'supports',
          color: 'green',
          style: 'dashed',
          arrow: 'triangle',
          arrowMode: 'end',
          strokeWidth: 3,
        },
      ],
      frames: [{ id: 'f1', name: 'Frame', x: 12, y: 16, w: 640, h: 320, color: '7' }],
    },
  )

  assert.equal(result.type, 'canvas')
  assert.equal(result.canvas.id, 'canvas-1')
  assert.deepEqual(result.cards.map((card) => card.id), ['a', 'b'])
  assert.equal(result.cards[0].text, 'Plan')
  assert.equal(result.cards[1].objectId, 'obj-1')
  assert.deepEqual(result.edges.map((edge) => edge.id), ['e1'])
  assert.deepEqual(result.edges[0], {
    id: 'e1',
    fromCard: 'a',
    toCard: 'b',
    fromSide: 'right',
    toSide: 'left',
    label: 'supports',
    color: 'green',
    style: 'dashed',
    arrow: 'triangle',
    arrowMode: 'end',
    strokeWidth: 3,
  })
  assert.deepEqual(result.frames, [{ id: 'f1', name: 'Frame', x: 12, y: 16, w: 640, h: 320, color: '7' }])
  assert.deepEqual(result.warnings, [])
})

test('normalizeCanvasContent can omit card text', () => {
  const result = normalizeCanvasContent(
    { id: 'canvas-1', title: 'Launch map', type: 'canvas' },
    { cards: [{ id: 'a', type: 'text', x: 0, y: 0, w: 100, h: 80, text: 'Hidden' }], edges: [] },
    { includeText: false },
  )

  assert.equal(result.cards[0].text, null)
})

test('normalizeCanvasContent reports invalid canvas content', () => {
  const result = normalizeCanvasContent(
    { id: 'canvas-1', title: 'Launch map', type: 'canvas' },
    { type: 'doc', content: [] },
  )

  assert.equal(result.cards.length, 0)
  assert.match(result.warnings.join('\n'), /cards/)
})

function task(overrides: {
  id: string
  title: string
  status?: string
  due_date?: string | null
  labels?: string[]
}) {
  return {
    id: overrides.id,
    title: overrides.title,
    status: overrides.status ?? 'Todo',
    due_date: overrides.due_date ?? null,
    updated_at: '2026-07-01T12:00:00Z',
    labels: overrides.labels ?? [],
  }
}
