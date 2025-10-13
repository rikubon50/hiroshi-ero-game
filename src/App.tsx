import React, { useEffect, useMemo, useRef, useState } from 'react';
import './App.css';

import { supabase } from './lib/supabase';

// ---- Type helpers ----
type Player = { id: string; name: string; score: number };

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

// 合コン向けお題プール（通常80系/ちょいえっち20系）
const GENERAL_QUESTIONS = [
  "小学生の頃、『終業式の日に全ての荷物持ち帰る系生徒』だっただろう人",
  "掃除の時『ちょっと男子！』って言ってそうな人",
  "恋人と別れた理由がかなりドロドロしていそうな人",
  "今日、誰かと連絡先を交換して帰りそうな人",
  "お酒を一番楽しんで酔っ払いそうな人",
  "実はこの場で一番緊張していそうな人",
  "この後、二次会に一番乗り気じゃなさそうな人",
  "次の日も休みだから朝まで遊びそうな人",
  "合コンに慣れていなさそうな人",
  "今日のメンバーの中で一番本命の相手が決まっていそうな人",
  "実はこの後気になる人を誘って抜け出しそうな人",
  "第一印象と今で一番ギャップがありそうな人",
  "合コンに参加する前に作戦会議をしっかり立てていそうな人",
  "今日の合コンを一番反省しそうな人",
  "実は自分のグループの異性に一番辛口なコメントをしそうな人",
  "一番恋愛の修羅場を踏んでいそうな人",
  "給食の時に誰よりも早くおかわりをしそうな人",
  "掃除の時間にほうきで遊んで先生に怒られそうな人",
  "夏休みの宿題を最終日まで残していそうな人",
  "休み時間に友達とずっと恋愛の話をしていそうな人",
  "卒業式で先生に手紙を書いて泣きそうな人",
  "習い事を掛け持ちして放課後が一番忙しそうな人",
  "授業に寝坊して友達に代返を頼みそうな人",
  "テスト前にノートを見せてとたくさんの人に頼られそうな人",
  "学食より外のおしゃれなランチを開拓しそうな人",
  "大学のイケメンの情報を誰よりも詳しそうな人",
  "教育実習に行ったら絶対高校生たちにいじられそうな人",
  "実はかなり嫉妬深い性格の持ち主そうな人",
];

const ERO_QUESTIONS = [
  "視線が妙にエロい人",
  "酔った勢いでキスしたことがありそうな人",
  "ベッドよりソファ派っぽい人(エロい意味で)",
  "エロい夢をよく見そうな人",
  "LINEのアイコンがもうすでにエロい人",
  "キスがうまそうな人",
  "お風呂を一緒に入るのが好きそうな人",
  "声だけで相手をドキッとさせそうな人",
  "夜の駆け引きがうまそうな人",
  "スローよりハードが好きそうな人",
  "経験人数を言えなさそうな人",
  "Hの時に主導権を握りたそうな人",
  "恋人に『もっとして』って言わせそうな人",
  "本気の恋と遊びを上手に使い分けそうな人",
  "一晩の関係でも後悔しなさそうな人",
  "体の相性をすごく重視しそうな人",
  "普段はクールだけどギャップがありそうな人",
  "押しに弱くて流されやすそうな人",
  "人の恋人を奪ったことがありそうな人",
  "耳元で囁くのが似合いそうな人",
  "夜に豹変しそうな人",
  "元恋人と今も連絡を取ってそうな人",
  "ホテル街の場所をやたら詳しそうな人",
  "酔うとスキンシップが増えそうな人",
  "恋人との夜が濃厚そうな人",
];

const ONI_QUESTIONS = [
  "密かにSMプレイに強い憧れがありそうな人",
  "酔っているのを利用して誘惑しそうな人",
  "Hの時、相手を縛ったり目隠しをしたりしたい願望がありそうな人",
  "特定の職業や制服のコスプレに対する強いフェチがありそうな人",
  "Hの時、カメラやスマホで記録されることに抵抗がない人",
  "『複数人で同時に行為に及ぶ』経験に強い興味がありそうな人",
  "『自慰行為』を毎日していそうな人",
  "性的な要求(頻度の高さ)を断る異性に対して内心イラッとしそうな人",
  "勝負下着を着てきてそうな人",
  "恋愛欲より性欲の方が圧倒的に強そうな人",
  "『相手に完全にバレずに浮気を成功させた』経験がありそうな人",
  "自分の性的な動画や写真を誰かに見られたことがありそうな人",
  "一夜限りの関係を目的としてSNSでDMしてそうな人",
  "職場や学校で不適切な関係を持ったことがありそうな人",
  "ホテル以外の予想外の場所でHしたことがありそうな人",
  "酔った相手を介抱している最中に性的な感情を抱いていそうな人(ダメだよ正々堂々と行こうね)",
  "家族や友人に絶対に知られたくない性癖を持っていそうな人",
  "別れ話の際に『最後に1発』とお願いしたことがありそうな人",
  "過去の恋人に『この行為は二度としないで』と真剣に怒られたことがありそうな人",
  "体に歯形がつくほどの激しそうな人",
  "避妊を無視して行為に及んだことがありそうな人(ダメだよ)",
  "『浮気がバレたら』の言い訳を常に考えていそうな人",
  "同性の友人の裸を見て性的な感情を抱いたことがありそうな人(全然問題ないよ！)",
  "自分の性の処理のために誰かを『利用』した経験がありそうな人",
  "『性的な相性』が合わないとわかった瞬間に別れを決意しそうな人",
  "『愛がなくても体の相性が合えば付き合える』と思う人",
  "愛よりもセックスの技巧を重要視しそうな人",
  "『自分は性的なカリスマ性がある』と勘違いしていそうな人",
  "お金を払ってでも自分の性の願望を叶えたいと思ったことがありそうな人",
  "Hの前に『必ずこの準備をする』という独自のルーティンがありそうな人",
  "自分の体の最も敏感な部分を隠さずに言えそうな人",
  "自分は相手のすべてを支配したい欲求が強い人",
  "このメンバーの中で一番Hな秘密を持っていそうな人",
  "ぶっちゃけ、今この場にいる誰かと『体の関係を持ちたい』と真剣に願ってそうな人",
  "今日避妊具持ってきてそうな人(Hする前提できてそうな人)",
  "道具を使ってするのが好きそうな人",
  "親や兄弟に性的な行為を見られたことがありそうな人",
  "酔った勢いでキスしそうな人",
  "このゲームで完全にスイッチが入ってしまってそうな人",
  "『今から二人きりで飲みに行こう』と誘われたら断らなそうな人",
  "間接キスに抵抗がなさそうな人",
  "異性の肩に頭を乗せて甘えたがりそうな人",
  "鎖骨を触られたそうな人(性感帯が鎖骨っぽい)",
  "最もエロい手の握り方をしそうな人",
  "『抱きしめて』と甘えて許されそうな人",
  "キスなら人前でしてもいいよと思ってそうな雰囲気がある人",
  "『もう終電ないよね？』と言いだしそうな人",
  "Hの前に『キスの練習』をしておきたそうな人",
  "人の胸筋を触っても許されそうな人",
  "ぶっちゃけ、今『この場で誰かの下着を覗き見たい』と願ってそうな人",
  "騎乗位好きそうな人",
  "バックが好きそうな人",
  "前戯にめちゃくちゃ時間かけそうな人",
  "前戯が強引で微妙そうな人",
  "めちゃくちゃ前戯焦らしそうな人",
  "すごい喘ぎそうな人",
  "イクのが早そうな人",
];

