// そっと出して数秒で消える短い知らせ（T-1108-03）。反応や候補の記録に失敗したときの「記録できませんでした」など。
// key を渡すと、どの行（札や候補）の知らせかを画面側で見分けられる。
import { getCurrentInstance, onUnmounted, ref } from "vue";

export const NOTICE_MS = 3000;

export function useNotice(ms = NOTICE_MS) {
  const message = ref("");
  const key = ref<string | null>(null);
  let timer: ReturnType<typeof setTimeout> | null = null;

  const clear = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    message.value = "";
    key.value = null;
  };

  const show = (text: string, forKey: string | null = null) => {
    if (timer) clearTimeout(timer);
    message.value = text;
    key.value = forKey;
    timer = setTimeout(clear, ms);
  };

  if (getCurrentInstance()) onUnmounted(clear);
  return { message, key, show, clear };
}
