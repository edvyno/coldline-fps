// Rounds: the loop that makes it a match rather than a shooting range. Buy phase, live round, a
// winner with a reason, money paid out, the next round on the same map, first to four. Every
// transition runs through here, so the score, the economy and the banner can never disagree.
import { RULES, resetPlayerForRound, spawnPlayer, makeBot, BOT_TEMPLATES, setBanner, pushFeed } from './state.js';
import { botLoadout } from './bots.js';
import { PATROLS } from './nav.js';

const ROUND_OVER_SECONDS = 4.2;
const MATCH_OVER_SECONDS = 9;

// Puts the map back to its starting state for a fresh round: bodies at their spawns, weapons on the
// loadout the player paid for, the charge back in hand, the clock wound to the buy phase.
export function startRound(state, world, options = {}) {
  if (!state.player) spawnPlayer(state, world.spawn);
  const player = resetPlayerForRound(state, world.spawn);
  if (options.keepPhase !== true) {
    state.phase = 'buy';
    state.phaseLeft = RULES.buySeconds;
  }
  state.bomb.state = 'carried';
  state.bomb.timer = RULES.fuseSeconds;
  state.bomb.site = { x: world.site.x, y: world.site.y, z: world.site.z };
  state.bomb.plantProgress = 0;
  state.bomb.defuseProgress = 0;
  state.bomb.beep = 0;
  state.grenade.live = false;
  state.feed = [];
  state.roundWinner = null;
  state.roundReason = '';
  player.hasBomb = true;

  state.bots = [];
  const spawnSlots = world.botSpawns;
  for (let i = 0; i < BOT_TEMPLATES.length; i += 1) {
    const template = BOT_TEMPLATES[i];
    const spawn = spawnSlots[i % spawnSlots.length];
    const bot = makeBot(template, i, spawn);
    const loadout = botLoadout(template.role);
    bot.weapon = loadout.weapon;
    bot.armour = loadout.armour;
    bot.ammo = loadout.weapon === 'smg' ? 30 : 30;
    bot.patrolIndex = 0;
    bot.path = [];
    bot.pathIndex = 0;
    bot.holdUntil = state.elapsed + 1 + i * 0.4;
    state.bots.push(bot);
  }
  state.botsVersion += 1;
  setBanner(state, `Round ${state.round}`, `Buy ${RULES.buySeconds}s · plant the charge at Valve B`, '', 2.4);
}

// Money for the round's outcome. The loser's payout grows with a losing streak, so a team that is
// behind can still buy, which is what keeps a match from running away.
export function payout(state, attackerWon) {
  const player = state.player;
  if (attackerWon) {
    player.money = Math.min(RULES.maxMoney, player.money + RULES.winReward);
    state.lossStreak = 0;
    state.botLossStreak += 1;
  } else {
    const loss = Math.min(RULES.maxLossReward, RULES.lossReward + state.lossStreak * RULES.lossStep);
    player.money = Math.min(RULES.maxMoney, player.money + loss);
    state.lossStreak += 1;
    state.botLossStreak = 0;
  }
}

function endRound(state, winner, reason, hooks) {
  if (state.phase === 'roundover' || state.phase === 'matchover') return;
  state.phase = 'roundover';
  state.phaseLeft = ROUND_OVER_SECONDS;
  state.roundWinner = winner;
  state.roundReason = reason;
  if (winner === 'us') {
    state.score.us += 1;
    payout(state, true);
    hooks.audio.roundWin();
    setBanner(state, 'Round won', reason, 'win', ROUND_OVER_SECONDS);
  } else {
    state.score.them += 1;
    payout(state, false);
    hooks.audio.roundLoss();
    setBanner(state, 'Round lost', reason, 'loss', ROUND_OVER_SECONDS);
  }
  pushFeed(state, `${winner === 'us' ? 'You' : 'Defence'} · ${reason}`, winner === 'us' ? 'you' : 'them');
  state.player.alive = state.player.alive && winner === 'us' ? state.player.alive : false;
  if (state.score.us >= RULES.winsToTake || state.score.them >= RULES.winsToTake) {
    state.matchOver = true;
  }
}

