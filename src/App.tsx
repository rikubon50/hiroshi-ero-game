import React, { useEffect, useMemo, useRef, useState } from 'react';

import { supabase } from './lib/supabase';
console.log('VITE_SUPABASE_URL', import.meta.env.VITE_SUPABASE_URL);
// ---- debug helpers ----
const URL_DEBUG = (() => {
  try { return new URL(window.location.href).searchParams.get('debug') === '1'; } catch { return false; }
})();
const dlog = (...args: any[]) => { if (URL_DEBUG) console.log('[DEBUG]', ...args); };

/**
 * ひろしエロゲー｜投票付き飲み会ゲーム MVP（ローカルデモ）
 * --------------------------------------------------------------
 * この単一ファイルは “仕様の体験用” のフロントのみデモです。
 * 1 端末で GM（ゲームマスター）画面と複数プレーヤー端末を擬似的に切替できます。
 * 実運用では Realtime（例: Supabase Realtime / Ably / Pusher）や
 * WebSocket（Socket.IO）を使って、状態同期をサーバ経由で行ってください。
 *
 * ▼ 仕様に沿った主な流れ
 * - ゲーム作成（GM） → URL/ID（Room Code）共有
 * - 参加者は ID 入力 → プレーヤー名入力 → ロビー入室
 * - GM が開始 → Q1〜Q5 を出題 → 各自「最も当てはまりそうな人」を投票＋コメント必須
 * - 全員回答後、GM 端末のみで下位からランキング公開 → 2位 → 1位
 * - 正誤（当てた/外した）表示 → 飲み処理（ローカルではカウントのみ）
 * - 5問終了後、正答数で最終順位表示
 *
 * ▼ データ同期を導入する際のヒント（下部にも詳細）
 * - rooms: { id, hostId, status, currentQuestionIndex, questions[] }
 * - players: { id, roomId, name, score, isHost }
 * - answers: { roomId, questionIndex, voterId, targetPlayerId, comment }
 * - tallies: サーバで集計し、ランキング表示用に整形
 */

// ------------------------------
// 小道具
// ------------------------------
const DEFAULT_QUESTIONS = [
  "直近1週間でHしてそうな人は？",
  "経験人数が10人以上いそうな人は？",
];

const PHASES = {
  LOBBY: "LOBBY", // 参加者集合
  IN_PROGRESS: "IN_PROGRESS", // 質問ラウンド中
  REVEAL_FROM_BOTTOM: "REVEAL_FROM_BOTTOM", // 最下位から順に公開
  REVEAL_SECOND: "REVEAL_SECOND", // 2位公開
  REVEAL_FIRST: "REVEAL_FIRST", // 1位公開
  SHOW_CORRECT: "SHOW_CORRECT", // 正答表示
  FINISHED: "FINISHED", // 最終結果
};

// ------------------------------
// メイン
// ------------------------------
// ------------------------------
// FinalResults (Reusable Component)
// ------------------------------
function FinalResults({ players, onBack }: { players: any[]; onBack?: () => void }) {
  // sort desc by score, tie -> same rank, next rank skips
  const sorted = [...players].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  const ranked: Array<{ rank: number; name: string; score: number }> = [];
  if (sorted.length > 0) {
    let i = 0; let rank = 1;
    while (i < sorted.length) {
      const s = sorted[i].score ?? 0;
      const bucket = sorted.filter(p => (p.score ?? 0) === s);
      bucket.forEach(p => ranked.push({ rank, name: p.name ?? '?', score: p.score ?? 0 }));
      i += bucket.length; rank += bucket.length;
    }
  }
  const medal = (r: number) => (r === 1 ? '🥇' : r === 2 ? '🥈' : r === 3 ? '🥉' : `${r}.`);
  if (ranked.length === 0) {
    return (
      <div className="rounded-2xl border bg-white p-4 shadow-sm">
        <h2 className="font-semibold mb-2">最終順位（暫定表示）</h2>
        <ol className="space-y-2">
          {players.map((p, idx) => (
            <li key={p.id || idx} className="flex items-center gap-3">
              <span className="w-8 text-right">{idx + 1}.</span>
              <span className="w-28 font-medium">{p.name}</span>
              <span className="badge">{p.score ?? 0} 正答</span>
            </li>
          ))}
        </ol>
        {onBack && (
          <div className="mt-3">
            <button className="btn" onClick={onBack}>ロビーへ戻る</button>
          </div>
        )}
      </div>
    );
  }
  return (
    <div className="rounded-2xl border bg-white p-4 shadow-sm">
      <h2 className="font-semibold mb-2">最終順位（正答数）</h2>
      <ol className="space-y-2">
        {ranked.map((row, idx) => (
          <li key={idx} className="flex items-center gap-3">
            <span className="w-8 text-right">{medal(row.rank)}</span>
            <span className="w-28 font-medium">{row.name}</span>
            <span className="badge">{row.score} 正答</span>
          </li>
        ))}
      </ol>
      {onBack && (
        <div className="mt-3">
          <button className="btn" onClick={onBack}>ロビーへ戻る</button>
        </div>
      )}
    </div>
  );
}

