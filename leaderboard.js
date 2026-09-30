/* ============================================================
 *  91game · 排行榜（TinyWebDB 后端）
 *  ------------------------------------------------------------
 *  改成你自己的榜单：把下面 USER / SECRET 换成你自己的
 *  TinyWebDB 账号（免费注册：https://tinywebdb.appinventor.space/），
 *  数据就会存到你自己独立的命名空间里，和原版游戏互不干扰。
 * ============================================================ */
(function () {
  'use strict';

  // ===== 配置：改成你自己的 =====
  var API_URL = 'https://tinywebdb.appinventor.space/api';
  var USER = 'YOUR_USER';        // TODO 换成你的 TinyWebDB 用户名
  var SECRET = 'YOUR_SECRET';    // TODO 换成你的 TinyWebDB 密钥
  var TAG_PREFIX = '91game_';    // 榜单数据前缀（你自己的命名空间）

  // 未配置账号时的提示（方便你知道还差最后一步）
  var NOT_CONFIGURED = (USER === 'YOUR_USER' || SECRET === 'YOUR_SECRET');

  var NAME_KEY = '91game.name';
  var DEFAULT_NAME = '默认用户';
  var MUTE_MIN_GAP = 3000;
  var MAX_SCORE = 99999999;
  var SCAN_PAGES = 2;            // 最多扫 2 页 × 100 条
  var WINDOW = 20;               // 榜单显示最近多少条

  var $ = function (id) { return document.getElementById(id); };

  /* —— 请求 TinyWebDB —— */
  function post(params) {
    if (NOT_CONFIGURED) {
      return Promise.reject(new Error('榜单尚未配置：请先在 leaderboard.js 里填入你自己的 USER / SECRET'));
    }
    var body = new URLSearchParams();
    body.set('user', USER);
    body.set('secret', SECRET);
    for (var k in params) body.set(k, params[k]);
    var once = function () {
      return fetch(API_URL, { method: 'POST', body: body }).then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.text();
      }).then(function (text) {
        var s = (text || '').trim();
        if (!s) return {};
        try { return JSON.parse(s); } catch (e) {
          throw new Error('服务器返回看不懂：' + s.slice(0, 60));
        }
      });
    };
    // 失败后隔 700ms 重试一次
    return once().catch(function (err) {
      return new Promise(function (r) { setTimeout(r, 700); }).then(once).catch(function () { throw err; });
    });
  }

  /* —— 提交一条成绩 —— */
  function addScore(name, score) {
    var tag = TAG_PREFIX + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6);
    var value = JSON.stringify({ n: name, s: score, t: Date.now() });
    return post({ action: 'update', tag: tag, value: value });
  }

  /* —— 拉取前缀匹配的所有条目 —— */
  function scan() {
    var out = {};
    var no = 1, page = 0;
    function step() {
      return post({ action: 'search', no: String(no), count: '100', tag: TAG_PREFIX, type: 'both' }).then(function (obj) {
        for (var k in obj) {
          if (k.indexOf(TAG_PREFIX) === 0 && typeof obj[k] === 'string') out[k] = obj[k];
        }
        page++;
        if (page < SCAN_PAGES) { no += 100; return step(); }
        return out;
      });
    }
    return step();
  }

  /* —— 从 tag / 记录里取时间戳 —— */
  function tsOf(tag, rec) {
    var t = Number(rec && rec.t);
    if (isFinite(t) && t > 0) return t;
    var mid = String(tag).split('_')[1] || '';
    if (/^\d{12,}$/.test(mid)) return Number(mid);
    var s = parseInt(mid, 36);
    return isFinite(s) ? s : 0;
  }

  /* —— 取最近 20 条，按分数排序 —— */
  function fetchTop() {
    return scan().then(function (obj) {
      var all = [];
      for (var tag in obj) {
        var raw = obj[tag];
        if (typeof raw !== 'string') continue;
        var rec;
        try { rec = JSON.parse(raw); } catch (e) { continue; }
        var s = Number(rec && rec.s);
        if (!isFinite(s) || s < 0 || s > MAX_SCORE) continue;
        all.push({
          tag: tag,
          name: String((rec && rec.n) || '匿名玩家').slice(0, 16),
          score: s,
          t: tsOf(tag, rec)
        });
      }
      all.sort(function (a, b) { return (b.t - a.t) || (b.tag > a.tag ? 1 : -1); });
      var fresh = all.slice(0, WINDOW);
      fresh.sort(function (a, b) { return (b.score - a.score) || (b.t - a.t); });
      return fresh;
    });
  }

  /* —— 昵称 —— */
  function cleanName(raw) {
    var n = String(raw || '').replace(/[\u0000-\u001f\u007f]/g, '').trim();
    if (n.length > 12) n = n.slice(0, 12);
    return n;
  }
  function loadName() { try { return cleanName(localStorage.getItem(NAME_KEY) || ''); } catch (e) { return ''; } }
  function saveName(n) { try { localStorage.setItem(NAME_KEY, n); } catch (e) {} }
  function myName() { return loadName() || DEFAULT_NAME; }

  /* —— DOM —— */
  var listEl = $('boardList');
  var modal = $('boardModal');
  var msgEl = $('submitMsg');
  var nickInput = $('nickInput');
  var nameLabel = $('myNameLabel');
  var submitBtn = $('submitBtn');
  var submitBox = $('submitBox');
  var lastSubmitAt = 0;
  var submitting = false;
  var pendingScore = 0;

  function setMsg(text, kind) {
    if (!msgEl) return;
    msgEl.textContent = text || '';
    msgEl.className = 'submit-msg' + (kind ? ' is-' + kind : '');
  }
  function showRetry(show) { if (submitBtn) submitBtn.hidden = !show; }

  function paintName() {
    var n = myName();
    if (nameLabel) nameLabel.textContent = n;
    if (nickInput && document.activeElement !== nickInput) nickInput.value = loadName();
  }

  function boardMessage(text) {
    if (!listEl) return;
    listEl.textContent = '';
    var p = document.createElement('p');
    p.className = 'board-empty';
    p.textContent = text;
    listEl.appendChild(p);
  }

  function rankClass(i) { return i === 0 ? 'r1' : i === 1 ? 'r2' : i === 2 ? 'r3' : ''; }

  function renderBoard(rows, myScore) {
    if (!listEl) return;
    listEl.textContent = '';
    if (!rows.length) {
      boardMessage('最近还没有人提交，快去玩一局！');
      return;
    }
    var marked = false;
    rows.forEach(function (row, i) {
      var line = document.createElement('div');
      line.className = 'board-row ' + rankClass(i);
      var rank = document.createElement('span');
      rank.className = 'board-rank';
      rank.textContent = i < 3 ? ['🥇', '🥈', '🥉'][i] : String(i + 1);
      var name = document.createElement('span');
      name.className = 'board-name';
      name.textContent = row.name;
      var score = document.createElement('span');
      score.className = 'board-score';
      score.textContent = row.score;
      line.appendChild(rank);
      line.appendChild(name);
      line.appendChild(score);
      if (!marked && myScore != null && row.score === myScore) {
        line.classList.add('is-mine');
        marked = true;
      }
      listEl.appendChild(line);
    });
  }

  function refreshBoard(myScore) {
    boardMessage('正在读取排行榜…');
    return fetchTop().then(function (rows) {
      renderBoard(rows, myScore);
      return rows;
    }).catch(function (err) {
      boardMessage('读取失败：' + err.message + '（检查一下网络？）');
      throw err;
    });
  }

  function openBoard() {
    if (!modal) return;
    modal.classList.add('show');
    modal.setAttribute('aria-hidden', 'false');
    refreshBoard(null).catch(function () {});
  }
  function closeBoard() {
    if (!modal) return;
    modal.classList.remove('show');
    modal.setAttribute('aria-hidden', 'true');
  }

  function pushScore(name, score, viaRetry) {
    if (submitting) return Promise.resolve(false);
    if (!viaRetry) {
      var now = Date.now();
      if (now - lastSubmitAt < MUTE_MIN_GAP) {
        setMsg('刚提交过啦，稍等一下', 'bad');
        return Promise.resolve(false);
      }
    }
    submitting = true;
    showRetry(false);
    setMsg('正在提交…', '');
    return addScore(name, score).then(function () {
      lastSubmitAt = Date.now();
      setMsg('已上榜 ✓　' + name + ' · ' + score + ' 分', 'good');
      return refreshBoard(score).then(function () { return true; }, function () { return true; });
    }).catch(function (err) {
      setMsg('提交失败：' + err.message, 'bad');
      showRetry(true);
      return false;
    }).then(function (ok) {
      submitting = false;
      return ok;
    });
  }

  function retry() {
    if (!pendingScore) return;
    pushScore(myName(), pendingScore, true);
  }

  function onGameOver(score) {
    if (!submitBox) return;
    pendingScore = Number(score) || 0;
    paintName();
    showRetry(false);
    if (!(pendingScore > 0)) {
      submitBox.style.display = 'none';
      return;
    }
    submitBox.style.display = '';
    setMsg('正在结算…', '');
    pushScore(myName(), pendingScore, true);
  }

  function bind() {
    var boardBtn = $('boardBtn');
    if (boardBtn) boardBtn.addEventListener('click', openBoard);
    var boardBtn2 = $('boardBtn2');
    if (boardBtn2) boardBtn2.addEventListener('click', openBoard);
    var closeBtn = $('boardClose');
    if (closeBtn) closeBtn.addEventListener('click', closeBoard);
    var refreshBtn = $('boardRefresh');
    if (refreshBtn) refreshBtn.addEventListener('click', function () { refreshBoard(null).catch(function () {}); });
    if (modal) {
      modal.addEventListener('click', function (e) { if (e.target === modal) closeBoard(); });
    }
    if (submitBtn) submitBtn.addEventListener('click', retry);
    if (nickInput) {
      nickInput.value = loadName();
      var commit = function () {
        saveName(cleanName(nickInput.value));
        nickInput.value = loadName();
        paintName();
      };
      nickInput.addEventListener('change', commit);
      nickInput.addEventListener('blur', commit);
      nickInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); commit(); nickInput.blur(); }
      });
    }
    var editNameBtn = $('editNameBtn');
    if (editNameBtn) {
      editNameBtn.addEventListener('click', function () {
        openBoard();
        if (nickInput) setTimeout(function () { nickInput.focus(); nickInput.select(); }, 260);
      });
    }
    paintName();
    window.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeBoard(); });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind);
  } else {
    bind();
  }

  window.Leaderboard = {
    open: openBoard,
    close: closeBoard,
    refresh: refreshBoard,
    onGameOver: onGameOver,
    fetchTop: fetchTop,
    submitScore: addScore,
    myName: myName,
    setName: function (n) { saveName(cleanName(n)); paintName(); },
    hasName: function () { return !!loadName(); }
  };
})();
