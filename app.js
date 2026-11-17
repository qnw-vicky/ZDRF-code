const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const viewMeta = {
  overview: ['今天先把能发布的内容推进', '五步闭环统一管理选题、平台设计、人审定稿、生产、发布与复盘。'],
  ideas: ['第 1 步 · 找到值得做的题目', 'AI 情报雷达提供参考，业务人员结合客户价值与历史数据确认选题。'],
  adapt: ['第 2 步 · 平台设计并人工定稿', '同一选题拆成平台版本；脚本、分镜、字幕和封面文案定稿后才放行生产。'],
  production: ['第 3 步 · 管理两条生产线', '即梦路线与纯代码路线只接收已定稿版本，工作台只记录外部生产和交付。'],
  publishing: ['第 4 步 · 发布并留下完整台账', '记录平台、账号、日期、素材版本和链接，为 T+N 取数提供来源。'],
  analytics: ['第 5 步 · 用同口径数据回到选题', '每周一按 T+7 主口径复盘，建议带证据并可一键生成下轮选题草稿。']
};
const stageLabels = {
  overview: '总览',
  ideas: '选题与情报',
  adapt: '平台内容设计',
  production: '生产任务',
  publishing: '发布与追溯',
  analytics: '数据复盘'
};
const platformOrder = ['Facebook', 'Instagram', 'YouTube', '小红书', 'Pinterest'];
let state = { contentLedger: [], productionTasks: [], assets: [], deliveries: [], publicationRecords: [], metricSnapshots: [], importBatches: [], insights: [], reviews: [], platformVersions: [], accounts: [], actionTasks: [], idea: {}, adoptedInsight: null };
let currentActorId = localStorage.getItem('workbenchActorId') || 'USR-OPS';
let contentLedger = [];
let currentAnalyticsPlatform = 'all';
let focusedAnalyticsId = '';
let ledgerExpanded = false;
let ledgerQuery = '';
let analyticsExpanded = false;
let analyticsQuery = '';
let queueDraftIds = [];

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[ch]));
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { 'Content-Type': 'application/json', 'X-Actor-Id': currentActorId, ...(options.headers || {}) },
    ...options
  });
  const payload = await response.json().catch(() => ({ ok: false, error: '服务器返回格式错误' }));
  if (!response.ok || payload.ok === false) throw new Error(payload.error || `请求失败 (${response.status})`);
  return payload;
}

async function reloadState() {
  const payload = await api('/api/state');
  state = payload.state;
  renderActorBar();
  contentLedger = state.contentLedger || [];
  hydrateIdea();
  renderOverview();
  renderReviewStatus();
  renderPlatformVersions();
  renderProduction();
  renderAssets();
  renderPublishing();
  renderAnalytics(currentAnalyticsPlatform, focusedAnalyticsId);
  renderInsight();
  renderAdoptedInsight();
}

function renderActorBar() {
  const select = $('#actor-select');
  if (!select) return;
  const participants = state.participants || [];
  if (!participants.some(person => person.id === currentActorId)) currentActorId = participants[0]?.id || '';
  select.innerHTML = participants.map(person => `<option value="${escapeHtml(person.id)}" ${person.id === currentActorId ? 'selected' : ''}>${escapeHtml(person.name)}</option>`).join('');
}

async function openAuditDrawer() {
  const payload = await api('/api/audit');
  const title = $('#drawer-title');
  const copy = $('#drawer-copy');
  const body = $('#drawer-body');
  title.textContent = '操作记录';
  copy.textContent = '关键修改记录操作者、对象、动作和时间，用于追溯任务过程。';
  body.innerHTML = `<div class="stage-list">${payload.auditLog.map(log => `<div class="stage"><div class="stage-name">${escapeHtml(log.actorName)} · ${escapeHtml(log.action)}</div><div class="stage-copy">${escapeHtml(log.entityType)} ${escapeHtml(log.entityId)}<br>${escapeHtml(log.summary)}<br>${escapeHtml(new Date(log.occurredAt).toLocaleString('zh-CN'))}</div></div>`).join('') || '<div class="empty">暂无审计记录</div>'}</div>`;
  $('#drawer').classList.add('open');
}

async function exportBackup() {
  const response = await fetch('/api/export', { headers: { 'X-Actor-Id': currentActorId } });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || '导出失败');
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `social-workbench-backup-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  toast('工作台 JSON 备份已导出');
}

function renderOverview() {
  const panels = $$('#overview .panel');
  const taskPanel = panels[0];
  const accountPanel = panels[1];
  if (taskPanel) {
    taskPanel.querySelectorAll(':scope > .task-row').forEach(row => row.remove());
    const tasks = [...(state.actionTasks || [])].filter(task => !task.deletedAt).sort((a, b) => (Number(a.sortOrder) - Number(b.sortOrder)) || a.dueDate.localeCompare(b.dueDate));
    tasks.forEach(task => {
      const row = document.createElement('div');
      row.className = 'task-row';
      row.innerHTML = `<div><div class="row-title">${escapeHtml(task.title)}</div><div class="row-sub">${escapeHtml(task.description)}</div></div><div><span class="status ${task.status === '已完成' ? 'good' : task.status === '进行中' ? 'blue' : 'warn'}">${escapeHtml(task.status)}</span></div><div class="row-sub">${escapeHtml(task.owner)} · ${escapeHtml(toDateLabel(task.dueDate))}</div><button class="btn text small">编辑</button>`;
      row.querySelector('button').addEventListener('click', () => openDrawer('task-drawer', task.id));
      taskPanel.appendChild(row);
    });
  }
  if (accountPanel) {
    accountPanel.querySelectorAll(':scope > .account-row').forEach(row => row.remove());
    (state.accounts || []).forEach(account => {
      const row = document.createElement('div');
      row.className = 'account-row';
      row.innerHTML = `<div><div class="row-title">${escapeHtml(account.platform)}</div><div class="row-sub">${escapeHtml(account.accountName)} · ${escapeHtml(account.region)}</div></div><div><span class="status ${account.status === '已连接' ? 'good' : account.status.includes('待') ? 'warn' : 'blue'}">${escapeHtml(account.status)}</span></div><div class="row-sub">${escapeHtml(account.capability)}</div><button class="btn text small">编辑</button>`;
      row.querySelector('button').addEventListener('click', () => openDrawer('account-drawer', account.id));
      accountPanel.appendChild(row);
    });
  }
  const kpis = $$('#overview .kpi-value');
  if (kpis[0]) kpis[0].textContent = String((state.actionTasks || []).filter(task => !task.deletedAt && task.status !== '已完成').length);
  if (kpis[1]) kpis[1].textContent = `${(state.accounts || []).filter(account => account.status === '已连接').length} / ${(state.accounts || []).length}`;
  if (kpis[2]) kpis[2].textContent = String(contentLedger.filter(item => item.status === '待发布').length);
}

function showView(id) {
  $$('.view').forEach(view => view.classList.toggle('hidden', view.id !== id));
  $$('.nav-btn').forEach(button => button.classList.toggle('active', button.dataset.view === id));
  $$('.flow-item').forEach(button => button.classList.toggle('active', button.dataset.view === id));
  $('#view-title').textContent = viewMeta[id][0];
  $('#view-copy').textContent = viewMeta[id][1];
  $('#current-stage').textContent = `当前阶段 · ${stageLabels[id]}`;
  window.scrollTo({ top: 0, behavior: 'auto' });
}

function toast(message, isError = false) {
  const element = $('#toast');
  element.textContent = message;
  element.style.background = isError ? '#8f2d2d' : '';
  element.classList.add('show');
  clearTimeout(window.__toast);
  window.__toast = setTimeout(() => element.classList.remove('show'), 3000);
}

function fmtNum(number) { return number ? Number(number).toLocaleString('zh-CN') : '—'; }
function statusClass(status) { return status === '已发布' ? 'ready' : (status === '草稿' || String(status).includes('卡') || status === '发布失败' ? 'wait' : ''); }
function toDateLabel(value) {
  if (!value) return '待安排';
  const date = new Date(`${value}T00:00:00`);
  return `${date.getMonth() + 1} 月 ${date.getDate()} 日`;
}

function hydrateIdea() {
  if (!state.idea) return;
  if ($('#idea-topic')) $('#idea-topic').value = state.idea.topic || '';
  if ($('#idea-source')) $('#idea-source').value = state.idea.source || 'AI 情报雷达 · 近期社媒案例';
  if ($('#idea-problem')) $('#idea-problem').value = state.idea.problem || '';
  if ($('#idea-value')) $('#idea-value').value = state.idea.value || '';
  if ($('#idea-target-platforms')) $('#idea-target-platforms').value = state.idea.targetPlatforms || '';
  if ($('#idea-validation')) $('#idea-validation').value = state.idea.validationVariable || '';
  if ($('#idea-card')) $('#idea-card').value = state.idea.card || '';
  if (state.idea.status === '已保存') {
    ['idea-problem-status', 'idea-value-status', 'idea-validation-status', 'idea-card-status'].forEach(id => {
      const element = $(`#${id}`);
      if (element) { element.className = 'status good'; element.textContent = '已保存'; }
    });
  }
}