// Called by the rest of the game when a body dies, so a death and the round it ends are one event.
export function onBotKilled(state, hooks, bot, headshot) {
  state.player.kills += 1;
  state.player.money = Math.min(RULES.maxMoney, state.player.money + RULES.killReward);
  bot.deaths += 1;
  pushFeed(state, `You ${headshot ? 'headshot' : 'killed'} ${bot.name}`, 'you');
  hooks.audio.hit(headshot);
  state.hitmarker.timer = 0.22;
  state.hitmarker.kill = true;
  const aliveBots = state.bots.filter((b) => b.alive).length;
  if (aliveBots === 0 && state.phase === 'live') {
    endRound(state, 'us', 'defence eliminated', hooks);
  }
}

export function onPlayerKilled(state, hooks, killer) {
  const p = state.player;
  p.deaths += 1;
  p.alive = false;
  pushFeed(state, `${killer ? killer.name : 'Defence'} killed you`, 'them');
  if (state.bomb.state === 'planted') {
    // the charge is down: the defenders still have to defuse it, so the round is not over
    setBanner(state, 'You are down', 'The charge is ticking — the defence must defuse it', 'loss', 2.4);
    return;
  }
  if (state.phase === 'live') endRound(state, 'them', 'attacker eliminated', hooks);
}

// The clock, the phase, and every way a round can end. One place, checked in order of priority:
// a live charge outranks the clock, and the clock outranks nothing else.
export function stepRounds(state, world, dt, hooks) {
  const bomb = state.bomb;

  if (state.phase === 'matchover') {
    state.phaseLeft -= dt;
    return;
  }

  if (state.phase === 'buy') {
    state.phaseLeft -= dt;
    if (state.phaseLeft <= 0) {
      state.phase = 'live';
      state.phaseLeft = RULES.roundSeconds;
      setBanner(state, 'Go', 'Plant the charge at Valve B', '', 1.6);
      hooks.audio.buy();
    }
    return;
  }

  if (state.phase === 'roundover') {
    state.phaseLeft -= dt;
    if (state.phaseLeft <= 0) {
      if (state.matchOver) {
        state.phase = 'matchover';
        state.phaseLeft = MATCH_OVER_SECONDS;
        const won = state.score.us >= RULES.winsToTake;
        setBanner(state, won ? 'Site held' : 'Site lost', `Final score ${state.score.us} — ${state.score.them}`, won ? 'win' : 'loss', MATCH_OVER_SECONDS);
      } else {
        state.round += 1;
        startRound(state, world);
      }
    }
    return;
  }

  // live
  state.phaseLeft -= dt;
  if (bomb.state === 'planted') {
    // the clock stops mattering once the charge is down: only defuse or detonation ends it
    if (bomb.state === 'planted' && state.phaseLeft < 0) state.phaseLeft = 0;
  } else if (state.phaseLeft <= 0) {
    state.phaseLeft = 0;
    endRound(state, 'them', 'time expired', hooks);
    return;
  }

  const aliveBots = state.bots.filter((b) => b.alive).length;
  if (aliveBots === 0 && bomb.state !== 'planted') {
    endRound(state, 'us', 'defence eliminated', hooks);
  }
}

// The charge blowing or being cut: both end the round on their own terms.
export function bombExploded(state, hooks) {
  if (state.phase !== 'live') return;
  pushFeed(state, 'The charge detonated', 'you');
  endRound(state, 'us', 'charge detonated', hooks);
}

export function bombDefused(state, hooks) {
  if (state.phase !== 'live') return;
  pushFeed(state, 'Defence defused the charge', 'them');
  endRound(state, 'them', 'charge defused', hooks);
}

export function nextRound(state, world) {
  if (state.matchOver) {
    // a fresh match after the final round: same map, clean score
    state.matchOver = false;
    state.score.us = 0;
    state.score.them = 0;
    state.round = 1;
    state.lossStreak = 0;
    state.botLossStreak = 0;
    state.player.money = RULES.startingMoney;
    state.player.kills = 0;
    state.player.deaths = 0;
    state.player.weapon = 'pistol';
    state.player.grenades = 0;
    state.player.armour = 0;
    state.player.ammo.rifle = { mag: 0, reserve: 0 };
    state.player.ammo.smg = { mag: 0, reserve: 0 };
  }
  startRound(state, world);
}