export default function App() {
  // ルーム作成（ローカルデモなのでダミー）
  const [roomId] = useState(() => {
    const url = new URL(window.location.href);
    const q = url.searchParams.get('room');
    if (q && /^[A-Z0-9]{6,8}$/.test(q)) return q;
    const rid = Math.random().toString(36).slice(2, 8).toUpperCase();
    url.searchParams.set('room', rid);
    window.history.replaceState({}, '', url.toString());
    return rid;
  });
  const [phase, setPhase] = useState(PHASES.LOBBY);
  const [questions] = useState(DEFAULT_QUESTIONS);
  const [currentQ, setCurrentQ] = useState(0);
  const [players, setPlayers] = useState<any[]>([]);
  const [hostId, setHostId] = useState<string | null>(null);

  // この端末のプレイヤーID（セッション・ルーム単位で保存）
  const [myId] = useState(() => {
    const key = `pid:${roomId}`;
    // 同じブラウザ内でもタブごとに別IDにするため sessionStorage を使用
    const existing = sessionStorage.getItem(key);
    if (existing) return existing;
    const nid = uid();
    sessionStorage.setItem(key, nid);
    return nid;
  });
  // 最初に入った端末が自動でホストを名乗る（競合時は先着）
  useEffect(() => {
    if (hostId) return;
    const t = window.setTimeout(() => {
      if (!hostId) {
        setHostId(myId);
        if (syncRef.current) syncRef.current({ hostId: myId });
      }
    }, 500);
    return () => window.clearTimeout(t);
  }, [hostId, myId]);

  // 各プレーヤーの投票 { [playerId]: { targetId, comment } }
  const [votes, setVotes] = useState({});
  // 自分が“正答”だとみなす判定：このゲームは「みんなが選びそうな人」を選ぶ系なので、
  // 最終的に 1 位に選ばれた人に投票できていたら正答とする（簡易ルール）
  const [lastRoundResult, setLastRoundResult] = useState(null);
  const [revealIdx, setRevealIdx] = useState(0);

  // players のマージ（上書きは incoming を優先）
  const mergePlayers = (prev: any[], incoming: any[]) => {
    const map = new Map<string, any>();
    prev.forEach(p => map.set(p.id, p));
    incoming.forEach(p => map.set(p.id, { ...(map.get(p.id) || {}), ...p }));
    return Array.from(map.values());
  };

  // players の同期をデバウンス
  const playersSyncTimer = useRef<number | null>(null);

  // --- Realtime (Supabase Broadcast) ---
  const syncRef = useRef(null as null | ((diff: any) => void));
  const isRemoteRef = useRef(false);
  const skipNextVotesSync = useRef(false);

  // 子コンポーネントから安全にブロードキャストするための関数
  const sendDiff = (diff: any) => {
    if (syncRef.current) {
      syncRef.current(diff);
    }
  };

  useEffect(() => {
    const channel = supabase.channel(`room:${roomId}`, {
      config: { broadcast: { ack: true }, presence: { key: crypto.randomUUID() } },
    });

    // presence（任意）
    channel.on('presence', { event: 'sync' }, () => {
      // const state = channel.presenceState();
      // ここでオンライン人数などを使いたければ処理
    });

    channel.subscribe(async (status) => {
      if (status === 'SUBSCRIBED') {
        await channel.track({ joinedAt: Date.now() });
      }
    });

    // 受信（差分をマージ）。エコーバック防止のため isRemoteRef を使用
    channel.on('broadcast', { event: 'state' }, ({ payload }) => {
      dlog('RX state', payload);
      // 自分が送ったブロードキャストは無視（再送ループ/描画カクつき防止）
      if (payload && payload.from === myId) return;
      isRemoteRef.current = true;
      if (payload.phase !== undefined) setPhase(payload.phase);
      if (payload.currentQ !== undefined) setCurrentQ(payload.currentQ);
      if (payload.votes !== undefined) {
        skipNextVotesSync.current = true;
        // 票はサーバ（orホスト）側の状態を正とし、常に置き換える
        setVotes(payload.votes || {});
      }
      if (payload.hostId !== undefined && payload.hostId) setHostId(payload.hostId);
      if (payload.players !== undefined) {
        setPlayers(prev => mergePlayers(prev, payload.players));
      }
      if (payload.lastRoundResult !== undefined) setLastRoundResult(payload.lastRoundResult);
      if (payload.revealIdx !== undefined) setRevealIdx(payload.revealIdx);
      isRemoteRef.current = false;
    });

    // 送信用関数を保持
    syncRef.current = (diff: any) => {
      dlog('TX state', diff);
      channel.send({ type: 'broadcast', event: 'state', payload: { ...diff, from: myId } });
    };

    return () => {
      supabase.removeChannel(channel);
      syncRef.current = null;
    };
  }, [roomId]);

  // 変更が起きたら差分を配信（受信起因の変更は送らない）
  useEffect(() => { if (syncRef.current && !isRemoteRef.current) syncRef.current({ phase }); }, [phase]);
  useEffect(() => { if (syncRef.current && !isRemoteRef.current) syncRef.current({ currentQ }); }, [currentQ]);
  useEffect(() => {
    if (!syncRef.current || isRemoteRef.current) return;
    if (skipNextVotesSync.current) { skipNextVotesSync.current = false; return; }
    syncRef.current({ votes });
  }, [votes]);
  useEffect(() => { if (syncRef.current && !isRemoteRef.current && hostId) syncRef.current({ hostId }); }, [hostId]);
  useEffect(() => {
    if (!syncRef.current || isRemoteRef.current) return;
    if (playersSyncTimer.current) window.clearTimeout(playersSyncTimer.current);
    playersSyncTimer.current = window.setTimeout(() => {
      // 名前編集中の連続更新を抑える
      syncRef.current && syncRef.current({ players });
      playersSyncTimer.current = null;
    }, 250);
  }, [players]);
  useEffect(() => { if (syncRef.current && !isRemoteRef.current) syncRef.current({ lastRoundResult }); }, [lastRoundResult]);
  useEffect(() => { if (syncRef.current && !isRemoteRef.current) syncRef.current({ revealIdx }); }, [revealIdx]);

  // trace important values
  useEffect(() => { dlog('phase ->', phase); }, [phase]);
  useEffect(() => { dlog('currentQ ->', currentQ); }, [currentQ]);
  useEffect(() => { dlog('players ->', players.map(p => ({ id: p.id, name: p.name, score: p.score }))); }, [players]);
  useEffect(() => { dlog('votes keys ->', Object.keys(votes)); }, [votes]);
  useEffect(() => { dlog('hostId ->', hostId, 'myId ->', myId); }, [hostId]);

  const everyoneAnswered = useMemo(() => Object.keys(votes).length === players.length, [votes, players.length]);

  // 現在ラウンドの集計
  const tally = useMemo(() => {
    const counts = Object.fromEntries(players.map(p => [p.id, 0]));
    const comments = []; // 最下位〜1位で並べ替えて表示
    for (const [voterId, { targetId, comment }] of Object.entries(votes)) {
      counts[targetId] = (counts[targetId] || 0) + 1;
      comments.push({ voterId, targetId, comment });
    }
    // 並び順（少ない順＝最下位から）
    const rank = Object.entries(counts)
      .map(([pid, c]) => ({ playerId: pid, count: c }))
      .sort((a, b) => a.count - b.count);
    return { counts, comments, rank };
  }, [votes, players]);

  // 表示用ユーティリティ
  const nameOf = (pid) => players.find(p => p.id === pid)?.name ?? "?";

  // 次ラウンドへ
  const goNextQuestion = () => {
    const next = currentQ + 1;
    if (next >= questions.length) {
      setPhase(PHASES.FINISHED);
    } else {
      setCurrentQ(next);
      setVotes({});
      syncRef.current && syncRef.current({ votes: {} });
      setRevealIdx(0);
      syncRef.current && syncRef.current({ revealIdx: 0 });
      setPhase(PHASES.IN_PROGRESS);
      setLastRoundResult(null);
    }
  };

  const backToLobby = () => {
    setPhase(PHASES.LOBBY);
    setCurrentQ(0);
    setVotes({});
    if (syncRef.current) syncRef.current({ votes: {} });
    setLastRoundResult(null);
    setRevealIdx(0);
    setPlayers(prev => prev.map(p => ({ ...p, score: 0 })));
  };

  return (
    <div className="min-h-dvh bg-neutral-50 text-neutral-900 p-4 md:p-8">
      <div className="mx-auto max-w-5xl space-y-6">
        <Header roomId={roomId} phase={phase} currentQ={currentQ} total={questions.length} hostId={hostId} />
        <Tabs>
          <Tab label="プレーヤー端末（擬似）">
            <PlayersSim
              players={players}
              setPlayers={setPlayers}
              phase={phase}
              setPhase={setPhase}
              question={questions[currentQ]}
              votes={votes}
              setVotes={setVotes}
              nameOf={nameOf}
              hostId={hostId}
              setHostId={setHostId}
              questions={questions}
              currentQ={currentQ}
              everyoneAnswered={everyoneAnswered}
              tally={tally}
              lastRoundResult={lastRoundResult}
              setLastRoundResult={setLastRoundResult}
              goNextQuestion={goNextQuestion}
              myId={myId}
              sendDiff={sendDiff}
              revealIdx={revealIdx}
              setRevealIdx={setRevealIdx}
              onBackToLobby={backToLobby}
            />
          </Tab>
          <Tab label="デバイスプレビュー（GM+4人）">
            <DevicesPreview
              players={players}
              setPlayers={setPlayers}
              phase={phase}
              setPhase={setPhase}
              question={questions[currentQ]}
              votes={votes}
              setVotes={setVotes}
              nameOf={nameOf}
              questions={questions}
              currentQ={currentQ}
              everyoneAnswered={everyoneAnswered}
              tally={tally}
              lastRoundResult={lastRoundResult}
              setLastRoundResult={setLastRoundResult}
              goNextQuestion={goNextQuestion}
              hostId={hostId}
              setHostId={setHostId}
              myId={myId}
              sendDiff={sendDiff}
              revealIdx={revealIdx}
              setRevealIdx={setRevealIdx}
              onBackToLobby={backToLobby}
            />
          </Tab>
        </Tabs>
        {/* Host-forced final results (safety net) */}
        {phase === PHASES.FINISHED && myId === hostId && (
          <FinalResults players={players} onBack={backToLobby} />
        )}
        {URL_DEBUG && (
          <DebugPanel roomId={roomId} phase={phase} currentQ={currentQ} players={players} votes={votes} hostId={hostId} myId={myId} />
        )}
      </div>
    </div>
  );
}

