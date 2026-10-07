import { listRows, resetRows, saveRows } from '@/data/local-store'
import type { EntryRow } from '@/data/types'

/**
 * 垃圾池台账：列表页、运营概览、值班交接三处共用的唯一口径。
 *
 * 口径约定：
 * - 池区顺序只认台账（存储）顺序，按「池区编号」登记时落位，刷新、重进页面都不变；
 *   看板分栏与各处清单都按这一条台账顺序排，不再各用发酵天数 / 池区温度 / 倒料日期去凑。
 * - 状态只能顺着 待投料 → 发酵中 → 已投料 → 需倒料 走，不允许跳级。
 * - 走到「已投料」时把当时的发酵天数、渗滤液液位等取值冻进快照，之后不随新口径重算。
 * - 「需倒料」的池区同步进值班交接的待倒料交接清单，顺序与台账逐条对得上。
 */

const MODULE_KEY = 'pit'

export const PIT_STATUSES = ['待投料', '发酵中', '已投料', '需倒料'] as const
export type PitStatus = (typeof PIT_STATUSES)[number]

export const PIT_ACTIONS = ['开始发酵', '确认投料', '安排倒料'] as const
export type PitAction = (typeof PIT_ACTIONS)[number]

const ACTION_NEXT: Record<PitAction, PitStatus> = {
  开始发酵: '发酵中',
  确认投料: '已投料',
  安排倒料: '需倒料',
}

/** 进入「已投料」那一刻冻结下来的取值，后续口径调整不再回算。 */
export type PitSnapshot = {
  发酵天数: string
  渗滤液液位: string
  垃圾存量: string
  抓斗操作人: string
  投料时间: string
}

export type PitCard = {
  row: EntryRow
  池区编号: string
  发酵天数: string
  渗滤液液位: string
  /** 看板展示取值：已投料 / 需倒料 用投料当时的快照，未投料用台账现值。 */
  locked: boolean
  /** 当前状态在流转链上允许执行的下一步动作；已到链尾或状态非法时为空。 */
  nextAction: PitAction | null
}

/** 台账原值，顺序即存储顺序（= 池区编号登记落位顺序），是唯一排序口径。 */
export function pitLedger(): EntryRow[] {
  return listRows(MODULE_KEY)
}

function isPitStatus(value: unknown): value is PitStatus {
  return typeof value === 'string' && (PIT_STATUSES as readonly string[]).includes(value)
}

/** 某状态在流转链上的下标；非法状态返回 -1，不允许任何流转。 */
export function statusRank(status: string): number {
  return (PIT_STATUSES as readonly string[]).indexOf(status)
}

/** 该状态允许执行的下一步动作；只能走相邻一步，不许跳级。 */
export function nextActionFor(status: string): PitAction | null {
  const rank = statusRank(status)
  if (rank < 0 || rank >= PIT_STATUSES.length - 1) {
    return null
  }
  const nextStatus = PIT_STATUSES[rank + 1]
  const found = (Object.entries(ACTION_NEXT) as [PitAction, PitStatus][]).find(
    ([, target]) => target === nextStatus,
  )
  return found ? found[0] : null
}

function readSnapshot(row: EntryRow): PitSnapshot | null {
  const value = row['投料快照']
  if (typeof value !== 'string') {
    return null
  }
  try {
    return JSON.parse(value) as PitSnapshot
  } catch {
    return null
  }
}

function toCard(row: EntryRow): PitCard {
  const status = String(row.status)
  const snapshot = readSnapshot(row)
  const locked = snapshot !== null && (status === '已投料' || status === '需倒料')
  return {
    row,
    池区编号: String(row['池区编号'] ?? ''),
    发酵天数: locked ? snapshot!.发酵天数 : String(row['发酵天数'] ?? '—'),
    渗滤液液位: locked ? snapshot!.渗滤液液位 : String(row['渗滤液液位'] ?? '—'),
    locked,
    nextAction: isPitStatus(status) ? nextActionFor(status) : null,
  }
}

/** 看板：四栏并排列出，栏内顺序严格沿用台账顺序。 */
export function pitBoard(): { status: PitStatus; cards: PitCard[] }[] {
  const cards = pitLedger().map(toCard)
  return PIT_STATUSES.map((status) => ({
    status,
    cards: cards.filter((card) => String(card.row.status) === status),
  }))
}

/**
 * 待倒料交接清单：所有走到「需倒料」的池区，顺序与台账逐条一致。
 * 取值用投料当时的快照，不随后续口径变化重算；值班交接页直接读这里。
 */
export function pendingDumpList(): PitCard[] {
  return pitLedger().map(toCard).filter((card) => String(card.row.status) === '需倒料')
}