function renderReviewStatus() {
  const review = [...(state.reviews || [])].reverse().find(item => item.status === 'APPROVED');
  const badge = $('#review-status');
  if (!badge) return;
  badge.className = `status ${review ? 'good' : 'warn'}`;
  badge.textContent = review ? `人工已定稿 · ${review.version}` : '待人工确认';
}

function renderPlatformVersions() {
  const list = $('#platform-version-list');
  const count = $('#platform-version-count');
  if (!list || !count) return;
  const versions = [...(state.platformVersions || [])].reverse();
  count.textContent = `${versions.length} 个版本`;
  list.innerHTML = versions.map(version => `<div class="stage"><div class="stage-name">${escapeHtml(version.platform)} · ${escapeHtml(version.title)}</div><div class="stage-copy">${escapeHtml(version.contentId)} · ${escapeHtml(version.format)} · ${escapeHtml(version.ratio)} · ${escapeHtml(version.duration)}<br>${escapeHtml(version.tags)} · ${escapeHtml(version.language)}<br>CTA：${escapeHtml(version.cta)}</div><div class="ledger-actions"><button class="ledger-link" data-edit-version="${escapeHtml(version.id)}">编辑</button><button class="ledger-link" data-review-version="${escapeHtml(version.id)}">人工定稿</button></div></div>`).join('') || '<div class="empty">尚未保存平台版本</div>';
  $$('[data-edit-version]').forEach(button => button.addEventListener('click', () => openDrawer('adapt-drawer', button.dataset.editVersion)));
  $$('[data-review-version]').forEach(button => button.addEventListener('click', () => openDrawer('script-drawer', button.dataset.reviewVersion)));
}

function renderAssets() {
  const list = $('#asset-list');
  if (!list) return;
  const assets = [...(state.assets || [])].reverse();
  list.innerHTML = assets.map(asset => `<div class="asset"><div class="asset-body"><div class="asset-title">${escapeHtml(asset.type)} · ${escapeHtml(asset.contentId)} ${escapeHtml(asset.version)}</div><div class="asset-meta">${asset.storageMode === 'local' ? '工作台本地文件' : '外部文件链接'} · ${escapeHtml(asset.acceptanceStatus)}</div><div class="asset-meta">${escapeHtml(asset.fileName || asset.url)}</div><a class="ledger-link" href="${escapeHtml(asset.url)}" target="_blank" rel="noopener">查看文件</a></div></div>`).join('') || '<div class="empty">暂无已登记素材</div>';
}

function renderProduction() {
  const panel = document.querySelector('#production .section-grid > .panel');
  if (!panel) return;
  panel.querySelectorAll(':scope > .content-row').forEach(row => row.remove());
  const callout = panel.querySelector(':scope > .callout');
  const tasks = state.productionTasks || [];
  [...tasks].reverse().forEach(task => {
    const row = document.createElement('div');
    row.className = 'content-row';
    row.dataset.productionId = task.contentId;
    row.dataset.title = task.title;
    const accepted = task.status === '已验收';
    const deliveries = (state.deliveries || []).filter(item => item.contentId === task.contentId);
    const pending = [...deliveries].reverse().find(item => item.acceptanceStatus === '待验收');
    row.innerHTML = `<div><div class="row-title">${escapeHtml(task.title)} · ${escapeHtml(task.route)}</div><div class="row-sub">${escapeHtml(task.contentId)} · ${escapeHtml(task.ratio)} · 定稿 ${escapeHtml(task.reviewVersion)}</div></div><div><span class="status ${accepted ? 'good' : task.status.includes('阻') || task.status.includes('修改') ? 'warn' : 'blue'}">${escapeHtml(task.status)}</span><div class="row-sub">${escapeHtml(task.owner)} · ${deliveries.length} 个交付版本</div></div><div><div class="row-title">交付 ${escapeHtml(toDateLabel(task.dueDate))}</div><div class="row-sub">${escapeHtml(task.blocker || (accepted ? '已完成外部交付' : '等待外部制作或回传'))}</div></div><div class="ledger-actions"><button class="ledger-link" data-manage-task>管理工单</button><button class="ledger-link" data-delivery-action>${pending ? '验收交付' : '登记交付'}</button></div>`;
    row.querySelector('[data-manage-task]').addEventListener('click', () => openDrawer('production-status-drawer', task.id));
    row.querySelector('[data-delivery-action]').addEventListener('click', () => openDrawer(pending ? 'delivery-review-drawer' : 'delivery-drawer', pending ? pending.id : task.contentId));
    callout.insertAdjacentElement('afterend', row);
  });
  if (!tasks.length) {
    const empty = document.createElement('div');
    empty.className = 'empty content-row';
    empty.textContent = '暂无生产工单；脚本人工定稿后方可创建。';
    callout.insertAdjacentElement('afterend', empty);
  }
}

