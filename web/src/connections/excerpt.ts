// 昔のひとことの本文のうち、思い出した一文（evidence。Worker が本文からの逐語引用であることを確かめている）に印を付けるための切り分け。
// 画面は hit の部分を <mark>（S3 と同じ蛍光ペン）で描く。見本の gen.py の marked() と同じ規則:
//   limit を超える長い本文は、引用の前後 context 字だけにして、切った側に「…」を付ける（一覧用。シートでは全文）
//   引用が本文に見つからなければ、本文をそのまま返す（印は付けない。推測で場所を決めない）
export type ExcerptPart = { text: string; hit: boolean };

const isLowSurrogate = (code: number) => code >= 0xdc00 && code <= 0xdfff;

export const markEvidence = (
  body: string,
  evidence: string,
  opts: { limit?: number; context?: number } = {},
): ExcerptPart[] => {
  const i = evidence ? body.indexOf(evidence) : -1;
  if (i < 0) return [{ text: body, hit: false }];
  const end = i + evidence.length;
  let a = 0;
  let b = body.length;
  if (opts.limit !== undefined && [...body].length > opts.limit) {
    const ctx = opts.context ?? 24;
    a = Math.max(0, i - ctx);
    b = Math.min(body.length, end + ctx);
    // 絵文字などのサロゲートペアの途中で切らない
    if (a > 0 && isLowSurrogate(body.charCodeAt(a))) a -= 1;
    if (b < body.length && isLowSurrogate(body.charCodeAt(b))) b += 1;
  }
  const pre = (a > 0 ? "…" : "") + body.slice(a, i);
  const post = body.slice(end, b) + (b < body.length ? "…" : "");
  return [
    ...(pre ? [{ text: pre, hit: false }] : []),
    { text: evidence, hit: true },
    ...(post ? [{ text: post, hit: false }] : []),
  ];
};
