<template>
  <section class="page">
    <header class="page-head">
      <div>
        <h2>运营概览</h2>
        <p class="page-desc">汇总各业务模块的关键指标，先看总量再看异常。</p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="refresh">重新统计</button>
      </div>
    </header>
    <div class="stat-row">
      <article v-for="card in cards" :key="card.label" class="stat-card">
        <span class="stat-label">{{ card.label }}</span>
        <strong class="stat-value">{{ card.value }}</strong>
      </article>
    </div>
    <table class="data-table">
      <thead>
        <tr><th>业务模块</th><th>今日新增</th><th>待处理</th><th>异常量</th></tr>
      </thead>
      <tbody>
        <tr v-for="row in moduleRows" :key="row.name">
          <td>{{ row.name }}</td>
          <td>{{ row.created }}</td>
          <td>{{ row.pending }}</td>
          <td>{{ row.abnormal }}</td>
        </tr>
      </tbody>
    </table>

    <!-- 待倒料与垃圾池管理、值班交接同一份口径：只列「需倒料」池区，按池区编号排序 -->
    <section class="turnover-section">
      <h3 class="section-title">垃圾池待倒料清单</h3>
      <p class="page-desc">与垃圾池管理看板、值班交接清单共用同一口径，已投料的池区不再重复出现。</p>
      <table class="data-table">
        <thead>
          <tr><th>池区编号</th><th>发酵天数</th><th>渗滤液液位</th><th>倒料日期</th></tr>
        </thead>
        <tbody>
          <tr v-for="pit in turnoverPits" :key="String(pit.id)">
            <td>{{ pit['池区编号'] }}</td>
            <td>{{ pit['发酵天数'] || '—' }}</td>
            <td>{{ pit['渗滤液液位'] || '—' }}</td>
            <td>{{ pit['倒料日期'] || '—' }}</td>
          </tr>
          <tr v-if="!turnoverPits.length">
            <td colspan="4" class="empty-state">当前没有待倒料的池区</td>
          </tr>
        </tbody>
      </table>
    </section>

    <footer class="page-foot">
      <span>数据保存在本机浏览器里，换浏览器或清缓存会回到示例数据</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import { listPendingTurnoverPits, loadOverview } from '@/api/local-service'
import type { EntryRow, OverviewResult } from '@/data/types'

const overviewCards = ref<OverviewResult['cards']>([])
const moduleRows = ref<OverviewResult['modules']>([])
const turnoverPits = ref<EntryRow[]>([])

const cards = computed(() => [
  ...overviewCards.value,
  { label: '待倒料池区', value: turnoverPits.value.length },
])

function refresh() {
  const payload = loadOverview()
  overviewCards.value = payload.cards
  moduleRows.value = payload.modules
  turnoverPits.value = listPendingTurnoverPits()
}

onMounted(refresh)
</script>