function renderPublishing() {
  const schedule = $('#publish-schedule');
  const ledger = $('#publish-ledger');
  if (!schedule || !ledger) return;
  const groups = [...new Set(contentLedger.filter(item => item.status !== '已发布').map(item => item.dateLabel))];
  schedule.innerHTML = groups.map(date => `<div class="schedule-col"><div class="schedule-date">${escapeHtml(date)}<span>${date === '待安排' ? '账号或素材未就绪' : '发布计划'}</span></div>${contentLedger.filter(item => item.dateLabel === date).map(item => `<div class="schedule-item"><div class="row-title">${escapeHtml(item.platform)} · ${escapeHtml(item.title)}</div><div class="row-sub">${escapeHtml(item.format)} · ${escapeHtml(item.ratio)}</div><div class="schedule-meta"><span class="${statusClass(item.status)}">${escapeHtml(item.status)}</span><span class="${String(item.copyStatus).includes('完成') ? 'ready' : 'wait'}">${escapeHtml(item.copyStatus)}</span><span class="${String(item.assetStatus).includes('完成') || String(item.assetStatus).includes('验收') ? 'ready' : 'wait'}">${escapeHtml(item.assetStatus)}</span></div></div>`).join('') || '<div class="empty">暂无排期</div>'}</div>`).join('');
  const key = ledgerQuery.trim().toLowerCase();
  const rows = contentLedger.slice().reverse().filter(item => `${item.id} ${item.title}`.toLowerCase().includes(key));
  const visible = ledgerExpanded ? rows : rows.slice(0, 10);
  $('#ledger-count').textContent = `显示 ${visible.length} / ${rows.length} 条`;
  $('#ledger-options').innerHTML = contentLedger.map(item => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.title)}</option>`).join('');
  $('#ledger-toggle').textContent = ledgerExpanded ? '收起' : '展开全部';
  $('#ledger-toggle').disabled = rows.length <= 10;
  ledger.innerHTML = visible.map(item => `<div class="ledger-row"><div><div class="row-title">${escapeHtml(item.title)}</div><div class="row-sub">${escapeHtml(item.id)} · ${escapeHtml(item.category)} · ${escapeHtml(item.style)}</div></div><div><span class="status blue">${escapeHtml(item.platform)}</span><div class="row-sub">${escapeHtml(item.format)} · ${escapeHtml(item.ratio)}</div></div><div><span class="status ${String(item.copyStatus).includes('完成') ? 'good' : 'warn'}">${escapeHtml(item.copyStatus)}</span><div class="copy-state">${escapeHtml(item.assetStatus)}</div></div><div><span class="status ${statusClass(item.status) === 'ready' ? 'good' : statusClass(item.status) === 'wait' ? 'warn' : 'blue'}">${escapeHtml(item.status)}</span><div class="row-sub">${escapeHtml(item.dateLabel)}</div></div><div class="ledger-actions"><button class="ledger-link" data-update-id="${escapeHtml(item.id)}">更新发布状态</button><button class="ledger-link" data-index-id="${escapeHtml(item.id)}">索引到复盘</button></div></div>`).join('') || '<div class="empty">没有找到匹配的内容任务</div>';
  $$('[data-update-id]').forEach(button => button.addEventListener('click', () => openDrawer('publish-drawer', button.dataset.updateId)));
  $$('[data-index-id]').forEach(button => button.addEventListener('click', () => focusAnalytics(button.dataset.indexId)));
}

function renderAnalytics(platform = 'all', focusId = '') {
  currentAnalyticsPlatform = platform;
  focusedAnalyticsId = focusId || '';
  if (focusId) { analyticsQuery = focusId; analyticsExpanded = true; if ($('#analytics-search')) $('#analytics-search').value = focusId; }
  const tabs = $('#analytics-platform-tabs');
  const summary = $('#analytics-summary');
  const list = $('#analytics-index-list');
  const copy = $('#analytics-index-copy');
  const classification = $('#analytics-classification');
  if (!tabs || !summary || !list || !classification) return;
  tabs.innerHTML = ['all', ...platformOrder].map(name => `<button class="platform-tab ${name === platform ? 'active' : ''}" data-platform-tab="${escapeHtml(name)}">${name === 'all' ? '全部平台' : escapeHtml(name)}</button>`).join('');
  $$('[data-platform-tab]').forEach(button => button.addEventListener('click', () => renderAnalytics(button.dataset.platformTab, '')));
  const rows = platform === 'all' ? contentLedger : contentLedger.filter(item => item.platform === platform);
  const comparable = rows.filter(item => item.snapshot === 'T+7');
  const key = analyticsQuery.trim().toLowerCase();
  const indexedRows = rows.slice().reverse().filter(item => `${item.id} ${item.title}`.toLowerCase().includes(key));
  const visible = analyticsExpanded ? indexedRows : indexedRows.slice(0, 10);
  $('#analytics-options').innerHTML = contentLedger.map(item => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.title)}</option>`).join('');
  $('#analytics-toggle').textContent = analyticsExpanded ? '收起' : '展开全部';
  $('#analytics-toggle').disabled = indexedRows.length <= 10;
  const totalVideo = rows.filter(item => item.isVideo).length;
  const published = rows.filter(item => item.status === '已发布').length;
  const totalImpressions = comparable.reduce((sum, item) => sum + Number(item.metrics.impressions || 0), 0);
  const watchRows = comparable.filter(item => item.metrics.watchRate);
  const avgWatch = watchRows.length ? Math.round(watchRows.reduce((sum, item) => sum + Number(item.metrics.watchRate), 0) / watchRows.length) : 0;
  const allVideoCount = contentLedger.filter(item => item.isVideo).length || 1;
  summary.innerHTML = `<div class="macro-card active"><div class="macro-name">${platform === 'all' ? '全部内容任务' : escapeHtml(platform)}</div><div class="macro-number">${totalVideo}</div><div class="macro-note">视频条数 · 总内容 ${rows.length} 条</div><div class="macro-bar"><span style="width:${Math.max(8, totalVideo / (platform === 'all' ? allVideoCount : Math.max(totalVideo, 1)) * 100)}%"></span></div></div><div class="macro-card"><div class="macro-name">已发布</div><div class="macro-number">${published}</div><div class="macro-note">已进入平台的内容</div></div><div class="macro-card"><div class="macro-name">T+7 曝光</div><div class="macro-number">${fmtNum(totalImpressions)}</div><div class="macro-note">同口径快照合计</div></div><div class="macro-card"><div class="macro-name">T+7 平均完播</div><div class="macro-number">${avgWatch ? `${avgWatch}%` : '—'}</div><div class="macro-note">仅计算可比样本</div></div>`;
  copy.textContent = focusedAnalyticsId ? `已定位到 ${focusedAnalyticsId}，可查看进度并回到发布台账。` : '全部内容任务都保留在这里，可查看状态或返回发布台账。';
  list.innerHTML = visible.map(item => `<div class="index-row" id="analytics-${escapeHtml(item.id)}"><div><strong>${escapeHtml(item.title)}</strong><div class="row-sub">${escapeHtml(item.id)} · ${escapeHtml(item.dateLabel)}</div></div><div><span class="status blue">${escapeHtml(item.platform)}</span><div class="row-sub">${escapeHtml(item.format)} · ${escapeHtml(item.ratio)}</div></div><div><div class="row-sub">曝光 ${fmtNum(item.metrics.impressions)} · 播放 ${fmtNum(item.metrics.views)}</div><div class="row-sub">完播 ${item.metrics.watchRate ? `${item.metrics.watchRate}%` : '—'} · ${escapeHtml(item.category)}</div></div><div style="text-align:right"><span class="status ${statusClass(item.status) === 'ready' ? 'good' : statusClass(item.status) === 'wait' ? 'warn' : 'blue'}">${escapeHtml(item.snapshot || item.status)}</span><button class="ledger-link" data-back-publish="${escapeHtml(item.id)}">回到发布台账</button></div></div>`).join('') || '<div class="empty">没有找到匹配的内容任务</div>';
  $$('[data-back-publish]').forEach(button => button.addEventListener('click', () => { ledgerQuery = button.dataset.backPublish; ledgerExpanded = true; $('#ledger-search').value = ledgerQuery; renderPublishing(); showView('publishing'); }));
  classification.innerHTML = platformOrder.map(name => { const items = contentLedger.filter(item => item.platform === name); const videos = items.filter(item => item.isVideo).length; const live = items.filter(item => item.status === '已发布').length; return `<div class="classification-item"><div><strong>${escapeHtml(name)}</strong><div class="row-sub">${items.map(item => item.category).filter((value, index, array) => array.indexOf(value) === index).map(escapeHtml).join(' · ')}</div></div><div><div class="count">${videos}<small> 条视频</small></div><div class="row-sub">总内容 ${items.length} · 已发布 ${live}</div></div><span class="status ${live ? 'good' : 'warn'}">${live ? '有表现数据' : '等待发布'}</span></div>`; }).join('');
}