// ------------------------------
// Header
// ------------------------------
function Header({ roomId, phase, currentQ, total, hostId }) {
  const phaseLabel = {
    [PHASES.LOBBY]: "ロビー（参加者集合中）",
    [PHASES.IN_PROGRESS]: `Q${currentQ + 1} 回答中…`,
    [PHASES.REVEAL_FROM_BOTTOM]: "結果発表：最下位〜",
    [PHASES.REVEAL_SECOND]: "結果発表：2位",
    [PHASES.REVEAL_FIRST]: "結果発表：1位",
    [PHASES.SHOW_CORRECT]: "当たり/ハズレ発表",
    [PHASES.FINISHED]: "最終結果",
  }[phase];

  return (
    <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
      <div>
        <h1 className="text-2xl md:text-3xl font-bold">ひろしエロゲー｜みんなの“思ってるやつ”投票ゲーム</h1>
        <p className="text-sm text-neutral-600">Room ID: <span className="font-mono">{roomId}</span> / 状態: {phaseLabel}</p>
        <div className="mt-2 flex gap-2">
          <button
            className="btn"
            onClick={() => {
              const url = new URL(window.location.href);
              url.searchParams.set('room', roomId);
              url.searchParams.set('guest', '1');
              url.searchParams.delete('host');
              navigator.clipboard.writeText(url.toString());
              alert('招待リンクをコピーしました（guest=1）');
            }}
          >招待リンクをコピー</button>
        </div>
      </div>
      <div className="text-sm text-neutral-600">進行 {Math.min(currentQ + 1, total)} / {total}</div>
    </div>
  );
}

