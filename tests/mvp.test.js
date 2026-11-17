const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'social-workbench-'));
process.env.WORKBENCH_DATA_FILE = path.join(tempDir, 'store.json');
const { createServer } = require('../server');

let server;
let base;
let productionTaskId;
let platformVersionId;

test.before(async () => {
  server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  await new Promise(resolve => server.close(resolve));
  fs.rmSync(tempDir, { recursive: true, force: true });
});

async function request(pathname, body, actorId = 'USR-OPS') {
  const actorHeaders = actorId ? { 'X-Actor-Id': actorId } : {};
  const response = await fetch(`${base}${pathname}`, body === undefined ? { headers: actorHeaders } : {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...actorHeaders },
    body: JSON.stringify(body)
  });
  return { status: response.status, body: await response.json() };
}

test('health endpoint is available', async () => {
  const result = await request('/api/health');
  assert.equal(result.status, 200);
  assert.equal(result.body.ok, true);
});

test('mutations require a known participant without inventing role levels', async () => {
  const missingActor = await request('/api/action-tasks', {
    title: '不应保存', description: '缺少操作者测试', owner: '内容组', dueDate: '2026-11-25', priority: '低', status: '待处理'
  }, null);
  assert.equal(missingActor.status, 401);
  const businessReview = await request('/api/reviews/approve', {
    contentId: 'RZ-PARTICIPANT', version: 'v1.0', reviewer: '业务负责人', script: '脚本', storyboard: '分镜', subtitles: '字幕', coverCopy: '封面'
  }, 'USR-BIZ');
  assert.equal(businessReview.status, 200);
});

test('idea and platform content package persist all fields required by the plan', async () => {
  const idea = await request('/api/ideas', {
    topic: '量尺内容', source: '人工补充素材', problem: '不会量尺', value: '展示三个测量点', targetPlatforms: 'Facebook、YouTube', validationVariable: 'T+7 互动率', card: '三个测量点'
  });
  assert.equal(idea.status, 200);
  assert.equal(idea.body.idea.validationVariable, 'T+7 互动率');
  const version = await request('/api/platform-versions', {
    contentId: 'RZ-TEST-001', platform: 'YouTube', format: '长视频', ratio: '16:9', duration: '3 分钟', title: '量尺的三个测量点', body: '完整正文', tags: '#量尺 #窗帘', cta: 'WhatsApp 咨询', language: '中文', coverRequirement: '结果型封面', expression: '先展示错误，再解释方法'
  });
  assert.equal(version.status, 201);
  platformVersionId = version.body.version.id;
  assert.equal(version.body.version.cta, 'WhatsApp 咨询');
});

test('action queue and account readiness are persisted', async () => {
  const task = await request('/api/action-tasks', {
    title: '二期任务测试', description: '验证首页行动队列持久化', owner: '内容组', dueDate: '2026-11-25', priority: '中', status: '进行中'
  });
  assert.equal(task.status, 201);
  const account = await request('/api/accounts', {
    id: 'ACC-YOUTUBE', status: '待完善', owner: '王子進', notes: '频道已经建立，待完善资料'
  });
  assert.equal(account.status, 200);
  const current = await request('/api/state');
  assert.ok(current.body.state.actionTasks.some(item => item.title === '二期任务测试'));
  assert.equal(current.body.state.accounts.find(item => item.id === 'ACC-YOUTUBE').status, '待完善');
});

test('action tasks are soft-deleted with operator trace', async () => {
  const before = await request('/api/state');
  const task = before.body.state.actionTasks.find(item => item.title === '二期任务测试');
  const removed = await request('/api/action-tasks/delete', { taskId: task.id }, 'USR-BIZ');
  assert.equal(removed.status, 200);
  assert.ok(removed.body.task.deletedAt);
  assert.equal(removed.body.task.deletedBy, '业务负责人');
  const after = await request('/api/state');
  assert.ok(after.body.state.actionTasks.find(item => item.id === task.id).deletedAt);
});