function renderAdoptedInsight() {
  const adopted = state.adoptedInsight;
  const card = $('#adopted-idea');
  const empty = $('#idea-return-empty');
  if (!card || !empty) return;
  card.style.display = adopted ? 'block' : 'none';
  empty.style.display = adopted ? 'none' : 'block';
  if (adopted) card.querySelector('.evidence').innerHTML = `建议：${escapeHtml(adopted.suggestion)}<br>待验证变量：${escapeHtml(adopted.validationVariable)}<br>证据回链：${adopted.evidenceContentIds.map(escapeHtml).join('、')}`;
}

function renderInsight() {
  const card = $('#insight-card');
  if (!card) return;
  const insight = [...(state.insights || [])].reverse().find(item => item.status === '待采纳') || [...(state.insights || [])].reverse()[0];
  if (!insight) {
    card.innerHTML = '<h4>尚未生成可采纳建议</h4><div class="evidence">至少需要 2 条带来源的 T+7 数据。点击“生成本周建议”后，系统按同口径互动率生成可解释建议。</div>';
    return;
  }
  card.innerHTML = `<h4>建议：${escapeHtml(insight.conclusion)}</h4><div class="evidence"><b>来源：</b>${escapeHtml(insight.source)}<br><b>样本：</b>${escapeHtml(insight.sampleContentIds.join('、'))}，共 ${insight.sampleSize} 条<br><b>基准：</b>${escapeHtml(insight.baseline)}<br><b>数字：</b>${escapeHtml(insight.numbers)}<br><b>动作：</b>${escapeHtml(insight.suggestedAction)}</div>${insight.status === '待采纳' ? '<button class="btn primary small" id="btn-adopt-insight" style="margin-top:10px">采纳为下轮选题</button>' : '<span class="status good" style="margin-top:10px">已采纳</span>'}`;
  $('#btn-adopt-insight')?.addEventListener('click', () => run(() => adoptInsight(insight.id)));
}

function focusAnalytics(id) { showView('analytics'); renderAnalytics('all', id); }

function closeDrawer() { $('#drawer').classList.remove('open'); }

async function saveActionTask() {
  await api('/api/action-tasks', { method: 'POST', body: JSON.stringify({
    id: $('#action-id').value,
    title: $('#action-title').value,
    description: $('#action-description').value,
    owner: $('#action-owner').value,
    dueDate: $('#action-due').value,
    priority: $('#action-priority').value,
    status: $('#action-status').value
  }) });
  closeDrawer();
  await reloadState();
  toast('行动任务已保存');
}

async function deleteActionTask(taskId, taskTitle) {
  if (!window.confirm(`确认删除行动任务“${taskTitle}”吗？\n删除后将从行动队列移除，但操作记录仍会保留。`)) return;
  await api('/api/action-tasks/delete', { method: 'POST', body: JSON.stringify({ taskId }) });
  closeDrawer();
  await reloadState();
  toast('行动任务已删除');
}

function renderQueueDraft() {
  const body = $('#drawer-body');
  const byId = new Map((state.actionTasks || []).map(task => [task.id, task]));
  body.innerHTML = `<div class="stage-list">${queueDraftIds.map((id, index) => { const task = byId.get(id); return `<div class="stage"><div class="stage-name">${index + 1}. ${escapeHtml(task.title)}</div><div class="stage-copy">${escapeHtml(task.owner)} · ${escapeHtml(toDateLabel(task.dueDate))} · ${escapeHtml(task.status)}</div><div class="top-actions"><button class="btn small" data-queue-up="${escapeHtml(id)}" ${index === 0 ? 'disabled' : ''}>上移</button><button class="btn small" data-queue-down="${escapeHtml(id)}" ${index === queueDraftIds.length - 1 ? 'disabled' : ''}>下移</button></div></div>`; }).join('')}</div><div class="row" style="display:flex;justify-content:flex-end;margin-top:16px"><button class="btn primary" id="btn-save-queue-order">保存队列顺序</button></div>`;
  $$('[data-queue-up]').forEach(button => button.addEventListener('click', () => moveQueueItem(button.dataset.queueUp, -1)));
  $$('[data-queue-down]').forEach(button => button.addEventListener('click', () => moveQueueItem(button.dataset.queueDown, 1)));
  $('#btn-save-queue-order').addEventListener('click', () => run(saveQueueOrder));
}

function moveQueueItem(id, offset) {
  const index = queueDraftIds.indexOf(id);
  const target = index + offset;
  if (index < 0 || target < 0 || target >= queueDraftIds.length) return;
  [queueDraftIds[index], queueDraftIds[target]] = [queueDraftIds[target], queueDraftIds[index]];
  renderQueueDraft();
}

function openQueueDrawer() {
  queueDraftIds = [...(state.actionTasks || [])].filter(task => !task.deletedAt).sort((a, b) => Number(a.sortOrder) - Number(b.sortOrder)).map(task => task.id);
  $('#drawer-title').textContent = '调整行动队列';
  $('#drawer-copy').textContent = '使用上移、下移调整执行顺序；保存后首页立即按新顺序展示。';
  renderQueueDraft();
  $('#drawer').classList.add('open');
}

async function saveQueueOrder() {
  await api('/api/action-tasks/reorder', { method: 'POST', body: JSON.stringify({ orderedIds: queueDraftIds }) });
  closeDrawer();
  await reloadState();
  toast('行动队列顺序已保存');
}

async function saveAccount() {
  await api('/api/accounts', { method: 'POST', body: JSON.stringify({
    id: $('#account-id').value,
    status: $('#account-status').value,
    owner: $('#account-owner').value,
    notes: $('#account-notes').value
  }) });
  closeDrawer();
  await reloadState();
  toast('账号状态已保存');
}

async function saveIdea() {
  await api('/api/ideas', { method: 'POST', body: JSON.stringify({ topic: $('#idea-topic').value, source: $('#idea-source').value, problem: $('#idea-problem').value, value: $('#idea-value').value, targetPlatforms: $('#idea-target-platforms').value, validationVariable: $('#idea-validation').value, card: $('#idea-card').value }) });
  await reloadState();
  toast('选题卡已持久化保存');
}

