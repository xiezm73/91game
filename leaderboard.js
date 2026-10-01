/* ============================================================
 *  91game · 排行榜（腾讯云 CloudBase 云函数后端）
 *  ------------------------------------------------------------
 *  云函数地址在这里填，形如：
 *    https://<环境ID>.service.tcloudbase.com/leaderboard
 * ============================================================ */
(function () {
  'use strict';

  // ===== 配置：把云函数 HTTP 地址填在这里 =====
  var API = 'https://YOUR-ENV.service.tcloudbase.com/leaderboard';  // TODO 换成你的云函数地址

  var NAME_KEY = '91game.name';
  var DEFAULT_NAME = '默认用户';
  var MUTE_MIN_GAP = 3000;
  var MAX_SCORE = 99999999;
  var WINDOW = 20;

  var $ = function (id) { return document.getElementById(id); };

  /* —— 提交一条成绩 —— */
  function addScore(name, score) {
    return fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name, score: score })
    }).then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return true;
    });
  }

  /* —— 取榜单前 20 —— */
  function fetchTop() {
    return fetch(API).then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    }).then(function (rows) {
      var out = [];
      (rows || []).forEach(function (r) {
        var s = Number(r && r.score);
        if (!isFinite(s) || s < 0 || s > MAX_SCORE) return;
        out.push({
          name: String((r && r.name) || '匿名玩家').slice(0, 16),
          score: s
        });
      });
      return out;
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