const PHASES = {
  LOBBY: "LOBBY", // 参加者集合（ルール表示もここで）
  TOPIC_INPUT: "TOPIC_INPUT", // お題入力（自由記述）
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
  const [roomId] = useState(() => {
    const raw = window.location.search || '';
    const cleaned = raw.replace(/amp;/g, ''); // tolerate links that contain literal `amp;`
    const sp = new URLSearchParams(cleaned);
    const q = sp.get('room');
    if (q && /^[A-Z0-9]{6,8}$/.test(q)) return q;
    const rid = Math.random().toString(36).slice(2, 8).toUpperCase();
    sp.set('room', rid);
    const url = new URL(window.location.href);
    url.search = sp.toString();
    window.history.replaceState({}, '', url.toString());
    return rid;
  });
  const [phase, setPhase] = useState(PHASES.LOBBY);
  const [questions, setQuestions] = useState(DEFAULT_QUESTIONS);
  const [currentQ, setCurrentQ] = useState(0);
  const [players, setPlayers] = useState<Player[]>([]);
  const [hostId, setHostId] = useState<string | null>(null);
  const [isGuest] = useState(() => {
    try {
      const raw = window.location.search || '';
      // quick path: if raw contains `&amp;guest=1` or `?guest=1`
      if (/(^|[?&]|&amp;)guest=1(&|$)/.test(raw)) return true;
      const cleaned = raw.replace(/amp;/g, '');
      const sp = new URLSearchParams(cleaned);
      return sp.get('guest') === '1';
    } catch {
      return false;
    }
  });

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
  // ゲスト端末は GM を自動取得しない
  useEffect(() => {
    if (hostId || isGuest) return;
    const t = window.setTimeout(() => {
      if (!hostId && !isGuest) {
        setHostId(myId);
        if (syncRef.current) syncRef.current({ hostId: myId });
      }
    }, 500);
    return () => window.clearTimeout(t);
  }, [hostId, myId, isGuest]);

  // 各プレーヤーの投票 { [playerId]: { targetId, comment } }
  const [votes, setVotes] = useState<Record<string, { targetId: string; comment: string }>>({});
  // 自分が“正答”だとみなす判定：このゲームは「みんなが選びそうな人」を選ぶ系なので、
  // 最終的に 1 位に選ばれた人に投票できていたら正答とする（簡易ルール）
  const [lastRoundResult, setLastRoundResult] = useState(null);
  const [revealIdx, setRevealIdx] = useState(0);

  // ルーレット状態（1問ごとに正解者から1人抽選）
  const [roulette, setRoulette] = useState<null | {
    round: number;
    targetId: string;
    outcome: 'IMMUNITY' | 'DRINK_RIGHT' | 'DRINK_LEFT' | 'DRINK_SELF' | 'DRINK_ALL';
    revealed?: boolean;
    drinkers?: string[]; // 免除適用後に実際に飲む人
  }>(null);

  // 今回のゲーム内の飲み回避権（プレイヤーID→残数）
  const [immunity, setImmunity] = useState<Record<string, number>>({});

  const [gameMode, setGameMode] = useState<'normal' | 'adult' | 'oni'>('normal');
  const skipNextGameModeSync = useRef(false);

  // お題提案パネル表示
  const [showSuggest, setShowSuggest] = useState(false);

  // players のマージ（スコアは常に大きい方を採用して安全にマージ）
  const mergePlayers = (prev: any[], incoming: any[]) => {
    const map = new Map<string, any>();
    prev.forEach(p => map.set(p.id, p));
    incoming.forEach(p => {
      const prevP = map.get(p.id) || {};
      const merged = { ...prevP, ...p };
      const prevScore = (prevP.score ?? 0);
      const incScore = (p?.score ?? prevScore ?? 0);
      // 重要: スコアは常に大きい方を採用（過去状態での上書きを防止）
      merged.score = Math.max(prevScore, incScore);
      map.set(p.id, merged);
    });
    return Array.from(map.values());
  };

  // players の同期をデバウンス
  const playersSyncTimer = useRef<number | null>(null);

  // --- Realtime (Supabase Broadcast) ---
  const syncRef = useRef(null as null | ((diff: any) => void));
  const isRemoteRef = useRef(false);
  const skipNextVotesSync = useRef(false);
  const skipNextPhaseSync = useRef(false);
  const skipNextLastRoundSync = useRef(false);
  const skipNextRevealSync = useRef(false);
  const skipNextQuestionsSync = useRef(false);
  // 初期ロード（localStorage からの再現）中かどうか
  const hydratingRef = useRef(true);
  // ---- Local snapshot rehydrate (on reload) ----
  useEffect(() => {
    const SNAP_KEY = `room:${roomId}:snapshot`;
    try {
      const raw = localStorage.getItem(SNAP_KEY);
      if (!raw) { hydratingRef.current = false; return; }
      const s = JSON.parse(raw);
      if (s && typeof s === 'object') {
        if (s.phase) setPhase(s.phase);
        if (Array.isArray(s.questions)) setQuestions(s.questions);
        if (Number.isInteger(s.currentQ)) setCurrentQ(s.currentQ);
        if (Array.isArray(s.players)) setPlayers(s.players);
        if (s.hostId) setHostId(s.hostId);
        if (s.votes && typeof s.votes === 'object') setVotes(s.votes);
        if (s.lastRoundResult !== undefined) setLastRoundResult(s.lastRoundResult);
        if (Number.isInteger(s.revealIdx)) setRevealIdx(s.revealIdx);
        if (s.gameMode) setGameMode(s.gameMode);
        if (s.roulette !== undefined) setRoulette(s.roulette);
        if (s.immunity !== undefined) setImmunity(s.immunity);
      }
    } catch (e) {
      console.warn('[snapshot] failed to load', e);
    } finally {
      // 次の tick で送信系エフェクトを解放
      setTimeout(() => { hydratingRef.current = false; }, 0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId]);

  // ---- Persist snapshot (per room) ----
  const saveTimerRef = useRef<number | null>(null);
  useEffect(() => {
    if (hydratingRef.current) return;
    const SNAP_KEY = `room:${roomId}:snapshot`;
    const save = () => {
      const data = {
        phase,
        questions,
        currentQ,
        players,
        hostId,
        votes,
        lastRoundResult,
        revealIdx,
        gameMode,
        // ★ persist 追加
        roulette,
        immunity,
      };
      try { localStorage.setItem(SNAP_KEY, JSON.stringify(data)); } catch {}
    };
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(save, 150);
    return () => {
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    };
  }, [roomId, phase, questions, currentQ, players, hostId, votes, lastRoundResult, revealIdx, gameMode, roulette, immunity]);

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
      if (payload.phase !== undefined) { skipNextPhaseSync.current = true; setPhase(payload.phase); }
      if (payload.currentQ !== undefined) { setCurrentQ(payload.currentQ); }
      if (payload.questions !== undefined) {
        skipNextQuestionsSync.current = true;
        setQuestions(payload.questions || []);
      }
      if (payload.votes !== undefined) {
        skipNextVotesSync.current = true;
        // 票はサーバ（orホスト）側の状態を正とし、常に置き換える
        setVotes(payload.votes || {});
      }
      if (payload.hostId !== undefined && payload.hostId) setHostId(payload.hostId);
      if (payload.resetScores === true) {
        setPlayers(prev => prev.map(p => ({ ...p, score: 0 })));
      }
      if (payload.players !== undefined) {
        setPlayers(prev => mergePlayers(prev, payload.players));
      }
      if (payload.lastRoundResult !== undefined) { skipNextLastRoundSync.current = true; setLastRoundResult(payload.lastRoundResult); }
      if (payload.revealIdx !== undefined) { skipNextRevealSync.current = true; setRevealIdx(payload.revealIdx); }
      if (payload.gameMode !== undefined) {
        skipNextGameModeSync.current = true;
        setGameMode(payload.gameMode);
      }
      if (payload.roulette !== undefined) {
        setRoulette(payload.roulette);
      }
      if (payload.immunity !== undefined) {
        setImmunity(payload.immunity || {});
      }
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
  useEffect(() => {
    if (!syncRef.current || isRemoteRef.current || hydratingRef.current) return;
    if (skipNextPhaseSync.current) { skipNextPhaseSync.current = false; return; }
    syncRef.current({ phase });
  }, [phase]);
  useEffect(() => { if (syncRef.current && !isRemoteRef.current && !hydratingRef.current) syncRef.current({ currentQ }); }, [currentQ]);
  useEffect(() => {
    if (!syncRef.current || isRemoteRef.current || hydratingRef.current) return;
    if (skipNextQuestionsSync.current) { skipNextQuestionsSync.current = false; return; }
    syncRef.current({ questions });
  }, [questions]);
  useEffect(() => {
    if (!syncRef.current || isRemoteRef.current || hydratingRef.current) return;
    if (skipNextVotesSync.current) { skipNextVotesSync.current = false; return; }
    syncRef.current({ votes });
  }, [votes]);
  useEffect(() => { if (syncRef.current && !isRemoteRef.current && !hydratingRef.current && hostId) syncRef.current({ hostId }); }, [hostId]);
  useEffect(() => {
    if (!syncRef.current || isRemoteRef.current || hydratingRef.current) return;
    if (playersSyncTimer.current) window.clearTimeout(playersSyncTimer.current);
    playersSyncTimer.current = window.setTimeout(() => {
      // 名前編集中の連続更新を抑える
      syncRef.current && syncRef.current({ players });
      playersSyncTimer.current = null;
    }, 250);
  }, [players]);
  useEffect(() => {
    if (!syncRef.current || isRemoteRef.current || hydratingRef.current) return;
    if (skipNextLastRoundSync.current) { skipNextLastRoundSync.current = false; return; }
    syncRef.current({ lastRoundResult });
  }, [lastRoundResult]);
  useEffect(() => {
    if (!syncRef.current || isRemoteRef.current || hydratingRef.current) return;
    if (skipNextRevealSync.current) { skipNextRevealSync.current = false; return; }
    syncRef.current({ revealIdx });
  }, [revealIdx]);

  // SHOW_CORRECT でルーレット結果を公開＆効果適用（免除の付与/消費・今回飲む人の確定）
  useEffect(() => {
    if (phase !== PHASES.SHOW_CORRECT) return;
    if (!roulette || roulette.revealed) return;
    const t = window.setTimeout(() => {
      // ルーレット由来の候補（※チケットでは回避できない）
      let wheelDrinkers: string[] = [];
      if (roulette.outcome === 'DRINK_RIGHT') {
        // 右隣：アナウンスのみ。演出は誰にも出さない
        wheelDrinkers = [];
      } else if (roulette.outcome === 'DRINK_LEFT') {
        // 左隣：アナウンスのみ。演出は誰にも出さない
        wheelDrinkers = [];
      } else if (roulette.outcome === 'DRINK_SELF') {
        wheelDrinkers = [roulette.targetId];
      } else if (roulette.outcome === 'DRINK_ALL') {
        wheelDrinkers = players.map(p => p.id);
      }

      // 投票ハズレ（正解できなかった人）由来の候補（※チケットで回避可能）
      const losers = (lastRoundResult && Array.isArray((lastRoundResult as any).correctVoterIds))
        ? players.filter((p: Player) => !(lastRoundResult as any).correctVoterIds.includes(p.id)).map(p => p.id)
        : [];

      // 免除適用（ハズレのみ対象）
      let newImmunity = { ...immunity };
      const avoidedIds: string[] = [];
      const finalLosers: string[] = [];
      for (const pid of losers) {
        const has = (newImmunity[pid] || 0) > 0;
        if (has) {
          newImmunity[pid] = Math.max(0, (newImmunity[pid] || 0) - 1); // 1つ消費
          avoidedIds.push(pid);
        } else {
          finalLosers.push(pid);
        }
      }

      // ルーレット由来は免除不可のためそのまま飲む
      const finalDrinkers: string[] = [...finalLosers, ...wheelDrinkers];

      // IMMUNITY 当選は権利 +1（上限1）
      if (roulette.outcome === 'IMMUNITY') {
        const cur = newImmunity[roulette.targetId] || 0;
        newImmunity = { ...newImmunity, [roulette.targetId]: Math.min(1, cur + 1) };
      }

      const nextRoulette = { ...roulette, revealed: true, drinkers: finalDrinkers, avoidedIds } as typeof roulette & { avoidedIds: string[] };
      setImmunity(newImmunity);
      setRoulette(nextRoulette);
      if (syncRef.current) syncRef.current({ immunity: newImmunity, roulette: nextRoulette });
    }, 900);
    return () => window.clearTimeout(t);
  }, [phase, roulette, players, immunity, lastRoundResult]);

  // ★ Safety: ロビーに居るときは必ずローカルのスコアを0に（リロードで古いスナップショットを掴んでも矯正）
  useEffect(() => {
    if (phase !== PHASES.LOBBY) return;
    setPlayers(prev => {
      // すでに全員0なら何もしない（無駄な再レンダー防止）
      if (!prev.some(p => (p.score ?? 0) !== 0)) return prev;
      return prev.map(p => ({ ...p, score: 0 }));
    });
  }, [phase]);

  // trace important values
  useEffect(() => { dlog('phase ->', phase); }, [phase]);
  useEffect(() => { dlog('currentQ ->', currentQ); }, [currentQ]);
  useEffect(() => { dlog('players ->', players.map(p => ({ id: p.id, name: p.name, score: p.score }))); }, [players]);
  useEffect(() => { dlog('votes keys ->', Object.keys(votes)); }, [votes]);
  useEffect(() => { dlog('hostId ->', hostId, 'myId ->', myId); }, [hostId]);

  useEffect(() => {
    if (!syncRef.current || isRemoteRef.current || hydratingRef.current) return;
    if (skipNextGameModeSync.current) { skipNextGameModeSync.current = false; return; }
    syncRef.current({ gameMode });
  }, [gameMode]);

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
      .sort((a, b) => (a as { playerId: string; count: number }).count - (b as { playerId: string; count: number }).count);
    return { counts, comments, rank };
  }, [votes, players]);

  // 表示用ユーティリティ
  const nameOf = (pid: string) => players.find(p => p.id === pid)?.name ?? "?";


  // 次ラウンドへ
  const goNextQuestion = () => {
    const next = currentQ + 1;
    // ルーレット状態をクリア
    setRoulette(null);
    if (syncRef.current) syncRef.current({ roulette: null });
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
    // ルーレットと免除をリセット
    setRoulette(null);
    if (syncRef.current) syncRef.current({ roulette: null });
    setImmunity({});
    if (syncRef.current) syncRef.current({ immunity: {} });
    setPlayers(prev => {
      const reset = prev.map(p => ({ ...p, score: 0 }));
      if (syncRef.current) syncRef.current({ players: reset, resetScores: true });
      return reset;
    });
  };

  // Helper to reset immunity
  const resetImmunity = () => {
    setImmunity({});
    sendDiff && sendDiff({ immunity: {} });
  };

  return (
    <div className="min-h-dvh bg-neutral-50 text-neutral-900 p-4 md:p-8">
      <div className="mx-auto max-w-5xl space-y-6">
        <Header roomId={roomId} phase={phase} currentQ={currentQ} total={questions.length} />
        <PlayersSim
          players={players}
          setPlayers={setPlayers}
          phase={phase}
          setPhase={setPhase}
          question={questions[currentQ]}
          votes={votes}
          setVotes={setVotes}
          nameOf={nameOf}
          onlySelfId={null}
          hostId={hostId}
          roomId={roomId}
          questions={questions}
          setQuestions={setQuestions}
          currentQ={currentQ}
          setCurrentQ={setCurrentQ}
          everyoneAnswered={everyoneAnswered}
          tally={tally}
          lastRoundResult={lastRoundResult}
          setLastRoundResult={setLastRoundResult}
          goNextQuestion={goNextQuestion}
          myId={myId}
          sendDiff={sendDiff}
          revealIdx={revealIdx}
          setRevealIdx={setRevealIdx}
          showSuggest={showSuggest}
          setShowSuggest={setShowSuggest}
          gameMode={gameMode}
          setGameMode={setGameMode}
          roulette={roulette}
          resetImmunity={resetImmunity}
          setRoulette={setRoulette}
          immunity={immunity}
        />
        {/* Host-forced final results (safety net) */}
        {phase === PHASES.FINISHED && (
          <FinalResults players={players} onBack={myId === hostId ? backToLobby : undefined} />
        )}
        
      </div>
    </div>
  );
}

