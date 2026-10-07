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

    <h3 class="section-title">待倒料池区（统一口径）</h3>
    <p class="section-hint">取自垃圾池台账「需倒料」状态，顺序按池区编号台账逐条排列，与垃圾池看板、值班交接清单完全一致；不再按池区温度另排。</p>
    <table class="data-table dump-table">
      <thead>
        <tr><th>序号</th><th>池区编号</th><th>发酵天数</th><th>渗滤液液位</th><th>倒料日期</th><th>池区状态</th></tr>
      </thead>
      <tbody>
        <tr v-for="(item, index) in pendingDump" :key="String(item.row.id)">
          <td>{{ index + 1 }}</td>
          <td>{{ item.池区编号 }}</td>
          <td>{{ item.发酵天数 }}</td>
          <td>{{ item.渗滤液液位 }}</td>
          <td>{{ item.row['倒料日期'] || '—' }}</td>
          <td>需倒料</td>
        </tr>
        <tr v-if="!pendingDump.length">
          <td colspan="6" class="empty-state">当前没有需倒料的池区</td>
        </tr>
      </tbody>
    </table>

    <h3 class="section-title">各业务模块</h3>
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
    <footer class="page-foot">
      <span>数据保存在本机浏览器里，换浏览器或清缓存会回到示例数据</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'

import { loadOverview } from '@/api/local-service'
import type { OverviewResult } from '@/data/types'
import { pendingDumpList, type PitCard } from '@/domain/pit-ledger'

const cards = ref<OverviewResult['cards']>([])
const moduleRows = ref<OverviewResult['modules']>([])
// 运营概览只读取垃圾池台账，顺序与看板、值班交接同源，概览页不另搞排序口径。
const pendingDump = ref<PitCard[]>([])

function refresh() {
  const payload = loadOverview()
  cards.value = payload.cards
  moduleRows.value = payload.modules
  pendingDump.value = pendingDumpList()
}

onMounted(refresh)
</script>

<style scoped>
.section-title {
  margin: 16px 0 6px;
  font-size: 15px;
}
.section-hint {
  margin: 0 0 8px;
  font-size: 12px;
  color: var(--muted);
}
.dump-table {
  margin-bottom: 8px;
}
</style>