// ------------------------------
// GM View（進行と公開を制御）
// ------------------------------
function GMView({ players, setPlayers, phase, setPhase, questions, currentQ, everyoneAnswered, tally, nameOf, lastRoundResult, setLastRoundResult, goNextQuestion }) {
  // ランキング配列（最下位→1位）
  const ordered = tally.rank;
  const first = ordered[ordered.length - 1];
  const second = ordered[ordered.length - 2];
  const bottom = ordered[0];

  const startGame = () => setPhase(PHASES.IN_PROGRESS);
  const revealBottom = () => setPhase(PHASES.REVEAL_FROM_BOTTOM);
  const revealSecond = () => setPhase(PHASES.REVEAL_SECOND);
  const revealFirst = () => setPhase(PHASES.REVEAL_FIRST);

  const showCorrect = () => {
    // 1位に投票できていた人を正答として加点
    if (!first) return;
    const newPlayers = players.map(p => ({ ...p }));
    const correctVoterIds = Object.entries(window._votes || {})
      .filter(([, v]) => v.targetId === first.playerId)
      .map(([pid]) => pid);
    newPlayers.forEach(p => {
      if (correctVoterIds.includes(p.id)) p.score += 1;
    });
    setPlayers(newPlayers);
    setLastRoundResult({ firstTarget: first.playerId, correctVoterIds });
    setPhase(PHASES.SHOW_CORRECT);
  };

  const nextRound = () => goNextQuestion();

  // votes を window にミラー（簡易的に GM/Player タブ間で共有）
  // 実運用ではサーバ同期に置き換え
  if (typeof window !== "undefined") {
    window._votes = window._votes || {};
  }

  return (
    <div className="space-y-4">
      {phase === PHASES.LOBBY && (
        <div className="rounded-2xl border bg-white p-4 shadow-sm">
          <h2 className="font-semibold">ロビー</h2>
          <p className="text-sm text-neutral-600">参加者（擬似）:</p>
          <ul className="flex flex-wrap gap-2 mt-2">
            {players.map(p => (
              <li key={p.id} className="px-3 py-1 rounded-full bg-neutral-100 border text-sm">{p.name}</li>
            ))}
          </ul>
          <div className="mt-3 flex gap-2">
            <button className="btn" onClick={() => setPlayers(prev => [...prev, { id: uid(), name: `新規${prev.length + 1}`, score: 0 }])}>参加者を追加（擬似）</button>
            <button className="btn btn-primary" onClick={startGame}>ゲーム開始</button>
          </div>
        </div>
      )}

      {phase === PHASES.IN_PROGRESS && (
        <div className="rounded-2xl border bg-white p-4 shadow-sm">
          <h2 className="font-semibold">Q{currentQ + 1}：{questions[currentQ]}</h2>
          <p className="text-sm text-neutral-600">全員の回答待ち… {everyoneAnswered ? "（揃いました）" : ""}</p>
          <div className="mt-3 flex gap-2">
            <button className="btn" disabled={!everyoneAnswered} onClick={revealBottom}>結果発表へ（最下位から）</button>
          </div>
        </div>
      )}

      {phase === PHASES.REVEAL_FROM_BOTTOM && (
        <RevealCard title="最下位" item={bottom} nameOf={nameOf} comments={tally.comments} />
      )}

      {phase === PHASES.REVEAL_FROM_BOTTOM && (
        <div className="flex gap-2">
          <button className="btn" onClick={revealSecond}>次へ（2位）</button>
        </div>
      )}

      {phase === PHASES.REVEAL_SECOND && (
        <RevealCard title="2 位" item={second} nameOf={nameOf} comments={tally.comments} />
      )}

      {phase === PHASES.REVEAL_SECOND && (
        <div className="flex gap-2">
          <button className="btn" onClick={revealFirst}>次へ（1位）</button>
        </div>
      )}

      {phase === PHASES.REVEAL_FIRST && (
        <RevealCard title="1 位" item={first} nameOf={nameOf} highlight comments={tally.comments} />
      )}

      {phase === PHASES.REVEAL_FIRST && (
        <div className="flex gap-2">
          <button className="btn btn-primary" onClick={showCorrect}>外した人を確認！</button>
        </div>
      )}

      {phase === PHASES.SHOW_CORRECT && lastRoundResult && (
        <div className="rounded-2xl border bg-white p-4 shadow-sm">
          <h3 className="font-semibold">当てた人 / 外した人</h3>
          <p className="text-sm text-neutral-600">正解（1位）：{nameOf(lastRoundResult.firstTarget)}</p>
          <ul className="mt-2 grid sm:grid-cols-2 gap-2">
            {players.map(p => (
              <li key={p.id} className="flex items-center gap-2 p-2 rounded-xl border">
                <span className="w-24 font-medium">{p.name}</span>
                {lastRoundResult.correctVoterIds.includes(p.id) ? (
                  <span className="badge bg-emerald-100 text-emerald-800">当たり</span>
                ) : (
                  <span className="badge bg-rose-100 text-rose-800">ハズレ</span>
                )}
              </li>
            ))}
          </ul>
          <div className="mt-3 flex gap-2">
            <button className="btn" onClick={goNextQuestion}>
              {currentQ >= questions.length - 1 ? '最終結果へ' : `第${currentQ + 2}問 開始`}
            </button>
          </div>
        </div>
      )}

      {isHostView && phase === PHASES.FINISHED && (() => {
        // スコアで降順。同点は同順位（次順位は人数分スキップ）
        const sorted = [...players].sort((a, b) => b.score - a.score);
        dlog('FINISHED render sorted', sorted);
        const ranked: Array<{ rank: number; name: string; score: number }> = [];
        if (sorted.length > 0) {
          let i = 0;
          let rank = 1;
          while (i < sorted.length) {
            const s = sorted[i].score ?? 0;
            const bucket = sorted.filter(p => (p.score ?? 0) === s);
            bucket.forEach(p => ranked.push({ rank, name: p.name ?? '?', score: p.score ?? 0 }));
            i += bucket.length;
            rank += bucket.length;
          }
        }
        dlog('FINISHED render ranked', ranked);
        // Fallback: show raw players for diagnostics if ranked is empty
        if (ranked.length === 0) {
          // Fallback: show raw players for diagnostics
          return (
            <div className="rounded-2xl border bg-white p-4 shadow-sm">
              <h2 className="font-semibold mb-2">最終順位（暫定表示）</h2>
              <ol className="space-y-2">
                {players.map((p, idx) => (
                  <li key={p.id || idx} className="flex items-center gap-3">
                    <span className="w-8 text-right">{idx + 1}.</span>
                    <span className="w-28 font-medium">{p.name}</span>
                    <span className="badge">{p.score ?? 0} 正答</span>
                  </li>
                ))}
              </ol>
              <div className="mt-3">
                <button className="btn" onClick={onBackToLobby}>ロビーへ戻る</button>
              </div>
              <p className="text-xs text-neutral-600 mt-2">DEBUG: ranked が空のため暫定表示（URLに debug=1 を付けると詳細ログが出ます）</p>
            </div>
          );
        }
        const medal = (r: number) =>
          r === 1 ? "🥇" : r === 2 ? "🥈" : r === 3 ? "🥉" : `${r}.`;
        return (
          <div className="rounded-2xl border bg-white p-4 shadow-sm">
            <h2 className="font-semibold mb-2">最終順位（正答数）</h2>
            <ol className="space-y-2">
              {ranked.map((row, idx) => (
                <li key={idx} className="flex items-center gap-3">
                  <span className="w-8 text-right">{medal(row.rank)}</span>
                  <span className="w-28 font-medium">{row.name}</span>
                  <span className="badge">{row.score} 正答</span>
                </li>
              ))}
            </ol>
            <div className="mt-3">
              <button className="btn" onClick={onBackToLobby}>ロビーへ戻る</button>
            </div>
          </div>
        );
      })()}

      {!isHostView && phase === PHASES.FINISHED && (
        <div className="rounded-2xl border bg-white p-4 shadow-sm">
          <h2 className="font-semibold">最終結果</h2>
          <p className="text-sm text-neutral-600">
            最終結果はGMの端末で表示されます。
          </p>
        </div>
      )}

      <StyleGuide />
      {URL_DEBUG && phase === PHASES.FINISHED && (
        <div className="text-xs text-neutral-600">[DEBUG] isHostView: {String(isHostView)} / players: {players.length}</div>
      )}
    </div>
  );
}