function sameCode(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase()
}

/** 同一个池区编号不许登记两遍。excludeId 用于编辑/自查时排除自身。 */
export function findDuplicateCode(code: string, excludeId?: number): EntryRow | undefined {
  return pitLedger().find(
    (row) => sameCode(String(row['池区编号'] ?? ''), code) && Number(row.id) !== excludeId,
  )
}

export type CreatePitInput = {
  池区编号: string
  垃圾存量: string
  发酵天数: string
  渗滤液液位: string
  抓斗操作人: string
  池区温度: string
}

/** 登记新池区：只能从「待投料」进入；编号唯一校验不通过则拒绝。 */
export function registerPit(input: CreatePitInput): { ok: boolean; message: string } {
  const code = input.池区编号.trim()
  if (!code) {
    return { ok: false, message: '池区编号不能为空' }
  }
  if (findDuplicateCode(code)) {
    return { ok: false, message: `池区编号「${code}」已经登记过，同一个池区编号不许登记两遍` }
  }
  const rows = pitLedger()
  const id = rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1
  const today = new Date().toISOString().slice(0, 10)
  const row: EntryRow = {
    id,
    status: '待投料',
    pending: true,
    abnormal: false,
    池区编号: code,
    垃圾存量: input.垃圾存量.trim() || '—',
    发酵天数: input.发酵天数.trim() || '0',
    渗滤液液位: input.渗滤液液位.trim() || '—',
    抓斗操作人: input.抓斗操作人.trim() || '—',
    倒料日期: '',
    池区温度: input.池区温度.trim() || '—',
    池区状态: '待投料',
    登记日期: today,
  }
  saveRows(MODULE_KEY, [...rows, row])
  return { ok: true, message: `池区「${code}」已登记，当前状态「待投料」` }
}

/**
 * 池区状态流转：只接受相邻一步，跳级 / 回退 / 非法状态一律拒绝。
 * 进入「已投料」时冻结快照；继续「安排倒料」沿用同一份快照，不重算。
 */
export function advancePit(id: number, action: PitAction): { ok: boolean; message: string } {
  const rows = pitLedger()
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的垃圾池区` }
  }
  const current = String(rows[index].status)
  const currentRank = statusRank(current)
  if (currentRank < 0) {
    return { ok: false, message: `池区当前状态「${current}」不在正常流转链上，不能操作` }
  }
  const allowed = nextActionFor(current)
  if (allowed === null) {
    return { ok: false, message: `池区已到「${current}」，没有可继续的动作` }
  }
  if (action !== allowed) {
    return {
      ok: false,
      message: `池区现在是「${current}」，只能先「${allowed}」，不能直接「${action}」（不许跳级）`,
    }
  }

  const target = ACTION_NEXT[action]
  const updated: EntryRow = { ...rows[index], status: target, 池区状态: target }

  if (target === '已投料') {
    const snapshot: PitSnapshot = {
      发酵天数: String(updated['发酵天数'] ?? ''),
      渗滤液液位: String(updated['渗滤液液位'] ?? ''),
      垃圾存量: String(updated['垃圾存量'] ?? ''),
      抓斗操作人: String(updated['抓斗操作人'] ?? ''),
      投料时间: new Date().toISOString().slice(0, 10),
    }
    updated['投料快照'] = JSON.stringify(snapshot)
  }
  if (target === '需倒料') {
    const snapshot = readSnapshot(updated)
    updated['倒料日期'] = snapshot?.投料时间 ?? new Date().toISOString().slice(0, 10)
    if (!readSnapshot(updated)) {
      // 数据迁移等历史数据没有快照：进入需倒料时补冻当时取值，同样不再回算。
      const fallback: PitSnapshot = {
        发酵天数: String(updated['发酵天数'] ?? ''),
        渗滤液液位: String(updated['渗滤液液位'] ?? ''),
        垃圾存量: String(updated['垃圾存量'] ?? ''),
        抓斗操作人: String(updated['抓斗操作人'] ?? ''),
        投料时间: String(updated['倒料日期'] ?? new Date().toISOString().slice(0, 10)),
      }
      updated['投料快照'] = JSON.stringify(fallback)
    }
  }
  updated.pending = target !== '需倒料'

  const next = [...rows]
  next[index] = updated
  saveRows(MODULE_KEY, next)
  return { ok: true, message: `池区已${action}，当前状态「${target}」` }
}

/** 恢复示例数据：重置后三处口径仍从这份台账统一读取。 */
export function resetPitLedger(): EntryRow[] {
  return resetRows(MODULE_KEY)
}
