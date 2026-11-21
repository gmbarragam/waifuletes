// js/waifinder.js - Motor de Gestos, Áudio Web, Modo Olhando e Modo Rollando do Waifinder

const RARITY_MAP = {
  COMMON:    { label: 'Comum',    plural: 'Comuns',    color: '#94a3b8', bg: '#475569', class: 'rarity-common' },
  UNCOMMON:  { label: 'Incomum',  plural: 'Incomuns',  color: '#22c55e', bg: '#166534', class: 'rarity-uncommon' },
  RARE:      { label: 'Raro',     plural: 'Raros',     color: '#3b82f6', bg: '#1e40af', class: 'rarity-rare' },
  EPIC:      { label: 'Épico',    plural: 'Épicos',    color: '#a855f7', bg: '#6b21a8', class: 'rarity-epic' },
  LEGENDARY: { label: 'Lendário', plural: 'Lendários', color: '#eab308', bg: '#854d0e', class: 'rarity-legendary' },
  MYTHIC:    { label: '🔮 Mítico', plural: 'Míticos',  color: '#facc15', bg: 'linear-gradient(135deg, #581c87, #3b0764)', class: 'rarity-mythic' }
};

// Sintetizador Web Audio API Retrô
const WaifinderAudio = {
  ctx: null,
  isMuted: false,

  init() {
    this.isMuted = localStorage.getItem('waifinder_muted') === 'true';
    this.updateMuteButton();
  },

  getContext() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) this.ctx = new AudioCtx();
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
    return this.ctx;
  },

  toggleMute() {
    this.isMuted = !this.isMuted;
    localStorage.setItem('waifinder_muted', String(this.isMuted));
    this.updateMuteButton();
    if (!this.isMuted) this.playPop();
  },

  updateMuteButton() {
    const btn = document.getElementById('btn-waifinder-mute');
    if (!btn) return;
    btn.innerHTML = this.isMuted
      ? '<i class="fas fa-volume-mute"></i>'
      : '<i class="fas fa-volume-up"></i>';
    btn.title = this.isMuted ? 'Desmutar efeitos' : 'Silenciar efeitos';
  },

  playTone(freq, duration, type = 'sine', gainVal = 0.08) {
    if (this.isMuted) return;
    try {
      const ctx = this.getContext();
      if (!ctx) return;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = type;
      osc.frequency.setValueAtTime(freq, ctx.currentTime);

      gain.gain.setValueAtTime(gainVal, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start();
      osc.stop(ctx.currentTime + duration);
    } catch (_) {}
  },

  playSwipe() {
    if (this.isMuted) return;
    try {
      const ctx = this.getContext();
      if (!ctx) return;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(260, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(80, ctx.currentTime + 0.12);

      gain.gain.setValueAtTime(0.09, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.12);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start();
      osc.stop(ctx.currentTime + 0.12);
    } catch (_) {}
  },

  playLike() {
    if (this.isMuted) return;
    try {
      const ctx = this.getContext();
      if (!ctx) return;
      const now = ctx.currentTime;
      [523.25, 659.25, 783.99].forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, now + idx * 0.05);

        gain.gain.setValueAtTime(0.08, now + idx * 0.05);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + idx * 0.05 + 0.15);

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start(now + idx * 0.05);
        osc.stop(now + idx * 0.05 + 0.15);
      });
    } catch (_) {}
  },

  playMarry() {
    if (this.isMuted) return;
    try {
      const ctx = this.getContext();
      if (!ctx) return;
      const now = ctx.currentTime;
      [523.25, 659.25, 783.99, 1046.5].forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, now + idx * 0.06);
        gain.gain.setValueAtTime(0.1, now + idx * 0.06);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + idx * 0.06 + 0.28);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now + idx * 0.06);
        osc.stop(now + idx * 0.06 + 0.28);
      });
    } catch (_) {}
  },

  playWishlist() {
    if (this.isMuted) return;
    try {
      const ctx = this.getContext();
      if (!ctx) return;
      const now = ctx.currentTime;
      [880, 1174.66, 1396.91].forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, now + idx * 0.06);

        gain.gain.setValueAtTime(0.09, now + idx * 0.06);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + idx * 0.06 + 0.22);

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start(now + idx * 0.06);
        osc.stop(now + idx * 0.06 + 0.22);
      });
    } catch (_) {}
  },

  playError() {
    this.playTone(190, 0.18, 'sawtooth', 0.06);
  },

  playPop() {
    this.playTone(480, 0.06, 'sine', 0.06);
  }
};