test('action queue order can be changed and persists', async () => {
  const before = await request('/api/state');
  const ordered = [...before.body.state.actionTasks].filter(task => !task.deletedAt).sort((a, b) => a.sortOrder - b.sortOrder).map(task => task.id).reverse();
  const changed = await request('/api/action-tasks/reorder', { orderedIds: ordered });
  assert.equal(changed.status, 200);
  assert.deepEqual(changed.body.actionTasks.map(task => task.id), ordered);
  const after = await request('/api/state');
  assert.deepEqual([...after.body.state.actionTasks].filter(task => !task.deletedAt).sort((a, b) => a.sortOrder - b.sortOrder).map(task => task.id), ordered);
});

test('production task is blocked before human approval', async () => {
  const result = await request('/api/production-tasks', {
    contentId: 'RZ-TEST-001', title: '门禁测试', route: '即梦路线', owner: '内容组', ratio: '9:16', dueDate: '2026-11-20', checklist: '成片、封面、字幕、文案'
  });
  assert.equal(result.status, 409);
  assert.match(result.body.error, /尚未人工定稿/);
});

test('only the two confirmed production routes are accepted', async () => {
  await request('/api/reviews/approve', {
    contentId: 'RZ-TEST-001', platformVersionId, platform: 'YouTube', version: 'v1.0', reviewer: '业务负责人', script: '已定稿脚本', storyboard: '已定稿分镜', subtitles: '已定稿字幕', coverCopy: '已定稿封面'
  });
  const invalid = await request('/api/production-tasks', {
    contentId: 'RZ-TEST-001', title: '路线测试', route: '人工剪辑路线', owner: '内容组', ratio: '9:16', dueDate: '2026-11-20', checklist: '成片'
  });
  assert.equal(invalid.status, 400);
  const valid = await request('/api/production-tasks', {
    contentId: 'RZ-TEST-001', title: '路线测试', route: '纯代码路线', owner: '内容组', ratio: '16:9', dueDate: '2026-11-20', checklist: '成片、封面、字幕、文案'
  });
  assert.equal(valid.status, 201);
  assert.equal(valid.body.task.route, '纯代码路线');
  productionTaskId = valid.body.task.id;
  const progress = await request('/api/production-tasks/status', { taskId: productionTaskId, status: '制作中', blocker: '外部制作已开始' });
  assert.equal(progress.status, 200);
  assert.equal(progress.body.task.status, '制作中');
});

test('assets support external links and local uploads as exclusive storage modes', async () => {
  const external = await request('/api/assets', { contentId: 'RZ-TEST-001', type: '封面', version: 'v1.0', url: 'https://files.example.com/cover.png' });
  assert.equal(external.status, 201);
  assert.equal(external.body.asset.storageMode, 'external');
  const bytes = Buffer.from('local asset test');
  const uploadedResponse = await fetch(`${base}/api/assets/upload`, {
    method: 'POST',
    headers: { 'X-Actor-Id': 'USR-OPS', 'X-Content-Id': encodeURIComponent('RZ-TEST-001'), 'X-Asset-Type': encodeURIComponent('字幕'), 'X-Asset-Version': encodeURIComponent('v1.0'), 'X-File-Name': encodeURIComponent('subtitle.txt'), 'Content-Type': 'text/plain' },
    body: bytes
  });
  assert.equal(uploadedResponse.status, 201);
  const uploaded = await uploadedResponse.json();
  assert.equal(uploaded.asset.storageMode, 'local');
  const downloaded = await fetch(`${base}${uploaded.asset.url}`);
  assert.equal(downloaded.status, 200);
  assert.equal(await downloaded.text(), 'local asset test');
});

