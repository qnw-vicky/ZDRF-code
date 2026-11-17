const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const ROOT = __dirname;
const DEFAULT_DATA_FILE = path.join(ROOT, 'data', 'store.json');
const SEED_FILE = path.join(ROOT, 'data', 'seed.json');
const PORT = Number(process.env.PORT || 8899);
const MAX_UPLOAD_BYTES = 500 * 1024 * 1024;
const ALLOWED_ASSET_EXTENSIONS = new Set(['.mp4', '.mov', '.webm', '.png', '.jpg', '.jpeg', '.webp', '.gif', '.srt', '.vtt', '.txt', '.pdf', '.doc', '.docx']);
const ALLOWED_ROUTES = new Set(['即梦路线', '纯代码路线']);
const ALLOWED_TASK_STATUS = new Set(['待开始', '制作中', '生产受阻', '待验收', '修改中', '已验收', '已取消']);
const ALLOWED_DELIVERY_REVIEW = new Set(['已验收', '退回修改']);
const ALLOWED_PUBLICATION_STATUS = new Set(['待发布', '已发布', '卡在账号', '卡在素材', '发布失败']);
const ALLOWED_SNAPSHOTS = new Set(['T+1', 'T+7', 'T+30']);
const AUDITED_MUTATIONS = new Set([
  '/api/action-tasks', '/api/action-tasks/reorder', '/api/action-tasks/delete', '/api/accounts', '/api/ideas', '/api/reviews/approve',
  '/api/platform-versions', '/api/production-tasks', '/api/production-tasks/status',
  '/api/assets', '/api/deliveries', '/api/deliveries/review', '/api/publications', '/api/metrics',
  '/api/insights/generate', '/api/insights/adopt'
]);

function dataFile() {
  return process.env.WORKBENCH_DATA_FILE || DEFAULT_DATA_FILE;
}

function ensureStore() {
  const file = dataFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (!fs.existsSync(file)) fs.copyFileSync(SEED_FILE, file);
  return file;
}

function loadStore() {
  const store = JSON.parse(fs.readFileSync(ensureStore(), 'utf8'));
  const seed = JSON.parse(fs.readFileSync(SEED_FILE, 'utf8'));
  let migrated = false;
  if (store.meta?.version !== seed.meta.version) migrated = true;
  store.meta = { ...(store.meta || {}), version: seed.meta.version };
  for (const key of ['participants', 'auditLog', 'accounts', 'actionTasks', 'platformVersions', 'reviews', 'productionTasks', 'assets', 'deliveries', 'publicationRecords', 'metricSnapshots', 'importBatches', 'insights', 'contentLedger']) {
    if (!Array.isArray(store[key])) {
      store[key] = seed[key] || [];
      migrated = true;
    }
  }
  if ('users' in store) {
    delete store.users;
    migrated = true;
  }
  if (store.auditLog.some(entry => 'role' in entry)) {
    store.auditLog = store.auditLog.map(({ role, ...entry }) => entry);
    migrated = true;
  }
  store.actionTasks.forEach((task, index) => {
    if (!Number.isInteger(task.sortOrder)) {
      task.sortOrder = index;
      migrated = true;
    }
  });
  if (migrated) saveStore(store);
  return store;
}

function saveStore(store) {
  store.meta.updatedAt = new Date().toISOString();
  const file = ensureStore();
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', chunk => {
      raw += chunk;
      if (raw.length > 2_000_000) reject(new Error('请求体过大'));
    });
    req.on('end', () => {
      try { resolve(raw ? JSON.parse(raw) : {}); }
      catch { reject(new Error('JSON 格式错误')); }
    });
    req.on('error', reject);
  });
}

function required(value, name) {
  const text = String(value || '').trim();
  if (!text) throw Object.assign(new Error(`缺少${name}`), { status: 400 });
  return text;
}

function externalUrl(value) {
  const text = required(value, '外部文件链接');
  try {
    const parsed = new URL(text);
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error();
  } catch {
    throw Object.assign(new Error('外部文件链接必须是 http 或 https 地址'), { status: 400 });
  }
  return text;
}

