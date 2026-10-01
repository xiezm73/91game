// ============================================================
// 91game 排行榜云函数（腾讯云 CloudBase 云开发）
// 用法（HTTP 访问服务，允许匿名访问）：
//   GET  → 返回前 20 名：[{name, score, createdAt}]
//   POST → body: {"name":"昵称","score":123}，写入一条成绩
// ============================================================
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const COLLECTION = 'scores';
const MAX_SCORE = 99999999;
const LIMIT = 20;

function cleanName(raw) {
  let n = String(raw || '').replace(/[\u0000-\u001f\u007f]/g, '').trim();
  if (n.length > 16) n = n.slice(0, 16);
  return n || '匿名玩家';
}

exports.main = async (event) => {
  const method = String(event.httpMethod || 'GET').toUpperCase();

  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  };

  // CORS 预检
  if (method === 'OPTIONS') {
    return { statusCode: 204, headers };
  }

  try {
    if (method === 'GET') {
      const res = await db.collection(COLLECTION)
        .orderBy('score', 'desc')
        .orderBy('createdAt', 'desc')
        .limit(LIMIT)
        .get();
      return { statusCode: 200, headers, body: JSON.stringify(res.data || []) };
    }

    if (method === 'POST') {
      let data = {};
      try { data = JSON.parse(event.body || '{}'); } catch (e) {}

      const name = cleanName(data.name);
      const score = Number(data.score);
      if (!isFinite(score) || score <= 0 || score > MAX_SCORE) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'invalid score' }) };
      }

      await db.collection(COLLECTION).add({
        data: { name, score, createdAt: db.serverDate() }
      });
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
    }

    return { statusCode: 405, headers, body: JSON.stringify({ error: 'method not allowed' }) };
  } catch (err) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: String((err && err.message) || err) })
    };
  }
};
