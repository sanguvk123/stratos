// Plays a climb over real HTTP against a running server, the way a browser would.
//
//   node scripts/play-dive.mjs [baseUrl] [daily|practice] [fast]
//
// "fast" plays one question and stops. The first matching answer locks a question and is scored at
// once, so a whole climb now takes seconds, not seven minutes. The accepted answers are never
// exposed by the API (by design), so this script tries a list of likely guesses, including some
// deliberate misspellings, until one is accepted.

const base = process.argv[2] ?? 'http://localhost:3200';
const mode = process.argv[3] ?? 'practice';
const fast = process.argv[4] === 'fast';
let cookie = '';

async function call(method, path, body) {
  const res = await fetch(base + path, {
    method,
    headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const set = res.headers.get('set-cookie');
  if (set) cookie = set.split(';')[0];
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: res.status, json };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const log = (...args) => console.log(...args);

// One or two plausible guesses per Indian question, the second spelt wrongly on purpose.
const GUESSES = [
  'Maharastra', 'Delhi', 'Ganga', 'Diwali', 'Mumbai Indians', 'Shah Rukh Khan', 'Hindi', 'Biriyani',
  'Dhoni', 'Shimla', 'Corbett', 'Narendra Modi', 'Bharatnatyam', 'Sitar', 'Mahatma Gandhi', 'Taj Mahal',
  'Turmeric', 'Hockey', 'Tiger', 'Akbar', 'Ganesha', 'Roti', 'Eden Gardens',
];

const hints = JSON.stringify((await call('POST', '/api/session', { mode })).json);
if (/example|provisional|candidate|activity/i.test(hints)) {
  throw new Error('the session view leaks something it should not: ' + hints);
}

let view = (await call('POST', '/api/session', { mode })).json;
log(`session ${view.sessionId.slice(0, 8)} mode=${view.mode} ranked=${view.isRanked} state=${view.state}`);
const sid = view.sessionId;
const total = fast ? 1 : view.questionCount;

for (let q = 1; q <= total; q += 1) {
  for (;;) {
    const r = await call('POST', `/api/session/${sid}/round`, { questionIndex: q });
    if (r.status === 200) {
      view = r.json;
      break;
    }
    if (r.json?.error === 'TOO_EARLY') {
      await sleep(Math.max(300, (r.json.availableAt ?? Date.now()) - Date.now() + 100));
      continue;
    }
    throw new Error(`issue q${q}: ${r.status} ${JSON.stringify(r.json)}`);
  }

  const round = view.activeRound;
  const keys = Object.keys(round).sort().join(',');
  log(`\nQ${q}: ${round.question.prompt}  (window ${(round.closesAt - round.servedAt) / 1000}s)`);
  log(`  qualifier: ${round.question.qualifier}`);
  log(`  active round exposes only: ${keys}`);

  // An answer that cannot count must not lock the question.
  const bad = await call('POST', `/api/session/${sid}/answer`, {
    roundId: round.roundId,
    rawText: 'zzz qqq nope',
    requestId: crypto.randomUUID(),
  });
  log(`  junk answer -> accepted=${bad.json.accepted} ${bad.json.reason ?? ''}`);

  let locked = null;
  for (const guess of GUESSES) {
    const r = await call('POST', `/api/session/${sid}/answer`, {
      roundId: round.roundId,
      rawText: guess,
      requestId: crypto.randomUUID(),
    });
    if (r.json?.accepted) {
      locked = { guess, ...r.json };
      break;
    }
  }

  if (locked) {
    const res = locked.result;
    log(`  typed "${locked.guess}" -> locked as "${locked.answerText}"${locked.corrected ? ' (spelling corrected)' : ''}`);
    log(`  FINAL at once: tier ${res.tier}  +${res.points} pts (${res.points} km)  popularity=${JSON.stringify(res.popularity)}`);

    // A second answer must be refused: the lock is final.
    const again = await call('POST', `/api/session/${sid}/answer`, {
      roundId: round.roundId,
      rawText: locked.guess,
      requestId: crypto.randomUUID(),
    });
    log(`  second answer -> accepted=${again.json.accepted} ${again.json.reason ?? ''}`);
  } else {
    log('  no guess matched this question; waiting out the clock (scores 0)');
    await sleep(Math.max(0, round.closesAt - Date.now() + 700));
  }
  view = (await call('GET', `/api/session/${sid}`)).json;
}

log(`\nstate=${view.state}  total=${view.totalPoints} pts  results=${view.results.length}`);
if (view.state === 'challenge_complete') {
  const final = await call('GET', `/api/session/${sid}/result`);
  log(`final result: ${final.json.totalPoints}/${final.json.maxPoints}  rank=${final.json.rank}/${final.json.participants}`);
  log(final.json.shareText);
}
