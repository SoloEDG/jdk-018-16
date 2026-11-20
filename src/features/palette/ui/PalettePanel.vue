<script setup lang="ts">
import { ref, computed } from "vue";
import {
  Pipette,
  Lock,
  Undo2,
  RefreshCw,
  Eye,
  Trash2,
  Plus,
  AlertTriangle,
  Layers,
} from "lucide-vue-next";
import { usePaletteSession, normalizeHex, contrastText } from "../model/usePaletteSession";

const p = usePaletteSession();
const manualHex = ref("#");

const kindLabel: Record<string, string> = {
  transparent: "透明",
  background: "背景",
  locked: "锁定",
  auto: "自动",
};

const occupied = computed(() =>
  p.palette.value ? p.palette.value.entries.length : 0,
);

/** 每个锁色 hex 的登记次数，用于核对重复锁色 */
const lockDupCount = computed<Record<string, number>>(() => {
  const map: Record<string, number> = {};
  for (const lock of p.doc.locks) {
    const key = lock.color.toLowerCase();
    map[key] = (map[key] ?? 0) + 1;
  }
  return map;
});

function addManual() {
  try {
    const hex = normalizeHex(manualHex.value);
    p.addLock(hex, "manual");
    manualHex.value = "#";
  } catch (e) {
    p.notice.value = e instanceof Error ? e.message : "颜色值无效";
  }
}

function toggleEyedropper() {
  p.eyedropper.value = !p.eyedropper.value;
}

const conflict = computed(() => p.palette.value?.conflict ?? null);
const metrics = computed(() => p.palette.value?.metrics ?? null);
</script>