// ------------------------------
// ランキング表示カード
// ------------------------------
function RevealCard({ title, item, nameOf, highlight, comments }) {
  if (!item) return null;
  const list = (comments || []).filter(c => c.targetId === item.playerId);

  return (
    <div className={`rounded-2xl border bg-white p-4 shadow-sm ${highlight ? "ring-2 ring-fuchsia-400" : ""}`}>
      <h2 className="font-semibold mb-2">{title}</h2>
      <div className="flex items-center gap-3 text-lg">
        <span className="font-medium">{nameOf(item.playerId)}</span>
        <span className="badge">{item.count} 票</span>
      </div>

      {list.length > 0 && (
        <div className="mt-2">
          <h4 className="text-sm font-semibold mb-1">コメント</h4>
          <ul className="space-y-1">
            {list.map((c, idx) => (
              <li key={idx} className="text-sm">
                <span className="font-medium">{nameOf(c.voterId)}</span>
                <span className="text-neutral-600">：</span>
                <span>{c.comment}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ------------------------------
// プレーヤー疑似端末（複数人分の入力を 1 画面で）
// ------------------------------
function PlayersSim({ players, setPlayers, phase, setPhase, question, votes, setVotes, nameOf, onlySelfId, hostId, setHostId, questions, currentQ, everyoneAnswered, tally, lastRoundResult, setLastRoundResult, goNextQuestion, myId, sendDiff, revealIdx, setRevealIdx,  onBackToLobby }) {
  // 同票は同順位のグループ（少ない→多い＝最下位→1位）
  const groups = React.useMemo(() => {
    const m = new Map<number, string[]>();
    (tally.rank || []).forEach((r: any) => {
      const arr = m.get(r.count) || [];
      arr.push(r.playerId);
      m.set(r.count, arr);
    });
    return Array.from(m.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([count, playerIds]) => ({ count, playerIds }));
  }, [tally]);
  const totalRanks = groups.length;
  const currentGroup = groups[revealIdx] || null;
  const currentRank = totalRanks > 0 ? (totalRanks - revealIdx) : null; // 1位が最大
  // window._votes を参照（GM と共有）
  if (typeof window !== "undefined") {
    window._votes = votes;
  }
  const visiblePlayers = onlySelfId ? players.filter(p => p.id === onlySelfId) : players.filter(p => p.id === myId);

  const isHostView = ((onlySelfId ?? myId) === hostId);

  const self = players.find(p => p.id === myId);
  const [joinName, setJoinName] = useState(self?.name || "");
  const alreadyJoined = !!self;
  const iAmHost = myId === hostId;
  const iAmInPlayers = players.some(p => p.id === myId);

  // --- local name state for editing player names (GM) ---
  const [localNames, setLocalNames] = useState<Record<string, string>>({});
  const setLocalName = (val: string, id?: string) => {
    const target = id ?? myId;
    setLocalNames(prev => ({ ...prev, [target]: val }));
  };

  const submit = (pid, targetId, comment) => {
    setVotes(prev => ({ ...prev, [pid]: { targetId, comment } }));
    if (typeof window !== 'undefined' && window.requestAnimationFrame) requestAnimationFrame(() => { sendDiff && sendDiff({ votes: { ...votes, [pid]: { targetId, comment } } }); });
  };

  useEffect(() => {
    if (phase === PHASES.FINISHED) {
      window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
    }
  }, [phase]);

  return (
    <div className="space-y-4">
      {phase === PHASES.LOBBY && (
        <div className="rounded-2xl border bg-white p-4 shadow-sm">
          {myId === hostId ? (
            <>
              <h2 className="font-semibold">ロビー</h2>
              {!iAmInPlayers ? (
                <div className="mt-2 flex items-center gap-2">
                  <input
                    id={`gm-name-${myId}`}
                    name="gmName"
                    className="input w-40"
                    placeholder="あなたの名前（GM）"
                    value={localNames[myId] ?? ""}
                    onChange={e => setLocalName(e.target.value, myId)}
                  />
                  <button
                    className="btn btn-primary"
                    disabled={!((localNames[myId] ?? "").trim())}
                    onClick={() => {
                      const name = (localNames[myId] ?? "").trim();
                      if (!name) return;
                      setPlayers(prev => ([...prev, { id: myId, name, score: 0 }]));
                    }}
                  >参加する</button>
                </div>
              ) : (
                <p className="text-sm text-neutral-600 mt-1">開始を押すと第1問に進みます。</p>
              )}

              <p className="text-sm text-neutral-600 mt-3">参加者</p>
              <ul className="flex flex-wrap gap-2 mt-2">
                {players.map(p => (
                  <li key={p.id} className="px-3 py-1 rounded-full bg-neutral-100 border text-sm">
                    {p.name}{hostId === p.id ? '（GM）' : ''}
                  </li>
                ))}
              </ul>

              <div className="mt-3 flex items-center gap-2">
                <button
                  className="btn btn-primary"
                  disabled={!(iAmInPlayers && players.length >= 2)}
                  onClick={() => { setPhase(PHASES.IN_PROGRESS); }}
                >ゲーム開始</button>
                {!(iAmInPlayers && players.length >= 2) && (
                  <span className="text-sm text-neutral-600">※ GMが参加し、参加者2人以上で開始できます</span>
                )}
              </div>
            </>
          ) : (
            <>
              <p className="text-sm text-neutral-600">あなたの名前を入力して参加</p>
              <div className="mt-2 flex items-center gap-2">
                <input
                  id={`join-name-${myId}`}
                  name="joinName"
                  className="input w-40"
                  placeholder="あなたの名前"
                  value={joinName}
                  onChange={e => { setJoinName(e.target.value); }}
                />
                {!alreadyJoined ? (
                  <button
                    className="btn btn-primary"
                    disabled={!joinName.trim()}
                    onClick={() => {
                      if (!joinName.trim()) return;
                      setPlayers(prev => ([...prev, { id: myId, name: joinName.trim(), score: 0 }]));
                    }}
                  >参加する</button>
                ) : (
                  <span className="badge">参加済み</span>
                )}
              </div>
              {alreadyJoined && (
                <p className="text-xs text-neutral-600 mt-2">開始を待っています…（GMが「ゲーム開始」を押します）</p>
              )}
            </>
          )}
        </div>
      )}

      {phase === PHASES.IN_PROGRESS && (
        <div className="rounded-2xl border bg-white p-4 shadow-sm">
          <h2 className="font-semibold">Q：{question}</h2>
          <p className="text-sm text-neutral-600">「最もみんなが選びそうな人」を選択し、理由をコメントで必須入力</p>
          <div className="mt-3 grid md:grid-cols-2 gap-3">
            {visiblePlayers.map(p => (
              <PlayerVoteCard
                key={p.id}
                self={p}
                players={players}
                value={votes[p.id]}
                onSubmit={submit}
              />
            ))}
          </div>
          {Object.keys(votes).length === players.length && (
            <div className="mt-3 p-3 rounded-xl bg-amber-50 border text-amber-900">全員の回答が揃いました。GM のスマホで結果発表！</div>
          )}
        </div>
      )}

      {isHostView && phase === PHASES.IN_PROGRESS && (
        <div className="rounded-2xl border bg-white p-4 shadow-sm">
          <h2 className="font-semibold">進行（GM）</h2>
          <p className="text-sm text-neutral-600">全員の回答待ち… {everyoneAnswered ? "（揃いました）" : ""}</p>
          <div className="mt-3 flex gap-2">
            <button className="btn" disabled={!everyoneAnswered} onClick={() => { setRevealIdx(0); setPhase(PHASES.REVEAL_FROM_BOTTOM); }}>結果発表へ（最下位から）</button>
          </div>
        </div>
      )}

      {isHostView && (phase === PHASES.REVEAL_FROM_BOTTOM || phase === PHASES.REVEAL_SECOND || phase === PHASES.REVEAL_FIRST) && currentGroup && (
        <div className="rounded-2xl border bg-white p-4 shadow-sm">
          <h2 className="font-semibold">結果発表：{revealIdx === 0 ? '最下位' : `${currentRank}位`}</h2>
          <div className="flex items-center gap-3 text-lg">
            <span className="font-medium">{currentGroup.playerIds.map(nameOf).join('、')}</span>
            <span className="badge">{currentGroup.count} 票</span>
          </div>
          {/* グループ全員分のコメント一覧 */}
          <div className="mt-2">
            <h4 className="text-sm font-semibold mb-1">コメント</h4>
            <ul className="space-y-1">
              {(tally.comments || []).filter((c: any) => currentGroup.playerIds.includes(c.targetId)).map((c: any, idx: number) => (
                <li key={idx} className="text-sm">
                  <span className="font-medium">{nameOf(c.voterId)}</span>
                  <span className="text-neutral-600">：</span>
                  <span>{c.comment}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="flex gap-2 mt-3">
            {revealIdx < totalRanks - 1 ? (
              <button className="btn" onClick={() => setRevealIdx(revealIdx + 1)}>次へ（{totalRanks - (revealIdx + 1)}位）</button>
            ) : (
              <button
                className="btn btn-primary"
                onClick={() => {
                  // 1位のターゲットを取得
                  const firstEntry = (tally.rank || [])[ (tally.rank || []).length - 1 ];
                  const firstTarget = firstEntry?.playerId;
                  // 正答者（1位に投票した人）を抽出
                  const correctVoterIds = firstTarget ? Object.entries(votes as any)
                    .filter(([, v]: any) => v?.targetId === firstTarget)
                    .map(([pid]) => pid) : [];
                  // スコア加点
                  setPlayers(prev => prev.map(p => correctVoterIds.includes(p.id) ? { ...p, score: (p.score || 0) + 1 } : p));
                  // ラウンド結果を保存
                  setLastRoundResult({ firstTarget, correctVoterIds });
                  // 当たり/ハズレ表示へ
                  setPhase(PHASES.SHOW_CORRECT);
                }}
              >外した人を確認！</button>
            )}
          </div>
        </div>
      )}

      {isHostView && phase === PHASES.SHOW_CORRECT && lastRoundResult && (
        <div className="rounded-2xl border bg-white p-4 shadow-sm">
          <h3 className="font-semibold">当てた人 / 外した人</h3>
          <p className="text-sm text-neutral-600">正解（1位）：{nameOf(lastRoundResult.firstTarget)}</p>
          <ul className="mt-2 grid sm:grid-cols-2 gap-2">
            {players.map(p => (
              <li key={p.id} className="flex items-center gap-2 p-2 rounded-xl border">
                <span className="w-24 font-medium">{p.name}</span>
                {lastRoundResult.correctVoterIds.includes(p.id) ? (
                  <span className="badge bg-emerald-100 text-emerald-800">当たり</span>
                ) : (
                  <span className="badge bg-rose-100 text-rose-800">ハズレ</span>
                )}
              </li>
            ))}
          </ul>
          <div className="mt-3 flex gap-2">
            <button className="btn" onClick={goNextQuestion}>
              {currentQ >= questions.length - 1 ? '最終結果へ' : `第${currentQ + 2}問 開始`}
            </button>
          </div>
        </div>
      )}

      {!isHostView && (phase === PHASES.REVEAL_FROM_BOTTOM || phase === PHASES.REVEAL_SECOND || phase === PHASES.REVEAL_FIRST) && currentGroup && (
        <div className="rounded-2xl border bg-white p-4 shadow-sm">
          <h2 className="font-semibold">結果発表：{revealIdx === 0 ? '最下位' : `${currentRank}位`}</h2>
          <div className="flex items-center gap-3 text-lg">
            <span className="font-medium">{currentGroup.playerIds.map(nameOf).join('、')}</span>
            <span className="badge">{currentGroup.count} 票</span>
          </div>
          <div className="mt-2">
            <h4 className="text-sm font-semibold mb-1">コメント</h4>
            <ul className="space-y-1">
              {(tally.comments || []).filter((c: any) => currentGroup.playerIds.includes(c.targetId)).map((c: any, idx: number) => (
                <li key={idx} className="text-sm">
                  <span className="font-medium">{nameOf(c.voterId)}</span>
                  <span className="text-neutral-600">：</span>
                  <span>{c.comment}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}

function DevicesPreview({ players, setPlayers, phase, setPhase, question, votes, setVotes, nameOf, questions, currentQ, everyoneAnswered, tally, lastRoundResult, setLastRoundResult, goNextQuestion, hostId, setHostId, sendDiff, revealIdx, setRevealIdx, onBackToLobby }) {
  const four = players.slice(0, 4);
  return (
    <div className="devices-grid">
      {four.map(p => (
        <div key={p.id} className="device">
          <h3>プレーヤー端末：{p.name}{hostId === p.id ? '（GM）' : ''}</h3>
          <div className="device-inner">
            <PlayersSim
              players={players}
              setPlayers={setPlayers}
              phase={phase}
              setPhase={setPhase}
              question={question}
              votes={votes}
              setVotes={setVotes}
              nameOf={nameOf}
              onlySelfId={p.id}
              hostId={hostId}
              setHostId={setHostId}
              questions={questions}
              currentQ={currentQ}
              everyoneAnswered={everyoneAnswered}
              tally={tally}
              lastRoundResult={lastRoundResult}
              setLastRoundResult={setLastRoundResult}
              goNextQuestion={goNextQuestion}
              myId={p.id}
              sendDiff={sendDiff}
              revealIdx={revealIdx}
              setRevealIdx={setRevealIdx}
              onBackToLobby={backToLobby}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

function PlayerVoteCard({ self, players, value, onSubmit }) {
  const [targetId, setTargetId] = useState(value?.targetId || "");
  const [comment, setComment] = useState(value?.comment || "");

  const canSubmit = targetId && comment.trim().length > 0;

  return (
    <div className="rounded-xl border p-3">
      <div className="font-medium mb-2">{self.name} の投票</div>
      <div className="flex flex-wrap gap-2">
        {players.map(p => (
          <button
            key={p.id}
            className={`chip ${targetId === p.id ? "chip-active" : ""}`}
            onClick={() => setTargetId(p.id)}
          >{p.name}</button>
        ))}
      </div>
      <textarea
        id={`comment-${self.id}`}
        name="comment"
        className="textarea w-full mt-2"
        placeholder="なぜそう思った？（必須）"
        value={comment}
        onChange={e => setComment(e.target.value)}
      />
      <div className="mt-2 flex gap-2">
        <button className="btn btn-primary" disabled={!canSubmit} onClick={() => onSubmit(self.id, targetId, comment)}>送信</button>
        {value && <span className="text-xs text-emerald-600">送信済み</span>}
      </div>
    </div>
  );
}

// ------------------------------
// ちょい UI
// ------------------------------
function Tabs({ children }) {
  const [i, setI] = useState(0);
  const arr = React.Children.toArray(children);
  return (
    <div>
      <div className="flex gap-2 mb-3">
        {arr.map((tab, idx) => (
          <button key={idx} className={`tab ${i === idx ? "tab-active" : ""}`} onClick={() => setI(idx)}>
            {tab.props.label}
          </button>
        ))}
      </div>
      <div>{arr[i]}</div>
    </div>
  );
}
function Tab({ children }) { return <>{children}</>; }

function StyleGuide() {
  return (
    <style>{`
    .btn { padding: 8px 12px; border-radius: 12px; border: 1px solid #e5e7eb; background: #f5f5f5; font-size: 14px; cursor: pointer; }
    .btn:hover { background: #e5e5e5; }
    .btn:disabled { opacity: .6; cursor: not-allowed; }
    .btn-primary { background: #111827; color: #fff; border-color: #111827; }
    .btn-primary:hover { background: #1f2937; }

    .input { padding: 8px 12px; border-radius: 12px; border: 1px solid #e5e7eb; background: #fff; }
    .textarea { min-height: 96px; padding: 8px 12px; border-radius: 12px; border: 1px solid #e5e7eb; background: #fff; width: 100%; }

    .badge { display: inline-flex; align-items: center; gap: 4px; padding: 2px 8px; border-radius: 9999px; border: 1px solid #e5e7eb; font-size: 12px; }

    .chip { padding: 6px 12px; border-radius: 9999px; border: 1px solid #e5e7eb; background: #fff; font-size: 14px; cursor: pointer; }
    .chip:hover { background: #f5f5f5; }
    .chip-active { background: #111827; color: #fff; border-color: #111827; }

    .tab { padding: 8px 12px; border-radius: 12px; border: 1px solid #e5e7eb; background: #fff; font-size: 14px; cursor: pointer; }
    .tab:hover { background: #f5f5f5; }
    .tab-active { background: #111827; color: #fff; }

    /* minimal helpers for card-like blocks */
    .rounded-2xl { border-radius: 16px; }
    .rounded-xl { border-radius: 12px; }
    .border { border: 1px solid #e5e7eb; }
    .bg-white { background: #fff; }
    .p-4 { padding: 16px; }
    .shadow-sm { box-shadow: 0 1px 2px rgba(0,0,0,.05); }

    /* basic color utilities to ensure visibility */
.text-neutral-900 { color: #111827; }
.text-neutral-600 { color: #525252; }
.bg-neutral-50 { background: #f9fafb; }

/* typography utilities */
.font-bold { font-weight: 700; }
.font-semibold { font-weight: 600; }
.font-medium { font-weight: 500; }
.font-mono { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; }

/* layout helpers used in markup */
.min-h-dvh { min-height: 100dvh; }
.mx-auto { margin-left: auto; margin-right: auto; }
.max-w-5xl { max-width: 64rem; }
.space-y-6 > * + * { margin-top: 1.5rem; }
.p-4 { padding: 16px; }
.md\:p-8 { padding: 32px; }
.gap-3 { gap: 0.75rem; }
.mb-2 { margin-bottom: 0.5rem; }
.mt-2 { margin-top: 0.5rem; }
.mt-3 { margin-top: 0.75rem; }
.w-24 { width: 6rem; }
.w-28 { width: 7rem; }
.w-8 { width: 2rem; }
.text-right { text-align: right; }
.grid { display: grid; }
.flex { display: flex; }
.flex-wrap { flex-wrap: wrap; }
.items-center { align-items: center; }
.inline-flex { display: inline-flex; }
.rounded-full { border-radius: 9999px; }

/* ring / badges / notice colors used in markup */
.ring-2 { outline: 2px solid rgba(217, 70, 239, 0.6); }
.ring-fuchsia-400 { outline-color: #e879f9; }
.bg-amber-50 { background: #fffbeb; }
.text-amber-900 { color: #78350f; }
.bg-emerald-100 { background: #d1fae5; }
.text-emerald-800 { color: #065f46; }
.bg-rose-100 { background: #ffe4e6; }
.text-rose-800 { color: #9f1239; }

/* ensure text inside white cards is dark */
.bg-white { background: #fff; color: #111827; }

.devices-grid { display: grid; grid-template-columns: repeat(1, minmax(0, 1fr)); gap: 16px; }
@media (min-width: 900px) { .devices-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (min-width: 1280px) { .devices-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
.device { background: #111827; border-radius: 16px; padding: 8px; border: 1px solid #2b2f36; }
.device-inner { background: #fff; border-radius: 12px; padding: 8px; }
.device h3 { color: #e5e7eb; font-size: 14px; margin: 4px 8px; }
/* remove bullets on name chips lists */
ul { list-style: none; padding-left: 0; margin-left: 0; }

.space-y-1 > * + * { margin-top: 4px; }
.mb-1 { margin-bottom: 4px; }
  `}</style>
  );
}

// ------------------------------
// DebugPanel
// ------------------------------
function DebugPanel({ roomId, phase, currentQ, players, votes, hostId, myId }: any) {
  return (
    <div style={{position:'fixed', right: 12, bottom: 12, background:'#111827', color:'#e5e7eb', padding: '10px 12px', borderRadius: 12, fontSize: 12, maxWidth: 320, zIndex: 9999, boxShadow:'0 4px 12px rgba(0,0,0,.25)'}}>
      <div style={{fontWeight:700, marginBottom:6}}>Debug</div>
      <div>room: <code>{roomId}</code></div>
      <div>phase: <code>{phase}</code></div>
      <div>currentQ: <code>{currentQ}</code></div>
      <div>hostId: <code>{hostId}</code> / myId: <code>{myId}</code></div>
      <div>players: {players.length}</div>
      <div>votes: {Object.keys(votes||{}).length}</div>
    </div>
  );
}

// ------------------------------
// ヘルパー
// ------------------------------
function uid() { return Math.random().toString(36).slice(2, 10); }

/* --------------------------------------------------------------
  サーバ実装ガイド（要約）
  - Next.js App Router + Edge Runtime / Node Runtime
  - 認証不要（匿名）だが Room ごとに ID（6〜8 桁英数）必須
  - 永続化: Supabase（Postgres + Row Level Security）推奨
  - リアルタイム: Supabase Realtime（Broadcast or Presence + Postgres CDC）

  テーブル例（Postgres）
  rooms (id text pk, created_at timestamptz, status text, current_q int, host_id text)
  players (id text pk, room_id text fk, name text, score int default 0, is_host bool)
  questions (room_id text fk, index int, body text)
  votes (room_id text fk, q_index int, voter_id text, target_id text, comment text, primary key(room_id, q_index, voter_id))

  進行ステート
  - status: lobby | answering | reveal_bottom | reveal_second | reveal_first | show_correct | finished

  API（/app/api/** で Route Handlers）
  - POST /api/rooms → { roomId }
  - POST /api/rooms/:id/join { name } → { playerId }
  - POST /api/rooms/:id/start
  - POST /api/rooms/:id/answer { qIndex, targetId, comment }
  - POST /api/rooms/:id/phase { status }
  - POST /api/rooms/:id/next → 次の問題へ、votes クリア

  集計
  - /reveal_* へ遷移する時にサーバで votes を集計して順位を返却
  - 正解判定: 1位に投票した voter に +1（ビジネスルールに合わせて調整可）

  端末制御
  - GM のみ結果画面を見られる: フロントで role=host のみ結果 UI を表示
  - プレーヤー端末: 回答 UI と「GM のスマホで結果発表！」の待機表示

  モデレーション/年齢
  - 性的話題を含みうるため 18+ の同意確認モーダル（利用規約と注意書き）
  - 不適切語句フィルタ（悪質コメントのマスク）

  追記
  - 5問固定だが可変にするなら rooms.max_questions を追加
  - 同率順位は同ページで並記（仕様通り）
-------------------------------------------------------------- */