test('delivery versions preserve rejection and require acceptance before publish', async () => {
  const first = await request('/api/deliveries', {
    contentId: 'RZ-TEST-001', version: 'v1.0', fileUrl: 'https://files.example.com/test.mp4', notes: '等待验收'
  });
  assert.equal(first.body.delivery.acceptanceStatus, '待验收');
  const blocked = await request('/api/publications', {
    contentId: 'RZ-TEST-001', platform: 'YouTube', status: '待发布', date: '2026-11-21', dateLabel: '11 月 21 日'
  });
  assert.equal(blocked.status, 409);
  const rejected = await request('/api/deliveries/review', {
    deliveryId: first.body.delivery.id, decision: '退回修改', reviewNotes: '字幕需要修改', reviewedBy: '业务负责人'
  });
  assert.equal(rejected.body.task.status, '修改中');
  const second = await request('/api/deliveries', {
    contentId: 'RZ-TEST-001', version: 'v1.1', fileUrl: 'https://files.example.com/test-v1.1.mp4', notes: '已修改字幕'
  });
  const accepted = await request('/api/deliveries/review', {
    deliveryId: second.body.delivery.id, decision: '已验收', reviewNotes: '画面、字幕、封面均通过', reviewedBy: '业务负责人'
  });
  assert.equal(accepted.body.task.status, '已验收');
  const rollback = await request('/api/production-tasks/status', { taskId: productionTaskId, status: '制作中', blocker: '不应允许回退' });
  assert.equal(rollback.status, 409);
  const published = await request('/api/publications', {
    contentId: 'RZ-TEST-001', platform: 'YouTube', status: '已发布', date: '2026-11-21', dateLabel: '11 月 21 日', platformUrl: 'https://youtube.example/video'
  });
  assert.equal(published.status, 200);
  assert.equal(published.body.content.status, '已发布');
  assert.match(published.body.publication.id, /^PUB-/);
});

test('metrics are persisted only against published content', async () => {
  const result = await request('/api/metrics', {
    sourceName: 'YouTube Studio 导出',
    sourceDate: '2026-11-28',
    rows: [{ contentId: 'RZ-TEST-001', snapshot: 'T+7', impressions: 1000, views: 800, watchRate: 42, engagements: 50, clicks: 12 }]
  });
  assert.equal(result.status, 200);
  const state = await request('/api/state');
  const item = state.body.state.contentLedger.find(row => row.id === 'RZ-TEST-001');
  assert.equal(item.snapshot, 'T+7');
  assert.equal(item.metrics.impressions, 1000);
  assert.ok(state.body.state.metricSnapshots.some(row => row.contentId === 'RZ-TEST-001' && row.sourceName === 'YouTube Studio 导出'));
  assert.ok(state.body.state.publicationRecords.some(row => row.contentId === 'RZ-TEST-001'));
});

test('rule-based insight contains source, sample, baseline and numbers before adoption', async () => {
  const generated = await request('/api/insights/generate', {});
  assert.equal(generated.status, 201);
  const insight = generated.body.insight;
  assert.ok(insight.source);
  assert.ok(insight.sampleContentIds.length >= 2);
  assert.ok(insight.baseline);
  assert.ok(insight.numbers);
  const adopted = await request('/api/insights/adopt', { insightId: insight.id });
  assert.equal(adopted.status, 200);
  assert.equal(adopted.body.adoptedInsight.insightId, insight.id);
});

test('operation log records mutations and known participants can export a backup', async () => {
  const audit = await request('/api/audit');
  assert.equal(audit.status, 200);
  assert.ok(audit.body.auditLog.length >= 8);
  assert.ok(audit.body.auditLog.some(item => item.entityType === 'Delivery' && item.action === 'review'));
  assert.ok(audit.body.auditLog.every(item => !('role' in item)));
  const exported = await request('/api/export', undefined, 'USR-BIZ');
  assert.equal(exported.status, 200);
  assert.ok(Array.isArray(exported.body.auditLog));
  assert.ok(Array.isArray(exported.body.contentLedger));
  assert.ok(Array.isArray(exported.body.participants));
  assert.ok(Array.isArray(exported.body.assets));
});
