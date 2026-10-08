(() => {
  'use strict';

  // Fixed world coordinates keep the game consistent across screen sizes.
  const WORLD = { width: 1200, height: 720 };
  const TAU = Math.PI * 2;
  const canvas = document.getElementById('gameCanvas');
  const context = canvas.getContext('2d');
  const ui = Object.fromEntries([
    'hpValue', 'hpFill', 'hpBar', 'xpValue', 'xpFill', 'xpBar', 'levelValue',
    'killValue', 'timeValue', 'waveValue', 'bossWarning', 'statusValue',
    'startScreen', 'upgradeScreen', 'pauseScreen', 'gameOverScreen',
    'upgradeChoices', 'upgradeLevel', 'playButton', 'restartButton',
    'resumeButton', 'pauseButton', 'finalTime', 'finalKills', 'finalLevel',
    'bossBar', 'bossName', 'bossHpFill', 'bossHpValue', 'arena',
  ].map(id => [id, document.getElementById(id)]));
  const keys = new Set();
  const touchDirections = new Map();
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const viewport = { width: 1200, height: 720, scale: 1, x: 0, y: 0, dpr: 1 };

  // Enemy definitions and progression are independent of rendering.
  const ENEMY_TYPES = {
    basic: { hp: 24, speed: 63, damage: 12, radius: 14, xp: 4, color: '#ff4e9b' },
    fast: { hp: 19, speed: 119, damage: 9, radius: 11, xp: 5, color: '#ffcf5e' },
    tank: { hp: 115, speed: 39, damage: 20, radius: 23, xp: 13, color: '#a98bff' },
    boss: { hp: 850, speed: 48, damage: 28, radius: 45, xp: 80, color: '#ff754a' },
  };

  const UPGRADES = [
    {
      id: 'fire-rate', icon: '↯', title: 'Rapid Circuit', category: 'FIRE RATE',
      description: 'Shoot 20% faster. Keep the pressure on.',
      apply: player => { player.fireInterval /= 1.2; },
    },
    {
      id: 'damage', icon: '✦', title: 'Overcharged Rounds', category: 'DAMAGE',
      description: 'Deal 25% more damage with every bullet.',
      apply: player => { player.bulletDamage *= 1.25; },
    },
    {
      id: 'speed', icon: '»', title: 'Ghost Step', category: 'MOVEMENT',
      description: 'Move 15% faster. Stay ahead of the swarm.',
      apply: player => { player.speed *= 1.15; },
    },
    {
      id: 'projectile', icon: '⋔', title: 'Split Signal', category: 'PROJECTILES',
      description: 'Fire 1 additional projectile in every volley.',
      apply: player => { player.projectiles += 1; },
    },
    {
      id: 'max-hp', icon: '⬡', title: 'Reinforced Core', category: 'MAXIMUM HP',
      description: 'Gain 25 maximum HP and recover 25 HP.',
      apply: player => { player.maxHp += 25; player.hp += 25; },
    },
    {
      id: 'heal', icon: '+', title: 'Emergency Patch', category: 'RECOVERY',
      description: 'Restore 30 HP, up to your current maximum.',
      apply: player => { player.hp = Math.min(player.maxHp, player.hp + 30); },
    },
  ];

  function createPlayer() {
    return {
      x: WORLD.width / 2, y: WORLD.height / 2, radius: 14,
      hp: 100, maxHp: 100, speed: 235, bulletDamage: 25,
      fireInterval: 0.4, fireCooldown: 0.08, projectiles: 1,
      invulnerability: 0, angle: -Math.PI / 2,
    };
  }

  function xpForLevel(level) {
    return 12 + (level - 1) * 12 + Math.floor((level - 1) ** 1.6 * 3);
  }

  function createState() {
    return {
      phase: 'start', player: createPlayer(), enemies: [], bullets: [],
      particles: [], popups: [], elapsed: 0, kills: 0, level: 1, xp: 0,
      xpRequired: xpForLevel(1), spawnClock: 0.7, nextBossTime: 60,
      bossCount: 0, bannerTime: 0, shake: 0, damageFlash: 0, hudClock: 0,
      choices: [],
    };
  }

  let state = createState();
  const stars = Array.from({ length: 55 }, () => ({
    x: Math.random() * WORLD.width,
    y: Math.random() * WORLD.height,
    phase: Math.random() * TAU,
  }));

  // UI and phase transitions. Simulation advances only during "playing".
  function showScreen(id) {
    ['startScreen', 'upgradeScreen', 'pauseScreen', 'gameOverScreen'].forEach(name => {
      ui[name].hidden = name !== id;
    });
    ui.pauseButton.disabled = state.phase !== 'playing' && state.phase !== 'paused';
    ui.pauseButton.textContent = state.phase === 'paused' ? '▶' : 'II';
    ui.pauseButton.setAttribute('aria-label', state.phase === 'paused' ? 'Resume game' : 'Pause game');
    document.body.classList.toggle('game-active', state.phase !== 'start');
  }

  function startGame() {
    state = createState();
    state.phase = 'playing';
    clearInput();
    showScreen(null);
    updateHUD();
    canvas.focus({ preventScroll: true });
  }

  function pauseGame() {
    if (state.phase !== 'playing') return;
    state.phase = 'paused';
    clearInput();
    showScreen('pauseScreen');
    updateHUD();
    ui.resumeButton.focus({ preventScroll: true });
  }

  function resumeGame() {
    if (state.phase !== 'paused') return;
    state.phase = 'playing';
    clearInput();
    showScreen(null);
    updateHUD();
    canvas.focus({ preventScroll: true });
  }

  function endGame() {
    state.phase = 'over';
    clearInput();
    ui.finalTime.textContent = formatTime(state.elapsed);
    ui.finalKills.textContent = String(state.kills);
    ui.finalLevel.textContent = String(state.level);
    showScreen('gameOverScreen');
    updateHUD();
    ui.restartButton.focus({ preventScroll: true });
  }

  function beginLevelUp() {
    if (state.phase !== 'playing' || state.xp < state.xpRequired) return;
    state.xp -= state.xpRequired;
    state.level += 1;
    state.xpRequired = xpForLevel(state.level);
    state.phase = 'upgrade';
    clearInput();

    // Fisher–Yates gives three unique choices; upgrades can stack across levels.
    const shuffled = [...UPGRADES];
    for (let i = shuffled.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    state.choices = shuffled.slice(0, 3);
    ui.upgradeLevel.textContent = String(state.level);
    ui.upgradeChoices.replaceChildren();
    state.choices.forEach((upgrade, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'upgrade-card';
      button.dataset.upgrade = upgrade.id;
      button.innerHTML = `<span class="upgrade-key">0${index + 1}</span>
        <span class="upgrade-icon" aria-hidden="true">${upgrade.icon}</span>
        <span class="upgrade-category">${upgrade.category}</span>
        <span class="upgrade-title">${upgrade.title}</span>
        <span class="upgrade-description">${upgrade.description}</span>`;
      button.addEventListener('click', () => chooseUpgrade(index));
      ui.upgradeChoices.append(button);
    });
    showScreen('upgradeScreen');
    updateHUD();
    ui.upgradeChoices.firstElementChild.focus({ preventScroll: true });
  }

  function chooseUpgrade(index) {
    if (state.phase !== 'upgrade' || !state.choices[index]) return;
    state.choices[index].apply(state.player);
    state.choices = [];
    state.phase = 'playing';
    showScreen(null);
    // A boss kill can award several levels. Preserve XP and offer every upgrade.
    beginLevelUp();
    updateHUD();
    if (state.phase === 'playing') canvas.focus({ preventScroll: true });
  }

  function formatTime(seconds) {
    const total = Math.floor(seconds);
    return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
  }

  function updateHUD() {
    const player = state.player;
    ui.hpValue.textContent = `${Math.ceil(player.hp)} / ${player.maxHp}`;
    ui.hpFill.style.width = `${Math.max(0, player.hp / player.maxHp * 100)}%`;
    ui.hpBar.setAttribute('aria-valuemax', String(player.maxHp));
    ui.hpBar.setAttribute('aria-valuenow', String(Math.ceil(player.hp)));
    ui.hpBar.classList.toggle('low-health', player.hp / player.maxHp < 0.3);
    ui.xpValue.textContent = `${state.xp} / ${state.xpRequired}`;
    ui.xpFill.style.width = `${Math.min(100, state.xp / state.xpRequired * 100)}%`;
    ui.xpBar.setAttribute('aria-valuemax', String(state.xpRequired));
    ui.xpBar.setAttribute('aria-valuenow', String(Math.min(state.xp, state.xpRequired)));
    ui.levelValue.textContent = String(state.level).padStart(2, '0');
    ui.killValue.textContent = String(state.kills).padStart(3, '0');
    ui.timeValue.textContent = formatTime(state.elapsed);
    ui.waveValue.textContent = String(Math.floor(state.elapsed / 20) + 1).padStart(2, '0');
    const bossSeconds = Math.max(0, Math.ceil(state.nextBossTime - state.elapsed));
    ui.bossWarning.hidden = state.phase === 'start' || state.phase === 'over';
    ui.bossWarning.textContent = state.bannerTime > 0
      ? `BOSS ${String(state.bossCount).padStart(2, '0')} HAS ENTERED THE ARENA`
      : `NEXT BOSS · ${formatTime(bossSeconds)}`;
    ui.bossWarning.classList.toggle('imminent', bossSeconds <= 10 || state.bannerTime > 0);
    if (ui.statusValue) {
      ui.statusValue.textContent = {
        start: 'AWAITING SIGNAL', playing: 'SURVIVE', paused: 'PAUSED',
        upgrade: 'UPGRADE AVAILABLE', over: 'SIGNAL LOST',
      }[state.phase];
    }
    const bosses = state.enemies.filter(enemy => enemy.type === 'boss' && !enemy.dead);
    ui.bossBar.hidden = bosses.length === 0;
    ui.bossWarning.classList.toggle('boss-active', bosses.length > 0);
    if (bosses.length) {
      const boss = bosses[0];
      ui.bossName.textContent = `WARDEN ${String(boss.number).padStart(2, '0')}${bosses.length > 1 ? ` · ${bosses.length} ACTIVE` : ''}`;
      ui.bossHpFill.style.width = `${Math.max(0, boss.hp / boss.maxHp * 100)}%`;
      ui.bossHpValue.textContent = `${Math.ceil(Math.max(0, boss.hp))} / ${Math.ceil(boss.maxHp)}`;
    }
  }

  // Keyboard and optional touch controls share the same movement vector.
  function clearInput() {
    keys.clear();
    touchDirections.clear();
    document.querySelectorAll('[data-direction]').forEach(button => button.classList.remove('pressed'));
  }

  const movementKeys = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowLeft', 'ArrowDown', 'ArrowRight']);
  window.addEventListener('keydown', event => {
    if (movementKeys.has(event.code)) {
      if (state.phase === 'playing') {
        event.preventDefault();
        keys.add(event.code);
      }
      return;
    }
    if (event.repeat) return;
    if (event.code === 'KeyP' || event.code === 'Escape') {
      event.preventDefault();
      if (state.phase === 'playing') pauseGame();
      else if (state.phase === 'paused') resumeGame();
    }
    if (state.phase === 'upgrade' && ['Digit1', 'Digit2', 'Digit3', 'Numpad1', 'Numpad2', 'Numpad3'].includes(event.code)) {
      event.preventDefault();
      chooseUpgrade(Number(event.code.slice(-1)) - 1);
    }
  });
  window.addEventListener('keyup', event => keys.delete(event.code));
  window.addEventListener('blur', () => { clearInput(); pauseGame(); });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { clearInput(); pauseGame(); }
  });
  document.querySelectorAll('[data-direction]').forEach(button => {
    button.addEventListener('pointerdown', event => {
      if (state.phase !== 'playing') return;
      event.preventDefault();
      button.setPointerCapture(event.pointerId);
      touchDirections.set(event.pointerId, button.dataset.direction);
      button.classList.add('pressed');
    });
    const release = event => {
      touchDirections.delete(event.pointerId);
      button.classList.toggle('pressed', [...touchDirections.values()].includes(button.dataset.direction));
    };
    button.addEventListener('pointerup', release);
    button.addEventListener('pointercancel', release);
    button.addEventListener('lostpointercapture', release);
  });
  ui.playButton.addEventListener('click', startGame);
  ui.restartButton.addEventListener('click', startGame);
  ui.resumeButton.addEventListener('click', resumeGame);
  ui.pauseButton.addEventListener('click', () => state.phase === 'paused' ? resumeGame() : pauseGame());

  // Entity spawning, damage, XP, and collision helpers.
  function spawnEnemy(type) {
    const definition = ENEMY_TYPES[type];
    const progression = 1 + state.elapsed / 150;
    const bossFactor = type === 'boss' ? 1.55 ** Math.max(0, state.bossCount - 1) : 1;
    const enemy = {
      ...definition, type, hp: definition.hp * progression * bossFactor,
      maxHp: definition.hp * progression * bossFactor,
      speed: definition.speed * Math.min(1.65, 1 + state.elapsed / 360),
      damage: definition.damage * Math.min(2.5, 1 + state.elapsed / 240),
      hitTimer: 0, dead: false, number: state.bossCount,
    };
    const margin = enemy.radius + 12;
    const side = Math.floor(Math.random() * 4);
    if (side < 2) {
      enemy.x = Math.random() * WORLD.width;
      enemy.y = side === 0 ? -margin : WORLD.height + margin;
    } else {
      enemy.x = side === 2 ? -margin : WORLD.width + margin;
      enemy.y = Math.random() * WORLD.height;
    }
    state.enemies.push(enemy);
  }

  function spawnWave() {
    const count = Math.min(4, 1 + Math.floor(state.elapsed / 75));
    for (let i = 0; i < count && state.enemies.length < 180; i += 1) {
      const roll = Math.random();
      let type = 'basic';
      if (state.elapsed >= 30 && roll < 0.2) type = 'tank';
      else if (state.elapsed >= 12 && roll < 0.48) type = 'fast';
      spawnEnemy(type);
    }
  }

  function emitParticles(x, y, color, count = 12) {
    for (let i = 0; i < count; i += 1) {
      const angle = Math.random() * TAU;
      const speed = 35 + Math.random() * 160;
      const life = 0.25 + Math.random() * 0.45;
      state.particles.push({ x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
        life, maxLife: life, radius: 1.5 + Math.random() * 2, color });
    }
    if (state.particles.length > 500) state.particles.splice(0, state.particles.length - 500);
  }

  function killEnemy(enemy) {
    if (enemy.dead) return;
    enemy.dead = true;
    state.kills += 1;
    state.xp += enemy.xp;
    emitParticles(enemy.x, enemy.y, enemy.color, enemy.type === 'boss' ? 45 : 14);
    state.popups.push({ x: enemy.x, y: enemy.y - enemy.radius, life: 0.8, text: `+${enemy.xp} XP`, color: '#62f7d2' });
  }

  function damagePlayer(enemy) {
    const player = state.player;
    if (player.invulnerability > 0) return;
    player.hp = Math.max(0, player.hp - enemy.damage);
    player.invulnerability = 0.7;
    state.shake = 0.22;
    state.damageFlash = 0.16;
    emitParticles(player.x, player.y, '#ff4e9b', 9);
    state.popups.push({ x: player.x, y: player.y - 24, life: 0.7,
      text: `−${Math.ceil(enemy.damage)}`, color: '#ff799f' });
    // A small knockback gives the player room to escape after contact.
    const dx = player.x - enemy.x;
    const dy = player.y - enemy.y;
    const distance = Math.hypot(dx, dy) || 1;
    player.x = clamp(player.x + dx / distance * 16, player.radius, WORLD.width - player.radius);
    player.y = clamp(player.y + dy / distance * 16, player.radius, WORLD.height - player.radius);
    updateHUD();
    if (player.hp <= 0) endGame();
  }

  function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }

  function nearestEnemy() {
    let nearest = null;
    let bestDistance = Infinity;
    for (const enemy of state.enemies) {
      if (enemy.dead) continue;
      const distance = (enemy.x - state.player.x) ** 2 + (enemy.y - state.player.y) ** 2;
      if (distance < bestDistance) { nearest = enemy; bestDistance = distance; }
    }
    return nearest;
  }

  function shoot(target) {
    const player = state.player;
    player.angle = Math.atan2(target.y - player.y, target.x - player.x);
    for (let i = 0; i < player.projectiles; i += 1) {
      // Keep a directly aimed round, then alternate extra rounds to either side.
      const spread = i === 0 ? 0 : Math.ceil(i / 2) * (i % 2 ? 1 : -1)
        * Math.min(0.13, 1.3 / player.projectiles);
      const angle = player.angle + spread;
      state.bullets.push({
        x: player.x, y: player.y,
        vx: Math.cos(angle) * 650, vy: Math.sin(angle) * 650,
        damage: player.bulletDamage, radius: 4, life: 2.2,
      });
    }
  }

  // Sweep along the whole bullet path so fast projectiles cannot tunnel through enemies.
  function collisionFraction(bullet, previousX, previousY, enemy) {
    const dx = bullet.x - previousX;
    const dy = bullet.y - previousY;
    const sx = previousX - enemy.x;
    const sy = previousY - enemy.y;
    const radius = bullet.radius + enemy.radius;
    const c = sx * sx + sy * sy - radius * radius;
    if (c <= 0) return 0;
    const lengthSquared = dx * dx + dy * dy;
    if (lengthSquared === 0) return null;
    const b = 2 * (sx * dx + sy * dy);
    const discriminant = b * b - 4 * lengthSquared * c;
    if (discriminant < 0) return null;
    const entry = (-b - Math.sqrt(discriminant)) / (2 * lengthSquared);
    return entry >= 0 && entry <= 1 ? entry : null;
  }

  // One update handles the simulation; rendering never changes gameplay state.
  function update(dt) {
    state.elapsed += dt;
    state.spawnClock -= dt;
    state.bannerTime = Math.max(0, state.bannerTime - dt);
    state.shake = Math.max(0, state.shake - dt);
    state.damageFlash = Math.max(0, state.damageFlash - dt);
    const player = state.player;
    player.invulnerability = Math.max(0, player.invulnerability - dt);

    const touch = new Set(touchDirections.values());
    let dx = Number(keys.has('KeyD') || keys.has('ArrowRight') || touch.has('right'))
      - Number(keys.has('KeyA') || keys.has('ArrowLeft') || touch.has('left'));
    let dy = Number(keys.has('KeyS') || keys.has('ArrowDown') || touch.has('down'))
      - Number(keys.has('KeyW') || keys.has('ArrowUp') || touch.has('up'));
    const movementLength = Math.hypot(dx, dy);
    if (movementLength) {
      dx /= movementLength;
      dy /= movementLength;
      player.x = clamp(player.x + dx * player.speed * dt, player.radius, WORLD.width - player.radius);
      player.y = clamp(player.y + dy * player.speed * dt, player.radius, WORLD.height - player.radius);
    }

    if (state.spawnClock <= 0) {
      spawnWave();
      state.spawnClock += Math.max(0.18, 1.05 * 0.88 ** (state.elapsed / 20));
    }
    if (state.elapsed >= state.nextBossTime) {
      state.bossCount += 1;
      spawnEnemy('boss');
      state.nextBossTime += 60;
      state.bannerTime = 4;
    }

    for (const enemy of state.enemies) {
      enemy.hitTimer = Math.max(0, enemy.hitTimer - dt);
      const ex = player.x - enemy.x;
      const ey = player.y - enemy.y;
      const distance = Math.hypot(ex, ey) || 1;
      enemy.x += ex / distance * enemy.speed * dt;
      enemy.y += ey / distance * enemy.speed * dt;
      if (Math.hypot(player.x - enemy.x, player.y - enemy.y) < player.radius + enemy.radius) {
        damagePlayer(enemy);
        if (state.phase === 'over') return;
      }
    }

    player.fireCooldown -= dt;
    const target = nearestEnemy();
    if (target) {
      player.angle = Math.atan2(target.y - player.y, target.x - player.x);
      if (player.fireCooldown <= 0) {
        shoot(target);
        player.fireCooldown = player.fireInterval;
      }
    }

    for (const bullet of state.bullets) {
      const previousX = bullet.x;
      const previousY = bullet.y;
      bullet.x += bullet.vx * dt;
      bullet.y += bullet.vy * dt;
      bullet.life -= dt;
      let hit = null;
      let firstHit = Infinity;
      for (const enemy of state.enemies) {
        if (enemy.dead) continue;
        const fraction = collisionFraction(bullet, previousX, previousY, enemy);
        if (fraction !== null && fraction < firstHit) { firstHit = fraction; hit = enemy; }
      }
      if (hit) {
        hit.hp -= bullet.damage;
        hit.hitTimer = 0.1;
        bullet.life = 0;
        if (hit.hp <= 0) killEnemy(hit);
      }
    }
    state.bullets = state.bullets.filter(bullet => bullet.life > 0 && bullet.x > -30
      && bullet.x < WORLD.width + 30 && bullet.y > -30 && bullet.y < WORLD.height + 30);
    state.enemies = state.enemies.filter(enemy => !enemy.dead);
    for (const particle of state.particles) {
      particle.x += particle.vx * dt;
      particle.y += particle.vy * dt;
      particle.vx *= Math.max(0, 1 - dt * 3);
      particle.vy *= Math.max(0, 1 - dt * 3);
      particle.life -= dt;
    }
    state.particles = state.particles.filter(particle => particle.life > 0);
    for (const popup of state.popups) { popup.y -= 26 * dt; popup.life -= dt; }
    state.popups = state.popups.filter(popup => popup.life > 0);
    beginLevelUp();
    state.hudClock -= dt;
    if (state.hudClock <= 0) { updateHUD(); state.hudClock = 0.08; }
  }

  // Canvas renderer: neon geometry, trails, particles, and damage feedback.
  function resizeCanvas() {
    const rect = canvas.getBoundingClientRect();
    viewport.width = Math.max(1, rect.width);
    viewport.height = Math.max(1, rect.height);
    viewport.dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(viewport.width * viewport.dpr);
    canvas.height = Math.round(viewport.height * viewport.dpr);
    viewport.scale = Math.min(viewport.width / WORLD.width, viewport.height / WORLD.height);
    viewport.x = (viewport.width - WORLD.width * viewport.scale) / 2;
    viewport.y = (viewport.height - WORLD.height * viewport.scale) / 2;
  }

  function drawBackground(time) {
    context.fillStyle = '#080e19';
    context.fillRect(0, 0, WORLD.width, WORLD.height);
    const glow = context.createRadialGradient(600, 360, 40, 600, 360, 700);
    glow.addColorStop(0, 'rgba(27, 69, 73, 0.2)');
    glow.addColorStop(1, 'rgba(8, 14, 25, 0)');
    context.fillStyle = glow;
    context.fillRect(0, 0, WORLD.width, WORLD.height);
    context.lineWidth = 1;
    for (let x = 0; x <= WORLD.width; x += 40) {
      context.strokeStyle = x % 200 === 0 ? 'rgba(98,247,210,0.08)' : 'rgba(110,142,163,0.045)';
      context.beginPath(); context.moveTo(x, 0); context.lineTo(x, WORLD.height); context.stroke();
    }
    for (let y = 0; y <= WORLD.height; y += 40) {
      context.strokeStyle = y % 200 === 0 ? 'rgba(98,247,210,0.08)' : 'rgba(110,142,163,0.045)';
      context.beginPath(); context.moveTo(0, y); context.lineTo(WORLD.width, y); context.stroke();
    }
    for (const star of stars) {
      context.globalAlpha = reducedMotion ? 0.25 : 0.18 + (Math.sin(time * 0.7 + star.phase) + 1) * 0.1;
      context.fillStyle = '#82b9b7';
      context.fillRect(star.x, star.y, 2, 2);
    }
    context.globalAlpha = 1;
    context.strokeStyle = 'rgba(98,247,210,0.2)';
    context.strokeRect(8, 8, WORLD.width - 16, WORLD.height - 16);
    context.strokeStyle = '#62f7d2';
    context.lineWidth = 2;
    [[18, 18, 1, 1], [1182, 18, -1, 1], [18, 702, 1, -1], [1182, 702, -1, -1]].forEach(([x, y, sx, sy]) => {
      context.beginPath(); context.moveTo(x, y + sy * 16); context.lineTo(x, y);
      context.lineTo(x + sx * 16, y); context.stroke();
    });
    context.fillStyle = 'rgba(113,160,169,0.35)';
    context.font = '10px monospace';
    context.textAlign = 'left';
    context.fillText('SECTOR 07 / CONTAINMENT GRID', 38, WORLD.height - 26);
    context.textAlign = 'right';
    context.fillText('1200 × 720', WORLD.width - 38, WORLD.height - 26);
  }

  function polygon(sides, radius, rotation = 0) {
    context.beginPath();
    for (let i = 0; i < sides; i += 1) {
      const angle = rotation + i * TAU / sides;
      const x = Math.cos(angle) * radius;
      const y = Math.sin(angle) * radius;
      if (i === 0) context.moveTo(x, y); else context.lineTo(x, y);
    }
    context.closePath();
  }

  function drawEnemy(enemy, time) {
    context.save();
    context.translate(enemy.x, enemy.y);
    context.strokeStyle = enemy.hitTimer > 0 ? '#ffffff' : enemy.color;
    context.fillStyle = enemy.hitTimer > 0 ? 'rgba(255,255,255,0.5)' : `${enemy.color}22`;
    context.shadowColor = enemy.color;
    context.shadowBlur = enemy.type === 'boss' ? 22 : 12;
    context.lineWidth = 2;
    if (enemy.type === 'basic') {
      polygon(4, enemy.radius, Math.PI / 2);
      context.fill(); context.stroke();
      context.fillStyle = enemy.color;
      context.fillRect(-3, -3, 6, 6);
    } else if (enemy.type === 'fast') {
      context.rotate(Math.atan2(state.player.y - enemy.y, state.player.x - enemy.x));
      polygon(3, enemy.radius + 2);
      context.fill(); context.stroke();
      context.beginPath(); context.moveTo(-16, -4); context.lineTo(-9, 0); context.lineTo(-16, 4); context.stroke();
    } else if (enemy.type === 'tank') {
      polygon(6, enemy.radius, Math.PI / 6);
      context.fill(); context.stroke();
      polygon(6, enemy.radius * 0.55, Math.PI / 6);
      context.stroke();
      context.fillStyle = enemy.color;
      context.fillRect(-4, -4, 8, 8);
    } else {
      context.rotate(reducedMotion ? 0 : time * 0.3);
      polygon(8, enemy.radius + 4, Math.PI / 8);
      context.fill(); context.stroke();
      context.lineWidth = 3;
      polygon(4, enemy.radius * 0.65, reducedMotion ? 0 : -time * 0.6);
      context.stroke();
      context.beginPath(); context.arc(0, 0, 9, 0, TAU); context.fillStyle = enemy.color; context.fill();
    }
    context.restore();
    if (enemy.hp < enemy.maxHp && enemy.type !== 'boss') {
      const width = enemy.radius * 2;
      context.fillStyle = '#182333';
      context.fillRect(enemy.x - width / 2, enemy.y - enemy.radius - 9, width, 3);
      context.fillStyle = enemy.color;
      context.fillRect(enemy.x - width / 2, enemy.y - enemy.radius - 9, width * Math.max(0, enemy.hp / enemy.maxHp), 3);
    }
  }

  function drawPlayer(time) {
    const player = state.player;
    context.save();
    context.translate(player.x, player.y);
    if (player.invulnerability > 0) {
      context.globalAlpha = 0.6 + Math.sin(time * 40) * 0.3;
      context.strokeStyle = '#ff7eab';
      context.lineWidth = 2;
      context.setLineDash([4, 4]);
      context.beginPath(); context.arc(0, 0, 23, 0, TAU); context.stroke();
      context.setLineDash([]);
    }
    context.rotate(player.angle);
    context.shadowColor = '#62f7d2';
    context.shadowBlur = 19;
    context.strokeStyle = '#62f7d2';
    context.fillStyle = '#123c3e';
    context.lineWidth = 2;
    context.beginPath(); context.arc(0, 0, player.radius, 0, TAU); context.fill(); context.stroke();
    context.fillStyle = '#d5fff4';
    context.fillRect(0, -6, 5, 12);
    context.fillStyle = '#62f7d2';
    context.fillRect(11, -3, 11, 6);
    context.shadowBlur = 0;
    context.strokeStyle = 'rgba(98,247,210,0.15)';
    context.beginPath(); context.arc(0, 0, 29, 0, TAU); context.stroke();
    context.restore();
  }

  function render(time) {
    context.setTransform(viewport.dpr, 0, 0, viewport.dpr, 0, 0);
    context.fillStyle = '#080e19';
    context.fillRect(0, 0, viewport.width, viewport.height);
    context.translate(viewport.x, viewport.y);
    context.scale(viewport.scale, viewport.scale);
    context.save();
    context.beginPath(); context.rect(0, 0, WORLD.width, WORLD.height); context.clip();
    if (state.shake > 0 && !reducedMotion && state.phase === 'playing') {
      const strength = state.shake / 0.22 * 7;
      context.translate(Math.sin(time * 117) * strength, Math.cos(time * 93) * strength);
    }
    drawBackground(time);
    for (const enemy of state.enemies) drawEnemy(enemy, time);
    context.save();
    context.strokeStyle = '#8dffe4';
    context.shadowColor = '#62f7d2';
    context.shadowBlur = 12;
    context.lineWidth = 4;
    context.lineCap = 'round';
    for (const bullet of state.bullets) {
      context.beginPath(); context.moveTo(bullet.x - bullet.vx * 0.016, bullet.y - bullet.vy * 0.016);
      context.lineTo(bullet.x, bullet.y); context.stroke();
    }
    context.restore();
    if (state.phase !== 'over') drawPlayer(time);
    for (const particle of state.particles) {
      context.globalAlpha = Math.max(0, particle.life / particle.maxLife);
      context.fillStyle = particle.color;
      context.fillRect(particle.x, particle.y, particle.radius, particle.radius);
    }
    context.globalAlpha = 1;
    context.textAlign = 'center';
    context.font = 'bold 12px monospace';
    for (const popup of state.popups) {
      context.globalAlpha = Math.min(1, Math.max(0, popup.life * 2));
      context.fillStyle = popup.color;
      context.fillText(popup.text, popup.x, popup.y);
    }
    context.globalAlpha = 1;
    if (state.damageFlash > 0) {
      context.strokeStyle = `rgba(255,78,155,${state.damageFlash / 0.16 * 0.55})`;
      context.lineWidth = 12;
      context.strokeRect(6, 6, WORLD.width - 12, WORLD.height - 12);
    }
    context.restore();
  }

  // Clamp long frames and reset the clock while paused; no background catch-up.
  let previousTime = null;
  function frame(timestamp) {
    const dt = previousTime === null ? 0 : Math.min(Math.max(0, (timestamp - previousTime) / 1000), 0.05);
    previousTime = timestamp;
    if (state.phase === 'playing') update(dt);
    render(timestamp / 1000);
    window.requestAnimationFrame(frame);
  }

  window.addEventListener('resize', resizeCanvas);
  if ('ResizeObserver' in window) new ResizeObserver(resizeCanvas).observe(canvas);
  resizeCanvas();
  showScreen('startScreen');
  updateHUD();
  window.requestAnimationFrame(frame);
})();