async function approveReview() {
  await api('/api/reviews/approve', { method: 'POST', body: JSON.stringify({ contentId: $('#review-content-id').value, platformVersionId: $('#review-platform-version-id').value, platform: $('#review-platform').value, version: $('#review-version').value, reviewer: $('#reviewer').value, script: $('#review-script').value, storyboard: $('#review-storyboard').value, subtitles: $('#review-subtitles').value, coverCopy: $('#review-cover-copy').value }) });
  closeDrawer();
  await reloadState();
  toast('人工定稿已冻结，可创建生产工单');
}

async function savePlatformVersion() {
  await api('/api/platform-versions', { method: 'POST', body: JSON.stringify({ id: $('#adapt-version-id').value, contentId: $('#adapt-content-id').value, platform: $('#adapt-platform').value, format: $('#adapt-format').value, ratio: $('#adapt-ratio').value, duration: $('#adapt-duration').value, title: $('#adapt-title').value, body: $('#adapt-body').value, tags: $('#adapt-tags').value, cta: $('#adapt-cta').value, language: $('#adapt-language').value, coverRequirement: $('#adapt-cover').value, expression: $('#adapt-expression').value }) });
  closeDrawer();
  await reloadState();
  toast('平台版本已保存，下一步进行人工定稿');
}

async function saveProduction() {
  await api('/api/production-tasks', { method: 'POST', body: JSON.stringify({ contentId: $('#production-id').value, title: $('#production-title').value, route: $('#production-route').value, owner: $('#production-owner').value, ratio: $('#production-ratio').value, dueDate: $('#production-due').value, checklist: $('#production-checklist').value }) });
  closeDrawer();
  await reloadState();
  showView('production');
  toast('生产工单已保存；等待外部制作');
}

async function updateProductionStatus() {
  await api('/api/production-tasks/status', { method: 'POST', body: JSON.stringify({
    taskId: $('#production-task-id').value,
    status: $('#production-task-status').value,
    blocker: $('#production-blocker').value
  }) });
  closeDrawer();
  await reloadState();
  toast('生产工单状态已更新');
}

async function saveDelivery() {
  const contentId = $('#delivery-content-id').value;
  const version = $('#delivery-version').value;
  const type = $('#delivery-asset-type').value;
  let asset;
  if ($('#delivery-storage-mode').value === 'local') {
    const file = $('#delivery-file').files[0];
    if (!file) throw new Error('请选择要上传的本地文件');
    if (file.size > 500 * 1024 * 1024) throw new Error('单个文件不能超过 500MB');
    const response = await fetch('/api/assets/upload', {
      method: 'POST',
      headers: { 'X-Actor-Id': currentActorId, 'X-Content-Id': encodeURIComponent(contentId), 'X-Asset-Type': encodeURIComponent(type), 'X-Asset-Version': encodeURIComponent(version), 'X-File-Name': encodeURIComponent(file.name), 'Content-Type': file.type || 'application/octet-stream' },
      body: file
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || '本地文件上传失败');
    asset = payload.asset;
  } else {
    const payload = await api('/api/assets', { method: 'POST', body: JSON.stringify({ contentId, type, version, url: $('#delivery-url').value }) });
    asset = payload.asset;
  }
  await api('/api/deliveries', { method: 'POST', body: JSON.stringify({ contentId, version, assetId: asset.id, notes: $('#delivery-notes').value }) });
  closeDrawer();
  await reloadState();
  toast('新交付版本已登记，等待人工验收');
}

async function reviewDelivery() {
  const decision = $('#delivery-decision').value;
  await api('/api/deliveries/review', { method: 'POST', body: JSON.stringify({
    deliveryId: $('#delivery-review-id').value,
    decision,
    reviewNotes: $('#delivery-review-notes').value,
    reviewedBy: $('#delivery-reviewer').value
  }) });
  closeDrawer();
  await reloadState();
  toast(decision === '已验收' ? '交付已验收，可进入发布' : '交付已退回修改');
}

async function savePublish() {
  const date = $('#publish-date').value;
  const status = $('#publish-status').value;
  await api('/api/publications', { method: 'POST', body: JSON.stringify({ contentId: $('#publish-content').value, platform: $('#publish-platform').value, status, date, dateLabel: toDateLabel(date), platformUrl: $('#publish-url').value, blocker: $('#publish-blocker').value }) });
  closeDrawer();
  await reloadState();
  toast(status === '已发布' ? '已更新为已发布，可继续录入数据' : '发布台账已更新');
}

function parseCsv(text) {
  const rows = [];
  let row = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"' && quoted && text[i + 1] === '"') { cell += '"'; i++; }
    else if (ch === '"') quoted = !quoted;
    else if (ch === ',' && !quoted) { row.push(cell.trim()); cell = ''; }
    else if ((ch === '\n' || ch === '\r') && !quoted) { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cell.trim()); if (row.some(Boolean)) rows.push(row); row = []; cell = ''; }
    else cell += ch;
  }
  row.push(cell.trim()); if (row.some(Boolean)) rows.push(row);
  return rows;
}

async function saveMetrics() {
  let rows;
  if ($('#metric-mode').value === 'single') {
    rows = [{ contentId: $('#metric-content').value, snapshot: $('#metric-snapshot').value, impressions: $('#metric-impressions').value, views: $('#metric-views').value, watchRate: $('#metric-watch').value, engagements: $('#metric-engagements').value, clicks: $('#metric-clicks').value }];
  } else {
    const file = $('#metric-csv').files[0];
    if (!file) throw new Error('请先选择平台 CSV 文件');
    const parsed = parseCsv(await file.text());
    if (parsed.length < 2) throw new Error('CSV 中没有可导入的数据');
    const headers = parsed[0].map(header => header.toLowerCase());
    const value = (row, names) => { const index = names.map(name => headers.indexOf(name.toLowerCase())).find(i => i >= 0); return index === undefined ? '' : row[index]; };
    rows = parsed.slice(1).map(row => ({ contentId: value(row, ['content_id', 'content id', '内容id', 'id']), snapshot: value(row, ['snapshot', '取数时间']) || $('#metric-snapshot').value, impressions: value(row, ['impressions', '曝光']), views: value(row, ['views', '播放']), watchRate: value(row, ['watch_rate', '完播率']), engagements: value(row, ['engagements', '互动数']), clicks: value(row, ['clicks', '点击数']) }));
  }
  const result = await api('/api/metrics', { method: 'POST', body: JSON.stringify({ rows, sourceName: $('#metric-source').value, sourceDate: $('#metric-source-date').value }) });
  closeDrawer();
  await reloadState();
  renderAnalytics('all', rows[0]?.contentId || '');
  toast(`已导入 ${result.matched} 条数据`);
}

async function generateInsight() {
  await api('/api/insights/generate', { method: 'POST', body: '{}' });
  await reloadState();
  toast('已从真实 T+7 快照生成带证据建议');
}

async function adoptInsight(insightId) {
  await api('/api/insights/adopt', { method: 'POST', body: JSON.stringify({ insightId }) });
  await reloadState();
  showView('ideas');
  toast('已生成下轮选题草稿，并回链证据');
}

