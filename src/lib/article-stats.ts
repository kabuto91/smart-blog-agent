import { prisma } from "./db/client"
import { incrementViews, incrementLikes } from "./db/stats"

/**
 * 文章阅读量 +1，返回最新的阅读数（含本次）。
 * 每打开一次详情页调用一次；同时累加站点总阅读量 SiteStats.totalViews。
 */
export async function bumpArticleRead(id: string): Promise<number> {
  const updated = await prisma.article.update({
    where: { id },
    data: { readCount: { increment: 1 } },
    select: { readCount: true },
  })
  await incrementViews(1)
  return updated.readCount
}

/**
 * 调整文章点赞数（like / unlike 切换）。返回最新点赞数。
 * 通过「读-算-写」并 clamp 到 ≥0，避免状态漂移导致负数；
 * 同步维护站点级总点赞数 SiteStats.totalLikes。
 */
export async function adjustArticleLike(
  id: string,
  action: "like" | "unlike"
): Promise<number> {
  const current = await prisma.article.findUnique({
    where: { id },
    select: { likeCount: true },
  })
  if (!current) throw new Error("文章不存在")

  const delta = action === "unlike" ? -1 : 1
  const next = Math.max(0, current.likeCount + delta)

  const updated = await prisma.article.update({
    where: { id },
    data: { likeCount: next },
    select: { likeCount: true },
  })

  if (next !== current.likeCount) {
    await incrementLikes(next - current.likeCount)
  }

  return updated.likeCount
}

export interface ArticleStatsBarOptions {
  id: string
  readCount: number
  likeCount: number
}

/**
 * 构建自包含的「阅读数 + 点赞按钮」统计条，用于注入到详情页正文之后。
 * 内联脚本通过 document.currentScript.parentElement 定位自身区块，
 * 用 localStorage（key 形如 sa-like-{id}）记住点赞状态，点击时调用点赞 API 同步。
 */
export function buildArticleStatsBar(options: ArticleStatsBarOptions): string {
  const { id, readCount, likeCount } = options

  return `
<style>
.sa-float-stats{position:fixed;right:24px;bottom:24px;z-index:999;display:flex;flex-direction:column;gap:8px;min-width:112px;padding:12px 12px 11px;border-radius:16px;background:rgba(255,255,255,.84);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);border:1px solid rgba(0,0,0,.08);box-shadow:0 10px 30px rgba(0,0,0,.09);font-size:13px;box-sizing:border-box;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"PingFang SC","Microsoft YaHei",sans-serif}
.sa-float-stats__row{display:flex;align-items:center;justify-content:space-between;gap:16px;color:#667085;line-height:1}
.sa-float-stats__label{display:inline-flex;align-items:center;gap:6px;color:#98a0aa}
.sa-float-stats__label svg{flex:none}
.sa-float-stats__num{font-weight:600;color:#2c2c2e;font-size:14px;font-variant-numeric:tabular-nums}
.sa-float-stats__divider{height:1px;background:rgba(0,0,0,.07);margin:1px 0}
.sa-float-stats__like{display:flex;align-items:center;justify-content:center;gap:6px;padding:8px 10px;border-radius:10px;border:1px solid rgba(0,0,0,.1);background:#fff;color:#767c85;font-size:13px;line-height:1;cursor:pointer;transition:transform .15s ease,border-color .2s ease,color .2s ease,background .2s ease,box-shadow .2s ease}
.sa-float-stats__like:hover{color:#e5a83d;border-color:#e5a83d;transform:translateY(-1px)}
.sa-float-stats__like:active{transform:translateY(0) scale(.96)}
.sa-float-stats__like--active{color:#e5760a;border-color:#f0b368;background:#fff8ee;box-shadow:0 1px 3px rgba(229,168,61,.22)}
.sa-float-stats__heart{flex:none;transition:transform .2s ease}
.sa-float-stats__like--active .sa-float-stats__heart{fill:currentColor;transform:scale(1.05)}
.sa-float-stats__like--bump .sa-float-stats__heart{animation:saHeartPop .3s ease}
@keyframes saHeartPop{0%{transform:scale(1)}50%{transform:scale(1.35)}100%{transform:scale(1)}}
.sa-float-stats__count{font-weight:600;font-variant-numeric:tabular-nums}
@media (max-width:640px){
  .sa-float-stats{right:12px;bottom:12px;min-width:96px;padding:10px;border-radius:14px}
}
</style>
<div class="sa-float-stats" role="complementary" aria-label="文章数据">
  <span class="sa-float-stats__row">
    <span class="sa-float-stats__label">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>
      阅读
    </span>
    <span class="sa-float-stats__num" data-read-count>${readCount}</span>
  </span>
  <span class="sa-float-stats__divider"></span>
  <button type="button" class="sa-float-stats__like" data-like-btn data-article-id="${id}" data-like-count="${likeCount}">
    <svg class="sa-float-stats__heart" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 14c1.5-1.5 3-3.2 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4 3 5.5l7 7Z"/></svg>
    赞 <span class="sa-float-stats__count" data-like-count-text>${likeCount}</span>
  </button>
  <script>
  (function(){
    var bar = document.currentScript.parentElement;
    if(!bar) return;
    var btn = bar.querySelector('[data-like-btn]');
    if(!btn) return;
    var countText = bar.querySelector('[data-like-count-text]');
    var id = btn.getAttribute('data-article-id');
    var key = 'sa-like-' + id;
    var liked = false;
    try { liked = localStorage.getItem(key) === '1'; } catch(e){}
    function render(){
      if(liked) btn.classList.add('sa-float-stats__like--active');
      else btn.classList.remove('sa-float-stats__like--active');
    }
    btn.addEventListener('click', function(){
      var action = liked ? 'unlike' : 'like';
      fetch('/api/articles/' + id + '/like', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: action })
      }).then(function(r){ return r.json(); }).then(function(data){
        liked = !liked;
        try { localStorage.setItem(key, liked ? '1' : '0'); } catch(e){}
        countText.textContent = String(data.likeCount);
        var c = btn.getAttribute('data-like-count');
        if(String(data.likeCount) !== c) btn.setAttribute('data-like-count', String(data.likeCount));
        render();
        if(liked){
          btn.classList.remove('sa-float-stats__like--bump');
          void btn.offsetWidth;
          btn.classList.add('sa-float-stats__like--bump');
        }
      }).catch(function(){});
    });
    render();
  })();
  </script>
</div>`
}