// Estado da Aplicação
const Waifinder = {
  mode: 'LOOKING', // 'LOOKING' | 'ROLLING'
  cards: [],
  currentIndex: 0,
  isLoading: false,
  isRolling: false,
  isMarrying: false,
  seenIds: [],
  token: '',
  publicId: '',
  userData: null,
  rollsInfo: null,
  activeRoll: null,
  activePointerCard: null,
  isDragging: false,
  startX: 0,
  startY: 0,
  currentX: 0,
  currentY: 0,
  genderFilter: 'ALL',

  async init() {
    WaifinderAudio.init();
    this.initSession();
    this.genderFilter = localStorage.getItem('waifinder_gender') || 'ALL';
    this.updateGenderButton();
    this.updateModeUI();
    this.setupEventListeners();
    await this.fetchNextBatch();
  },

  initSession() {
    const params = new URLSearchParams(window.location.search);
    this.token = params.get('token') || '';
    this.publicId = params.get('publicId') || '';

    if (!this.token) {
      const savedToken = this.getCookie('waifu_session') || localStorage.getItem('waifu_session');
      if (savedToken) {
        this.token = savedToken;
      }
    }

    if (this.token && !this.publicId) {
      const savedPublicId =
        this.getCookie('waifu_user_public_id') ||
        this.getCookie('waifu_public_id') ||
        localStorage.getItem('waifu_user_public_id');
      if (savedPublicId) {
        this.publicId = savedPublicId;
      }
    }
  },

  getCookie(name) {
    const nameEQ = name + '=';
    const ca = document.cookie.split(';');
    for (let i = 0; i < ca.length; i++) {
      let c = ca[i];
      while (c.charAt(0) === ' ') c = c.substring(1, c.length);
      if (c.indexOf(nameEQ) === 0) return decodeURIComponent(c.substring(nameEQ.length, c.length));
    }
    return null;
  },

  setCookie(name, value, maxAgeSeconds = 31536000) {
    document.cookie = `${name}=${encodeURIComponent(value)}; max-age=${maxAgeSeconds}; path=/; SameSite=Lax`;
  },

  isAuthenticated() {
    return Boolean(this.token && this.userData);
  },

  hasOpenModal() {
    return Boolean(document.querySelector('.modal-overlay:not(.hidden)'));
  },

  setupEventListeners() {
    const themeBtn = document.getElementById('btn-waifinder-theme');
    if (themeBtn) {
      themeBtn.addEventListener('click', () => {
        document.body.classList.toggle('dark-mode');
        const isDark = document.body.classList.contains('dark-mode');
        localStorage.setItem('waifu_theme', isDark ? 'dark' : 'light');
        themeBtn.innerHTML = isDark ? '<i class="fas fa-sun"></i>' : '<i class="fas fa-moon"></i>';
        WaifinderAudio.playPop();
        if (this.rollsInfo) this.updateRollsDisplay(this.rollsInfo);
      });
    }

    const savedTheme = localStorage.getItem('waifu_theme');
    const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    if (savedTheme === 'dark' || (!savedTheme && prefersDark)) {
      document.body.classList.add('dark-mode');
      if (themeBtn) themeBtn.innerHTML = '<i class="fas fa-sun"></i>';
    }

    document.getElementById('btn-waifinder-mute')?.addEventListener('click', () => WaifinderAudio.toggleMute());
    document.getElementById('btn-waifinder-mode')?.addEventListener('click', () => this.toggleMode());

    // Fechar modais clicando fora
    document.querySelectorAll('.modal-overlay').forEach((overlay) => {
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
          this.closeModals();
        }
      });
    });

    // Botões de Ação Inferiores
    document.getElementById('btn-action-pass')?.addEventListener('click', () => {
      if (this.mode === 'ROLLING') {
        this.performRealRoll('left');
      } else {
        this.swipeCard('left');
      }
    });

    document.getElementById('btn-action-like')?.addEventListener('click', () => {
      if (this.mode === 'ROLLING') {
        this.performMarry();
      } else {
        this.swipeCard('right');
      }
    });

    document.getElementById('btn-action-wishlist')?.addEventListener('click', () => this.handleWishlist());
    document.getElementById('btn-action-gender')?.addEventListener('click', () => this.toggleGenderFilter());

    // Atalhos de Teclado Desktop
    window.addEventListener('keydown', (e) => {
      if (document.activeElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) return;

      const key = e.key.toLowerCase();
      if (key === 'escape') {
        this.closeModals();
        return;
      }

      if (this.hasOpenModal()) return;

      if (this.mode === 'ROLLING') {
        // Modo Rollando: C = casar, R = roll (ignora A e D!)
        if (key === 'r') {
          e.preventDefault();
          this.performRealRoll('left');
        } else if (key === 'c') {
          e.preventDefault();
          this.performMarry();
        } else if (key === 'w') {
          e.preventDefault();
          this.handleWishlist();
        } else if (key === 'g' || key === 's') {
          e.preventDefault();
          this.toggleGenderFilter();
        }
        return;
      }

      // Modo Olhando
      if (key === 'arrowleft' || key === 'a') {
        e.preventDefault();
        this.swipeCard('left');
      } else if (key === 'arrowright' || key === 'd') {
        e.preventDefault();
        this.swipeCard('right');
      } else if (key === 'w') {
        e.preventDefault();
        this.handleWishlist();
      } else if (key === 'g' || key === 's') {
        e.preventDefault();
        this.toggleGenderFilter();
      }
    });
  },

  toggleMode() {
    if (!this.isAuthenticated()) {
      this.showAuthPrompt('Para ativar o modo Rollando, gastar seus rolls e casar no Waifinder, conecte sua conta!');
      return;
    }

    WaifinderAudio.playPop();

    if (this.mode === 'LOOKING') {
      const warned = this.getCookie('waifinder_roll_mode_warned') === '1';
      if (!warned) {
        document.getElementById('modal-roll-mode-intro')?.classList.remove('hidden');
        return;
      }
      this.enterRollingMode();
    } else {
      this.enterLookingMode();
    }
  },

  confirmRollModeIntro() {
    this.setCookie('waifinder_roll_mode_warned', '1', 365 * 86400);
    this.closeModals();
    this.enterRollingMode();
  },

  cancelRollModeIntro() {
    this.closeModals();
  },

  enterRollingMode() {
    this.mode = 'ROLLING';
    this.activeRoll = null;
    this.activePointerCard = null;
    this.resetFloatingStamps();
    this.updateModeUI();
    this.renderRollingReadyState();
  },

  enterLookingMode() {
    this.mode = 'LOOKING';
    this.activeRoll = null;
    this.activePointerCard = null;
    this.resetFloatingStamps();
    this.updateModeUI();

    if (this.cards.length - this.currentIndex <= 0) {
      this.fetchNextBatch();
    } else {
      this.renderDeck();
    }
  },

  updateModeUI() {
    const modeBtn = document.getElementById('btn-waifinder-mode');
    const btnPass = document.getElementById('btn-action-pass');
    const btnLike = document.getElementById('btn-action-like');
    const hints = document.getElementById('waifinder-desktop-hints');

    if (this.mode === 'ROLLING') {
      if (modeBtn) {
        modeBtn.classList.remove('mode-olhando');
        modeBtn.classList.add('mode-rollando');
        modeBtn.innerHTML = '<span class="mode-icon">💖</span> <span class="mode-text">Rollando</span>';
        modeBtn.title = 'Modo Rollando ativo! Clique para voltar ao modo Olhando.';
      }
      if (btnPass) {
        btnPass.classList.add('is-roll-dice');
        btnPass.innerHTML = '<i class="fas fa-dice"></i>';
        btnPass.title = 'Fazer Roll (Atalho: R)';
      }
      if (btnLike) {
        btnLike.classList.add('is-marry-ring');
        btnLike.innerHTML = '<i class="fas fa-ring"></i>';
        btnLike.title = 'Casar com o personagem (Atalho: C)';
        btnLike.disabled = !this.canMarryCurrentRoll();
      }
      if (hints) {
        hints.innerHTML = '<kbd>R</kbd> Rolar &nbsp;•&nbsp; <kbd>C</kbd> Casar &nbsp;•&nbsp; <kbd>W</kbd> Wishlist &nbsp;•&nbsp; <kbd>G / S</kbd> Gênero';
      }
    } else {
      if (modeBtn) {
        modeBtn.classList.remove('mode-rollando');
        modeBtn.classList.add('mode-olhando');
        modeBtn.innerHTML = '<span class="mode-icon">👁️</span> <span class="mode-text">Olhando</span>';
        modeBtn.title = 'Modo Olhando ativo (não gasta rolls). Clique para alternar para Rollando.';
      }
      if (btnPass) {
        btnPass.classList.remove('is-roll-dice');
        btnPass.innerHTML = '<i class="fas fa-times"></i>';
        btnPass.title = 'Passar para a próxima (Atalho: ← ou A)';
        btnPass.disabled = false;
      }
      if (btnLike) {
        btnLike.classList.remove('is-marry-ring');
        btnLike.innerHTML = '<i class="fas fa-heart"></i>';
        btnLike.title = 'Curtir personagem (Atalho: → ou D)';
        btnLike.disabled = false;
      }
      if (hints) {
        hints.innerHTML = '<kbd>← / A</kbd> Passar &nbsp;•&nbsp; <kbd>→ / D</kbd> Curtir &nbsp;•&nbsp; <kbd>W</kbd> Wishlist &nbsp;•&nbsp; <kbd>G / S</kbd> Gênero';
      }
    }
  },

  canMarryCurrentRoll() {
    if (this.mode !== 'ROLLING' || !this.activeRoll) return false;
    const ch = this.activeRoll.character;
    if (!ch) return false;
    if (this.activeRoll.isMythic || ch.isMythic) return false;
    if (this.activeRoll.instantMarriage || this.activeRoll.marriedJustNow) return false;
    return Boolean(this.activeRoll.available);
  },

  getRollNumberColor(available, max) {
    const safeMax = Math.max(1, Number(max) || 9);
    const avail = Math.max(0, Number(available) || 0);
    if (avail === 0) return '#ef4444';
    const ratio = Math.min(1, avail / safeMax);
    const hue = Math.round(ratio * 138); // 0 = vermelho, 50 = amarelo, 138 = verde
    const isDark = document.body.classList.contains('dark-mode');
    return `hsl(${hue}, 82%, ${isDark ? 56 : 36}%)`;
  },

  updateRollsDisplay(rolls) {
    if (!rolls || !this.userData) return;
    this.rollsInfo = rolls;

    const userBar = document.getElementById('waifinder-user-bar');
    const userBadge = document.getElementById('waifinder-user-badge');
    if (!userBar || !userBadge) return;

    const avail = Number(rolls.availableRolls) || 0;
    const maxR = Number(rolls.maxRolls) || 9;
    const farmRolls = Number(rolls.farmRolls) || 0;
    const farmTickets = Number(rolls.farmTickets) || 0;
    const baseAvail = Number(rolls.baseAvailableRolls ?? avail) || 0;

    const color = this.getRollNumberColor(avail, maxR);
    let tooltip = `Saldo total disponível: ${avail}/${maxR} rolls`;
    if (farmRolls > 0 || farmTickets > 0) {
      tooltip += ` (${baseAvail} normais/donate + ${farmRolls} fazenda + ${farmTickets} tickets)`;
    }

    userBadge.innerHTML = `
      <span style="display:inline-flex;align-items:center;gap:5px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
        <i class="fas fa-user-circle"></i>
        <span>${Api.escapeHtml(this.userData.name)}</span>
      </span>
      <span class="waifinder-rolls-indicator" title="${Api.escapeHtml(tooltip)}">
        (🎲 <span style="color:${color};">${avail}</span>/${maxR} rolls)
      </span>
    `;
    userBar.classList.remove('hidden');
  },

  updateGenderButton() {
    const btn = document.getElementById('btn-action-gender');
    const label = document.getElementById('label-gender-filter');
    const icon = document.getElementById('icon-gender-filter');
    if (!btn || !label || !icon) return;

    btn.classList.remove('filter-all', 'filter-waifus', 'filter-husbandos');

    if (this.genderFilter === 'FEMALE') {
      btn.classList.add('filter-waifus');
      label.textContent = 'Waifus';
      icon.className = 'fas fa-venus';
      btn.title = 'Filtro atual: Waifus (♀). Clique para alternar para Husbandos.';
    } else if (this.genderFilter === 'MALE') {
      btn.classList.add('filter-husbandos');
      label.textContent = 'Husbandos';
      icon.className = 'fas fa-mars';
      btn.title = 'Filtro atual: Husbandos (♂). Clique para alternar para Todos.';
    } else {
      btn.classList.add('filter-all');
      label.textContent = 'Todos';
      icon.className = 'fas fa-venus-mars';
      btn.title = 'Filtro atual: Todos os gêneros. Clique para alternar para Waifus.';
    }
  },

  toggleGenderFilter() {
    WaifinderAudio.playPop();

    if (this.genderFilter === 'ALL') {
      this.genderFilter = 'FEMALE';
      this.showToast('Filtrando: Apenas Waifus ♀', '🌸');
    } else if (this.genderFilter === 'FEMALE') {
      this.genderFilter = 'MALE';
      this.showToast('Filtrando: Apenas Husbandos ♂', '⚔️');
    } else {
      this.genderFilter = 'ALL';
      this.showToast('Filtrando: Todos os Gêneros ⚧', '✨');
    }

    localStorage.setItem('waifinder_gender', this.genderFilter);
    this.updateGenderButton();

    if (this.mode === 'ROLLING') {
      this.showToast('Filtro aplicado para o próximo roll!', '🎲');
      return;
    }

    this.cards = [];
    this.currentIndex = 0;
    const deckEl = document.getElementById('waifinder-deck');
    if (deckEl) {
      deckEl.innerHTML = `
        <div class="waifinder-empty-state">
          <div class="empty-icon">✨</div>
          <h3 style="font-weight:800;font-size:17px;margin-bottom:6px;">Buscando ${this.genderFilter === 'FEMALE' ? 'Waifus' : (this.genderFilter === 'MALE' ? 'Husbandos' : 'personagens')}...</h3>
          <p style="font-size:12px;color:var(--text-muted);">Embaralhando catálogo com nova seleção...</p>
        </div>
      `;
    }
    this.fetchNextBatch();
  },

  async fetchNextBatch() {
    if (this.isLoading) return;
    this.isLoading = true;

    try {
      const queryParams = new URLSearchParams();
      if (this.token) queryParams.set('token', this.token);
      if (this.publicId) queryParams.set('publicId', this.publicId);
      if (this.genderFilter) queryParams.set('gender', this.genderFilter);
      if (this.seenIds.length > 0) {
        queryParams.set('excludeIds', this.seenIds.slice(-40).join(','));
      }

      const res = await fetch(`/api/web/catalog/deck?${queryParams.toString()}`);
      const data = await res.json();

      if (data.success && Array.isArray(data.data?.characters)) {
        const newChars = data.data.characters;
        this.cards.push(...newChars);

        if (data.data.authenticated && data.data.user) {
          this.userData = data.data.user;
          this.publicId = this.userData.publicId;
          if (this.token) {
            this.setCookie('waifu_session', this.token, 3 * 86400);
          }
          if (this.publicId) {
            this.setCookie('waifu_user_public_id', this.publicId, 3 * 86400);
          }

          if (data.data.user.rolls) {
            this.updateRollsDisplay(data.data.user.rolls);
          }

          const haremLink = document.getElementById('waifinder-harem-link');
          if (haremLink) {
            haremLink.href = `/user/${this.userData.publicId}${this.token ? `?token=${encodeURIComponent(this.token)}` : ''}`;
            haremLink.classList.remove('hidden');
          }
        }

        if (this.mode === 'LOOKING') {
          this.renderDeck();
        }
      } else if (this.cards.length === 0 && this.mode === 'LOOKING') {
        this.showEmptyState();
      }
    } catch (err) {
      console.error('Erro ao buscar lote do Waifinder:', err);
      if (this.cards.length === 0 && this.mode === 'LOOKING') this.showEmptyState();
    } finally {
      this.isLoading = false;
    }
  },

  renderRollingReadyState() {
    const deckEl = document.getElementById('waifinder-deck');
    if (!deckEl) return;

    const avail = this.rollsInfo ? this.rollsInfo.availableRolls : null;
    const maxR = this.rollsInfo ? this.rollsInfo.maxRolls : 9;

    deckEl.innerHTML = `
      <div class="waifinder-empty-state" id="waifinder-roll-ready-box" style="cursor:pointer;">
        <div class="empty-icon">🎲</div>
        <h3 style="font-weight:800;font-size:18px;margin-bottom:8px;">Modo Rollando Pronto!</h3>
        <p style="font-size:13px;color:var(--text-muted);max-width:300px;line-height:1.45;margin-bottom:14px;">
          Clique no botão <b>🎲</b> abaixo, aperte <b>R</b> ou deslize aqui para fazer seu roll!<br>
          <span style="font-size:11.5px;">Cada personagem sorteado consome <b>1 roll</b>${avail !== null ? ` (${avail}/${maxR} disponíveis)` : ''}.</span>
        </p>
        <button type="button" class="btn-retro btn-sm btn-gold" id="btn-start-first-roll">
          <i class="fas fa-dice"></i> Fazer Roll Agora
        </button>
      </div>
    `;

    document.getElementById('btn-start-first-roll')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.performRealRoll('left');
    });

    // Permite swipe direto na área vazia inicial para iniciar o roll
    const readyBox = document.getElementById('waifinder-roll-ready-box');
    if (readyBox) {
      let sx = 0;
      readyBox.addEventListener('pointerdown', (e) => {
        if (e.target.closest('button')) return;
        sx = e.clientX;
      });
      readyBox.addEventListener('pointerup', (e) => {
        if (e.target.closest('button')) return;
        if (Math.abs(e.clientX - sx) > 55) {
          this.performRealRoll(e.clientX > sx ? 'right' : 'left');
        }
      });
    }
  },

  renderNoRollsState(errData = {}) {
    const deckEl = document.getElementById('waifinder-deck');
    if (!deckEl) return;

    const remSecs = Number(errData.remainingSeconds) || this.rollsInfo?.secondsToNext || 300;
    const fullSecs = Number(errData.fullRechargeSeconds) || this.rollsInfo?.fullRechargeSeconds || 0;
    const nextMin = Math.max(1, Math.ceil(remSecs / 60));
    const fullMin = Math.max(1, Math.ceil(fullSecs / 60));

    deckEl.innerHTML = `
      <div class="waifinder-empty-state">
        <div class="empty-icon">⏳</div>
        <h3 style="font-weight:800;font-size:18px;margin-bottom:6px;color:#ef4444;">Seus rolls acabaram!</h3>
        <p style="font-size:13px;color:var(--text-muted);max-width:300px;line-height:1.45;margin-bottom:14px;">
          Você está com <b>0 rolls</b> disponíveis no momento.<br>
          Próximo roll em <b>~${nextMin} min</b>${fullSecs > 0 ? ` • Recarga total em <b>~${fullMin} min</b>` : ''}.
        </p>
        <div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:center;">
          <button type="button" class="btn-retro btn-sm" onclick="Waifinder.enterLookingMode()">
            👁️ Voltar para Olhando
          </button>
          <button type="button" class="btn-retro btn-sm btn-gold" onclick="Waifinder.performRealRoll('left')">
            <i class="fas fa-redo"></i> Tentar Novamente
          </button>
        </div>
      </div>
    `;
  },

  async performRealRoll(direction = 'left') {
    if (this.mode !== 'ROLLING' || this.isRolling) return;
    if (!this.isAuthenticated()) {
      this.showAuthPrompt('Conecte sua conta para rolar personagens!');
      return;
    }

    if (this.rollsInfo && this.rollsInfo.availableRolls <= 0) {
      WaifinderAudio.playError();
      this.showToast('Você está sem rolls disponíveis! Aguarde a recarga.', '⏳');
      if (!this.activeRoll) {
        this.renderNoRollsState({});
      }
      return;
    }

    this.isRolling = true;
    this.resetFloatingStamps();

    const prevCard = this.activePointerCard;
    if (prevCard) {
      this.activePointerCard = null;
      const flyX = direction === 'right' ? window.innerWidth + 200 : -window.innerWidth - 200;
      const rotate = direction === 'right' ? 20 : -20;
      prevCard.style.transition = 'transform 0.25s ease-out, opacity 0.22s ease-out';
      prevCard.style.transform = `translate3d(${flyX}px, 0, 0) rotate(${rotate}deg)`;
      prevCard.style.opacity = '0';
      setTimeout(() => {
        if (prevCard.parentNode) prevCard.parentNode.removeChild(prevCard);
      }, 220);
    }

    WaifinderAudio.playSwipe();

    const deckEl = document.getElementById('waifinder-deck');
    if (deckEl && !prevCard) {
      deckEl.innerHTML = `
        <div class="waifinder-empty-state">
          <div class="empty-icon">🎲</div>
          <h3 style="font-weight:800;font-size:17px;margin-bottom:6px;">Rolando personagem...</h3>
          <p style="font-size:12px;color:var(--text-muted);">Sorteando no catálogo oficial...</p>
        </div>
      `;
    }

    try {
      const publicId = this.publicId || 'token-session';
      const res = await fetch(`/api/web/user/${encodeURIComponent(publicId)}/waifinder/roll`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: this.token,
          gender: this.genderFilter,
        }),
      });

      const data = await res.json();

      if (res.status === 401) {
        this.token = '';
        this.userData = null;
        this.enterLookingMode();
        this.showAuthPrompt('Sua sessão expirou! Gere um novo link com !waifinder ou !mu-adm.');
        return;
      }

      if (!res.ok || !data.success) {
        const err = data.error || {};
        if (typeof err.availableRolls === 'number') {
          this.updateRollsDisplay({
            availableRolls: err.availableRolls,
            maxRolls: err.maxRolls ?? this.rollsInfo?.maxRolls ?? 9,
            farmRolls: err.farmRolls ?? 0,
            farmTickets: err.farmTickets ?? 0,
            secondsToNext: err.remainingSeconds ?? 0,
            fullRechargeSeconds: err.fullRechargeSeconds ?? 0,
          });
        }
        WaifinderAudio.playError();
        if (err.code === 'COOLDOWN_ACTIVE') {
          this.activeRoll = null;
          this.updateModeUI();
          this.renderNoRollsState(err);
          this.showToast('Seus rolls acabaram!', '⏳');
        } else {
          this.showToast(err.message || 'Não foi possível realizar o roll.', '⚠️');
          if (!this.activeRoll) {
            this.renderRollingReadyState();
          }
        }
        return;
      }

      const rollData = data.data;
      this.activeRoll = rollData;

      if (rollData.rolls) {
        this.updateRollsDisplay(rollData.rolls);
      }

      this.renderRolledCard(rollData);
      this.updateModeUI();

      // Feedbacks contextuais leves
      if (rollData.isMythic) {
        WaifinderAudio.playWishlist();
        this.showToast('🔮 Personagem Mítico! Seu roll foi devolvido!', '✨');
      } else if (rollData.instantMarriage) {
        WaifinderAudio.playMarry();
        this.showToast(`📈 Casamento instantâneo por cota com ${rollData.character.name}!`, '💍');
      } else if (rollData.isWishlist) {
        WaifinderAudio.playWishlist();
        this.showToast(`🌟 ${rollData.character.name} está na sua Wishlist!`, '⭐');
      } else if (rollData.keyProgress) {
        this.showToast(`🔑 +1 Chave em ${rollData.character.name} (${rollData.keyProgress.currentKeys}/10)!`, '💎');
      }
    } catch (err) {
      WaifinderAudio.playError();
      this.showToast('Erro de comunicação ao realizar roll.', '❌');
      if (!this.activeRoll) {
        this.renderRollingReadyState();
      }
    } finally {
      this.isRolling = false;
    }
  },

  renderRolledCard(rollData) {
    const deckEl = document.getElementById('waifinder-deck');
    if (!deckEl || !rollData?.character) return;

    const char = rollData.character;
    const cardData = {
      ...char,
      baseRarity: rollData.isMythic ? 'MYTHIC' : (char.baseRarity || char.rarity || 'COMMON'),
      isWishlisted: Boolean(rollData.isWishlist || char.isWishlisted),
      _rollMeta: rollData,
    };

    deckEl.innerHTML = '';
    const cardEl = this.createCardElement(cardData, 0);
    deckEl.appendChild(cardEl);
    this.bindCardGestures(cardEl);
  },

  async performMarry() {
    if (this.mode !== 'ROLLING' || this.isMarrying || this.isRolling || !this.activeRoll) return;
    if (!this.canMarryCurrentRoll()) {
      this.showToast('Este personagem não está disponível para casamento.', 'ℹ️');
      return;
    }

    this.isMarrying = true;
    const btnLike = document.getElementById('btn-action-like');
    if (btnLike) btnLike.disabled = true;

    try {
      const publicId = this.publicId || 'token-session';
      const res = await fetch(`/api/web/user/${encodeURIComponent(publicId)}/waifinder/marry`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: this.token,
          characterId: this.activeRoll.character.id,
        }),
      });

      const data = await res.json();

      if (res.status === 401) {
        this.token = '';
        this.userData = null;
        this.enterLookingMode();
        this.showAuthPrompt('Sua sessão expirou! Gere um novo link com !waifinder ou !mu-adm.');
        return;
      }

      if (!res.ok || !data.success) {
        WaifinderAudio.playError();
        const err = data.error || {};
        if (err.code === 'CHARACTER_ALREADY_CLAIMED') {
          this.activeRoll.available = false;
          this.activeRoll.owner = err.owner || { name: 'Outro jogador' };
          this.renderRolledCard(this.activeRoll);
        }
        this.updateModeUI();
        this.showToast(err.message || 'Não foi possível casar com este personagem.', '⚠️');
        return;
      }

      WaifinderAudio.playMarry();

      this.activeRoll.available = false;
      this.activeRoll.isOwner = true;
      this.activeRoll.marriedJustNow = true;
      this.activeRoll.owner = { name: this.userData?.name || 'Você' };
      this.activeRoll.character.claimCount = (Number(this.activeRoll.character.claimCount) || 0) + 1;

      this.renderRolledCard(this.activeRoll);
      this.updateModeUI();
      this.showMarrySuccessModal(data.data);
    } catch (err) {
      WaifinderAudio.playError();
      this.showToast('Erro ao comunicar com o servidor para casar.', '❌');
      if (btnLike) btnLike.disabled = !this.canMarryCurrentRoll();
    } finally {
      this.isMarrying = false;
    }
  },

  formatDurationShort(seconds) {
    const s = Math.max(0, Math.floor(Number(seconds) || 0));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    if (h > 0 && m > 0) return `${h}h ${m}min`;
    if (h > 0) return `${h}h`;
    if (m > 0) return `${m}min`;
    return `${s}s`;
  },

  showMarrySuccessModal(marryData) {
    const body = document.getElementById('waifinder-marry-modal-body');
    const modal = document.getElementById('modal-waifinder-marry');
    if (!body || !modal || !marryData) return;

    const ch = marryData.character || {};
    const rarityKey = String(ch.rarity || 'COMMON').toUpperCase();
    const rarityInfo = RARITY_MAP[rarityKey] || RARITY_MAP.COMMON;
    const imgUrl = this.formatCardImg(ch.imageUrl || (ch.imageUrls && ch.imageUrls[0]) || '', ch.id);

    const dm = marryData.dailyMarry;
    let remainingLine = '';
    if (rarityKey === 'LEGENDARY') {
      remainingLine = '∞ Sem limite diário para Lendários!';
    } else if (dm && dm.limit !== null && dm.limit !== undefined) {
      remainingLine = `<b>${dm.remaining}/${dm.limit}</b> casamentos de ${rarityInfo.plural} restantes hoje`;
    }

    const cooldownSecs = marryData.rarityCooldown?.cooldownSeconds || 0;
    const cooldownText = cooldownSecs > 0 ? this.formatDurationShort(cooldownSecs) : '';

    body.innerHTML = `
      <div style="display:flex;flex-direction:column;align-items:center;gap:10px;">
        <img src="${Api.escapeHtml(imgUrl)}" alt="${Api.escapeHtml(ch.name)}" onerror="window.handleImgError(this)" style="width:130px;height:185px;object-fit:cover;object-position:top center;border-radius:8px;border:3px solid ${rarityInfo.color};box-shadow:3px 3px 0 #000;">
        <div>
          <div style="font-size:16px;font-weight:900;color:var(--text-main);">
            💍 Parabéns, ${Api.escapeHtml(this.userData?.name || 'Jogador')}!
          </div>
          <div style="font-size:13px;color:var(--text-muted);margin-top:2px;">
            Você se casou com <b>${Api.escapeHtml(ch.name)}</b>! 🎉
          </div>
          <div style="font-size:11.5px;color:var(--text-muted);margin-top:2px;">
            ${Api.escapeHtml(ch.series || '')} • <span style="color:${rarityInfo.color};font-weight:800;">${rarityInfo.label}</span>
          </div>
        </div>

        <div style="width:100%;background:var(--bg-card-subtle);border:var(--border-retro);border-radius:6px;padding:10px 12px;text-align:left;font-size:12.5px;display:flex;flex-direction:column;gap:5px;">
          <div>🔑 Chaves: <b>${marryData.keys || 1}/10</b></div>
          <div>💜 Saldo atual: <b>${Number(marryData.kakeraBalance || 0).toLocaleString('pt-BR')} Zinthos</b></div>
          ${remainingLine ? `<div>📅 Limite diário (${rarityInfo.label}): ${remainingLine}</div>` : ''}
          ${cooldownText ? `<div>⏳ Cooldown da raridade: <b>${cooldownText}</b></div>` : ''}
          ${marryData.isSoulmate ? `<div style="color:#ec4899;font-weight:800;">💖 ${Api.escapeHtml(ch.name)} é sua Soulmate definitiva!</div>` : ''}
        </div>
      </div>
    `;

    modal.classList.remove('hidden');
  },

  renderDeck() {
    if (this.mode !== 'LOOKING') return;
    const deckEl = document.getElementById('waifinder-deck');
    if (!deckEl) return;

    const remaining = this.cards.length - this.currentIndex;
    if (remaining <= 4 && !this.isLoading) {
      this.fetchNextBatch();
    }

    if (remaining <= 0) {
      this.showEmptyState();
      return;
    }

    deckEl.innerHTML = '';

    const visibleCount = Math.min(3, remaining);
    for (let i = visibleCount - 1; i >= 0; i--) {
      const cardIndex = this.currentIndex + i;
      const char = this.cards[cardIndex];
      const cardEl = this.createCardElement(char, i);
      deckEl.appendChild(cardEl);

      if (i === 0) {
        this.bindCardGestures(cardEl);
      }
    }
  },

  formatCardImg(url, charId) {
    if (!url) {
      return charId ? `/media/characters/${charId}/default.jpg` : '/media/characters/default.jpg';
    }
    if (url.startsWith('http://') || url.startsWith('https://')) {
      try {
        const parsed = new URL(url);
        if (parsed.pathname.startsWith('/characters/')) {
          parsed.pathname = '/media' + parsed.pathname;
          return parsed.toString();
        }
      } catch (_) {}
      return url;
    }
    if (url.startsWith('/media/')) return url;
    if (url.startsWith('media/')) return `/${url}`;
    const clean = url.startsWith('/') ? url : `/${url}`;
    return `/media${clean}`;
  },

  createCardElement(char, layerIndex) {
    const isMythic = Boolean(char.isMythic || char.baseRarity === 'MYTHIC');
    const rarity = isMythic ? RARITY_MAP.MYTHIC : (RARITY_MAP[char.baseRarity] || RARITY_MAP.COMMON);
    const rawImg = (char.imageUrls && char.imageUrls[0]) || char.imageUrl || '';
    const imgUrl = this.formatCardImg(rawImg, char.id);
    const profileId = char.numericId || char.id;
    const rollMeta = char._rollMeta || null;

    let rollBannerHtml = '';
    if (rollMeta) {
      if (rollMeta.isMythic) {
        rollBannerHtml = `<div class="waifinder-roll-status-banner is-mythic">🔮 Criação Mítica — Roll devolvido!</div>`;
      } else if (rollMeta.instantMarriage) {
        rollBannerHtml = `<div class="waifinder-roll-status-banner is-instant">📈 Casamento instantâneo por cota!</div>`;
      } else if (rollMeta.marriedJustNow) {
        rollBannerHtml = `<div class="waifinder-roll-status-banner is-owner">💍 Casada(o) com você agora!</div>`;
      } else if (!rollMeta.available && rollMeta.isOwner) {
        const keysInfo = rollMeta.keyProgress ? ` • 🔑 ${rollMeta.keyProgress.currentKeys}/10` : '';
        rollBannerHtml = `<div class="waifinder-roll-status-banner is-owner">💍 Sua waifu${keysInfo} • +${rollMeta.rollReward?.totalScrap || 0} 💎</div>`;
      } else if (!rollMeta.available && rollMeta.owner) {
        const scrap = rollMeta.kakeraValue || rollMeta.rollReward?.totalScrap || 0;
        rollBannerHtml = `<div class="waifinder-roll-status-banner is-married">💍 De ${Api.escapeHtml(rollMeta.owner.name)} • +${scrap} 💎</div>`;
      }
    }

    const showTopLike = this.mode === 'ROLLING' && layerIndex === 0;
    const isLiked = Boolean(char.isLikedToday);

    const card = document.createElement('div');
    card.className = `waifinder-card card-layer-${layerIndex} ${rarity.class}`;
    card.dataset.id = char.id;

    card.innerHTML = `
      <div class="waifinder-card-img-wrap">
        <img draggable="false" decoding="async" class="waifinder-card-img" src="${Api.escapeHtml(imgUrl)}" alt="${Api.escapeHtml(char.name)}" onerror="window.handleImgError(this)">
        <div class="waifinder-card-gradient"></div>

        <div class="waifinder-badges-top">
          <span class="waifinder-rarity-badge" style="background:${rarity.bg};">${rarity.label}</span>
          ${showTopLike ? `
            <button type="button" class="btn-card-top-like ${isLiked ? 'liked' : ''}" title="${isLiked ? 'Já curtido hoje!' : 'Curtir personagem'}">
              <i class="fas fa-heart"></i>
            </button>
          ` : ''}
        </div>
      </div>

      <div class="waifinder-card-info">
        <div class="waifinder-char-name">
          <span>${Api.escapeHtml(char.name)}</span>
          ${char.isWishlisted ? '<span title="Já na sua Wishlist!" style="font-size:15px;color:#eab308;">★</span>' : ''}
        </div>
        <div class="waifinder-char-series">
          <i class="fas fa-tv"></i> <span>${Api.escapeHtml(char.series || 'Origem desconhecida')}</span>
        </div>
        ${rollBannerHtml}
        <div class="waifinder-char-stats">
          <span>⭐ ${char.wishlistCount || 0} wishlists</span>
          <span class="stat-likes-count">❤️ ${char.likeCount || 0} curtidas</span>
          <span>💍 ${char.claimCount || 0} casamentos</span>
          ${char.gender ? `<span>${char.gender === 'FEMALE' ? '♀' : char.gender === 'MALE' ? '♂' : '⚧'}</span>` : ''}
        </div>
        <div class="waifinder-char-desc">
          ${Api.escapeHtml(char.description || 'Nenhuma descrição cadastrada para este personagem.')}
        </div>

        <div class="waifinder-card-actions-wrap waifinder-rarity-action-wrap">
          ${isMythic ? `
            <div class="waifinder-action-group group-rarity" style="color: #facc15; font-size: 11px; font-weight: 800; padding: 5px 9px; background: rgba(168, 85, 247, 0.25); border-radius: 4px; border: 1px solid #a855f7;">
              🔮 Criação Mítica
            </div>
          ` : `
            <!-- Grupo: Mudar Raridade -->
            <div class="waifinder-action-group group-rarity">
              <button type="button" class="btn-waifinder-sub-action btn-waifinder-change-rarity" title="Sugerir alteração de raridade">
                🔄 Raridade
              </button>
              <div class="waifinder-rarity-options hidden">
                <button type="button" class="btn-rarity-opt opt-common ${char.baseRarity === 'COMMON' ? 'is-current' : ''}" data-rarity="COMMON" title="Comum">Comum</button>
                <button type="button" class="btn-rarity-opt opt-uncommon ${char.baseRarity === 'UNCOMMON' ? 'is-current' : ''}" data-rarity="UNCOMMON" title="Incomum">Incomum</button>
                <button type="button" class="btn-rarity-opt opt-rare ${char.baseRarity === 'RARE' ? 'is-current' : ''}" data-rarity="RARE" title="Raro">Raro</button>
                <button type="button" class="btn-rarity-opt opt-epic ${char.baseRarity === 'EPIC' ? 'is-current' : ''}" data-rarity="EPIC" title="Épico">Épico</button>
                <button type="button" class="btn-rarity-opt opt-legendary ${char.baseRarity === 'LEGENDARY' ? 'is-current' : ''}" data-rarity="LEGENDARY" title="Lendário">Lendário</button>
                <button type="button" class="btn-rarity-opt opt-cancel" title="Fechar">✕</button>
              </div>
            </div>
          `}

          <!-- Grupo: Denunciar! -->
          <div class="waifinder-action-group group-report">
            <button type="button" class="btn-waifinder-sub-action btn-waifinder-report" title="Denunciar ou solicitar exclusão deste personagem">
              🚩 Denunciar!
            </button>
            <div class="waifinder-report-options hidden">
              <button type="button" class="btn-report-opt opt-confirm-report" title="Confirmar Denúncia">
                <i class="fas fa-check"></i> Confirmar
              </button>
              <button type="button" class="btn-report-opt opt-cancel-report" title="Cancelar">
                <i class="fas fa-times"></i> Cancelar
              </button>
            </div>
          </div>

          <!-- Botão Perfil (abre em nova aba) -->
          <a href="/c/${encodeURIComponent(profileId)}" target="_blank" rel="noopener noreferrer" draggable="false" class="btn-waifinder-sub-action btn-waifinder-profile" title="Abrir página do personagem em nova aba">
            👤 Perfil
          </a>
        </div>
      </div>
    `;

    this.bindCardActionButtons(card, char);
    return card;
  },

  updateFloatingStamps(currentX, threshold) {
    const rightEl = document.getElementById('waifinder-floating-stamp-right');
    const leftEl = document.getElementById('waifinder-floating-stamp-left');
    if (!rightEl || !leftEl) return;

    const progress = Math.min(1, Math.abs(currentX) / Math.max(80, threshold * 0.85));

    if (this.mode === 'ROLLING') {
      const canMarry = this.canMarryCurrentRoll();
      if (canMarry) {
        rightEl.textContent = 'CASAR!';
        rightEl.className = 'waifinder-stamp stamp-like is-marry';
      } else {
        rightEl.textContent = 'PRÓXIMO!';
        rightEl.className = 'waifinder-stamp stamp-nope is-next';
      }
      leftEl.textContent = 'PRÓXIMO!';
      leftEl.className = 'waifinder-stamp stamp-nope is-next';
    } else {
      rightEl.textContent = 'CURTIR';
      rightEl.className = 'waifinder-stamp stamp-like';
      leftEl.textContent = 'PASSAR';
      leftEl.className = 'waifinder-stamp stamp-nope';
    }

    if (currentX > 8) {
      rightEl.style.opacity = String(progress);
      rightEl.style.transform = `translateX(-50%) scale(${0.92 + progress * 0.12})`;
      leftEl.style.opacity = '0';
    } else if (currentX < -8) {
      leftEl.style.opacity = String(progress);
      leftEl.style.transform = `translateX(-50%) scale(${0.92 + progress * 0.12})`;
      rightEl.style.opacity = '0';
    } else {
      rightEl.style.opacity = '0';
      leftEl.style.opacity = '0';
    }
  },

  resetFloatingStamps() {
    const rightEl = document.getElementById('waifinder-floating-stamp-right');
    const leftEl = document.getElementById('waifinder-floating-stamp-left');
    if (rightEl) rightEl.style.opacity = '0';
    if (leftEl) leftEl.style.opacity = '0';
  },

  bindCardGestures(cardEl) {
    this.activePointerCard = cardEl;

    const onPointerDown = (e) => {
      if (e.target.closest('.waifinder-char-desc')) {
        if (e.target.scrollHeight > e.target.clientHeight) return;
      }
      if (
        e.target.closest('.waifinder-card-actions-wrap') ||
        e.target.closest('.waifinder-rarity-action-wrap') ||
        e.target.closest('.btn-card-top-like')
      ) {
        return;
      }

      this.isDragging = true;
      this.startX = e.clientX;
      this.startY = e.clientY;
      this.currentX = 0;
      this.currentY = 0;

      cardEl.style.transition = 'none';
      try {
        cardEl.setPointerCapture(e.pointerId);
      } catch (_) {}
    };

    const onPointerMove = (e) => {
      if (!this.isDragging) return;

      this.currentX = e.clientX - this.startX;
      this.currentY = e.clientY - this.startY;

      const threshold = Math.max(115, Math.round((cardEl.offsetWidth || 360) * 0.34));
      const rotate = Math.max(-14, Math.min(14, this.currentX * 0.05));
      const dampY = this.currentY * 0.35;

      cardEl.style.transform = `translate3d(${this.currentX}px, ${dampY}px, 0) rotate(${rotate}deg)`;

      // Anima suavemente o card de baixo subindo durante o arraste
      if (this.mode === 'LOOKING') {
        const nextCard = cardEl.parentElement?.querySelector('.card-layer-1');
        if (nextCard) {
          const prog = Math.min(1, Math.abs(this.currentX) / threshold);
          const scale = 0.96 + prog * 0.04;
          const ty = 10 - prog * 10;
          nextCard.style.setProperty('transform', `translateY(${ty.toFixed(1)}px) scale(${scale.toFixed(4)})`, 'important');
        }
      }

      this.updateFloatingStamps(this.currentX, threshold);
    };

    const onPointerUp = (e) => {
      if (!this.isDragging) return;
      this.isDragging = false;

      try {
        cardEl.releasePointerCapture(e.pointerId);
      } catch (_) {}

      const threshold = Math.max(115, Math.round((cardEl.offsetWidth || 360) * 0.34));
      this.resetFloatingStamps();

      if (this.currentX >= threshold) {
        if (this.mode === 'ROLLING') {
          if (this.canMarryCurrentRoll()) {
            // Volta card suavemente ao centro e dispara casamento com popup
            cardEl.style.transition = 'transform 0.32s cubic-bezier(0.22, 1.25, 0.36, 1)';
            cardEl.style.transform = 'translate3d(0, 0, 0) rotate(0deg)';
            this.performMarry();
          } else {
            this.performRealRoll('right');
          }
        } else {
          this.animateCardExit('right');
        }
      } else if (this.currentX <= -threshold) {
        if (this.mode === 'ROLLING') {
          this.performRealRoll('left');
        } else {
          this.animateCardExit('left');
        }
      } else {
        // Desistiu no meio: restaura suavemente ao centro estilo Tinder
        cardEl.style.transition = 'transform 0.36s cubic-bezier(0.22, 1.25, 0.36, 1)';
        cardEl.style.transform = 'translate3d(0, 0, 0) rotate(0deg)';

        if (this.mode === 'LOOKING') {
          const nextCard = cardEl.parentElement?.querySelector('.card-layer-1');
          if (nextCard) {
            nextCard.style.removeProperty('transform');
          }
        }
      }
    };

    cardEl.addEventListener('pointerdown', onPointerDown);
    cardEl.addEventListener('pointermove', onPointerMove);
    cardEl.addEventListener('pointerup', onPointerUp);
    cardEl.addEventListener('pointercancel', onPointerUp);
  },

  swipeCard(direction) {
    if (!this.activePointerCard) return;
    this.animateCardExit(direction);
  },

  recordUnauthSwipeAndMaybePrompt() {
    if (this.token) return;
    const stage = parseInt(localStorage.getItem('waifinder_unauth_prompt_stage') || '0', 10) || 0;
    if (stage >= 3) return;

    const count = (parseInt(localStorage.getItem('waifinder_unauth_swipe_count') || '0', 10) || 0) + 1;
    localStorage.setItem('waifinder_unauth_swipe_count', String(count));

    // 1x -> +10x (11) -> +30x (41) -> nunca mais
    let shouldPrompt = false;
    let nextStage = stage;
    if (stage === 0 && count >= 1) {
      shouldPrompt = true;
      nextStage = 1;
    } else if (stage === 1 && count >= 11) {
      shouldPrompt = true;
      nextStage = 2;
    } else if (stage === 2 && count >= 41) {
      shouldPrompt = true;
      nextStage = 3;
    }

    if (shouldPrompt) {
      localStorage.setItem('waifinder_unauth_prompt_stage', String(nextStage));
      this.showAuthPrompt('Para curtir personagens, adicioná-los à Wishlist e rolar/casar no site, conecte sua conta!');
    }
  },

  animateCardExit(direction) {
    const cardEl = this.activePointerCard;
    if (!cardEl) return;

    this.activePointerCard = null;
    this.resetFloatingStamps();

    const currentChar = this.cards[this.currentIndex];
    if (currentChar) {
      this.seenIds.push(currentChar.id);
    }

    const flyX = direction === 'right' ? window.innerWidth + 200 : -window.innerWidth - 200;
    const rotate = direction === 'right' ? 22 : -22;

    cardEl.style.transition = 'transform 0.3s ease-out, opacity 0.26s ease-out';
    cardEl.style.transform = `translate3d(${flyX}px, 0, 0) rotate(${rotate}deg)`;
    cardEl.style.opacity = '0';

    if (!this.token) {
      if (direction === 'right') WaifinderAudio.playLike();
      else WaifinderAudio.playSwipe();
      this.recordUnauthSwipeAndMaybePrompt();
    } else if (direction === 'right' && currentChar) {
      WaifinderAudio.playLike();
      this.submitLike(currentChar.id, false);
    } else {
      WaifinderAudio.playSwipe();
    }

    setTimeout(() => {
      if (cardEl.parentNode) cardEl.parentNode.removeChild(cardEl);
      this.currentIndex++;
      this.renderDeck();
    }, 260);
  },

  async submitLike(charId, updateActiveCard = false) {
    if (!this.token) {
      this.showAuthPrompt('Para curtir personagens e registrá-los na sua conta, entre com seu link do WhatsApp!');
      return;
    }

    try {
      const publicId = this.publicId || 'token-session';
      const res = await fetch(`/api/web/user/${encodeURIComponent(publicId)}/characters/${encodeURIComponent(charId)}/like`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: this.token })
      });
      const data = await res.json();
      if (!data.success && data.error?.code === 'LIKE_ALREADY_GIVEN_TODAY') {
        this.showToast(data.error.message, '⏳');
      } else if (data.success) {
        WaifinderAudio.playLike();
        this.showToast('Curtida registrada! ❤️', '✨');
        if (updateActiveCard && this.activeRoll?.character?.id === charId) {
          this.activeRoll.character.isLikedToday = true;
          if (typeof data.data?.likeCount === 'number') {
            this.activeRoll.character.likeCount = data.data.likeCount;
          } else {
            this.activeRoll.character.likeCount = (Number(this.activeRoll.character.likeCount) || 0) + 1;
          }
          const topLikeBtn = document.querySelector('.btn-card-top-like');
          if (topLikeBtn) topLikeBtn.classList.add('liked');
          const likesStat = document.querySelector('.stat-likes-count');
          if (likesStat) likesStat.textContent = `❤️ ${this.activeRoll.character.likeCount} curtidas`;
        }
      }
    } catch (_) {}
  },

  getCurrentCharacter() {
    if (this.mode === 'ROLLING') {
      return this.activeRoll?.character || null;
    }
    return this.cards[this.currentIndex] || null;
  },

  async handleWishlist() {
    const currentChar = this.getCurrentCharacter();
    if (!currentChar) return;

    if (!this.token) {
      this.showAuthPrompt('Para adicionar waifus à sua Wishlist, entre com seu link do WhatsApp!');
      return;
    }

    const stamp = document.getElementById('waifinder-floating-stamp-wish');
    if (stamp) {
      stamp.style.opacity = '1';
      setTimeout(() => { stamp.style.opacity = '0'; }, 600);
    }

    WaifinderAudio.playWishlist();

    try {
      const publicId = this.publicId || 'token-session';
      const res = await fetch(`/api/web/user/${encodeURIComponent(publicId)}/wishlist`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: this.token, characterId: currentChar.id })
      });
      const data = await res.json();

      if (data.success) {
        this.showToast(`${currentChar.name} adicionada à sua Wishlist!`, '⭐');
      } else {
        this.showToast(data.error?.message || 'Não foi possível adicionar à wishlist.', '⚠️');
      }
    } catch (err) {
      this.showToast('Erro ao comunicar com o servidor.', '❌');
    }
  },

  bindCardActionButtons(cardEl, char) {
    const topLikeBtn = cardEl.querySelector('.btn-card-top-like');
    if (topLikeBtn) {
      const stop = (e) => e.stopPropagation();
      topLikeBtn.addEventListener('pointerdown', stop);
      topLikeBtn.addEventListener('pointerup', stop);
      topLikeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        this.submitLike(char.id, true);
      });
    }

    const wrap = cardEl.querySelector('.waifinder-card-actions-wrap');
    if (!wrap) return;

    const stopProp = (e) => e.stopPropagation();
    wrap.addEventListener('pointerdown', stopProp);
    wrap.addEventListener('pointermove', stopProp);
    wrap.addEventListener('pointerup', stopProp);
    wrap.addEventListener('touchstart', stopProp, { passive: true });
    wrap.addEventListener('mousedown', stopProp);
    wrap.addEventListener('click', stopProp);

    const groupRarity = wrap.querySelector('.group-rarity');
    const btnChangeRarity = wrap.querySelector('.btn-waifinder-change-rarity');
    const optionsRarity = wrap.querySelector('.waifinder-rarity-options');
    const btnCancelRarity = wrap.querySelector('.opt-cancel');

    const groupReport = wrap.querySelector('.group-report');
    const btnReport = wrap.querySelector('.btn-waifinder-report');
    const optionsReport = wrap.querySelector('.waifinder-report-options');
    const btnConfirmReport = wrap.querySelector('.opt-confirm-report');
    const btnCancelReport = wrap.querySelector('.opt-cancel-report');
    const btnProfile = wrap.querySelector('.btn-waifinder-profile');

    const toggleOtherGroups = (hide) => {
      if (btnProfile) btnProfile.classList.toggle('hidden', hide);
    };

    if (btnChangeRarity && optionsRarity) {
      btnChangeRarity.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        btnChangeRarity.classList.add('hidden');
        if (groupReport) groupReport.classList.add('hidden');
        toggleOtherGroups(true);
        optionsRarity.classList.remove('hidden');
        WaifinderAudio.playPop();
      });
    }

    if (btnCancelRarity && optionsRarity && btnChangeRarity) {
      btnCancelRarity.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        optionsRarity.classList.add('hidden');
        btnChangeRarity.classList.remove('hidden');
        if (groupReport) groupReport.classList.remove('hidden');
        toggleOtherGroups(false);
      });
    }

    wrap.querySelectorAll('.btn-rarity-opt[data-rarity]').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        e.preventDefault();
        await this.handleRaritySuggestion(char, btn.dataset.rarity, wrap);
      });
    });

    if (btnReport && optionsReport) {
      btnReport.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        btnReport.classList.add('hidden');
        if (groupRarity) groupRarity.classList.add('hidden');
        toggleOtherGroups(true);
        optionsReport.classList.remove('hidden');
        WaifinderAudio.playPop();
      });
    }

    if (btnCancelReport && optionsReport && btnReport) {
      btnCancelReport.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        optionsReport.classList.add('hidden');
        btnReport.classList.remove('hidden');
        if (groupRarity) groupRarity.classList.remove('hidden');
        toggleOtherGroups(false);
      });
    }

    if (btnConfirmReport) {
      btnConfirmReport.addEventListener('click', async (e) => {
        e.stopPropagation();
        e.preventDefault();
        await this.handleReportSuggestion(char, wrap);
      });
    }
  },

  async handleRaritySuggestion(char, targetRarity, wrapEl) {
    const targetInfo = RARITY_MAP[targetRarity] || { label: targetRarity };

    if (char.baseRarity === targetRarity) {
      this.showToast(`${char.name} já é da raridade ${targetInfo.label}!`, 'ℹ️');
      return;
    }

    if (!this.token) {
      this.showAuthPrompt('Para sugerir alterações de raridade, conecte-se com seu link da Ravena no WhatsApp!');
      return;
    }

    const groupReport = wrapEl.querySelector('.group-report');
    const btnProfile = wrapEl.querySelector('.btn-waifinder-profile');
    const btnChange = wrapEl.querySelector('.btn-waifinder-change-rarity');
    const optionsWrap = wrapEl.querySelector('.waifinder-rarity-options');

    const btns = wrapEl.querySelectorAll('button');
    btns.forEach((b) => (b.disabled = true));

    this.showToast(`Enviando sugestão para ${targetInfo.label}...`, '⏳');

    try {
      const publicId = this.publicId || 'token-session';
      const res = await fetch(`/api/web/user/${encodeURIComponent(publicId)}/suggestions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: this.token,
          type: 'RARITY',
          characterId: char.id,
          characterName: char.name,
          series: char.series,
          suggestedRarity: targetRarity,
          reason: 'Sugerido via Waifinder',
        }),
      });

      const data = await res.json();

      if (data.success) {
        WaifinderAudio.playPop();
        this.showToast(`Sugestão enviada com sucesso! (${targetInfo.label}) ✨`, '💎');
        if (optionsWrap) optionsWrap.classList.add('hidden');
        if (groupReport) groupReport.classList.remove('hidden');
        if (btnProfile) btnProfile.classList.remove('hidden');
        if (btnChange) {
          btnChange.classList.remove('hidden');
          btnChange.innerHTML = `<i class="fas fa-check" style="color:#22c55e;"></i> ${targetInfo.label}`;
          setTimeout(() => {
            btnChange.innerHTML = '🔄 Raridade';
          }, 3500);
        }
      } else {
        this.showToast(data.error?.message || 'Falha ao enviar sugestão de raridade.', '⚠️');
        if (optionsWrap) optionsWrap.classList.add('hidden');
        if (btnChange) btnChange.classList.remove('hidden');
        if (groupReport) groupReport.classList.remove('hidden');
        if (btnProfile) btnProfile.classList.remove('hidden');
      }
    } catch (err) {
      this.showToast('Erro ao comunicar com o servidor.', '❌');
      if (optionsWrap) optionsWrap.classList.add('hidden');
      if (btnChange) btnChange.classList.remove('hidden');
      if (groupReport) groupReport.classList.remove('hidden');
      if (btnProfile) btnProfile.classList.remove('hidden');
    } finally {
      btns.forEach((b) => (b.disabled = false));
    }
  },

  async handleReportSuggestion(char, wrapEl) {
    if (!this.token) {
      this.showAuthPrompt('Para denunciar personagens, conecte-se com seu link da Ravena no WhatsApp!');
      return;
    }

    const groupRarity = wrapEl.querySelector('.group-rarity');
    const btnProfile = wrapEl.querySelector('.btn-waifinder-profile');
    const btnReport = wrapEl.querySelector('.btn-waifinder-report');
    const optionsReport = wrapEl.querySelector('.waifinder-report-options');

    const btns = wrapEl.querySelectorAll('button');
    btns.forEach((b) => (b.disabled = true));

    this.showToast('Enviando denúncia...', '⏳');

    try {
      const publicId = this.publicId || 'token-session';
      const res = await fetch(`/api/web/user/${encodeURIComponent(publicId)}/suggestions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: this.token,
          type: 'DELETE_CHARACTER',
          characterId: char.id,
          reason: 'Denunciado via Waifinder',
        }),
      });

      const data = await res.json();

      if (data.success) {
        WaifinderAudio.playPop();
        this.showToast('Denúncia enviada com sucesso para a moderação! 🚩', '⚠️');
        if (optionsReport) optionsReport.classList.add('hidden');
        if (groupRarity) groupRarity.classList.remove('hidden');
        if (btnProfile) btnProfile.classList.remove('hidden');
        if (btnReport) {
          btnReport.classList.remove('hidden');
          btnReport.innerHTML = '<i class="fas fa-check" style="color:#22c55e;"></i> Denunciado';
          setTimeout(() => {
            btnReport.innerHTML = '🚩 Denunciar!';
          }, 3500);
        }
      } else {
        this.showToast(data.error?.message || 'Falha ao enviar denúncia.', '⚠️');
        if (optionsReport) optionsReport.classList.add('hidden');
        if (btnReport) btnReport.classList.remove('hidden');
        if (groupRarity) groupRarity.classList.remove('hidden');
        if (btnProfile) btnProfile.classList.remove('hidden');
      }
    } catch (err) {
      this.showToast('Erro ao comunicar com o servidor.', '❌');
      if (optionsReport) optionsReport.classList.add('hidden');
      if (btnReport) btnReport.classList.remove('hidden');
      if (groupRarity) groupRarity.classList.remove('hidden');
      if (btnProfile) btnProfile.classList.remove('hidden');
    } finally {
      btns.forEach((b) => (b.disabled = false));
    }
  },

  showAuthPrompt(customMsg) {
    WaifinderAudio.playPop();
    const msgEl = document.getElementById('auth-prompt-msg');
    if (msgEl && customMsg) msgEl.textContent = customMsg;
    document.getElementById('modal-waifinder-auth')?.classList.remove('hidden');
  },

  closeModals() {
    document.querySelectorAll('.modal-overlay').forEach((m) => m.classList.add('hidden'));
  },

  showEmptyState() {
    const deckEl = document.getElementById('waifinder-deck');
    if (!deckEl) return;
    deckEl.innerHTML = `
      <div class="waifinder-empty-state">
        <div class="empty-icon">✨</div>
        <h3 style="font-weight:800;font-size:18px;margin-bottom:6px;">Todos os cards foram vistos!</h3>
        <p style="font-size:13px;color:var(--text-muted);margin-bottom:14px;">Buscando mais waifus no catálogo...</p>
        <button type="button" class="waifinder-header-btn" onclick="Waifinder.seenIds = []; Waifinder.fetchNextBatch();">
          <i class="fas fa-redo"></i> Recarregar Baralho
        </button>
      </div>
    `;
  },

  showToast(message, icon = '✨') {
    let toast = document.getElementById('retro-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'retro-toast';
      toast.className = 'retro-toast hidden';
      document.body.appendChild(toast);
    }
    const iconEl = document.createElement('span');
    iconEl.style.fontSize = '18px';
    iconEl.textContent = icon == null ? '' : String(icon);
    const msgEl = document.createElement('span');
    msgEl.textContent = message == null ? '' : String(message);
    toast.replaceChildren(iconEl, document.createTextNode(' '), msgEl);
    toast.classList.remove('hidden');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => {
      toast.classList.add('hidden');
    }, 3200);
  }
};

window.addEventListener('DOMContentLoaded', () => {
  Waifinder.init();
});