function findLedger(store, id) {
  return store.contentLedger.find(item => item.id === id);
}

function requireActor(req, store) {
  const actorId = String(req.headers['x-actor-id'] || '').trim();
  const actor = store.participants.find(person => person.id === actorId && person.active !== false);
  if (!actor) throw Object.assign(new Error('未选择有效操作者'), { status: 401 });
  return actor;
}

function uploadRoot() {
  return path.join(path.dirname(dataFile()), 'uploads');
}

function safeSegment(value, fallback = 'file') {
  const cleaned = String(value || '').normalize('NFKC').replace(/[^\p{L}\p{N}._-]+/gu, '_').replace(/^\.+/, '');
  return cleaned || fallback;
}

function assetDownload(res, store, assetId) {
  const asset = store.assets.find(item => item.id === assetId && item.storageMode === 'local');
  if (!asset) return json(res, 404, { ok: false, error: '未找到本地素材' });
  const root = path.resolve(uploadRoot());
  const full = path.resolve(path.dirname(dataFile()), asset.storedPath);
  if (!full.startsWith(root + path.sep) || !fs.existsSync(full)) return json(res, 404, { ok: false, error: '素材文件不存在' });
  res.writeHead(200, {
    'Content-Type': asset.mimeType || 'application/octet-stream',
    'Content-Length': fs.statSync(full).size,
    'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(asset.fileName)}`,
    'Cache-Control': 'private, no-store'
  });
  fs.createReadStream(full).pipe(res);
}

function uploadAsset(req, res) {
  const store = loadStore();
  const actor = requireActor(req, store);
  const contentId = decodeURIComponent(required(req.headers['x-content-id'], 'Content ID'));
  if (!store.productionTasks.some(item => item.contentId === contentId)) throw Object.assign(new Error('未找到对应生产工单'), { status: 404 });
  const assetType = decodeURIComponent(required(req.headers['x-asset-type'], '素材类型'));
  const version = decodeURIComponent(required(req.headers['x-asset-version'], '素材版本'));
  const originalName = decodeURIComponent(required(req.headers['x-file-name'], '文件名'));
  const extension = path.extname(originalName).toLowerCase();
  if (!ALLOWED_ASSET_EXTENSIONS.has(extension)) throw Object.assign(new Error('不支持该文件类型'), { status: 400 });
  const declaredSize = Number(req.headers['content-length'] || 0);
  if (declaredSize > MAX_UPLOAD_BYTES) throw Object.assign(new Error('单个文件不能超过 500MB'), { status: 413 });
  const folder = path.join(uploadRoot(), safeSegment(contentId, 'content'));
  fs.mkdirSync(folder, { recursive: true });
  const storedName = `${Date.now()}-${safeSegment(path.basename(originalName))}`;
  const full = path.join(folder, storedName);
  const output = fs.createWriteStream(full, { flags: 'wx' });
  let size = 0;
  let settled = false;
  const cleanup = () => { if (fs.existsSync(full)) fs.unlinkSync(full); };
  return new Promise((resolve, reject) => {
    const fail = error => {
      if (settled) return;
      settled = true;
      output.destroy();
      cleanup();
      reject(error);
    };
    req.on('data', chunk => {
      size += chunk.length;
      if (size > MAX_UPLOAD_BYTES) fail(Object.assign(new Error('单个文件不能超过 500MB'), { status: 413 }));
    });
    req.on('error', fail);
    output.on('error', fail);
    output.on('finish', () => {
      if (settled) return;
      settled = true;
      const asset = {
        id: `AST-${Date.now()}`,
        contentId,
        type: assetType,
        version,
        storageMode: 'local',
        fileName: originalName,
        fileSize: size,
        mimeType: String(req.headers['content-type'] || 'application/octet-stream'),
        storedPath: path.relative(path.dirname(dataFile()), full),
        url: '',
        acceptanceStatus: '待验收',
        createdAt: new Date().toISOString()
      };
      asset.url = `/api/assets/${encodeURIComponent(asset.id)}/file`;
      store.assets.push(asset);
      saveAudited(store, actor, 'upload', 'Asset', asset.id, `${contentId} · ${assetType} · ${version} · 本地文件`);
      json(res, 201, { ok: true, asset });
      resolve();
    });
    req.pipe(output);
  });
}

