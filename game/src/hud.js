// The HUD: the only module that touches the DOM. It reads the store and writes text and class
// names into elements that index.html already has — nothing is created per frame, and a value that
// did not change is not written again.
import { WEAPONS, BUY_LIST, GRENADE } from './weapons.js';
import { RULES } from './state.js';

function el(id) {
  return document.getElementById(id);
}

function formatClock(seconds) {
  const whole = Math.max(0, Math.ceil(seconds));
  const m = Math.floor(whole / 60);
  const s = whole % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function createHud() {
  const nodes = {
    health: el('health'),
    healthBar: el('health-bar'),
    armour: el('armour'),
    armourBar: el('armour-bar'),
    ammoMag: el('ammo-mag'),
    ammoReserve: el('ammo-reserve'),
    ammoBox: el('ammo'),
    weaponName: el('weapon-name'),
    items: el('items'),
    timer: el('timer'),
    scoreUs: el('score-us'),
    scoreThem: el('score-them'),
    roundNumber: el('round-number'),
    phaseLabel: el('phase-label'),
    wallet: el('wallet-value'),
    feed: el('feed'),
    banner: el('banner'),
    bannerTitle: el('banner-title'),
    bannerSub: el('banner-sub'),
    hitmarker: el('hitmarker'),
    vignette: el('vignette'),
    flash: el('flash'),
    buy: el('buy'),
    buyList: el('buy-list'),
    buyFunds: el('buy-funds'),
    board: el('board'),
    boardBody: el('board-body'),
    crosshair: document.documentElement,
    overlay: el('overlay'),
    overlayTitle: el('overlay-title'),
    overlayCopy: el('overlay-copy'),
    objective: el('objective'),
  };

  const cache = {
    health: -1,
    armour: -1,
    mag: -1,
    reserve: -1,
    timer: '',
    us: -1,
    them: -1,
    round: -1,
    phase: '',
    money: -1,
    weapon: '',
    items: '',
    feed: 0,
    bannerTitle: '',
    buySignature: '',
    boardSignature: '',
  };
  let buyHandler = null;
  let buyOpen = false;

  function setText(node, value) {
    if (node.textContent !== value) node.textContent = value;
  }

  function renderBuy(state) {
    const player = state.player;
    const signature = `${player.money}|${player.weapon}|${player.grenades}|${player.armour}`;
    if (signature === cache.buySignature) return;
    cache.buySignature = signature;
    nodes.buyFunds.textContent = `$${player.money}`;
    const rows = [];
    for (const item of BUY_LIST) {
      const owned =
        (item.kind === 'weapon' && player.weapon === item.id) ||
        (item.kind === 'armour' && player.armour >= 100);
      const affordable = player.money >= item.price && !owned;
      rows.push(
        `<li class="${affordable ? '' : 'cant'}" data-key="${item.key}">
          <span class="key">${item.key}</span>
          <span class="name">${item.label}<small>${item.detail}</small></span>
          <span class="price ${owned ? 'owned' : ''}">${owned ? 'equipped' : `$${item.price}`}</span>
        </li>`,
      );
    }
    nodes.buyList.innerHTML = rows.join('');
  }

  function renderBoard(state) {
    const rows = [];
    const p = state.player;
    rows.push(
      `<tr class="you ${p.alive ? '' : 'dead'}"><td>You (attacker)</td><td class="num">${p.kills}</td><td class="num">${p.deaths}</td><td class="num">$${p.money}</td><td class="num">${p.alive ? 'up' : 'down'}</td></tr>`,
    );
    for (const bot of state.bots) {
      rows.push(
        `<tr class="${bot.alive ? '' : 'dead'}"><td>${bot.name} <small>${bot.role}</small></td><td class="num">${bot.kills}</td><td class="num">${bot.deaths}</td><td class="num">—</td><td class="num">${bot.alive ? `${Math.round(bot.health)} hp` : 'down'}</td></tr>`,
      );
    }
    const signature = rows.join('');
    if (signature === cache.boardSignature) return;
    cache.boardSignature = signature;
    nodes.boardBody.innerHTML = signature;
  }

  return {
    nodes,
    onBuy(handler) {
      buyHandler = handler;
      nodes.buyList.addEventListener('click', (event) => {
        const li = event.target.closest('li');
        if (li && buyHandler) buyHandler(li.dataset.key);
      });
    },
    setBuyOpen(open, state) {
      buyOpen = open;
      nodes.buy.classList.toggle('on', open);
      if (open && state) renderBuy(state);
    },
    isBuyOpen() {
      return buyOpen;
    },
    setBoardOpen(open, state) {
      nodes.board.classList.toggle('on', open);
      if (open && state) renderBoard(state);
    },
    hideOverlay() {
      nodes.overlay.hidden = true;
    },
    showOverlay(title, copy) {
      nodes.overlay.hidden = false;
      if (title) nodes.overlayTitle.textContent = title;
      if (copy) nodes.overlayCopy.textContent = copy;
    },
    // The per-frame readout. Cheap by construction: comparisons first, writes only on change.
    update(state) {
      const p = state.player;
      const weapon = WEAPONS[p.weapon];
      const ammo = p.ammo[p.weapon] ?? { mag: 0, reserve: 0 };
      const health = Math.round(p.health);
      if (health !== cache.health) {
        cache.health = health;
        nodes.health.textContent = String(health);
        nodes.health.classList.toggle('low', health <= 35);
        nodes.healthBar.style.width = `${Math.max(0, Math.min(100, health))}%`;
      }
      const armour = Math.round(p.armour);
      if (armour !== cache.armour) {
        cache.armour = armour;
        nodes.armour.textContent = String(armour);
        nodes.armourBar.style.width = `${Math.max(0, Math.min(100, (armour / 100) * 100))}%`;
      }
      if (ammo.mag !== cache.mag || ammo.reserve !== cache.reserve) {
        cache.mag = ammo.mag;
        cache.reserve = ammo.reserve;
        nodes.ammoMag.textContent = String(ammo.mag);
        nodes.ammoReserve.textContent = String(ammo.reserve);
        nodes.ammoBox.classList.toggle('empty', ammo.mag === 0);
      }
      if (weapon && weapon.name !== cache.weapon) {
        cache.weapon = weapon.name;
        nodes.weaponName.textContent = weapon.name;
      }
      const items = `FRAG ×${p.grenades}`;
      if (items !== cache.items) {
        cache.items = items;
        nodes.items.textContent = items;
      }
      const clock = formatClock(state.phase === 'buy' ? state.phaseLeft : state.phaseLeft);
      if (clock !== cache.timer) {
        cache.timer = clock;
        nodes.timer.textContent = clock;
        nodes.timer.classList.toggle('urgent', state.phase !== 'buy' && state.phaseLeft < 20);
      }
      if (state.score.us !== cache.us) {
        cache.us = state.score.us;
        nodes.scoreUs.textContent = String(state.score.us);
      }
      if (state.score.them !== cache.them) {
        cache.them = state.score.them;
        nodes.scoreThem.textContent = String(state.score.them);
      }
      if (state.round !== cache.round) {
        cache.round = state.round;
        nodes.roundNumber.textContent = `Round ${state.round}`;
      }
      const phaseText =
        state.phase === 'buy' ? 'Buy' : state.phase === 'live' ? 'Live' : state.phase === 'matchover' ? 'Match' : 'Round over';
      if (phaseText !== cache.phase) {
        cache.phase = phaseText;
        nodes.phaseLabel.textContent = phaseText;
      }
      const money = Math.round(p.money);
      if (money !== cache.money) {
        cache.money = money;
        nodes.wallet.textContent = `$${money}`;
        if (buyOpen) {
          cache.buySignature = '';
          renderBuy(state);
        }
      }

      // crosshair gap tracks the spread the next shot will have, plus the recoil in the aim
      const gap = 4 + Math.round((p.spread * 1000) + Math.hypot(p.vel.x, p.vel.z) * 1.6 + p.crouch * -1.5);
      nodes.crosshair.style.setProperty('--spread', `${Math.max(2, Math.min(60, gap))}px`);

      // hit marker
      const hitOn = state.hitmarker.timer > 0;
      nodes.hitmarker.classList.toggle('on', hitOn);
      nodes.hitmarker.classList.toggle('kill', hitOn && state.hitmarker.kill);

      // damage: a vignette that follows the hurt timer, and a white flash for an explosion
      const hurt = Math.min(1, p.hurtTimer * 1.6);
      nodes.vignette.style.opacity = hurt.toFixed(2);
      nodes.flash.style.opacity = (state.smoke > 0 ? Math.min(0.55, state.smoke) : 0).toFixed(2);

      // banner
      const bannerOn = state.banner.timer > 0;
      nodes.banner.classList.toggle('on', bannerOn);
      if (bannerOn) {
        if (state.banner.title !== cache.bannerTitle) {
          cache.bannerTitle = state.banner.title;
          nodes.bannerTitle.textContent = state.banner.title;
          nodes.bannerTitle.className = `title ${state.banner.kind}`;
          nodes.bannerSub.textContent = state.banner.sub;
        }
      }

      // objective line follows the charge
      if (state.bomb.state === 'planted') {
        setText(nodes.objective, `Charge armed — ${Math.ceil(state.bomb.timer)}s · hold the site`);
      } else if (state.bomb.state === 'defused') {
        setText(nodes.objective, 'The defence cut the charge');
      } else if (state.bomb.state === 'exploded') {
        setText(nodes.objective, 'Charge detonated');
      } else if (state.phase === 'live') {
        setText(nodes.objective, 'Plant the charge on Valve B · or eliminate the defence');
      }

      // kill feed: rebuild only when the list changes
      if (state.feed.length !== cache.feed || (state.feed.length > 0 && state.feed[0].id !== cache.feedId)) {
        cache.feed = state.feed.length;
        cache.feedId = state.feed[0]?.id;
        let html = '';
        for (let i = state.feed.length - 1; i >= 0; i -= 1) {
          const item = state.feed[i];
          html += `<div class="${item.kind}">${item.text}</div>`;
        }
        nodes.feed.innerHTML = html;
      }

      if (buyOpen) renderBuy(state);
    },
    renderBoard,
  };
}
