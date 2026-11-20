import { reactive, ref, provide, watch } from "vue";
import { createDocument } from "../shared/defaults";
import { studioKey } from "../shared/context";
import { generate } from "../features/mapping";

export function useWorkspace() {
  const doc = reactive(createDocument());
  const busy = ref(false),
    notice = ref("所有处理均在你的浏览器中完成");
  /** 重新生成（换图/裁剪/密度/明暗等）后由会话层调用，清空色板撤销栈 */
  let onRegenerate: (() => void) | null = null;
  let timer: ReturnType<typeof setTimeout>;

  function invalidate() {
    doc.revision++;
    busy.value = true;
    clearTimeout(timer);
    timer = setTimeout(() => {
      try {
        doc.grid = generate(doc);
        onRegenerate?.();
      } catch (e) {
        notice.value = e instanceof Error ? e.message : "生成失败";
      } finally {
        busy.value = false;
      }
    }, 60);
  }

  function setRegenerateHook(fn: () => void) {
    onRegenerate = fn;
  }

  watch(() => doc.settings.background, invalidate);
  provide(studioKey, { doc, busy, notice, invalidate });
  return { doc, busy, notice, invalidate, setRegenerateHook };
}