function saveAudited(store, actor, action, entityType, entityId, summary) {
  store.auditLog.push({
    id: `AUD-${Date.now()}-${store.auditLog.length}`,
    actorId: actor.id,
    actorName: actor.name,
    action,
    entityType,
    entityId: String(entityId || ''),
    summary,
    occurredAt: new Date().toISOString()
  });
  saveStore(store);
}

function downloadJson(res, filename, body) {
  res.writeHead(200, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Disposition': `attachment; filename="${filename}"`,
    'Cache-Control': 'no-store'
  });
  res.end(JSON.stringify(body, null, 2));
}

function serveStatic(res, pathname) {
  const requested = pathname === '/' ? 'index.html' : decodeURIComponent(pathname.slice(1));
  const full = path.resolve(ROOT, requested);
  if (!full.startsWith(ROOT + path.sep) && full !== path.join(ROOT, 'index.html')) return json(res, 403, { ok: false, error: '禁止访问' });
  if (!fs.existsSync(full) || fs.statSync(full).isDirectory()) return json(res, 404, { ok: false, error: '文件不存在' });
  const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.pdf': 'application/pdf' };
  res.writeHead(200, { 'Content-Type': types[path.extname(full).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  fs.createReadStream(full).pipe(res);
}

async function routeApi(req, res, pathname) {
  if (pathname === '/api/health' && req.method === 'GET') return json(res, 200, { ok: true, service: 'social-agent-workbench', version: '1.4.2-phase5' });
  const assetFileMatch = pathname.match(/^\/api\/assets\/([^/]+)\/file$/);
  if (assetFileMatch && req.method === 'GET') return assetDownload(res, loadStore(), decodeURIComponent(assetFileMatch[1]));
  if (pathname === '/api/assets/upload' && req.method === 'POST') return uploadAsset(req, res);
  if (pathname === '/api/state' && req.method === 'GET') {
    const store = loadStore();
    const { auditLog, users, ...publicState } = store;
    return json(res, 200, { ok: true, state: publicState });
  }
  if (pathname === '/api/audit' && req.method === 'GET') {
    const store = loadStore();
    requireActor(req, store);
    return json(res, 200, { ok: true, auditLog: [...store.auditLog].reverse().slice(0, 200) });
  }
  if (pathname === '/api/export' && req.method === 'GET') {
    const store = loadStore();
    const actor = requireActor(req, store);
    saveAudited(store, actor, 'export', 'Workspace', 'all', '导出完整工作台 JSON 备份');
    return downloadJson(res, `social-workbench-backup-${new Date().toISOString().slice(0, 10)}.json`, store);
  }

  const body = await readBody(req);
  const store = loadStore();
  const actor = AUDITED_MUTATIONS.has(pathname) ? requireActor(req, store) : null;

  if (pathname === '/api/action-tasks' && req.method === 'POST') {
    const id = String(body.id || '').trim();
    const existing = id ? store.actionTasks.find(item => item.id === id) : null;
    if (existing?.deletedAt) throw Object.assign(new Error('该任务已删除，不能继续编辑'), { status: 409 });
    const nextOrder = store.actionTasks.reduce((max, item) => Math.max(max, Number(item.sortOrder) || 0), -1) + 1;
    const task = existing || { id: `AT-${Date.now()}`, sortOrder: nextOrder, createdAt: new Date().toISOString() };
    Object.assign(task, {
      title: required(body.title, '任务名称'),
      description: required(body.description, '业务说明'),
      owner: required(body.owner, '负责人'),
      dueDate: required(body.dueDate, '截止日期'),
      priority: required(body.priority, '优先级'),
      status: required(body.status, '任务状态'),
      updatedAt: new Date().toISOString()
    });
    if (!existing) store.actionTasks.push(task);
    saveAudited(store, actor, existing ? 'update' : 'create', 'ActionTask', task.id, `${task.title} · ${task.status}`);
    return json(res, existing ? 200 : 201, { ok: true, task });
  }

  if (pathname === '/api/action-tasks/reorder' && req.method === 'POST') {
    const orderedIds = Array.isArray(body.orderedIds) ? body.orderedIds.map(id => String(id)) : [];
    const activeTasks = store.actionTasks.filter(task => !task.deletedAt);
    const currentIds = new Set(activeTasks.map(task => task.id));
    if (orderedIds.length !== activeTasks.length || new Set(orderedIds).size !== orderedIds.length || orderedIds.some(id => !currentIds.has(id))) {
      throw Object.assign(new Error('任务列表已变化，请刷新后重新调整顺序'), { status: 409 });
    }
    orderedIds.forEach((id, index) => {
      store.actionTasks.find(task => task.id === id).sortOrder = index;
    });
    saveAudited(store, actor, 'reorder', 'ActionTaskQueue', 'all', `调整 ${orderedIds.length} 条行动任务顺序`);
    return json(res, 200, { ok: true, actionTasks: activeTasks.sort((a, b) => a.sortOrder - b.sortOrder) });
  }

  if (pathname === '/api/action-tasks/delete' && req.method === 'POST') {
    const taskId = required(body.taskId, '任务 ID');
    const task = store.actionTasks.find(item => item.id === taskId);
    if (!task) throw Object.assign(new Error('未找到行动任务'), { status: 404 });
    if (task.deletedAt) throw Object.assign(new Error('该任务已经删除'), { status: 409 });
    task.deletedAt = new Date().toISOString();
    task.deletedBy = actor.name;
    task.updatedAt = task.deletedAt;
    saveAudited(store, actor, 'delete', 'ActionTask', task.id, `删除行动任务：${task.title}`);
    return json(res, 200, { ok: true, task });
  }

  if (pathname === '/api/accounts' && req.method === 'POST') {
    const id = required(body.id, '账号 ID');
    const account = store.accounts.find(item => item.id === id);
    if (!account) throw Object.assign(new Error('未找到账号记录'), { status: 404 });
    account.status = required(body.status, '账号状态');
    account.owner = required(body.owner, '负责人');
    account.notes = String(body.notes || '').trim();
    account.lastCheckedAt = new Date().toISOString();
    saveAudited(store, actor, 'update', 'Account', account.id, `${account.platform} · ${account.status}`);
    return json(res, 200, { ok: true, account });
  }

  if (pathname === '/api/ideas' && req.method === 'POST') {
    store.idea = {
      topic: required(body.topic, '业务主题'),
      source: required(body.source, '参考来源'),
      problem: required(body.problem, '客户真实问题'),
      value: required(body.value, '可展示价值'),
      targetPlatforms: required(body.targetPlatforms, '目标平台'),
      validationVariable: required(body.validationVariable, '待验证变量'),
      card: required(body.card, '选题卡'),
      status: '已保存',
      updatedAt: new Date().toISOString()
    };
    saveAudited(store, actor, 'update', 'Idea', 'current', `保存选题卡：${store.idea.card}`);
    return json(res, 200, { ok: true, idea: store.idea });
  }

  if (pathname === '/api/reviews/approve' && req.method === 'POST') {
    const contentId = required(body.contentId, 'Content ID');
    const platformVersionId = String(body.platformVersionId || '').trim();
    const platformVersion = platformVersionId ? store.platformVersions.find(item => item.id === platformVersionId && item.contentId === contentId) : null;
    if (platformVersionId && !platformVersion) throw Object.assign(new Error('未找到对应平台版本'), { status: 404 });
    const review = {
      contentId,
      platformVersionId,
      platform: platformVersion?.platform || String(body.platform || '').trim(),
      version: required(body.version, '定稿版本'),
      reviewer: required(body.reviewer, '审核人'),
      script: required(body.script, '脚本'),
      storyboard: required(body.storyboard, '分镜'),
      subtitles: required(body.subtitles, '字幕文案'),
      coverCopy: required(body.coverCopy, '封面文案'),
      status: 'APPROVED',
      approvedAt: new Date().toISOString()
    };
    store.reviews = store.reviews.filter(item => platformVersionId ? item.platformVersionId !== platformVersionId : item.contentId !== contentId);
    store.reviews.push(review);
    saveAudited(store, actor, 'approve', 'Review', contentId, `人工定稿 ${review.version}`);
    return json(res, 200, { ok: true, review });
  }

  if (pathname === '/api/platform-versions' && req.method === 'POST') {
    const id = String(body.id || '').trim();
    const existing = id ? store.platformVersions.find(item => item.id === id) : null;
    const version = existing || {
      id: `PV-${Date.now()}`,
      createdAt: new Date().toISOString()
    };
    Object.assign(version, {
      contentId: required(body.contentId, 'Content ID'),
      platform: required(body.platform, '平台'),
      format: required(body.format, '内容形式'),
      ratio: required(body.ratio, '画幅'),
      duration: required(body.duration, '时长'),
      title: required(body.title, '标题'),
      body: required(body.body, '正文'),
      tags: required(body.tags, '标签'),
      cta: required(body.cta, 'CTA'),
      language: required(body.language, '语言'),
      coverRequirement: required(body.coverRequirement, '封面要求'),
      expression: required(body.expression, '平台版表达'),
      status: '待人工定稿',
      updatedAt: new Date().toISOString()
    });
    if (!existing) store.platformVersions.push(version);
    saveAudited(store, actor, existing ? 'update' : 'create', 'PlatformVersion', version.id, `${version.contentId} · ${version.platform}`);
    return json(res, existing ? 200 : 201, { ok: true, version });
  }

  if (pathname === '/api/assets' && req.method === 'POST') {
    const contentId = required(body.contentId, 'Content ID');
    if (!store.productionTasks.some(item => item.contentId === contentId)) throw Object.assign(new Error('未找到对应生产工单'), { status: 404 });
    const asset = {
      id: `AST-${Date.now()}`,
      contentId,
      type: required(body.type, '素材类型'),
      version: required(body.version, '素材版本'),
      storageMode: 'external',
      fileName: String(body.fileName || '').trim(),
      fileSize: 0,
      mimeType: '',
      storedPath: '',
      url: externalUrl(body.url),
      acceptanceStatus: '待验收',
      createdAt: new Date().toISOString()
    };
    store.assets.push(asset);
    saveAudited(store, actor, 'register', 'Asset', asset.id, `${contentId} · ${asset.type} · ${asset.version} · 外部链接`);
    return json(res, 201, { ok: true, asset });
  }

  if (pathname === '/api/production-tasks' && req.method === 'POST') {
    const contentId = required(body.contentId, 'Content ID');
    const route = required(body.route, '生产路线');
    if (!ALLOWED_ROUTES.has(route)) throw Object.assign(new Error('生产路线只能是即梦路线或纯代码路线'), { status: 400 });
    const review = store.reviews.find(item => item.contentId === contentId && item.status === 'APPROVED');
    if (!review) throw Object.assign(new Error('脚本/分镜尚未人工定稿，不可创建生产工单'), { status: 409 });
    if (store.productionTasks.some(item => item.contentId === contentId && !['已取消', '已验收'].includes(item.status))) {
      throw Object.assign(new Error('该 Content ID 已存在进行中的生产工单'), { status: 409 });
    }
    const task = {
      id: `PT-${Date.now()}`,
      contentId,
      title: required(body.title, '内容标题'),
      reviewVersion: review.version,
      route,
      owner: required(body.owner, '负责人'),
      ratio: required(body.ratio, '目标画幅'),
      dueDate: required(body.dueDate, '交付日期'),
      checklist: required(body.checklist, '交付清单'),
      status: '待开始',
      createdAt: new Date().toISOString()
    };
    store.productionTasks.push(task);
    saveAudited(store, actor, 'create', 'ProductionTask', task.id, `${task.contentId} · ${task.route}`);
    return json(res, 201, { ok: true, task });
  }

  if (pathname === '/api/production-tasks/status' && req.method === 'POST') {
    const taskId = required(body.taskId, '工单 ID');
    const status = required(body.status, '工单状态');
    if (!ALLOWED_TASK_STATUS.has(status)) throw Object.assign(new Error('生产工单状态无效'), { status: 400 });
    const task = store.productionTasks.find(item => item.id === taskId);
    if (!task) throw Object.assign(new Error('未找到生产工单'), { status: 404 });
    if (task.status === '已验收' && status !== '已验收') throw Object.assign(new Error('已验收工单不可回退'), { status: 409 });
    task.status = status;
    task.blocker = String(body.blocker || '').trim();
    task.updatedAt = new Date().toISOString();
    saveAudited(store, actor, 'status', 'ProductionTask', task.id, `${task.contentId} · ${task.status}`);
    return json(res, 200, { ok: true, task });
  }

  if (pathname === '/api/deliveries' && req.method === 'POST') {
    const contentId = required(body.contentId, 'Content ID');
    const task = [...store.productionTasks].reverse().find(item => item.contentId === contentId);
    if (!task) throw Object.assign(new Error('未找到对应生产工单'), { status: 404 });
    if (!ALLOWED_ROUTES.has(task.route)) throw Object.assign(new Error('生产工单路线无效'), { status: 409 });
    let asset = body.assetId ? store.assets.find(item => item.id === body.assetId && item.contentId === contentId) : null;
    if (body.assetId && !asset) throw Object.assign(new Error('未找到对应素材记录'), { status: 404 });
    if (!asset) {
      asset = {
        id: `AST-${Date.now()}`,
        contentId,
        type: String(body.type || '成片').trim(),
        version: required(body.version, '成片版本'),
        storageMode: 'external',
        fileName: '', fileSize: 0, mimeType: '', storedPath: '',
        url: externalUrl(body.fileUrl),
        acceptanceStatus: '待验收',
        createdAt: new Date().toISOString()
      };
      store.assets.push(asset);
    }
    const delivery = {
      id: `DL-${Date.now()}`,
      contentId,
      version: required(body.version, '成片版本'),
      route: task.route,
      assetId: asset.id,
      fileUrl: asset.url,
      acceptanceStatus: '待验收',
      notes: String(body.notes || '').trim(),
      reviewNotes: '',
      createdAt: new Date().toISOString()
    };
    store.deliveries.push(delivery);
    task.status = '待验收';
    let item = findLedger(store, contentId);
    if (!item) {
      item = { id: contentId, platform: 'Facebook', title: task.title, dateLabel: '待安排', status: '等待验收', format: task.route === '纯代码路线' ? '长视频' : '短视频', ratio: task.ratio, category: '待分类', style: '待确认', copyStatus: '文案已完成', assetStatus: '成片待验收', isVideo: true, metrics: { impressions: 0, views: 0, watchRate: 0, engagements: 0, clicks: 0 } };
      store.contentLedger.push(item);
    }
    item.assetStatus = `成片 ${delivery.version} 待验收`;
    item.status = '等待验收';
    saveAudited(store, actor, 'create', 'Delivery', delivery.id, `${delivery.contentId} · ${delivery.version} · 待验收`);
    return json(res, 201, { ok: true, delivery, task, content: item });
  }

  if (pathname === '/api/deliveries/review' && req.method === 'POST') {
    const deliveryId = required(body.deliveryId, '交付 ID');
    const decision = required(body.decision, '验收结论');
    if (!ALLOWED_DELIVERY_REVIEW.has(decision)) throw Object.assign(new Error('验收结论只能是已验收或退回修改'), { status: 400 });
    const delivery = store.deliveries.find(item => item.id === deliveryId);
    if (!delivery) throw Object.assign(new Error('未找到交付记录'), { status: 404 });
    if (delivery.acceptanceStatus !== '待验收') throw Object.assign(new Error('该交付版本已完成验收处理'), { status: 409 });
    const task = [...store.productionTasks].reverse().find(item => item.contentId === delivery.contentId);
    const item = findLedger(store, delivery.contentId);
    delivery.acceptanceStatus = decision;
    delivery.reviewNotes = required(body.reviewNotes, '验收意见');
    delivery.reviewedBy = required(body.reviewedBy, '验收人');
    delivery.reviewedAt = new Date().toISOString();
    const asset = store.assets.find(item => item.id === delivery.assetId);
    if (asset) {
      asset.acceptanceStatus = decision;
      asset.reviewedBy = delivery.reviewedBy;
      asset.reviewedAt = delivery.reviewedAt;
    }
    if (decision === '已验收') {
      task.status = '已验收';
      if (item) { item.assetStatus = `成片 ${delivery.version} 已验收`; item.status = '待发布'; }
    } else {
      task.status = '修改中';
      if (item) { item.assetStatus = `成片 ${delivery.version} 退回修改`; item.status = '等待修改'; }
    }
    saveAudited(store, actor, 'review', 'Delivery', delivery.id, `${delivery.contentId} · ${delivery.version} · ${decision}`);
    return json(res, 200, { ok: true, delivery, task, content: item });
  }

  if (pathname === '/api/publications' && req.method === 'POST') {
    const contentId = required(body.contentId, 'Content ID');
    const item = findLedger(store, contentId);
    if (!item) throw Object.assign(new Error('未找到内容记录'), { status: 404 });
    const status = required(body.status, '发布状态');
    if (!ALLOWED_PUBLICATION_STATUS.has(status)) throw Object.assign(new Error('发布状态无效'), { status: 400 });
    if (['待发布', '已发布'].includes(status) && !String(item.assetStatus || '').includes('已验收')) {
      throw Object.assign(new Error('成片尚未验收，不可进入待发布或已发布状态'), { status: 409 });
    }
    item.platform = required(body.platform, '发布平台');
    item.dateValue = required(body.date, '发布日期');
    item.dateLabel = body.dateLabel || item.dateValue;
    item.status = status;
    item.platformUrl = String(body.platformUrl || '').trim();
    item.blocker = String(body.blocker || '').trim();
    if (status === '已发布' && !item.platformUrl) throw Object.assign(new Error('已发布内容必须填写平台链接'), { status: 400 });
    const publication = {
      id: `PUB-${Date.now()}`,
      contentId,
      platform: item.platform,
      plannedOrActualDate: item.dateValue,
      status,
      platformUrl: item.platformUrl,
      blocker: item.blocker,
      recordedAt: new Date().toISOString()
    };
    store.publicationRecords.push(publication);
    saveAudited(store, actor, 'record', 'Publication', publication.id, `${contentId} · ${status}`);
    return json(res, 200, { ok: true, content: item, publication });
  }

  if (pathname === '/api/metrics' && req.method === 'POST') {
    const rows = Array.isArray(body.rows) ? body.rows : [body];
    const sourceName = required(body.sourceName, '数据来源');
    const sourceDate = required(body.sourceDate, '来源日期');
    const batch = { id: `IMP-${Date.now()}`, sourceName, sourceDate, rowCount: rows.length, matched: 0, importedAt: new Date().toISOString() };
    let matched = 0;
    for (const row of rows) {
      const item = findLedger(store, String(row.contentId || '').trim());
      if (!item || item.status !== '已发布') continue;
      const snapshot = String(row.snapshot || 'T+7');
      if (!ALLOWED_SNAPSHOTS.has(snapshot)) continue;
      item.snapshot = snapshot;
      item.metrics = {
        impressions: Number(row.impressions) || 0,
        views: Number(row.views) || 0,
        watchRate: Number(row.watchRate) || 0,
        engagements: Number(row.engagements) || 0,
        clicks: Number(row.clicks) || 0
      };
      store.metricSnapshots.push({
        id: `MET-${Date.now()}-${matched}`,
        contentId: item.id,
        platform: item.platform,
        snapshot,
        sourceName,
        sourceDate,
        impressions: item.metrics.impressions,
        views: item.metrics.views,
        watchRate: item.metrics.watchRate,
        engagements: item.metrics.engagements,
        clicks: item.metrics.clicks,
        importedAt: new Date().toISOString()
      });
      matched++;
    }
    if (!matched) throw Object.assign(new Error('没有匹配到已发布的 Content ID'), { status: 400 });
    batch.matched = matched;
    store.importBatches.push(batch);
    saveAudited(store, actor, 'import', 'ImportBatch', batch.id, `${sourceName} · 匹配 ${matched}/${rows.length}`);
    return json(res, 200, { ok: true, matched, batch });
  }

  if (pathname === '/api/insights/generate' && req.method === 'POST') {
    const latestByContent = new Map();
    for (const snapshot of store.metricSnapshots.filter(item => item.snapshot === 'T+7')) latestByContent.set(snapshot.contentId, snapshot);
    const comparable = [...latestByContent.values()].map(snapshot => ({ snapshot, content: findLedger(store, snapshot.contentId) })).filter(item => item.content && item.snapshot.impressions > 0);
    if (comparable.length < 2) throw Object.assign(new Error('至少需要 2 条有来源的 T+7 数据才能生成建议'), { status: 409 });
    const rates = comparable.map(item => item.snapshot.engagements / item.snapshot.impressions * 100).sort((a, b) => a - b);
    const middle = Math.floor(rates.length / 2);
    const medianRate = rates.length % 2 ? rates[middle] : (rates[middle - 1] + rates[middle]) / 2;
    const top = [...comparable].sort((a, b) => (b.snapshot.engagements / b.snapshot.impressions) - (a.snapshot.engagements / a.snapshot.impressions))[0];
    const topRate = top.snapshot.engagements / top.snapshot.impressions * 100;
    const ratio = medianRate > 0 ? topRate / medianRate : 1;
    const insight = {
      id: `INS-${Date.now()}`,
      semanticLevel: 'L7',
      conclusion: `在已确认内容方向内，下一轮测试增加「${top.content.category}」内容占比`,
      source: [...new Set(comparable.map(item => `${item.snapshot.sourceName}（${item.snapshot.sourceDate}）`))].join('；'),
      sampleContentIds: comparable.map(item => item.content.id),
      sampleSize: comparable.length,
      baseline: 'T+7 快照，同口径互动率比较',
      numbers: `${top.content.id} 互动率 ${topRate.toFixed(2)}%，样本中位数 ${medianRate.toFixed(2)}%，约 ${ratio.toFixed(2)} 倍`,
      suggestedAction: `下一轮安排 1 条「${top.content.category}」内容作为验证，不据此改变账号策略`,
      validationVariable: `「${top.content.category}」内容的 T+7 互动率能否继续高于当前样本中位数`,
      status: '待采纳',
      generatedAt: new Date().toISOString()
    };
    store.insights.push(insight);
    saveAudited(store, actor, 'generate', 'Insight', insight.id, insight.conclusion);
    return json(res, 201, { ok: true, insight });
  }

  if (pathname === '/api/insights/adopt' && req.method === 'POST') {
    const insightId = required(body.insightId, 'Insight ID');
    const insight = store.insights.find(item => item.id === insightId);
    if (!insight) throw Object.assign(new Error('未找到可采纳的建议'), { status: 404 });
    if (!insight.source || !insight.sampleContentIds?.length || !insight.baseline || !insight.numbers) throw Object.assign(new Error('建议缺少来源、样本、基准或数字，不可采纳'), { status: 409 });
    insight.status = '已采纳';
    insight.adoptedAt = new Date().toISOString();
    store.adoptedInsight = {
      insightId,
      suggestion: insight.suggestedAction,
      evidenceContentIds: insight.sampleContentIds,
      validationVariable: insight.validationVariable,
      adoptedAt: new Date().toISOString()
    };
    saveAudited(store, actor, 'adopt', 'Insight', insight.id, insight.suggestedAction);
    return json(res, 200, { ok: true, adoptedInsight: store.adoptedInsight });
  }

  return json(res, 404, { ok: false, error: '接口不存在' });
}

function createServer() {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    try {
      if (url.pathname.startsWith('/api/')) return await routeApi(req, res, url.pathname);
      return serveStatic(res, url.pathname);
    } catch (error) {
      return json(res, error.status || 500, { ok: false, error: error.message || '服务器错误' });
    }
  });
}

if (require.main === module) {
  ensureStore();
  createServer().listen(PORT, '127.0.0.1', () => {
    console.log(`社媒 Agent 工作台已启动：http://127.0.0.1:${PORT}`);
  });
}

module.exports = { createServer, ensureStore, loadStore, saveStore };
