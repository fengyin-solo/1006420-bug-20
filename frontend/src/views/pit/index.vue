<template>
  <section class="page" data-module="pit">
    <header class="page-head">
      <div>
        <h2>垃圾池管理</h2>
        <p class="page-desc">维护垃圾池区，围绕池区编号、垃圾存量、发酵天数、渗滤液液位做登记、筛选与状态流转。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="toggleCreate">
          {{ showCreate ? '收起登记' : '登记垃圾池区' }}
        </button>
        <button class="btn" type="button" @click="exportRows">导出垃圾池管理清单</button>
      </div>
    </header>

    <form v-if="showCreate" class="filter-bar create-panel" @submit.prevent="submitCreate">
      <label v-for="field in createFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input
          v-model="createForm[field]"
          :placeholder="field === codeField ? '必填，同一个池区编号不许登记两遍' : `填写${field}`"
        />
      </label>
      <button class="btn primary" type="submit">提交登记</button>
    </form>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <!-- 统一口径看板：四列并排，块内顺序与下方台账逐条对得上，重进页面顺序不变 -->
    <div class="pit-board">
      <section v-for="column in board" :key="column.status" class="pit-board-column">
        <header class="pit-board-head">
          <span>{{ column.status }}</span>
          <span class="pit-board-count">{{ column.rows.length }}</span>
        </header>
        <div class="pit-board-body">
          <article v-for="pit in column.rows" :key="String(pit.id)" class="pit-card">
            <strong class="pit-card-code">{{ pit[codeField] }}</strong>
            <span class="pit-card-meta">发酵 {{ pit['发酵天数'] || '—' }}</span>
            <span class="pit-card-meta">液位 {{ pit['渗滤液液位'] || '—' }}</span>
          </article>
          <p v-if="!column.rows.length" class="pit-board-empty">暂无池区</p>
        </div>
      </section>
    </div>

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
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button
              v-for="action in actions"
              :key="action"
              class="link"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无垃圾池管理数据，可先登记垃圾池区</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条垃圾池管理记录</span>
      <span v-if="noticeMessage" class="ok-text">{{ noticeMessage }}</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  createEntry,
  downloadEntries,
  filterRows,
  listPitLedger,
  moduleMeta,
  pitStatusBoard,
  runAction as applyAction,
} from '@/api/local-service'
import type { BoardColumn, EntryRow } from '@/data/types'

const meta = moduleMeta('pit')
const columns = ["池区编号", "垃圾存量", "发酵天数", "渗滤液液位", "抓斗操作人", "倒料日期", "池区温度", "池区状态"]
const actions = ["开始发酵", "确认投料", "安排倒料"]
const statuses = ["待投料", "发酵中", "已投料", "需倒料"]
const codeField = columns[0]
const createFields = columns

// 台账：全量、按池区编号排序，是看板与统计的共同来源；rows 只是它的筛选结果。
const ledger = ref<EntryRow[]>([])
const board = ref<BoardColumn[]>([])
const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const noticeMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)
const showCreate = ref(false)
const createForm = ref<Record<string, string>>({})

const stats = computed(() => [
  { label: '发酵中池区', value: countByStatus('发酵中') },
  { label: '已投料池区', value: countByStatus('已投料') },
  { label: '需倒料池区', value: countByStatus('需倒料') },
])
const statusSummary = computed(() =>
  statuses.map((status: string) => ({ status, count: countByStatus(status) })),
)

function countByStatus(status: string): number {
  return ledger.value.filter((row) => String(row.status) === status).length
}

function toggleCreate() {
  showCreate.value = !showCreate.value
  if (showCreate.value) {
    createForm.value = {}
  }
}

function submitCreate() {
  errorMessage.value = ''
  noticeMessage.value = ''
  const result = createEntry(meta.key, createForm.value)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  noticeMessage.value = result.message
  createForm.value = {}
  showCreate.value = false
  reload()
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  noticeMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  noticeMessage.value = result.message
  reload()
}

function reload() {
  errorMessage.value = ''
  try {
    ledger.value = listPitLedger()
    board.value = pitStatusBoard()
    const matched = filterRows(ledger.value, filters.value)
    rows.value = matched
    total.value = matched.length
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '垃圾池管理列表读取失败'
  }
}

onMounted(reload)
</script>
