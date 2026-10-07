<template>
  <section class="page" data-module="pit">
    <header class="page-head">
      <div>
        <h2>垃圾池管理管理</h2>
        <p class="page-desc">按池区编号把待投料、发酵中、已投料、需倒料并排列出；分栏顺序与下方台账逐条一致，重进页面不变。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记垃圾池区</button>
        <button class="btn" type="button" @click="exportRows">导出垃圾池管理清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <!-- 统一口径看板：四处状态并排，栏内顺序只认台账（按池区编号登记落位）顺序 -->
    <div class="pit-board">
      <article v-for="column in board" :key="column.status" class="pit-column">
        <header class="pit-column-head">
          <span class="pit-column-title">{{ column.status }}</span>
          <span class="pit-column-count">{{ column.cards.length }}</span>
        </header>
        <div v-if="column.cards.length" class="pit-card-list">
          <div v-for="card in column.cards" :key="String(card.row.id)" class="pit-card">
            <div class="pit-card-top">
              <strong class="pit-card-code">{{ card.池区编号 }}</strong>
              <span class="pit-card-tag" :class="{ locked: card.locked }">
                {{ card.locked ? '投料时取值' : '当前取值' }}
              </span>
            </div>
            <dl class="pit-card-metrics">
              <div>
                <dt>发酵天数</dt>
                <dd>{{ card.发酵天数 }}</dd>
              </div>
              <div>
                <dt>渗滤液液位</dt>
                <dd>{{ card.渗滤液液位 }}</dd>
              </div>
            </dl>
            <div class="pit-card-foot">
              <button
                v-if="card.nextAction"
                class="link"
                type="button"
                @click="runAction(card.nextAction, card.row)"
              >
                {{ card.nextAction }}
              </button>
              <span v-else class="pit-card-end">已到链尾</span>
            </div>
          </div>
        </div>
        <p v-else class="pit-column-empty">暂无池区</p>
      </article>
    </div>

    <h3 class="section-title">池区台账明细</h3>
    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ displayValue(row, column) }}</td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button
              v-if="nextAction(String(row.status))"
              class="link"
              type="button"
              @click="runAction(nextAction(String(row.status)), row)"
            >
              {{ nextAction(String(row.status)) }}
            </button>
            <span v-else class="muted-text">—</span>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无垃圾池管理数据，可先登记垃圾池区</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条垃圾池管理记录 · 看板与台账同一顺序口径</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>

    <div v-if="creating" class="modal-mask" @click.self="closeCreate">
      <form class="modal-card" @submit.prevent="submitCreate">
        <h3 class="modal-title">登记垃圾池区</h3>
        <p class="modal-hint">新登记的池区一律从「待投料」进入；池区编号不能与已有记录重复。</p>
        <label v-for="field in createFields" :key="field" class="modal-field">
          <span>{{ field }}</span>
          <input v-model="createForm[field]" :placeholder="`请输入${field}`" />
        </label>
        <p v-if="formError" class="error-text">{{ formError }}</p>
        <div class="modal-actions">
          <button class="btn ghost" type="button" @click="closeCreate">取消</button>
          <button class="btn primary" type="submit">登记</button>
        </div>
      </form>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'

import { downloadEntries, moduleMeta } from '@/api/local-service'
import type { EntryRow } from '@/data/types'
import {
  advancePit,
  nextActionFor,
  pitBoard,
  pitLedger,
  PIT_STATUSES,
  registerPit,
  type PitAction,
  type PitCard,
  type PitStatus,
} from '@/domain/pit-ledger'

const meta = moduleMeta('pit')
const columns = ['池区编号', '垃圾存量', '发酵天数', '渗滤液液位', '抓斗操作人', '倒料日期', '池区温度', '池区状态']
const filterFields = columns.slice(0, 3)

const board = ref<{ status: PitStatus; cards: PitCard[] }[]>([])
const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})

const stats = computed(() =>
  PIT_STATUSES.map((status) => ({
    label: `${status}池区`,
    value: pitLedger().filter((row) => String(row.status) === status).length,
  })),
)

const creating = ref(false)
const formError = ref('')
const createFields = ['池区编号', '垃圾存量', '发酵天数', '渗滤液液位', '抓斗操作人', '池区温度'] as const
const createForm = reactive<Record<(typeof createFields)[number], string>>({
  池区编号: '',
  垃圾存量: '',
  发酵天数: '',
  渗滤液液位: '',
  抓斗操作人: '',
  池区温度: '',
})