// ------------------------------
// Header
// ------------------------------
type HeaderProps = {
  roomId: string;
  phase: string;
  currentQ: number;
  total: number;
};

function Header({ roomId, phase, currentQ, total }: HeaderProps) {
  const phaseLabel = {
    [PHASES.LOBBY]: "ロビー（参加者集合中）",
    [PHASES.TOPIC_INPUT]: "お題入力",
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
        <h1 className="text-2xl md:text-3xl font-bold">ダレソレ！？</h1>
        <p className="text-sm text-neutral-600">Room ID: <span className="font-mono">{roomId}</span> / 状態: {phaseLabel}</p>
        <div className="mt-2 flex flex-col gap-2">
          <p className="text-xs text-neutral-600">下のリンクをコピーして、参加者に送ってね。</p>
          <div className="flex gap-2">
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
      </div>
      {phase !== PHASES.LOBBY && phase !== PHASES.TOPIC_INPUT && (
        <div className="text-sm text-neutral-600">進行 {Math.min(currentQ + 1, total)} / {total}</div>
      )}
    </div>
  );
}



// ------------------------------
// プレーヤー疑似端末（複数人分の入力を 1 画面で）
// ------------------------------
function PlayersSim({
  players, setPlayers, phase, setPhase, question, votes, setVotes, nameOf, onlySelfId, hostId, roomId, questions, setQuestions, currentQ, setCurrentQ, everyoneAnswered, tally, lastRoundResult, setLastRoundResult, goNextQuestion, myId, sendDiff, revealIdx, setRevealIdx, showSuggest, setShowSuggest, gameMode, setGameMode, roulette, resetImmunity, setRoulette, immunity
}: {
  players: any[];
  setPlayers: React.Dispatch<React.SetStateAction<any[]>>;
  phase: string;
  setPhase: React.Dispatch<React.SetStateAction<string>>;
  question: string;
  votes: Record<string, any>;
  setVotes: React.Dispatch<React.SetStateAction<Record<string, any>>>;
  nameOf: (id: string) => string;
  onlySelfId?: string | null;
  hostId: string | null;
  roomId: string;
  questions: string[];
  setQuestions: React.Dispatch<React.SetStateAction<string[]>>;
  currentQ: number;
  setCurrentQ: React.Dispatch<React.SetStateAction<number>>;
  everyoneAnswered: boolean;
  tally: any;
  lastRoundResult: any;
  setLastRoundResult: React.Dispatch<React.SetStateAction<any>>;
  goNextQuestion: () => void;
  myId: string;
  sendDiff: (diff: any) => void;
  revealIdx: number;
  setRevealIdx: React.Dispatch<React.SetStateAction<number>>;
  showSuggest: boolean;
  setShowSuggest: React.Dispatch<React.SetStateAction<boolean>>;
  gameMode: 'normal' | 'adult' | 'oni';
  setGameMode: React.Dispatch<React.SetStateAction<'normal' | 'adult' | 'oni'>>;
  roulette: any;
  resetImmunity: () => void;
  setRoulette: React.Dispatch<React.SetStateAction<any>>;
  immunity: Record<string, number>;
}) {
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
  const displayName = (pid: string) => `${nameOf(pid)}${(immunity[pid] || 0) > 0 ? '🎟️' : ''}`;

  const self = players.find(p => p.id === myId);
  const [joinName, setJoinName] = useState(self?.name || "");
  const alreadyJoined = !!self;
  const iAmInPlayers = players.some(p => p.id === myId);

  // --- local name state for editing player names (GM) ---
  const [localNames, setLocalNames] = useState<Record<string, string>>({});
  // 飲み確定 演出トグル（この端末のみ）
  const [drinkFx, setDrinkFx] = useState(false);
  const setLocalName = (val: string, id?: string) => {
    const target = id ?? myId;
    setLocalNames(prev => ({ ...prev, [target]: val }));
  };

  const submit = (pid: any, targetId: any, comment: any) => {
    setVotes(prev => ({ ...prev, [pid]: { targetId, comment } }));
    requestAnimationFrame(() => { sendDiff && sendDiff({ votes: { ...votes, [pid]: { targetId, comment } } }); });
  };

  // ラウンドごとに「飲み確定」演出（自分が飲みだった端末だけ）: ルーレットも考慮・免除も考慮
  useEffect(() => {
    if (phase !== PHASES.SHOW_CORRECT) {
      setDrinkFx(false);
      return;
    }
    if (!lastRoundResult || !Array.isArray(lastRoundResult.correctVoterIds)) return;
    const losers = players.filter((p: Player) => !lastRoundResult.correctVoterIds.includes(p.id)).map(p => p.id);
    const rouletteDrinkers: string[] = (typeof roulette === 'object' && roulette?.drinkers) || [];
    const avoided: string[] = (typeof roulette === 'object' && (roulette as any)?.avoidedIds) || [];
    // 実際に飲むのは「候補 − 回避」
    const loserDrinkers = losers.filter(id => !avoided.includes(id));
    const iShouldDrink = loserDrinkers.includes(myId) || rouletteDrinkers.includes(myId);
    if (iShouldDrink) {
      setDrinkFx(true);
      try { if (navigator && 'vibrate' in navigator) (navigator as any).vibrate([80, 120, 160]); } catch {}
    } else {
      setDrinkFx(false);
    }
  }, [phase, lastRoundResult, myId, players, roulette]);

  useEffect(() => {
    if (phase === PHASES.FINISHED) {
      window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
    }
  }, [phase]);

  return (
    <div className="space-y-4">
      {phase !== PHASES.LOBBY && !alreadyJoined && (
        <div className="rounded-2xl border bg-white p-4 shadow-sm">
          <h2 className="font-semibold">ゲーム進行中</h2>
          <p className="text-sm text-neutral-700 mt-1">
            ただいまゲームが進行中です。次のゲーム開始（全員がロビーへ戻ったタイミング）から参加できます。
          </p>
          <p className="text-xs text-neutral-500 mt-2">
            ※ この画面は待機画面です。ロビーに戻ると、名前を入力して参加ボタンが表示されます。
          </p>
        </div>
      )}
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
                {players.map((p: Player) => (
                  <li key={p.id} className="px-3 py-1 rounded-full bg-neutral-100 border text-sm">
                    {p.name}{(immunity[p.id]||0)>0 && '🎟️'}{hostId === p.id ? '（GM）' : ''}
                  </li>
                ))}
              </ul>
              <div className="mt-3">
                <h3 className="font-semibold text-sm mb-1">モード</h3>
                <div className="inline-flex items-center gap-4 text-sm">
                  <label className="inline-flex items-center gap-2">
                    <input
                      type="radio"
                      name="mode"
                      checked={gameMode === 'normal'}
                      onChange={() => { setGameMode('normal'); sendDiff && sendDiff({ gameMode: 'normal' }); }}
                    />
                    普通（おもしろ + ちょいえっち 20%混合）
                  </label>
                  <label className="inline-flex items-center gap-2">
                    <input
                      type="radio"
                      name="mode"
                      checked={gameMode === 'adult'}
                      onChange={() => { setGameMode('adult'); sendDiff && sendDiff({ gameMode: 'adult' }); }}
                    />
                    アダルト（ちょいえっちのみ）
                  </label>
                  <label className="inline-flex items-center gap-2">
                    <input
                      type="radio"
                      name="mode"
                      checked={gameMode === 'oni'}
                      onChange={() => { setGameMode('oni'); sendDiff && sendDiff({ gameMode: 'oni' }); }}
                    />
                    鬼アダルト（超刺激）
                  </label>
                </div>
              </div>

              <div className="mt-3">
                <button className="btn" onClick={() => setShowSuggest(v => !v)}>
                  {showSuggest ? 'お題作成を閉じる' : 'お題を作成する'}
                </button>
              </div>
              {showSuggest && (
                <SuggestQuestionPanel roomId={roomId} authorId={myId} onClose={() => setShowSuggest(false)} />
              )}

              <div className="mt-3">
                <h3 className="font-semibold mb-1">ルール</h3>
                <ol className="list-decimal list-inside text-sm text-neutral-700 space-y-1">
                  <li>GMが問題を進行します。参加者は各設問に対して「みんなが選びそうな人」を投票します。</li>
                  <li>コメントは必須。回答が揃ったらGMがゲームを進行してくれるので自分の画面で結果を確認します。</li>
                  <li>1位に投票できていたら正解。ハズレの人は罰ゲーム。</li>
                  <li>ゲーム終了時の正答数で最終順位を決めます。最下位の人は罰ゲームです。</li>
                  <li>正解者の中からランダムで1人に「ルーレットチャンス」。結果は <span className="whitespace-nowrap">6分の2で飲み回避チケット+1</span>、<span className="whitespace-nowrap">6分の1で右隣が飲み</span>、<span className="whitespace-nowrap">6分の1で左隣が飲み</span>、<span className="whitespace-nowrap">6分の1で自分が飲み</span>、<span className="whitespace-nowrap">6分の1で全員で飲み</span>。</li>
                  <li>飲み回避チケット（🎟️）：所持上限は1枚。投票でのハズレは自動で1枚消費して回避。<span className="whitespace-nowrap">※ルーレットで指名された飲みは回避不可</span>。</li>
                </ol>
              </div>

              <div className="mt-3 flex items-center gap-2">
                <button
                  className="btn btn-primary"
                  disabled={!(iAmInPlayers && players.length >= 2)}
                  onClick={() => { setPhase(PHASES.TOPIC_INPUT); }}
                >参加者が揃ったらタップでゲーム開始！</button>
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
              <div className="mt-4">
                <h3 className="font-semibold mb-1">ルール</h3>
                <ol className="list-decimal list-inside text-sm text-neutral-700 space-y-1">
                  <li>GMが問題を進行します。参加者は各設問に対して「みんなが選びそうな人」を投票します。</li>
                  <li>コメントは必須。回答が揃ったらGMがゲームを進行してくれるので自分の画面で結果を確認します。</li>
                  <li>1位に投票できていたら正解。ハズレの人は罰ゲーム。</li>
                  <li>ゲーム終了時の正答数で最終順位を決めます。最下位の人は罰ゲームです。</li>
                  <li>正解者の中からランダムで1人に「ルーレットチャンス」。結果は <span className="whitespace-nowrap">6分の2で飲み回避チケット+1</span>、<span className="whitespace-nowrap">6分の1で右隣が飲み</span>、<span className="whitespace-nowrap">6分の1で左隣が飲み</span>、<span className="whitespace-nowrap">6分の1で自分が飲み</span>、<span className="whitespace-nowrap">6分の1で全員で飲み</span>。</li>
                  <li>飲み回避チケット（🎟️）：所持上限は1枚。投票でのハズレは自動で1枚消費して回避。<span className="whitespace-nowrap">※ルーレットで指名された飲みは回避不可</span>。</li>
                </ol>
              </div>
              <div className="mt-3">
                <button className="btn" onClick={() => setShowSuggest(v => !v)}>
                  {showSuggest ? 'お題作成を閉じる' : 'お題を作成する'}
                </button>
              </div>
              {showSuggest && (
                <SuggestQuestionPanel roomId={roomId} authorId={myId} onClose={() => setShowSuggest(false)} />
              )}
            </>
          )}
        </div>
      )}


      {isHostView && phase === PHASES.TOPIC_INPUT && (
        <TopicInputPanel gameMode={gameMode} onCancel={() => setPhase(PHASES.LOBBY)} onStart={(qs) => {
          setRevealIdx(0);
          setVotes({});
          setLastRoundResult(null);
          // ★ New: スコアをリセット（新ゲームは0点から）
          setPlayers(prev => {
            const reset = prev.map(p => ({ ...p, score: 0 }));
            // ブロードキャスト（他端末も0点に同期・権限リセット）
            sendDiff && sendDiff({ players: reset, resetScores: true });
            return reset;
          });
          resetImmunity();
          setQuestions(qs);
          setCurrentQ(0);
          setPhase(PHASES.IN_PROGRESS);
          // 参加端末へお題セットと初期状態を配信
          sendDiff && sendDiff({ questions: qs, votes: {}, revealIdx: 0, lastRoundResult: null, currentQ: 0, phase: PHASES.IN_PROGRESS });
        }} />
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
                immunity={immunity}
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
          <h2 className="font-semibold">結果発表：{totalRanks === 1 ? '1位（同率）' : (revealIdx === 0 ? '最下位' : `${currentRank}位`)}</h2>
          <div className="flex items-center gap-3 text-lg">
            <span className="font-medium">{currentGroup.playerIds.map(displayName).join('、')}</span>
            <span className="badge">{currentGroup.count} 票</span>
          </div>
          {/* グループ全員分のコメント一覧（対象ごと） */}
          <div className="mt-2">
            <h4 className="text-sm font-semibold mb-1">コメント（対象ごと）</h4>
            {(() => {
              const byTarget: Record<string, { voterId: string; targetId: string; comment: string }[]> = {};
              (tally.comments || []).forEach((c: any) => {
                if (!currentGroup.playerIds.includes(c.targetId)) return;
                (byTarget[c.targetId] ||= []).push(c);
              });
              return (
                <div className="space-y-2">
                  {currentGroup.playerIds.map((pid: string) => (
                    <div key={pid} className="rounded-xl border p-2">
                      <div className="text-sm font-medium mb-1 flex items-center gap-2">
                        <span className="inline-block px-2 py-0.5 rounded-full bg-neutral-100 border">{displayName(pid)}</span>
                        <span className="text-xs text-neutral-500">{(byTarget[pid]?.length || 0)} 件</span>
                      </div>
                      {byTarget[pid] && byTarget[pid].length > 0 ? (
                        <ul className="space-y-1">
                          {byTarget[pid].map((c, idx) => (
                            <li key={idx} className="text-sm">{c.comment}</li>
                          ))}
                        </ul>
                      ) : (
                        <p className="text-xs text-neutral-500">コメントなし</p>
                      )}
                    </div>
                  ))}
                </div>
              );
            })()}
          </div>
          <div className="flex gap-2 mt-3">
            {revealIdx < totalRanks - 1 ? (
              <button className="btn" onClick={() => setRevealIdx(revealIdx + 1)}>次へ（{totalRanks - (revealIdx + 1)}位）</button>
            ) : (
              <button
                className="btn btn-primary"
                onClick={() => {
                  // 1位のターゲット（同率含む）を取得
                  const rankArr = (tally.rank || []);
                  const maxCount = rankArr.length ? rankArr[rankArr.length - 1].count : null;
                  const firstTargets = maxCount != null
                    ? rankArr.filter((e: any) => e.count === maxCount).map((e: any) => e.playerId)
                    : [];
                  // 正答者（1位の誰かに投票した人）を抽出
                  const correctVoterIds = firstTargets.length
                    ? Object.entries(votes as any)
                        .filter(([, v]: any) => firstTargets.includes(v?.targetId))
                        .map(([pid]) => pid)
                    : [];
                  // スコア加点（同期を確実にするため即座に配信）
                  const updatedPlayers = players.map(p =>
                    correctVoterIds.includes(p.id)
                      ? { ...p, score: (p.score || 0) + 1 }
                      : p
                  );
                  setPlayers(updatedPlayers);
                  // Realtime & 他端末に即反映
                  sendDiff && sendDiff({ players: updatedPlayers });
                  // ラウンド結果を保存
                  setLastRoundResult({ firstTargets, correctVoterIds });
                  // --- ルーレット抽選 ---
                  if (correctVoterIds.length) {
                    const targetId = correctVoterIds[Math.floor(Math.random() * correctVoterIds.length)];
                    const wheel: Array<'IMMUNITY'|'IMMUNITY'|'DRINK_RIGHT'|'DRINK_LEFT'|'DRINK_SELF'|'DRINK_ALL'> = ['IMMUNITY','IMMUNITY','DRINK_RIGHT','DRINK_LEFT','DRINK_SELF','DRINK_ALL'];
                    const outcome = wheel[Math.floor(Math.random() * wheel.length)];
                    const r = { round: currentQ, targetId, outcome, revealed: false } as const;
                    setRoulette(r);
                    sendDiff && sendDiff({ roulette: r });
                  } else {
                    setRoulette(null);
                    sendDiff && sendDiff({ roulette: null });
                  }
                  // 当たり/ハズレ表示へ
                  setPhase(PHASES.SHOW_CORRECT);
                }}
              >外した人を確認！</button>
            )}
          </div>
        </div>
      )}

      {phase === PHASES.SHOW_CORRECT && roulette && (
        <div className="rounded-2xl border bg-white p-4 shadow-sm">
          <h3 className="font-semibold">🎰 ルーレットチャンス</h3>
          <p className="text-sm text-neutral-700 mt-1">
            挑戦者：<span className="font-medium">{displayName(roulette.targetId)}</span>
          </p>
          {!roulette.revealed ? (
            <div className="mt-2 text-sm text-neutral-500">スピン中…</div>
          ) : (
            <div className="mt-3 p-3 rounded-xl border bg-neutral-50">
              {roulette.outcome === 'IMMUNITY' && (<span>当たり！<b>飲み回避権 +1</b> を獲得 🎟️</span>)}
              {roulette.outcome === 'DRINK_RIGHT' && (
                <span><b>{displayName(roulette.targetId)}の右隣の人は飲み</b> 🍻</span>
              )}
              {roulette.outcome === 'DRINK_LEFT' && (
                <span><b>{displayName(roulette.targetId)}の左隣の人は飲み</b> 🍻</span>
              )}
              {roulette.outcome === 'DRINK_SELF' && (<span><b>自分が飲み</b> 🥤</span>)}
              {roulette.outcome === 'DRINK_ALL' && (<span><b>全員で飲み</b> 🍺</span>)}
            </div>
          )}
        </div>
      )}
      {phase === PHASES.SHOW_CORRECT && lastRoundResult && (
        <div className="rounded-2xl border bg-white p-4 shadow-sm">
          <h3 className="font-semibold">飲む人（外した人のみ表示）</h3>
          {(() => {
            const losers = players.filter((p: Player) => !lastRoundResult.correctVoterIds.includes(p.id));
            return (
              <>
                {losers.length === 0 ? (
                  <div className="mt-2 p-3 rounded-xl bg-emerald-50 border text-emerald-900">今回は全員セーフ！飲む人はいません。</div>
                ) : (
                  <ul className="mt-2 grid sm:grid-cols-2 gap-2">
                    {losers.map((p: Player) => (
                      <li key={p.id} className="p-2 rounded-xl border">
                        {(() => {
                          const avoided = Array.isArray((roulette as any)?.avoidedIds) ? (roulette as any).avoidedIds as string[] : [];
                          const didAvoid = avoided.includes(p.id);
                          return (
                            <span className="font-medium">
                              {displayName(p.id)}{didAvoid ? 'はチケットを消費して飲み回避' : 'は飲み'}
                            </span>
                          );
                        })()}
                      </li>
                    ))}
                  </ul>
                )}
              </>
            );
          })()}
          {isHostView && (
            <div className="mt-3 flex gap-2">
              <button className="btn" onClick={goNextQuestion}>
                {currentQ >= questions.length - 1 ? '最終結果へ' : `第${currentQ + 2}問 開始`}
              </button>
            </div>
          )}
        </div>
      )}

      {!isHostView && (phase === PHASES.REVEAL_FROM_BOTTOM || phase === PHASES.REVEAL_SECOND || phase === PHASES.REVEAL_FIRST) && currentGroup && (
        <div className="rounded-2xl border bg-white p-4 shadow-sm">
          <h2 className="font-semibold">結果発表：{totalRanks === 1 ? '1位（同率）' : (revealIdx === 0 ? '最下位' : `${currentRank}位`)}</h2>
          <div className="flex items-center gap-3 text-lg">
            <span className="font-medium">{currentGroup.playerIds.map(displayName).join('、')}</span>
            <span className="badge">{currentGroup.count} 票</span>
          </div>
          <div className="mt-2">
            <h4 className="text-sm font-semibold mb-1">コメント（対象ごと）</h4>
            {(() => {
              const byTarget: Record<string, { voterId: string; targetId: string; comment: string }[]> = {};
              (tally.comments || []).forEach((c: any) => {
                if (!currentGroup.playerIds.includes(c.targetId)) return;
                (byTarget[c.targetId] ||= []).push(c);
              });
              return (
                <div className="space-y-2">
                  {currentGroup.playerIds.map((pid: string) => (
                    <div key={pid} className="rounded-xl border p-2">
                      <div className="text-sm font-medium mb-1 flex items-center gap-2">
                        <span className="inline-block px-2 py-0.5 rounded-full bg-neutral-100 border">{displayName(pid)}</span>
                        <span className="text-xs text-neutral-500">{(byTarget[pid]?.length || 0)} 件</span>
                      </div>
                      {byTarget[pid] && byTarget[pid].length > 0 ? (
                        <ul className="space-y-1">
                          {byTarget[pid].map((c, idx) => (
                            <li key={idx} className="text-sm">{c.comment}</li>
                          ))}
                        </ul>
                      ) : (
                        <p className="text-xs text-neutral-500">コメントなし</p>
                      )}
                    </div>
                  ))}
                </div>
              );
            })()}
          </div>
        </div>
      )}
      {drinkFx && (
        <>
          <style>
            {`
              @keyframes keg-pop { 0% { transform: scale(0.7); opacity: 0; } 40% { transform: scale(1.08); opacity: 1; } 60% { transform: scale(0.98); } 100% { transform: scale(1); opacity: 1; } }
              @keyframes beer-bounce { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-8px); } }
            `}
          </style>
          <div className="pointer-events-none mt-4 flex items-center justify-center w-full">
            <div
              className="pointer-events-auto rounded-3xl border bg-white/90 shadow-2xl px-8 py-6 flex items-center gap-4"
              style={{ animation: 'keg-pop 600ms ease-out', maxWidth: 'fit-content' }}
            >
              <div style={{ fontSize: 48, animation: 'beer-bounce 1.1s ease-in-out infinite' }}>🍺</div>
              <div className="text-2xl font-extrabold text-rose-700">飲み確定！</div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}


function PlayerVoteCard({ self, players, value, onSubmit, immunity }: { self: Player; players: Player[]; value: { targetId: string; comment: string } | undefined; onSubmit: (pid: string, targetId: string, comment: string) => void; immunity: Record<string, number>; }) {
  const [targetId, setTargetId] = useState(value?.targetId || "");
  const [comment, setComment] = useState(value?.comment || "");

  const canSubmit = targetId && comment.trim().length > 0;

  return (
    <div className="rounded-xl border p-3">
      <div className="font-medium mb-2">{self.name} の投票</div>
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="投票対象">
        {players.map(p => {
          const active = targetId === p.id;
          return (
            <button
              key={p.id}
              type="button"
              role="radio"
              aria-checked={active}
              className={
                `px-3 py-1 rounded-full border transition focus:outline-none focus:ring-2 ` +
                (active
                  ? `bg-indigo-600 text-white border-indigo-600 ring-indigo-300 shadow-sm`
                  : `bg-neutral-100 text-neutral-900 border-neutral-300 hover:bg-neutral-200`)
              }
              onClick={() => setTargetId(p.id)}
            >
              <span className="inline-flex items-center gap-2">
                <span
                  className={
                    `inline-block w-2.5 h-2.5 rounded-full ` +
                    (active ? `bg-white` : `bg-neutral-400`)
                  }
                  aria-hidden="true"
                />
                <span>{p.name}{(immunity[p.id]||0)>0 && '🎟️'}</span>
                {active && <span className="ml-1 text-xs opacity-90">✓ 選択中</span>}
              </span>
            </button>
          );
        })}
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


// ------------------------------
// DebugPanel
// ------------------------------

// ------------------------------
// Extend Window interface
// ------------------------------
declare global {
  interface Window {
    _votes?: Record<string, { targetId: string; comment: string }>;
  }
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

// お題入力パネル
function TopicInputPanel({ gameMode, onCancel, onStart }: { gameMode: 'normal'|'adult'|'oni'; onCancel?: () => void; onStart: (questions: string[]) => void }) {
  const [freeText, setFreeText] = useState("");
  const [includeFree, setIncludeFree] = useState(true);
  // 5問生成：1/5 でエロ系、それ以外は通常。free を混ぜる場合はランダムで1問差し替え
  const buildQuestions = () => {
    const pick = <T,>(arr: T[]) => arr[Math.floor(Math.random() * arr.length)];
    const out: string[] = [];
    if (gameMode === 'oni') {
      for (let i = 0; i < 5; i++) out.push(pick(ONI_QUESTIONS));
    } else if (gameMode === 'adult') {
      for (let i = 0; i < 5; i++) out.push(pick(ERO_QUESTIONS));
    } else {
      for (let i = 0; i < 5; i++) {
        const isEro = Math.random() < 0.2;
        out.push(isEro ? pick(ERO_QUESTIONS) : pick(GENERAL_QUESTIONS));
      }
    }
    if (includeFree && freeText.trim()) {
      const idx = Math.floor(Math.random() * out.length);
      out[idx] = freeText.trim();
    }
    return out;
  };

  return (
    <div className="rounded-2xl border bg-white p-4 shadow-sm">
      <h2 className="font-semibold">お題入力（任意）</h2>
      <p className="text-sm text-neutral-600">5問のうち 1問は 20% の確率で「ちょいえっち」系が混ざります。自由記述を混ぜる場合は下に入力してください。</p>
      <label className="mt-2 block text-sm font-medium">自由記述のお題（任意）</label>
      <textarea className="textarea w-full mt-1" placeholder="例）今日一番モテるのは誰？" value={freeText} onChange={e => setFreeText(e.target.value)} />
      <label className="mt-2 inline-flex items-center gap-2 text-sm"><input type="checkbox" checked={includeFree} onChange={e => setIncludeFree(e.target.checked)} />この自由記述を今回ランダムで混ぜる</label>
      <div className="mt-3 flex gap-2">
        {onCancel && <button className="btn" onClick={onCancel}>戻る</button>}
        <button className="btn btn-primary" onClick={() => onStart(buildQuestions())}>ゲームを開始</button>
      </div>
    </div>
  );
}

function SuggestQuestionPanel({ roomId, authorId, onClose }: { roomId: string; authorId: string; onClose?: () => void }) {
  const [body, setBody] = useState("");
  const [category, setCategory] = useState<'general' | 'ero'>('general');
  const [submitting, setSubmitting] = useState(false);
  const canSubmit = body.trim().length >= 4 && body.trim().length <= 120 && !submitting;

  const submit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const payload = { room_id: roomId, author_id: authorId, body: body.trim(), category, created_at: new Date().toISOString() };
      const { error } = await supabase.from('question_suggestions').insert(payload);
      if (error) throw error;
      alert('お題を受け付けました。ご協力ありがとうございます！');
      setBody("");
      setCategory('general');
      onClose && onClose();
    } catch (e: any) {
      console.error(e);
      alert('送信に失敗しました。時間をおいて再度お試しください。');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mt-3 rounded-2xl border bg-white p-4 shadow-sm">
      <h3 className="font-semibold">お題を投稿</h3>
      <p className="text-xs text-neutral-600">運営側に蓄積され、今後の問題プールに活用されます（4〜120文字）。</p>
      <textarea className="textarea w-full mt-2" placeholder="例）今日のメンバーで一番マイペースなのは誰？" value={body} onChange={e => setBody(e.target.value)} maxLength={120} />
      <div className="mt-2 flex items-center gap-3 text-sm">
        <label className="inline-flex items-center gap-2">
          <input type="radio" name="qcat" checked={category==='general'} onChange={() => setCategory('general')} />
          通常（おもしろ系）
        </label>
        <label className="inline-flex items-center gap-2">
          <input type="radio" name="qcat" checked={category==='ero'} onChange={() => setCategory('ero')} />
          ちょいえっち
        </label>
      </div>
      <div className="mt-3 flex gap-2">
        <button className="btn" onClick={onClose}>閉じる</button>
        <button className="btn btn-primary" disabled={!canSubmit} onClick={submit}>{submitting ? '送信中…' : '送信'}</button>
      </div>
    </div>
  );
}