<template>
  <section class="panel palette-panel">
    <div class="section-title">
      <span>04 / INDEX PALETTE</span><Layers :size="15" />
    </div>

    <template v-if="p.doc.settings.indexed">
    <label class="field">
      色数上限
      <b>{{ p.doc.settings.maxColors }} · 实际 {{ occupied }}</b>
      <input
        aria-label="色数上限"
        type="range"
        min="2"
        max="64"
        step="1"
        :value="p.doc.settings.maxColors"
        @input="p.setMaxColors(Number(($event.target as HTMLInputElement).value))"
      />
    </label>
    <div class="range-ends"><span>2</span><span>64</span></div>

    <div class="strategy-row">
      <button
        :class="{ active: p.doc.settings.strategy === 'salient' }"
        @click="p.setStrategy('salient')"
      >
        显眼小区域优先
      </button>
      <button
        :class="{ active: p.doc.settings.strategy === 'fidelity' }"
        @click="p.setStrategy('fidelity')"
      >
        整体色差优先
      </button>
    </div>

    <div class="palette-actions">
      <button class="mini" :class="{ active: p.eyedropper.value }" @click="toggleEyedropper">
        <Pipette :size="13" /> 吸色
      </button>
      <button class="mini" @click="p.reextract">
        <RefreshCw :size="13" /> 重提取
      </button>
      <button class="mini" :disabled="!p.canUndo.value" @click="p.undo">
        <Undo2 :size="13" /> 撤销
      </button>
    </div>

    <div class="manual-lock">
      <input
        aria-label="手动锁色"
        v-model="manualHex"
        placeholder="#RRGGBB"
        maxlength="7"
        @keydown.enter="addManual"
      />
      <button class="mini" @click="addManual"><Plus :size="13" /> 锁色</button>
    </div>

    <p v-if="p.eyedropper.value" class="hint-line eyedropper-hint">
      <Pipette :size="12" /> 已开启吸色：在上方原图或预览中点击吸取颜色
    </p>

    <ul v-if="p.doc.locks.length" class="lock-list">
      <li
        v-for="lock in p.doc.locks"
        :key="lock.id"
        class="lock-item"
        :class="{ dup: lockDupCount[lock.color.toLowerCase()] > 1 }"
      >
        <span class="swatch-chip" :style="{ background: lock.color }" />
        <span class="lock-hex mono">{{ lock.color }}</span>
        <span
          v-if="lockDupCount[lock.color.toLowerCase()] > 1"
          class="dup-badge"
          >×{{ lockDupCount[lock.color.toLowerCase()] }}</span
        >
        <span class="lock-origin">{{
          lock.origin === "eyedropper" ? "吸取" : lock.origin === "swatch" ? "色板" : "手动"
        }}</span>
        <button
          class="icon-button"
          aria-label="移除锁色"
          @click="p.removeLock(lock.id)"
        >
          <Trash2 :size="12" />
        </button>
      </li>
    </ul>

    <div v-if="p.palette.value" class="swatch-grid">
      <button
        v-for="entry in p.palette.value.entries"
        :key="entry.id"
        class="swatch"
        :class="{
          tracked: p.trackedIndex.value === entry.index,
          zero: entry.count === 0,
        }"
        @click="p.track(entry.index)"
        :title="`索引 ${entry.index} · ${kindLabel[entry.kind]} · ${entry.count} 单元`"
      >
        <span
          class="swatch-color"
          :style="{
            background:
              entry.kind === 'transparent'
                ? 'repeating-conic-gradient(#3a3d44 0 25%, #15171b 0 50%) 50% / 8px 8px'
                : entry.color,
            color: entry.kind === 'transparent' ? '#c9ccd2' : contrastText(entry.color),
          }"
          >{{ entry.kind === "transparent" ? "∅" : entry.index }}</span
        >
        <span class="swatch-meta mono">
          <Lock v-if="entry.kind === 'locked'" :size="9" />{{ entry.count }}
        </span>
      </button>
    </div>

    <div v-if="p.palette.value" class="entry-table-wrap">
      <table class="entry-table mono">
        <thead>
          <tr>
            <th>#</th><th>来源</th><th>颜色</th><th>占用</th><th>边缘</th><th></th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="entry in p.palette.value.entries"
            :key="entry.id"
            :class="{ tracked: p.trackedIndex.value === entry.index }"
            @click="p.track(entry.index)"
          >
            <td>{{ entry.index }}</td>
            <td>{{ kindLabel[entry.kind] }}</td>
            <td>
              <span class="dot" :style="{ background: entry.kind === 'transparent' ? '#000' : entry.color }" />
              {{ entry.kind === "transparent" ? "tRNS" : entry.color }}
            </td>
            <td>{{ entry.count }}</td>
            <td>{{ entry.edgeCells }}</td>
            <td>
              <button
                v-if="entry.kind === 'auto'"
                class="icon-button"
                aria-label="锁定该色"
                @click.stop="p.lockEntry(entry.index)"
              >
                <Lock :size="11" />
              </button>
              <Eye
                v-else
                :size="11"
                :class="{ on: p.trackedIndex.value === entry.index }"
              />
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-if="metrics" class="metrics-grid mono">
      <div><b>{{ metrics.usedEntries }}</b><small>实际占用色</small></div>
      <div><b>{{ metrics.meanDeltaE }}</b><small>平均 ΔE</small></div>
      <div><b>{{ metrics.maxDeltaE }}</b><small>最大 ΔE</small></div>
      <div><b>{{ metrics.orderTau }}</b><small>层级 τ</small></div>
      <div><b>{{ metrics.edgeCells }}</b><small>半透明边缘</small></div>
      <div><b>{{ metrics.transparentCells }}</b><small>透明单元</small></div>
    </div>

    <div v-if="conflict && (conflict.dropped.length || conflict.duplicateGroups.length || conflict.nearPairs.length)" class="conflict-box">
      <div class="conflict-title"><AlertTriangle :size="13" /> 锁色核对</div>
      <p v-if="conflict.duplicateGroups.length" class="conflict-line">
        重复锁色已合并：
        <template v-for="d in conflict.duplicateGroups" :key="d.color">
          <span class="tag">{{ d.color }} ×{{ d.count }}</span>
        </template>
      </p>
      <p v-if="conflict.nearPairs.length" class="conflict-line">
        近似锁色（ΔE &lt; 8）：
        <template v-for="(pair, i) in conflict.nearPairs" :key="i">
          <span class="tag">{{ pair.a }}≈{{ pair.b }} ({{ pair.deltaE }})</span>
        </template>
      </p>
      <template v-if="conflict.dropped.length">
        <p class="conflict-line">
          登记锁色 {{ conflict.requested }} 个（去重后 {{ conflict.unique }}
          个），容量 {{ conflict.capacity }}，已舍弃
          {{ conflict.dropped.length }} 个：
        </p>
        <ul class="dropped-list">
          <li v-for="(d, i) in conflict.dropped" :key="i">
            <span class="swatch-chip" :style="{ background: d.color }" />
            <span class="mono">{{ d.color }}</span>
            <small>显眼度 {{ d.score }}</small>
          </li>
        </ul>
        <div class="compare-grid mono">
          <div :class="{ pick: p.doc.settings.strategy === 'salient' }">
            <b>显眼策略</b>
            <small>平均ΔE {{ conflict.compare.salient.meanDeltaE }}</small>
            <small>舍弃显眼度 {{ conflict.compare.salient.droppedSalience }}</small>
          </div>
          <div :class="{ pick: p.doc.settings.strategy === 'fidelity' }">
            <b>色差策略</b>
            <small>平均ΔE {{ conflict.compare.fidelity.meanDeltaE }}</small>
            <small>舍弃显眼度 {{ conflict.compare.fidelity.droppedSalience }}</small>
          </div>
        </div>
      </template>
    </div>
    </template>
    <p v-else class="hint-line" style="margin-top: 4px">
      当前为逐格真彩色模式，打开预览栏「索引色」开关启用有限色板、锁色与索引 PNG 导出。
    </p>
  </section>
</template>
