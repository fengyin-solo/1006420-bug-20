import { MODULE_BY_KEY } from '@/data/modules'
import { allRows, listRows, resetRows, saveRows } from '@/data/local-store'
import type { ActionResult, BoardColumn, EntryRow, ModuleMeta, OverviewResult, PageResult } from '@/data/types'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

export function moduleMeta(key: string): ModuleMeta {
  const meta = MODULE_BY_KEY.get(key)
  if (!meta) {
    throw new Error(`没有登记名为 ${key} 的业务模块`)
  }
  return meta
}

export function filterRows(rows: EntryRow[], filters: Record<string, string>): EntryRow[] {
  const pairs = Object.entries(filters).filter(([, value]) => value.trim() !== '')
  if (pairs.length === 0) {
    return rows
  }
  return rows.filter((row) =>
    pairs.every(([field, value]) => String(row[field] ?? '').includes(value.trim())),
  )
}

export function listEntries(key: string, filters: Record<string, string> = {}): PageResult {
  const matched = filterRows(listRows(key), filters)
  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

// 模块的终态：登记了线性流转链的取链尾，否则取状态列表最后一位。
function terminalStatus(meta: ModuleMeta): string {
  const chain = meta.flow ?? meta.statuses
  return chain[chain.length - 1]
}

export function runAction(key: string, id: number, action: string): ActionResult {
  const meta = moduleMeta(key)
  const target = meta.actionTargets[action]
  if (!target) {
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }
  const rows = listRows(key)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  const current = String(rows[index].status)
  if (current === target) {
    return { ok: false, message: `${meta.entity}已经是「${target}」，不用重复操作` }
  }
  if (meta.flow) {
    const targetIndex = meta.flow.indexOf(target)
    const predecessor = targetIndex > 0 ? meta.flow[targetIndex - 1] : undefined
    if (!predecessor || current !== predecessor) {
      return {
        ok: false,
        message: `${meta.entity}状态只能顺着走（${meta.flow.join(' → ')}），不能从「${current}」直接「${action}」`,
      }
    }
  }
  const updated: EntryRow = {
    ...rows[index],
    status: target,
    pending: target !== terminalStatus(meta),
    abnormal: NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb)),
  }
  const next = [...rows]
  next[index] = updated
  saveRows(key, next)
  return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」` }
}

export function createEntry(key: string, fields: Record<string, string>): ActionResult {
  const meta = moduleMeta(key)
  const codeField = meta.fields[0]
  const code = (fields[codeField] ?? '').trim()
  if (!code) {
    return { ok: false, message: `${codeField}不能为空` }
  }
  const rows = listRows(key)
  if (rows.some((row) => String(row[codeField] ?? '').trim() === code)) {
    return { ok: false, message: `${codeField}「${code}」已经登记过了，同一个${codeField}不许登记两遍` }
  }
  const initial = meta.flow ? meta.flow[0] : meta.statuses[0]
  const row: EntryRow = {
    id: rows.reduce((max, item) => Math.max(max, Number(item.id) || 0), 0) + 1,
    status: initial,
    pending: initial !== terminalStatus(meta),
    abnormal: false,
  }
  for (const field of meta.fields) {
    row[field] = (fields[field] ?? '').trim()
  }
  row[codeField] = code
  saveRows(key, [...rows, row])
  return { ok: true, message: `${meta.entity}「${code}」已登记，当前状态「${initial}」` }
}

export function resetModule(key: string): PageResult {
  resetRows(key)
  return listEntries(key)
}

export function exportEntries(key: string): { filename: string; content: string } {
  const meta = moduleMeta(key)
  const header = ['编号', ...meta.fields, '当前状态']
  const lines = [header.join(',')]
  for (const row of listRows(key)) {
    lines.push([row.id, ...meta.fields.map((field) => row[field] ?? ''), row.status].join(','))
  }
  return { filename: `${meta.name}-清单.csv`, content: `\uFEFF${lines.join('\n')}` }
}

export function downloadEntries(key: string): void {
  const { filename, content } = exportEntries(key)
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

export function loadOverview(): OverviewResult {
  const rows = allRows()
  const modules = [...MODULE_BY_KEY.values()].map((meta) => {
    const entries = rows[meta.key] ?? []
    return {
      name: meta.name,
      created: entries.length,
      pending: entries.filter((row) => row.pending).length,
      abnormal: entries.filter((row) => row.abnormal).length,
    }
  })
  const cards = [
    { label: '业务模块', value: modules.length },
    { label: '登记总量', value: modules.reduce((sum, item) => sum + item.created, 0) },
    { label: '待处理', value: modules.reduce((sum, item) => sum + item.pending, 0) },
    { label: '异常量', value: modules.reduce((sum, item) => sum + item.abnormal, 0) },
  ]
  return { cards, modules }
}

// —— 垃圾池区统一口径 ——
// 列表页、运营概览、值班交接的待倒料清单都从下面这几个函数取数，同一个根：
// 顺序只认池区编号升序，重进页面顺序不变；已投料（已倒过料）的池区按当时
// 登记的取值保留，不参与待倒料口径的重算，也不会再进待倒料清单。
const PIT_KEY = 'pit'
const PIT_CODE_FIELD = '池区编号'
// 与 modules.ts 里「安排倒料」的目标状态保持一致。
const PIT_TURNOVER_STATUS = '需倒料'

function comparePitRows(a: EntryRow, b: EntryRow): number {
  const byCode = String(a[PIT_CODE_FIELD] ?? '').localeCompare(
    String(b[PIT_CODE_FIELD] ?? ''),
    'zh-Hans-CN',
    { numeric: true },
  )
  return byCode !== 0 ? byCode : Number(a.id) - Number(b.id)
}

// 池区台账：按池区编号升序，是明细表、看板与待倒料清单共同的顺序来源。
export function listPitLedger(): EntryRow[] {
  return [...listRows(PIT_KEY)].sort(comparePitRows)
}

// 状态看板：按模块状态列表的顺序分列，每列内部沿用台账顺序，逐条对得上。
export function pitStatusBoard(): BoardColumn[] {
  const meta = moduleMeta(PIT_KEY)
  const ledger = listPitLedger()
  return meta.statuses.map((status) => ({
    status,
    rows: ledger.filter((row) => String(row.status) === status),
  }))
}

// 待倒料清单：只认「需倒料」状态，值班交接与运营概览同步用这一份。
export function listPendingTurnoverPits(): EntryRow[] {
  return listPitLedger().filter((row) => String(row.status) === PIT_TURNOVER_STATUS)
}