function nextAction(status: string): PitAction | null {
  return nextActionFor(status)
}

/** 已投料 / 需倒料 的发酵天数与液位展示投料当时冻结值，不跟现值重算。 */
function snapshotValue(row: EntryRow, field: string): string | undefined {
  const raw = row['投料快照']
  if (typeof raw !== 'string') {
    return undefined
  }
  try {
    const snapshot = JSON.parse(raw) as Record<string, unknown>
    return snapshot[field] !== undefined ? String(snapshot[field]) : undefined
  } catch {
    return undefined
  }
}

function displayValue(row: EntryRow, field: string): string | number | boolean {
  if ((field === '发酵天数' || field === '渗滤液液位') && (row.status === '已投料' || row.status === '需倒料')) {
    const frozen = snapshotValue(row, field)
    if (frozen !== undefined) {
      return frozen
    }
  }
  return row[field] ?? '—'
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  formError.value = ''
  for (const field of createFields) {
    createForm[field] = ''
  }
  creating.value = true
}

function closeCreate() {
  creating.value = false
}

function submitCreate() {
  formError.value = ''
  const result = registerPit({ ...createForm })
  if (!result.ok) {
    formError.value = result.message
    return
  }
  creating.value = false
  errorMessage.value = result.message
  reload()
}

function runAction(action: PitAction | null, row: EntryRow) {
  if (!action) {
    return
  }
  errorMessage.value = ''
  const result = advancePit(Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  errorMessage.value = result.message
  reload()
}

function matchesFilters(row: EntryRow): boolean {
  return Object.entries(filters.value).every(([field, value]) => {
    const keyword = value.trim()
    if (!keyword) {
      return true
    }
    return String(row[field] ?? '').includes(keyword)
  })
}

function reload() {
  board.value = pitBoard()
  // 明细与看板同源同序：先按台账顺序取，再套用筛选，绝不另起排序口径。
  const matched = pitLedger().filter(matchesFilters)
  rows.value = matched
  total.value = matched.length
}

onMounted(reload)
</script>

<style scoped>
.section-title {
  margin: 18px 0 10px;
  font-size: 15px;
}
.pit-board {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
  margin-bottom: 8px;
}
.pit-column {
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 10px;
  min-height: 160px;
}
.pit-column-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}
.pit-column-title {
  font-weight: 600;
  font-size: 14px;
}
.pit-column-count {
  background: #eef2f7;
  border-radius: 999px;
  padding: 1px 9px;
  font-size: 12px;
  color: var(--muted);
}
.pit-card-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.pit-card {
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 8px 10px;
  background: #fbfdff;
}
.pit-card-top {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.pit-card-code {
  font-size: 14px;
}
.pit-card-tag {
  font-size: 11px;
  color: var(--muted);
  background: #eef2f7;
  border-radius: 4px;
  padding: 1px 6px;
}
.pit-card-tag.locked {
  color: #92400e;
  background: #fef3c7;
}
.pit-card-metrics {
  display: flex;
  gap: 14px;
  margin: 8px 0 6px;
}
.pit-card-metrics dt {
  font-size: 11px;
  color: var(--muted);
}
.pit-card-metrics dd {
  margin: 2px 0 0;
  font-size: 14px;
  font-weight: 600;
}
.pit-card-foot {
  display: flex;
  justify-content: flex-end;
  min-height: 20px;
}
.pit-card-end,
.muted-text {
  color: var(--muted);
  font-size: 12px;
}
.pit-column-empty {
  color: var(--muted);
  font-size: 12px;
  text-align: center;
  margin-top: 24px;
}
.modal-mask {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 20;
}
.modal-card {
  width: 420px;
  background: #fff;
  border-radius: 10px;
  padding: 18px 20px;
}
.modal-title {
  margin: 0 0 4px;
}
.modal-hint {
  margin: 0 0 12px;
  font-size: 12px;
  color: var(--muted);
}
.modal-field {
  display: block;
  margin-bottom: 10px;
}
.modal-field span {
  display: block;
  font-size: 12px;
  color: var(--muted);
  margin-bottom: 3px;
}
.modal-field input {
  width: 100%;
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 6px 8px;
}
.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 6px;
}
</style>