function openDrawer(kind, recordId = '') {
  const drawer = $('#drawer');
  const title = $('#drawer-title');
  const copy = $('#drawer-copy');
  const body = $('#drawer-body');
  let html = '';
  if (kind === 'task-drawer') { const task = (state.actionTasks || []).find(item => item.id === recordId && !item.deletedAt); title.textContent = task ? '编辑行动任务' : '新建行动任务'; copy.textContent = '任务将同步到首页行动队列。'; html = `<div class="form-grid"><input id="action-id" type="hidden" value="${escapeHtml(task?.id || '')}" /><div class="field"><label>任务名称</label><input id="action-title" value="${escapeHtml(task?.title || '')}" /></div><div class="field"><label>负责人</label><select id="action-owner"><option ${task?.owner === '王子進' ? 'selected' : ''}>王子進</option><option ${task?.owner === '内容组' ? 'selected' : ''}>内容组</option></select></div><div class="field"><label>截止日期</label><input id="action-due" type="date" value="${escapeHtml(task?.dueDate || '2026-11-20')}" /></div><div class="field"><label>优先级</label><select id="action-priority">${['高','中','低'].map(value => `<option ${task?.priority === value ? 'selected' : ''}>${value}</option>`).join('')}</select></div><div class="field"><label>状态</label><select id="action-status">${['待处理','进行中','需要人工','已完成'].map(value => `<option ${task?.status === value ? 'selected' : ''}>${value}</option>`).join('')}</select></div><div class="field full"><label>业务说明</label><textarea id="action-description">${escapeHtml(task?.description || '')}</textarea></div></div><div class="row" style="display:flex;justify-content:${task ? 'space-between' : 'flex-end'};gap:8px;margin-top:16px">${task ? `<button class="btn danger" data-delete-action="${escapeHtml(task.id)}" data-delete-title="${escapeHtml(task.title)}">删除任务</button>` : ''}<button class="btn primary" data-save-action>保存行动任务</button></div>`; }
  if (kind === 'account-drawer') { const account = (state.accounts || []).find(item => item.id === recordId) || state.accounts?.[0]; if (!account) { toast('暂无账号记录', true); return; } title.textContent = `账号管理 · ${account.platform}`; copy.textContent = '账号状态只影响发布准备，不属于生产路线。'; html = `<div class="form-grid"><input id="account-id" type="hidden" value="${escapeHtml(account.id)}" /><div class="field"><label>平台</label><input value="${escapeHtml(account.platform)}" readonly /></div><div class="field"><label>账号</label><input value="${escapeHtml(account.accountName)}" readonly /></div><div class="field"><label>状态</label><select id="account-status">${['已连接','待完善','待注册','待验证','暂停使用'].map(value => `<option ${account.status === value ? 'selected' : ''}>${value}</option>`).join('')}</select></div><div class="field"><label>负责人</label><select id="account-owner"><option ${account.owner === '王子進' ? 'selected' : ''}>王子進</option><option ${account.owner === '内容组' ? 'selected' : ''}>内容组</option></select></div><div class="field full"><label>备注</label><textarea id="account-notes">${escapeHtml(account.notes || '')}</textarea></div></div><div class="row" style="display:flex;justify-content:flex-end;margin-top:16px"><button class="btn primary" data-save-account>保存账号状态</button></div>`; }
  if (kind === 'adapt-drawer') { const item = (state.platformVersions || []).find(version => version.id === recordId); title.textContent = item ? '编辑平台内容版本' : '平台内容设计'; copy.textContent = '完整保存标题、正文、标签、CTA、语言、时长和封面要求。'; html = `<div class="form-grid"><input id="adapt-version-id" type="hidden" value="${escapeHtml(item?.id || '')}" /><div class="field"><label>Content ID</label><input id="adapt-content-id" value="${escapeHtml(item?.contentId || 'RZ-009')}" /></div><div class="field"><label>平台</label><select id="adapt-platform">${['Facebook','Instagram','Pinterest','小红书','YouTube'].map(value => `<option ${item?.platform === value ? 'selected' : ''}>${value}</option>`).join('')}</select></div><div class="field"><label>内容形式</label><select id="adapt-format">${['短视频','图文','长视频','Idea Pin'].map(value => `<option ${item?.format === value ? 'selected' : ''}>${value}</option>`).join('')}</select></div><div class="field"><label>画幅</label><select id="adapt-ratio">${['9:16','3:4','2:3','16:9'].map(value => `<option ${item?.ratio === value ? 'selected' : ''}>${value}</option>`).join('')}</select></div><div class="field"><label>时长</label><input id="adapt-duration" value="${escapeHtml(item?.duration || '30 秒')}" /></div><div class="field"><label>语言</label><input id="adapt-language" value="${escapeHtml(item?.language || '中文')}" /></div><div class="field full"><label>标题</label><input id="adapt-title" value="${escapeHtml(item?.title || state.idea?.card || '')}" /></div><div class="field full"><label>正文</label><textarea id="adapt-body">${escapeHtml(item?.body || state.idea?.value || '')}</textarea></div><div class="field full"><label>标签</label><input id="adapt-tags" value="${escapeHtml(item?.tags || '#窗帘量尺 #安特卫普家居')}" /></div><div class="field full"><label>CTA</label><input id="adapt-cta" value="${escapeHtml(item?.cta || '通过 WhatsApp 咨询')}" /></div><div class="field full"><label>封面要求</label><textarea id="adapt-cover">${escapeHtml(item?.coverRequirement || '首帧直接展示结果，文字完整可读。')}</textarea></div><div class="field full"><label>平台版表达</label><textarea id="adapt-expression">${escapeHtml(item?.expression || '前三秒展示量尺错误导致的遮光缝隙，再给出三个测量点。')}</textarea></div></div><div class="row" style="display:flex;justify-content:flex-end;margin-top:16px"><button class="btn primary" data-save-platform>保存平台版本</button></div>`; }
  if (kind === 'script-drawer') { const platformVersion = (state.platformVersions || []).find(item => item.id === recordId) || [...(state.platformVersions || [])].reverse()[0]; const review = (state.reviews || []).find(item => item.platformVersionId === platformVersion?.id) || (state.reviews || []).find(item => item.contentId === platformVersion?.contentId); title.textContent = '脚本 / 分镜人工定稿'; copy.textContent = platformVersion ? `${platformVersion.platform} · ${platformVersion.title}` : '请先保存平台内容版本，再进行人工定稿。'; html = `<div class="form-grid"><input id="review-platform-version-id" type="hidden" value="${escapeHtml(platformVersion?.id || '')}" /><div class="field"><label>Content ID</label><input id="review-content-id" value="${escapeHtml(platformVersion?.contentId || 'RZ-009')}" readonly /></div><div class="field"><label>平台</label><input id="review-platform" value="${escapeHtml(platformVersion?.platform || '')}" readonly /></div><div class="field"><label>定稿版本</label><input id="review-version" value="${escapeHtml(review?.version || 'v1.0')}" /></div><div class="field"><label>审核人</label><select id="reviewer"><option>社媒运营负责人</option><option>业务负责人</option></select></div><div class="field full"><label>脚本</label><textarea id="review-script">${escapeHtml(review?.script || platformVersion?.body || '')}</textarea></div><div class="field full"><label>分镜</label><textarea id="review-storyboard">${escapeHtml(review?.storyboard || platformVersion?.expression || '')}</textarea></div><div class="field full"><label>字幕文案</label><textarea id="review-subtitles">${escapeHtml(review?.subtitles || platformVersion?.body || '')}</textarea></div><div class="field full"><label>封面文案</label><textarea id="review-cover-copy">${escapeHtml(review?.coverCopy || platformVersion?.coverRequirement || '')}</textarea></div></div><div class="row" style="display:flex;justify-content:flex-end;margin-top:16px"><button class="btn primary" data-approve-review>确认并冻结版本</button></div>`; }
  if (kind === 'production-drawer') { const review = [...(state.reviews || [])].reverse().find(item => item.status === 'APPROVED'); const platformVersion = (state.platformVersions || []).find(item => item.id === review?.platformVersionId); title.textContent = '创建生产工单'; copy.textContent = '只允许即梦路线或纯代码路线；工作台不执行制作。'; html = `<div class="form-grid"><div class="field"><label>Content ID</label><input id="production-id" value="${escapeHtml(review?.contentId || 'RZ-009')}" /></div><div class="field"><label>内容标题</label><input id="production-title" value="${escapeHtml(platformVersion?.title || '量尺安装真实案例')}" /></div><div class="field"><label>生产路线</label><select id="production-route"><option>即梦路线</option><option>纯代码路线</option></select></div><div class="field"><label>负责人</label><select id="production-owner"><option>王子進</option><option>内容组</option></select></div><div class="field"><label>目标画幅</label><select id="production-ratio">${['9:16','3:4','2:3','16:9'].map(value => `<option ${platformVersion?.ratio === value ? 'selected' : ''}>${value}</option>`).join('')}</select></div><div class="field"><label>交付日期</label><input id="production-due" type="date" value="2026-11-20" /></div><div class="field full"><label>交付清单</label><textarea id="production-checklist">成片、封面、字幕、平台文案、标题和标签；全部关联同一 Content ID。</textarea></div></div><div class="row" style="display:flex;justify-content:flex-end;margin-top:16px"><button class="btn primary" data-save-production>创建生产工单</button></div>`; }
  if (kind === 'production-status-drawer') { const task = (state.productionTasks || []).find(item => item.id === recordId); if (!task) { toast('未找到生产工单', true); return; } title.textContent = `管理工单 · ${task.contentId}`; copy.textContent = '更新外部制作进度或记录受阻原因。'; html = `<div class="form-grid"><input id="production-task-id" type="hidden" value="${escapeHtml(task.id)}" /><div class="field"><label>生产路线</label><input value="${escapeHtml(task.route)}" readonly /></div><div class="field"><label>负责人</label><input value="${escapeHtml(task.owner)}" readonly /></div><div class="field"><label>工单状态</label><select id="production-task-status">${['待开始','制作中','生产受阻','待验收','修改中','已取消'].map(value => `<option ${task.status === value ? 'selected' : ''}>${value}</option>`).join('')}</select></div><div class="field full"><label>卡点 / 进展说明</label><textarea id="production-blocker">${escapeHtml(task.blocker || '')}</textarea></div></div><div class="row" style="display:flex;justify-content:flex-end;margin-top:16px"><button class="btn primary" data-update-production>保存工单状态</button></div>`; }
  if (kind === 'delivery-drawer') { const task = [...(state.productionTasks || [])].reverse().find(item => item.contentId === recordId) || state.productionTasks?.[0]; if (!task) { toast('请先创建生产工单', true); return; } const versions = (state.deliveries || []).filter(item => item.contentId === task.contentId); title.textContent = '登记外部生产结果'; copy.textContent = '保存方式二选一：登记外部链接，或上传到工作台本地。'; html = `<div class="form-grid"><div class="field"><label>Content ID</label><input id="delivery-content-id" value="${escapeHtml(task.contentId)}" readonly /></div><div class="field"><label>生产路线</label><input value="${escapeHtml(task.route)}" readonly /></div><div class="field"><label>素材类型</label><select id="delivery-asset-type"><option>成片</option><option>封面</option><option>字幕</option><option>文案</option><option>其他</option></select></div><div class="field"><label>素材版本</label><input id="delivery-version" value="v${versions.length + 1}.0" /></div><div class="field full"><label>保存方式</label><select id="delivery-storage-mode"><option value="external">登记外部文件链接</option><option value="local">上传到工作台本地</option></select></div><div class="field full delivery-external"><label>外部文件链接</label><input id="delivery-url" placeholder="共享盘、网盘或文件服务器链接" /></div><div class="field full delivery-local" style="display:none"><label>本地文件（最大 500MB）</label><input id="delivery-file" type="file" accept="video/*,image/*,.srt,.vtt,.txt,.pdf,.doc,.docx" /></div><div class="field full"><label>交付说明</label><textarea id="delivery-notes">外部制作结果已交回，并关联同一 Content ID。</textarea></div></div><div class="row" style="display:flex;justify-content:flex-end;margin-top:16px"><button class="btn primary" data-save-delivery>保存并进入待验收</button></div>`; }
  if (kind === 'delivery-review-drawer') { const delivery = (state.deliveries || []).find(item => item.id === recordId); if (!delivery) { toast('未找到待验收交付', true); return; } title.textContent = `验收交付 · ${delivery.contentId} ${delivery.version}`; copy.textContent = '验收通过后才能进入发布；退回修改会保留本版本记录。'; html = `<div class="form-grid"><input id="delivery-review-id" type="hidden" value="${escapeHtml(delivery.id)}" /><div class="field"><label>外部文件</label><input value="${escapeHtml(delivery.fileUrl)}" readonly /></div><div class="field"><label>生产路线</label><input value="${escapeHtml(delivery.route)}" readonly /></div><div class="field"><label>验收结论</label><select id="delivery-decision"><option>已验收</option><option>退回修改</option></select></div><div class="field"><label>验收人</label><select id="delivery-reviewer"><option>社媒运营负责人</option><option>业务负责人</option></select></div><div class="field full"><label>验收意见</label><textarea id="delivery-review-notes">画面、字幕、封面、文案和链接均已检查。</textarea></div></div><div class="row" style="display:flex;justify-content:flex-end;margin-top:16px"><button class="btn primary" data-review-delivery>提交验收结论</button></div>`; }
  if (kind === 'publish-drawer') { const chosen = contentLedger.find(item => item.id === recordId) || contentLedger[0]; title.textContent = recordId ? '更新发布状态' : '安排发布'; copy.textContent = '只有已验收素材才能进入待发布或已发布。'; html = `<div class="form-grid"><div class="field full"><label>内容任务</label><select id="publish-content">${contentLedger.map(item => `<option value="${escapeHtml(item.id)}" ${item.id === chosen.id ? 'selected' : ''}>${escapeHtml(item.id)} · ${escapeHtml(item.title)} · ${escapeHtml(item.assetStatus)}</option>`).join('')}</select></div><div class="field"><label>发布平台</label><select id="publish-platform">${[...platformOrder, 'TikTok'].map(name => `<option ${name === chosen.platform ? 'selected' : ''}>${escapeHtml(name)}</option>`).join('')}</select></div><div class="field"><label>发布状态</label><select id="publish-status">${['待发布', '已发布', '卡在账号', '卡在素材', '发布失败'].map(status => `<option ${status === chosen.status ? 'selected' : ''}>${status}</option>`).join('')}</select></div><div class="field"><label>计划 / 实际发布日期</label><input id="publish-date" type="date" value="${escapeHtml(chosen.dateValue || '2026-11-20')}" /></div><div class="field full"><label>发布后的平台链接</label><input id="publish-url" value="${escapeHtml(chosen.platformUrl || '')}" /></div><div class="field full"><label>卡点或备注</label><textarea id="publish-blocker">${escapeHtml(chosen.blocker || '')}</textarea></div></div><div class="row" style="display:flex;justify-content:flex-end;margin-top:16px"><button class="btn primary" data-save-publish>保存到发布台账</button></div>`; }
  if (kind === 'metrics-drawer') { const published = contentLedger.filter(item => item.status === '已发布'); const chosen = published[0] || contentLedger[0]; title.textContent = '导入发布数据'; copy.textContent = '每次导入必须登记真实来源和来源日期，CSV 按 Content ID 匹配。'; html = `<div class="form-grid"><div class="field full"><label>导入方式</label><select id="metric-mode"><option value="single">手动录入单条内容</option><option value="batch">上传平台 CSV 批量导入</option></select></div><div class="field"><label>数据来源</label><input id="metric-source" value="平台官方后台导出" /></div><div class="field"><label>来源日期</label><input id="metric-source-date" type="date" value="2026-11-16" /></div><div class="field full metric-single"><label>已发布内容</label><select id="metric-content">${published.map(item => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.id)} · ${escapeHtml(item.platform)} · ${escapeHtml(item.title)}</option>`).join('')}</select></div><div class="field metric-batch" style="display:none"><label>平台 CSV</label><input id="metric-csv" type="file" accept=".csv" /></div><div class="field"><label>取数时间</label><select id="metric-snapshot"><option>T+1</option><option selected>T+7</option><option>T+30</option></select></div><div class="field metric-single"><label>曝光</label><input id="metric-impressions" type="number" value="${chosen?.metrics.impressions || 0}" /></div><div class="field metric-single"><label>播放</label><input id="metric-views" type="number" value="${chosen?.metrics.views || 0}" /></div><div class="field metric-single"><label>完播率 %</label><input id="metric-watch" type="number" value="${chosen?.metrics.watchRate || 0}" /></div><div class="field metric-single"><label>互动数</label><input id="metric-engagements" type="number" value="${chosen?.metrics.engagements || 0}" /></div><div class="field metric-single"><label>点击数</label><input id="metric-clicks" type="number" value="${chosen?.metrics.clicks || 0}" /></div></div><div class="row" style="display:flex;justify-content:flex-end;margin-top:16px"><button class="btn primary" data-save-metrics>保存并进入复盘</button></div>`; }
  body.innerHTML = html;
  drawer.classList.add('open');
  $('[data-save-action]')?.addEventListener('click', () => run(saveActionTask));
  $('[data-delete-action]')?.addEventListener('click', event => run(() => deleteActionTask(event.currentTarget.dataset.deleteAction, event.currentTarget.dataset.deleteTitle)));
  $('[data-save-account]')?.addEventListener('click', () => run(saveAccount));
  $('[data-save-platform]')?.addEventListener('click', () => run(savePlatformVersion));
  $('[data-approve-review]')?.addEventListener('click', () => run(approveReview));
  $('[data-save-production]')?.addEventListener('click', () => run(saveProduction));
  $('[data-update-production]')?.addEventListener('click', () => run(updateProductionStatus));
  $('[data-save-delivery]')?.addEventListener('click', () => run(saveDelivery));
  $('[data-review-delivery]')?.addEventListener('click', () => run(reviewDelivery));
  $('[data-save-publish]')?.addEventListener('click', () => run(savePublish));
  $('[data-save-metrics]')?.addEventListener('click', () => run(saveMetrics));
  $('#metric-mode')?.addEventListener('change', event => { const batch = event.target.value === 'batch'; $$('.metric-single').forEach(item => item.style.display = batch ? 'none' : 'grid'); $$('.metric-batch').forEach(item => item.style.display = batch ? 'grid' : 'none'); });
  $('#delivery-storage-mode')?.addEventListener('change', event => {
    const local = event.target.value === 'local';
    $$('.delivery-external').forEach(item => item.style.display = local ? 'none' : 'grid');
    $$('.delivery-local').forEach(item => item.style.display = local ? 'grid' : 'none');
  });
}

async function run(action) {
  try { await action(); }
  catch (error) { toast(error.message, true); }
}

async function init() {
  $$('.nav-btn,.flow-item,[data-view]').forEach(element => element.addEventListener('click', () => { if (element.dataset.view) showView(element.dataset.view); }));
  $$('[data-open]').forEach(element => element.addEventListener('click', () => openDrawer(element.dataset.open)));
  $('#drawer-close').addEventListener('click', closeDrawer);
  $('#drawer').addEventListener('click', event => { if (event.target.id === 'drawer') closeDrawer(); });
  $('#actor-select').addEventListener('change', event => { currentActorId = event.target.value; localStorage.setItem('workbenchActorId', currentActorId); renderActorBar(); toast('当前操作者已切换'); });
  $('#btn-audit').addEventListener('click', () => run(openAuditDrawer));
  $('#btn-export').addEventListener('click', () => run(exportBackup));
  $('#btn-new-task').addEventListener('click', () => openDrawer('task-drawer'));
  $('#btn-reorder-tasks').addEventListener('click', openQueueDrawer);
  $('#btn-plan').addEventListener('click', () => window.open('docs/开发方案_社媒Agent工作台.html', '_blank'));
  $('#btn-radar').addEventListener('click', () => window.open('https://intelligence.royalzenliving.com/', '_blank', 'noopener'));
  $('#btn-save-idea').addEventListener('click', () => run(saveIdea));
  $('#btn-create-pack').addEventListener('click', () => openDrawer('adapt-drawer'));
  $('#btn-approve-script').addEventListener('click', () => openDrawer('script-drawer'));
  $('#btn-analyse').addEventListener('click', () => run(generateInsight));
  $('#ledger-search').addEventListener('input', event => { ledgerQuery = event.target.value; ledgerExpanded = false; renderPublishing(); });
  $('#ledger-toggle').addEventListener('click', () => { ledgerExpanded = !ledgerExpanded; renderPublishing(); });
  $('#analytics-search').addEventListener('input', event => { analyticsQuery = event.target.value; analyticsExpanded = false; renderAnalytics(currentAnalyticsPlatform, ''); });
  $('#analytics-toggle').addEventListener('click', () => { analyticsExpanded = !analyticsExpanded; renderAnalytics(currentAnalyticsPlatform, ''); });
  $$('.filter').forEach(filter => filter.addEventListener('click', () => { $$('.filter').forEach(item => item.classList.remove('active')); filter.classList.add('active'); const type = filter.dataset.filter; $$('#platform-table .content-row').forEach(row => row.style.display = type === 'all' || row.dataset.type === type ? 'grid' : 'none'); }));
  const initialView = location.hash.slice(1) || new URLSearchParams(location.search).get('view');
  showView(initialView && viewMeta[initialView] ? initialView : 'overview');
  await reloadState();
}

document.addEventListener('DOMContentLoaded', () => run(init));
