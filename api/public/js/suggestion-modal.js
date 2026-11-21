// js/suggestion-modal.js - Componente Compartilhado de Modal de Sugestões (Dados e Fotos)

(function (global) {
  'use strict';

  const RARITY_CONFIG = {
    COMMON:    { emoji: '⚪', label: 'Comum',    color: '#94a3b8' },
    UNCOMMON:  { emoji: '🟢', label: 'Incomum',  color: '#22c55e' },
    RARE:      { emoji: '🔵', label: 'Raro',     color: '#3b82f6' },
    EPIC:      { emoji: '🟣', label: 'Épico',    color: '#a855f7' },
    LEGENDARY: { emoji: '⭐', label: 'Lendário', color: '#eab308' }
  };

  function escapeHtml(str) {
    if (global.Api && typeof global.Api.escapeHtml === 'function') {
      return global.Api.escapeHtml(str);
    }
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function normalizeLegendaryPhrase(str) {
    return (str || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function isLegendaryPhraseValid(str) {
    return normalizeLegendaryPhrase(str) === 'personagem casado criar versao lendaria';
  }

  const SuggestionModal = {
    _initialized: false,
    _activeCharacter: null,
    _tagsState: [],
    _photosList: [],
    _photoAction: 'ADD',
    _targetPhoto: null,
    _cropper: null,
    _countdownTimer: null,
    _countdownRemaining: 30,
    _phraseValidated: false,
    _countdownFinished: false,
    _isSubmitting: false,
    _token: '',
    _publicId: 'token-session',
    _onSuccess: null,

    _ensureDom() {
      let overlay = document.getElementById('modal-suggest');
      if (overlay) return overlay;

      overlay = document.createElement('div');
      overlay.className = 'modal-overlay hidden';
      overlay.id = 'modal-suggest';
      overlay.innerHTML = `
        <div class="modal-box" style="max-width: min(720px, 90vw); max-height: 85vh; overflow-y: auto;">
          <div class="modal-header">
            <span class="modal-title" style="font-size: clamp(13px, 3.8vw, 16px);">💡 Sugerir Alteração no Personagem</span>
            <button type="button" class="modal-close" id="btn-suggest-modal-close">&times;</button>
          </div>
          <div class="modal-body">
            <div style="display: flex; justify-content: space-between; align-items: center; gap: 10px; margin-bottom: 12px; background: var(--bg-card-subtle); padding: 10px; border: var(--border-retro); border-radius: 4px;">
              <div style="min-width: 0;">
                <h4 id="suggest-char-name" style="font-weight: 800; font-size: 16px; margin: 0; word-break: break-word;">Personagem</h4>
                <span id="suggest-char-series-badge" style="font-size: 12px; color: var(--text-muted); font-weight: 600;">Série</span>
              </div>
              <span id="suggest-current-rarity" class="badge-rarity" style="position: static; white-space: nowrap; flex-shrink: 0;">⚪ Comum</span>
            </div>

            <div class="retro-tabs" style="margin-bottom: 16px;">
              <button type="button" class="retro-tab active" data-subtab="subtab-edit-info">📝 Dados</button>
              <button type="button" class="retro-tab" data-subtab="subtab-photos">📸 Fotos</button>
            </div>

            <!-- Subaba Dados Gerais do Personagem -->
            <div class="subtab-content" id="subtab-edit-info">
              <p style="font-size: 12px; color: var(--text-muted); margin-bottom: 12px;">Sugerir alterações de sexo, série, descrição, raridade e tags.</p>
              <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 12px; margin-bottom: 10px;">
                <div class="form-group" style="margin-bottom: 0;">
                  <label class="retro-label">Nome Sugerido:</label>
                  <input type="text" id="suggest-edit-name" class="retro-input" placeholder="Nome do personagem">
                </div>
                <div class="form-group" style="margin-bottom: 0;">
                  <label class="retro-label">Série / Anime Sugerido:</label>
                  <input type="text" id="suggest-edit-series" class="retro-input" placeholder="Obra / Franquia de origem">
                </div>
              </div>

              <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 12px; margin-bottom: 10px;">
                <div class="form-group" style="margin-bottom: 0;">
                  <label class="retro-label">Gênero / Sexo:</label>
                  <select id="suggest-edit-gender" class="retro-select">
                    <option value="FEMALE">♀ Feminino</option>
                    <option value="MALE">♂ Masculino</option>
                    <option value="OTHER">⚧ Outro</option>
                  </select>
                </div>
                <div class="form-group" style="margin-bottom: 0;">
                  <label class="retro-label">Raridade Sugerida:</label>
                  <select id="suggest-edit-rarity" class="retro-select">
                    <option value="COMMON">⚪ Comum</option>
                    <option value="UNCOMMON">🟢 Incomum</option>
                    <option value="RARE">🔵 Raro</option>
                    <option value="EPIC">🟣 Épico</option>
                    <option value="LEGENDARY">⭐ Lendário</option>
                  </select>
                </div>
              </div>

              <!-- Alerta e Upload de Foto para Versão Lendária de Personagem Casado -->
              <div id="suggest-legendary-married-box" class="legendary-married-alert hidden">
                <div style="font-weight: 800; display: flex; align-items: center; gap: 6px; margin-bottom: 6px;">
                  <span>⚠️</span> <span>Regra Especial: Personagem Já Casado</span>
                </div>
                <p style="margin: 0 0 10px 0; line-height: 1.4;">
                  Este personagem <b>já foi casado</b>. A raridade máxima permitida para o personagem existente é <b>ÉPICO</b>. Você deveria ter feito a sugestão antes de se casar com o personagem, esta ação é mal vista pela administração, pois parece abuso do sistema para tentar fazer upgrade nos seus personagens.<br>
                  Para sugerir a mudança para <b>LENDÁRIO</b>, será criado um <b>NOVO personagem</b> no catálogo na versão lendária.<br>
                  📸 <b>É obrigatório fornecer uma nova foto neste caso!</b>
                </p>
                <div class="form-group" style="margin-bottom: 8px;">
                  <label class="retro-label" style="color: inherit; font-weight: 800;">Nova Foto para a Versão Lendária: *</label>
                  <input type="file" id="suggest-legendary-photo-input" class="retro-input" accept="image/*">
                  <div id="suggest-legendary-preview-container" class="hidden" style="margin-top: 8px; text-align: center;">
                    <img id="suggest-legendary-preview-img" src="" style="max-height: 160px; border: var(--border-retro); border-radius: 6px;" alt="Prévia da Foto">
                  </div>
                </div>

                <div id="suggest-legendary-countdown" class="hidden" style="margin-bottom: 10px; padding: 10px 14px; background: #fef08a; border: 2px solid #eab308; border-radius: 6px; font-weight: 800; font-size: 13px; color: #854d0e; text-align: center;">
                  ⏳ AGUARDE! Aproveite este tempo para ler o texto acima. (<span id="suggest-legendary-countdown-seconds">30</span>s)
                </div>

                <div class="form-group" style="margin-bottom: 0;">
                  <label class="retro-label" style="color: inherit; font-weight: 800;">
                    Confirmação obrigatória: Digite a frase <span style="color: #b91c1c;">"Personagem casado, criar versão lendária"</span>: *
                  </label>
                  <input type="text" id="suggest-legendary-phrase-input" class="retro-input" placeholder="Personagem casado, criar versão lendária" autocomplete="off">
                  <small id="suggest-legendary-phrase-status" style="display: block; margin-top: 4px; font-size: 11px; font-weight: 700; color: #b91c1c;">
                    Digite a frase acima para iniciar a contagem de 30 segundos e liberar o envio.
                  </small>
                </div>
              </div>

              <div class="form-group">
                <label class="retro-label">Tags do Personagem (Adicionar e Remover):</label>
                <div id="suggest-tags-chips-container" class="tag-manager-container"></div>
                <div style="display: flex; gap: 8px; margin-top: 6px;">
                  <input type="text" id="suggest-new-tag-input" class="retro-input" placeholder="Nova tag..." style="flex: 1;">
                  <button type="button" class="btn-retro btn-sm btn-gold" id="btn-add-suggest-tag" style="white-space: nowrap;">
                    <i class="fas fa-plus"></i> Adicionar
                  </button>
                </div>
                <input type="hidden" id="suggest-edit-tags">
              </div>

              <div class="form-group">
                <label class="retro-label">Descrição / Biografia Sugerida:</label>
                <textarea id="suggest-edit-description" class="retro-textarea" rows="3" placeholder="Informações biográficas da waifu/personagem..."></textarea>
              </div>

              <div class="form-group">
                <label class="retro-label">Justificativa da Mudança (obrigatório, mín. 5 caracteres):</label>
                <textarea id="suggest-edit-reason" class="retro-textarea" rows="2" placeholder="Por que essas alterações devem ser aplicadas?"></textarea>
              </div>

              <button type="button" class="btn-retro btn-sm btn-gold" id="btn-submit-edit-info" style="width: 100%;" disabled title="Preencha os dados necessários para liberar o envio">
                <i class="fas fa-paper-plane"></i> Enviar Sugestão de Dados
              </button>
              <div id="edit-info-progress-container" class="hidden" style="margin-top: 10px; background: rgba(0,0,0,0.03); border: var(--border-retro); border-radius: 6px; padding: 8px 12px;">
                <div style="background: #e2e8f0; border-radius: 4px; height: 14px; overflow: hidden; border: 1px solid #cbd5e1;">
                  <div id="edit-info-progress-bar" style="background: #eab308; height: 100%; width: 0%; transition: width 0.15s ease;"></div>
                </div>
                <div id="edit-info-progress-text" style="font-size: 11px; font-weight: 800; color: #854d0e; text-align: center; margin-top: 5px;">
                  Aguarde... 0%
                </div>
              </div>
            </div>

            <!-- Subaba Fotos -->
            <div class="subtab-content hidden" id="subtab-photos">
              <p style="font-size: 12px; color: var(--text-muted); margin-bottom: 12px;">Ver, adicionar, excluir e substituir fotos da galeria.</p>
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
                <span style="font-weight: 800; font-size: 13px;">
                  🖼️ Fotos Atuais no Jogo (<span id="suggest-photos-count">0</span>):
                </span>
                <button type="button" class="btn-retro btn-sm btn-gold" id="btn-suggest-add-photo">
                  <i class="fas fa-plus"></i> Sugerir Nova Foto
                </button>
              </div>

              <div id="suggest-photos-grid" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(115px, 1fr)); gap: 10px; margin-bottom: 14px;"></div>

              <div id="user-photo-action-box" class="hidden" style="background: var(--bg-card-subtle); border: var(--border-retro); border-radius: 6px; padding: 12px; margin-top: 10px;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                  <span id="user-photo-action-title" style="font-weight: 800; font-size: 13px;">Ação na Foto:</span>
                  <button type="button" class="btn-retro btn-sm" id="btn-suggest-cancel-photo" style="padding: 2px 8px; font-size: 11px;">Cancelar</button>
                </div>

                <div id="user-photo-delete-form" class="hidden">
                  <p style="font-size: 12px; color: #dc2626; font-weight: 700; margin-bottom: 8px;">
                    ⚠️ Você está sugerindo a exclusão desta foto errada/inadequada.
                  </p>
                  <div class="form-group">
                    <label class="retro-label">Motivo da Exclusão (mín. 5 caracteres):</label>
                    <input type="text" id="user-photo-delete-reason" class="retro-input" placeholder="Ex: Foto de outro personagem, baixa qualidade, etc.">
                  </div>
                  <button type="button" class="btn-retro btn-sm btn-danger" id="btn-suggest-submit-delete-photo" style="width: 100%;">
                    <i class="fas fa-trash"></i> Confirmar Sugestão de Exclusão
                  </button>
                </div>

                <div id="user-photo-upload-form" class="hidden">
                  <div class="form-group" style="margin-bottom: 8px;">
                    <label class="retro-label">Selecione o arquivo da imagem:</label>
                    <input type="file" id="suggest-file-input" class="retro-input" accept="image/*">
                  </div>

                  <div id="cropper-container" class="hidden">
                    <div class="cropper-img-box">
                      <img id="cropper-img" src="" alt="Recorte de foto">
                    </div>
                    <div class="cropper-preview-container">
                      <div>
                        <span class="retro-label" style="display: block; margin-bottom: 4px;">Pré-visualização (Card):</span>
                        <div class="crop-preview-box" id="crop-preview"></div>
                      </div>
                      <div style="flex: 1;">
                        <div class="form-group" style="margin-bottom: 0;">
                          <label class="retro-label">Motivo / Justificativa:</label>
                          <input type="text" id="suggest-photo-reason" class="retro-input" placeholder="Ex: Foto oficial em alta resolução">
                        </div>
                      </div>
                    </div>
                    <button type="button" class="btn-retro btn-sm btn-gold" id="btn-submit-crop" style="width: 100%; margin-top: 14px;">
                      <i class="fas fa-paper-plane"></i> Enviar Sugestão de Foto
                    </button>
                    <div id="crop-progress-container" class="hidden" style="margin-top: 10px; background: rgba(0,0,0,0.03); border: var(--border-retro); border-radius: 6px; padding: 8px 12px;">
                      <div style="background: #e2e8f0; border-radius: 4px; height: 14px; overflow: hidden; border: 1px solid #cbd5e1;">
                        <div id="crop-progress-bar" style="background: #eab308; height: 100%; width: 0%; transition: width 0.15s ease;"></div>
                      </div>
                      <div id="crop-progress-text" style="font-size: 11px; font-weight: 800; color: #854d0e; text-align: center; margin-top: 5px;">
                        Aguarde... 0%
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      `;
      document.body.appendChild(overlay);
      return overlay;
    },

    _bindEventsOnce() {
      if (this._initialized) return;
      this._initialized = true;

      const overlay = this._ensureDom();

      document.getElementById('btn-suggest-modal-close')?.addEventListener('click', () => this.close());
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) this.close();
      });

      document.addEventListener('keydown', (e) => {
        if ((e.key === 'Escape' || e.key === 'Esc') && !overlay.classList.contains('hidden')) {
          this.close();
        }
      });

      // Subabas Dados / Fotos
      const subtabs = overlay.querySelectorAll('.retro-tab[data-subtab]');
      subtabs.forEach((tab) => {
        tab.addEventListener('click', () => {
          subtabs.forEach((t) => t.classList.remove('active'));
          tab.classList.add('active');
          const targetId = tab.dataset.subtab;
          overlay.querySelectorAll('.subtab-content').forEach((c) => c.classList.add('hidden'));
          document.getElementById(targetId)?.classList.remove('hidden');
        });
      });

      // Campos de Dados
      ['suggest-edit-name', 'suggest-edit-series', 'suggest-edit-description', 'suggest-edit-reason'].forEach((id) => {
        document.getElementById(id)?.addEventListener('input', () => this._updateEditInfoSubmitButtonState());
      });

      document.getElementById('suggest-edit-gender')?.addEventListener('change', () => {
        this._updateEditInfoSubmitButtonState();
      });

      document.getElementById('suggest-edit-rarity')?.addEventListener('change', () => {
        this._updateLegendaryMarriedBox();
        this._updateEditInfoSubmitButtonState();
      });

      // Foto para versão lendária de personagem já casado
      document.getElementById('suggest-legendary-photo-input')?.addEventListener('change', (e) => {
        const file = e.target.files?.[0];
        if (file && file.size > 10 * 1024 * 1024) {
          global.Api?.showToast('A imagem enviada é muito grande! Compacte ela antes', '⚠️');
          e.target.value = '';
          return;
        }
        const prevBox = document.getElementById('suggest-legendary-preview-container');
        const prevImg = document.getElementById('suggest-legendary-preview-img');
        if (file && prevBox && prevImg) {
          const reader = new FileReader();
          reader.onload = (evt) => {
            prevImg.src = evt.target.result;
            prevBox.classList.remove('hidden');
          };
          reader.readAsDataURL(file);
        } else if (prevBox) {
          prevBox.classList.add('hidden');
        }
        this._updateEditInfoSubmitButtonState();
      });

      document.getElementById('suggest-legendary-phrase-input')?.addEventListener('input', () => {
        this._handleLegendaryPhraseInput();
        this._updateEditInfoSubmitButtonState();
      });

      // Tags
      document.getElementById('btn-add-suggest-tag')?.addEventListener('click', () => this._addTag());
      document.getElementById('suggest-new-tag-input')?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          this._addTag();
        }
      });

      // Submissão Dados
      document.getElementById('btn-submit-edit-info')?.addEventListener('click', () => this.submitEditInfo());

      // Fotos
      document.getElementById('btn-suggest-add-photo')?.addEventListener('click', () => this._triggerAddPhoto());
      document.getElementById('btn-suggest-cancel-photo')?.addEventListener('click', () => this._cancelPhotoAction());
      document.getElementById('btn-suggest-submit-delete-photo')?.addEventListener('click', () => this.submitDeletePhoto());
      document.getElementById('btn-submit-crop')?.addEventListener('click', () => this.submitPhotoCrop());

      const fileInput = document.getElementById('suggest-file-input');
      if (fileInput) {
        fileInput.addEventListener('change', (e) => {
          const file = e.target.files?.[0];
          if (!file) return;

          if (file.size > 10 * 1024 * 1024) {
            global.Api?.showToast('A imagem enviada é muito grande! Compacte ela antes', '⚠️');
            fileInput.value = '';
            return;
          }

          const reader = new FileReader();
          reader.onload = (event) => {
            const cropperImg = document.getElementById('cropper-img');
            const cropperContainer = document.getElementById('cropper-container');
            if (!cropperImg || !cropperContainer) return;

            cropperImg.src = event.target.result;
            cropperContainer.classList.remove('hidden');

            if (this._cropper) {
              this._cropper.destroy();
              this._cropper = null;
            }

            if (typeof global.Cropper === 'function') {
              this._cropper = new global.Cropper(cropperImg, {
                aspectRatio: 225 / 350,
                viewMode: 1,
                autoCropArea: 0.95,
                preview: '#crop-preview',
                responsive: true,
              });
            }
          };
          reader.readAsDataURL(file);
        });
      }
    },

    _isAlreadyLegendary() {
      if (!this._activeCharacter) return false;
      const r = (this._activeCharacter.baseRarity || this._activeCharacter.rarity || '').toUpperCase();
      return r === 'LEGENDARY';
    },

    _marriedGuardActive() {
      if (!this._activeCharacter) return false;
      if (this._isAlreadyLegendary()) return false;
      return Boolean(this._activeCharacter.wasEverMarried);
    },

    _resetLegendaryVerification() {
      if (this._countdownTimer) {
        clearInterval(this._countdownTimer);
        this._countdownTimer = null;
      }
      this._countdownRemaining = 30;
      this._phraseValidated = false;
      this._countdownFinished = false;

      const phraseInput = document.getElementById('suggest-legendary-phrase-input');
      if (phraseInput) phraseInput.value = '';

      const countdownBox = document.getElementById('suggest-legendary-countdown');
      if (countdownBox) {
        countdownBox.classList.add('hidden');
        countdownBox.innerHTML = '⏳ AGUARDE! Aproveite este tempo para ler o texto acima. (<span id="suggest-legendary-countdown-seconds">30</span>s)';
        countdownBox.style.background = '#fef08a';
        countdownBox.style.borderColor = '#eab308';
        countdownBox.style.color = '#854d0e';
      }

      const statusEl = document.getElementById('suggest-legendary-phrase-status');
      if (statusEl) {
        statusEl.textContent = 'Digite a frase acima para iniciar a contagem de 30 segundos e liberar o envio.';
        statusEl.style.color = '#b91c1c';
      }

      this._updateEditInfoSubmitButtonState();
    },

    _handleLegendaryPhraseInput() {
      const phraseInput = document.getElementById('suggest-legendary-phrase-input');
      const countdownBox = document.getElementById('suggest-legendary-countdown');
      const secondsSpan = document.getElementById('suggest-legendary-countdown-seconds');
      const statusEl = document.getElementById('suggest-legendary-phrase-status');
      if (!phraseInput) return;

      const matches = isLegendaryPhraseValid(phraseInput.value);
      if (matches) {
        if (!this._phraseValidated) {
          this._phraseValidated = true;
          this._countdownRemaining = 30;
          this._countdownFinished = false;
          this._updateEditInfoSubmitButtonState();

          if (countdownBox) countdownBox.classList.remove('hidden');
          if (secondsSpan) secondsSpan.textContent = '30';
          if (statusEl) {
            statusEl.textContent = 'Frase confirmada! Aguarde o término do contador de 30 segundos.';
            statusEl.style.color = '#854d0e';
          }

          if (this._countdownTimer) clearInterval(this._countdownTimer);
          this._countdownTimer = setInterval(() => {
            this._countdownRemaining--;
            const curSecondsEl = document.getElementById('suggest-legendary-countdown-seconds');
            if (curSecondsEl) curSecondsEl.textContent = String(Math.max(0, this._countdownRemaining));

            if (this._countdownRemaining <= 0) {
              clearInterval(this._countdownTimer);
              this._countdownTimer = null;
              this._countdownFinished = true;
              if (countdownBox) {
                countdownBox.innerHTML = '✅ Tempo concluído! Agora você pode enviar a sugestão.';
                countdownBox.style.background = '#dcfce7';
                countdownBox.style.borderColor = '#22c55e';
                countdownBox.style.color = '#15803d';
              }
              if (statusEl) {
                statusEl.textContent = 'Verificação e tempo concluídos com sucesso! Selecione a foto se ainda não anexou.';
                statusEl.style.color = '#15803d';
              }
              this._updateEditInfoSubmitButtonState();
            }
          }, 1000);
        }
      } else if (this._phraseValidated || !this._countdownFinished) {
        if (this._countdownTimer) {
          clearInterval(this._countdownTimer);
          this._countdownTimer = null;
        }
        this._phraseValidated = false;
        this._countdownFinished = false;
        this._countdownRemaining = 30;

        if (countdownBox) {
          countdownBox.classList.add('hidden');
          countdownBox.innerHTML = '⏳ AGUARDE! Aproveite este tempo para ler o texto acima. (<span id="suggest-legendary-countdown-seconds">30</span>s)';
          countdownBox.style.background = '#fef08a';
          countdownBox.style.borderColor = '#eab308';
          countdownBox.style.color = '#854d0e';
        }
        if (statusEl) {
          statusEl.textContent = 'Digite a frase acima para iniciar a contagem de 30 segundos e liberar o envio.';
          statusEl.style.color = '#b91c1c';
        }
        this._updateEditInfoSubmitButtonState();
      }
    },

    _updateLegendaryMarriedBox() {
      const raritySelect = document.getElementById('suggest-edit-rarity');
      const box = document.getElementById('suggest-legendary-married-box');
      const btn = document.getElementById('btn-submit-edit-info');
      if (!raritySelect || !box) return;

      const isLegendary = raritySelect.value === 'LEGENDARY';
      const wasEverMarried = this._marriedGuardActive();

      if (wasEverMarried && isLegendary) {
        box.classList.remove('hidden');
        if (btn) {
          btn.innerHTML = '<i class="fas fa-star"></i> Enviar Sugestão de Novo Personagem Lendário';
        }
      } else {
        box.classList.add('hidden');
        this._resetLegendaryVerification();
        if (btn) {
          btn.innerHTML = '<i class="fas fa-paper-plane"></i> Enviar Sugestão de Dados';
        }
      }

      this._updateEditInfoSubmitButtonState();
    },

    _updateEditInfoSubmitButtonState() {
      const btn = document.getElementById('btn-submit-edit-info');
      if (!btn) return;
      if (!this._activeCharacter) {
        btn.disabled = true;
        return;
      }

      const suggestedName = (document.getElementById('suggest-edit-name')?.value || '').trim();
      const suggestedSeries = (document.getElementById('suggest-edit-series')?.value || '').trim();
      const suggestedGender = document.getElementById('suggest-edit-gender')?.value;
      const suggestedRarity = document.getElementById('suggest-edit-rarity')?.value;
      const suggestedTags = Array.isArray(this._tagsState) ? this._tagsState : [];
      const suggestedDescription = (document.getElementById('suggest-edit-description')?.value || '').trim();
      const reason = (document.getElementById('suggest-edit-reason')?.value || '').trim();

      const isReasonValid = reason.length >= 5;
      const wasEverMarried = this._marriedGuardActive();

      if (wasEverMarried && suggestedRarity === 'LEGENDARY') {
        const phraseInput = document.getElementById('suggest-legendary-phrase-input')?.value || '';
        const isPhraseValid = isLegendaryPhraseValid(phraseInput);
        const photoFile = document.getElementById('suggest-legendary-photo-input')?.files?.[0];
        const canSubmit = isReasonValid && isPhraseValid && this._countdownFinished && Boolean(photoFile);

        btn.disabled = !canSubmit;
        if (!canSubmit) {
          if (!isPhraseValid) btn.title = 'Digite a frase de confirmação obrigatória para liberar o envio.';
          else if (!this._countdownFinished) btn.title = 'Aguarde o término do contador de 30 segundos.';
          else if (!photoFile) btn.title = 'Selecione uma nova foto para a versão lendária.';
          else if (!isReasonValid) btn.title = 'Informe uma justificativa com pelo menos 5 caracteres.';
        } else {
          btn.title = 'Enviar sugestão de novo personagem lendário';
        }
        return;
      }

      if (wasEverMarried && suggestedRarity !== 'LEGENDARY') {
        const normReason = reason.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
        const asksLegendary = /\b(lenda\w*|legend\w*|upgrade\w*|subir raridade|aumentar raridade|mudar raridade|virar lenda\w*|passar pra lenda\w*|bota.*lenda\w*|coloca.*lenda\w*|p[oõ]e.*lenda\w*)/i.test(normReason);
        if (asksLegendary) {
          btn.disabled = true;
          btn.title = 'Personagens casados não podem pedir upgrade para Lendário na justificativa. A raridade máxima permitida é ÉPICO.';
          return;
        }
      }

      const curRarity = (this._activeCharacter.baseRarity || this._activeCharacter.rarity || 'COMMON').toUpperCase();
      const nameChanged = suggestedName !== (this._activeCharacter.name || '').trim();
      const seriesChanged = suggestedSeries !== (this._activeCharacter.series || '').trim();
      const genderChanged = suggestedGender !== (this._activeCharacter.gender || 'FEMALE');
      const rarityChanged = suggestedRarity !== curRarity;
      const curTagsNorm = [...(this._activeCharacter.tags || [])].sort().join(',');
      const sugTagsNorm = [...suggestedTags].sort().join(',');
      const tagsChanged = sugTagsNorm !== curTagsNorm;
      const curDesc = (this._activeCharacter.description || '').trim();
      const descChanged = suggestedDescription !== curDesc;

      const hasAnyChange = nameChanged || seriesChanged || genderChanged || rarityChanged || tagsChanged || descChanged;
      const canSubmit = hasAnyChange && isReasonValid;

      btn.disabled = !canSubmit;
      if (!canSubmit) {
        if (!hasAnyChange) {
          btn.title = 'Altere pelo menos um dado do personagem (nome, série, gênero, raridade, tags ou descrição).';
        } else if (!isReasonValid) {
          btn.title = 'Informe uma justificativa com pelo menos 5 caracteres.';
        }
      } else {
        btn.title = 'Enviar sugestão de dados';
      }
    },

    _renderTagsChips() {
      const container = document.getElementById('suggest-tags-chips-container');
      const hiddenInput = document.getElementById('suggest-edit-tags');
      if (!container) return;

      container.innerHTML = '';
      if (this._tagsState.length === 0) {
        container.innerHTML = '<span style="font-size: 11px; color: #94a3b8; font-style: italic;">Nenhuma tag adicionada.</span>';
      } else {
        this._tagsState.forEach((tag) => {
          const chip = document.createElement('span');
          chip.className = 'tag-chip';
          chip.innerHTML = `#${escapeHtml(tag)} <button type="button" class="tag-chip-remove" title="Remover tag">&times;</button>`;
          chip.querySelector('.tag-chip-remove')?.addEventListener('click', () => this._removeTag(tag));
          container.appendChild(chip);
        });
      }

      if (hiddenInput) {
        hiddenInput.value = this._tagsState.join(', ');
      }
    },

    _addTag(tag) {
      const input = document.getElementById('suggest-new-tag-input');
      const rawTag = (tag !== undefined ? tag : input?.value || '').trim().replace(/^#+/, '').toLowerCase();
      if (!rawTag) return;

      if (rawTag.length < 2 || rawTag.length > 30) {
        global.Api?.showToast('A tag deve ter entre 2 e 30 caracteres.', '⚠️');
        return;
      }

      if (this._tagsState.includes(rawTag)) {
        global.Api?.showToast('Esta tag já foi adicionada.', 'ℹ️');
        return;
      }

      this._tagsState.push(rawTag);
      this._renderTagsChips();
      if (input) input.value = '';
      this._updateEditInfoSubmitButtonState();
    },

    _removeTag(tagToRemove) {
      this._tagsState = this._tagsState.filter((t) => t !== tagToRemove);
      this._renderTagsChips();
      this._updateEditInfoSubmitButtonState();
    },

    _renderPhotosGrid() {
      const container = document.getElementById('suggest-photos-grid');
      const countEl = document.getElementById('suggest-photos-count');
      if (countEl) countEl.textContent = String(this._photosList.length);
      if (!container) return;

      container.innerHTML = '';
      if (this._photosList.length === 0) {
        container.innerHTML = '<div style="grid-column: 1 / -1; font-size: 12px; color: #64748b; font-style: italic; padding: 12px; background: #fff; border: 1px dashed #cbd5e1; border-radius: 4px; text-align: center;">Nenhuma foto cadastrada para este personagem.</div>';
        return;
      }

      this._photosList.forEach((src, idx) => {
        const item = document.createElement('div');
        item.style.cssText = 'position: relative; border: 1.5px solid #2d241e; border-radius: 4px; overflow: hidden; background: #111;';
        item.innerHTML = `
          <div style="aspect-ratio: 9/14; width: 100%; position: relative;">
            <img loading="lazy" decoding="async" src="${escapeHtml(src)}" style="width: 100%; height: 100%; object-fit: cover;" onerror="this.src='/media/characters/default.jpg'">
            <span style="position: absolute; top: 4px; left: 4px; background: rgba(0,0,0,0.7); color: #fff; font-size: 10px; font-weight: 800; padding: 2px 6px; border-radius: 3px;">#${idx + 1}</span>
          </div>
          <div style="padding: 4px; background: #fff; border-top: 1px solid #2d241e; display: flex; flex-direction: column; gap: 4px;">
            <button type="button" class="btn-retro btn-sm btn-gold btn-suggest-replace" style="padding: 2px 4px; font-size: 11px; width: 100%;">
              🔄 Substituir
            </button>
            <button type="button" class="btn-retro btn-sm btn-danger btn-suggest-delete" style="padding: 2px 4px; font-size: 11px; width: 100%;">
              🗑️ Excluir
            </button>
          </div>
        `;
        item.querySelector('.btn-suggest-replace')?.addEventListener('click', () => this._triggerReplacePhoto(src, idx));
        item.querySelector('.btn-suggest-delete')?.addEventListener('click', () => this._triggerDeletePhoto(src, idx));
        container.appendChild(item);
      });
    },

    _triggerAddPhoto() {
      this._photoAction = 'ADD';
      this._targetPhoto = null;
      const box = document.getElementById('user-photo-action-box');
      const title = document.getElementById('user-photo-action-title');
      const deleteForm = document.getElementById('user-photo-delete-form');
      const uploadForm = document.getElementById('user-photo-upload-form');

      if (title) title.innerHTML = '➕ <b>Sugerir Nova Foto Extra:</b>';
      deleteForm?.classList.add('hidden');
      uploadForm?.classList.remove('hidden');
      box?.classList.remove('hidden');

      const fileInput = document.getElementById('suggest-file-input');
      if (fileInput) {
        fileInput.value = '';
        fileInput.click();
      }
    },

    _triggerReplacePhoto(targetPhoto, idx) {
      this._photoAction = 'REPLACE';
      this._targetPhoto = targetPhoto;
      const box = document.getElementById('user-photo-action-box');
      const title = document.getElementById('user-photo-action-title');
      const deleteForm = document.getElementById('user-photo-delete-form');
      const uploadForm = document.getElementById('user-photo-upload-form');

      if (title) title.innerHTML = `🔄 <b>Sugerir Substituição da Foto #${idx + 1}:</b>`;
      deleteForm?.classList.add('hidden');
      uploadForm?.classList.remove('hidden');
      box?.classList.remove('hidden');

      const fileInput = document.getElementById('suggest-file-input');
      if (fileInput) {
        fileInput.value = '';
        fileInput.click();
      }
    },

    _triggerDeletePhoto(targetPhoto, idx) {
      this._photoAction = 'DELETE';
      this._targetPhoto = targetPhoto;
      const box = document.getElementById('user-photo-action-box');
      const title = document.getElementById('user-photo-action-title');
      const deleteForm = document.getElementById('user-photo-delete-form');
      const uploadForm = document.getElementById('user-photo-upload-form');

      if (title) title.innerHTML = `🗑️ <b>Sugerir Exclusão da Foto #${idx + 1}:</b>`;
      uploadForm?.classList.add('hidden');
      deleteForm?.classList.remove('hidden');
      box?.classList.remove('hidden');

      const reasonInput = document.getElementById('user-photo-delete-reason');
      if (reasonInput) {
        reasonInput.value = '';
        reasonInput.focus();
      }
    },

    _cancelPhotoAction() {
      this._isSubmitting = false;
      document.getElementById('user-photo-action-box')?.classList.add('hidden');
      document.getElementById('cropper-container')?.classList.add('hidden');
      document.getElementById('crop-progress-container')?.classList.add('hidden');
      const btnCrop = document.getElementById('btn-submit-crop');
      if (btnCrop) {
        btnCrop.disabled = false;
        btnCrop.innerHTML = '<i class="fas fa-paper-plane"></i> Enviar Sugestão de Foto';
      }
      if (this._cropper) {
        this._cropper.destroy();
        this._cropper = null;
      }
      const fileInput = document.getElementById('suggest-file-input');
      if (fileInput) fileInput.value = '';
      const photoReason = document.getElementById('suggest-photo-reason');
      if (photoReason) photoReason.value = '';
      this._targetPhoto = null;
    },

    async open(opts = {}) {
      this._ensureDom();
      this._bindEventsOnce();

      const {
        character = null,
        characterId = null,
        characterName = '',
        currentRarity = 'COMMON',
        token = '',
        publicId = 'token-session',
        onSuccess = null,
      } = opts;

      this._isSubmitting = false;
      this._token = token || (typeof getCookie === 'function' ? getCookie('waifu_session') : '') || (window.localStorage ? (localStorage.getItem('waifu_session') || '') : '') || '';
      this._publicId = publicId || (typeof getCookie === 'function' ? (getCookie('waifu_user_public_id') || getCookie('waifu_public_id') || '') : '') || (window.localStorage ? (localStorage.getItem('waifu_user_public_id') || '') : '') || 'token-session';
      this._onSuccess = typeof onSuccess === 'function' ? onSuccess : null;

      let char = character;
      const targetId = char?.id || characterId;

      if (targetId && (!char || !char.imageUrls || typeof char.wasEverMarried === 'undefined')) {
        try {
          const res = await global.Api.get(`/characters/${encodeURIComponent(targetId)}`);
          if (res?.data) {
            char = { ...(char || {}), ...res.data };
          }
        } catch (_) {}
      }

      this._activeCharacter = char || { id: targetId, name: characterName, baseRarity: currentRarity };
      if (!this._activeCharacter.baseRarity && this._activeCharacter.rarity) {
        this._activeCharacter.baseRarity = this._activeCharacter.rarity;
      }
      if (!this._activeCharacter.baseRarity && currentRarity) {
        this._activeCharacter.baseRarity = currentRarity;
      }
      this._activeCharacter.wasEverMarried = Boolean(
        this._activeCharacter.wasEverMarried ||
        this._activeCharacter.isClaimed ||
        (this._activeCharacter.claimCount && this._activeCharacter.claimCount > 0) ||
        this._activeCharacter.owner
      );

      const nameEl = document.getElementById('suggest-char-name');
      if (nameEl) nameEl.textContent = `Personagem: ${this._activeCharacter.name || characterName}`;

      const seriesBadge = document.getElementById('suggest-char-series-badge');
      if (seriesBadge) {
        seriesBadge.textContent = this._activeCharacter.series ? `Série: ${this._activeCharacter.series}` : '';
      }

      const currBadge = document.getElementById('suggest-current-rarity');
      const cfg = RARITY_CONFIG[this._activeCharacter.baseRarity || currentRarity] || RARITY_CONFIG.COMMON;
      if (currBadge) {
        currBadge.style.borderColor = cfg.color;
        currBadge.style.color = cfg.color;
        currBadge.textContent = `${cfg.emoji} ${cfg.label}`;
      }

      const editName = document.getElementById('suggest-edit-name');
      if (editName) editName.value = this._activeCharacter.name || '';

      const editSeries = document.getElementById('suggest-edit-series');
      if (editSeries) editSeries.value = this._activeCharacter.series || '';

      const editGender = document.getElementById('suggest-edit-gender');
      if (editGender) editGender.value = this._activeCharacter.gender || 'FEMALE';

      const editRarity = document.getElementById('suggest-edit-rarity');
      if (editRarity) {
        const legOption = editRarity.querySelector('option[value="LEGENDARY"]');
        if (legOption) {
          legOption.textContent = this._marriedGuardActive()
            ? '⭐ Lendário (Criar Novo Personagem no Catálogo)'
            : '⭐ Lendário';
        }
        editRarity.value = (this._activeCharacter.baseRarity || this._activeCharacter.rarity || currentRarity || 'COMMON').toUpperCase();
      }

      this._tagsState = Array.isArray(this._activeCharacter.tags) ? [...this._activeCharacter.tags] : [];
      this._renderTagsChips();

      const editDesc = document.getElementById('suggest-edit-description');
      if (editDesc) editDesc.value = this._activeCharacter.description || '';

      const editReason = document.getElementById('suggest-edit-reason');
      if (editReason) editReason.value = '';

      const newTagInput = document.getElementById('suggest-new-tag-input');
      if (newTagInput) newTagInput.value = '';

      const legInput = document.getElementById('suggest-legendary-photo-input');
      if (legInput) legInput.value = '';
      document.getElementById('suggest-legendary-preview-container')?.classList.add('hidden');
      const legPrevImg = document.getElementById('suggest-legendary-preview-img');
      if (legPrevImg) legPrevImg.src = '';
      this._resetLegendaryVerification();
      this._updateLegendaryMarriedBox();

      this._photosList = Array.isArray(this._activeCharacter.imageUrls) && this._activeCharacter.imageUrls.length > 0
        ? [...this._activeCharacter.imageUrls]
        : (this._activeCharacter.imageUrl ? [this._activeCharacter.imageUrl] : []);

      this._renderPhotosGrid();
      this._cancelPhotoAction();

      // Volta para primeira aba
      const overlay = document.getElementById('modal-suggest');
      if (overlay) {
        overlay.querySelectorAll('.retro-tab[data-subtab]').forEach((t, i) => {
          t.classList.toggle('active', i === 0);
        });
        overlay.querySelectorAll('.subtab-content').forEach((c, i) => {
          c.classList.toggle('hidden', i !== 0);
        });
        overlay.classList.remove('hidden');
        document.body.classList.add('modal-open');
      }

      this._updateEditInfoSubmitButtonState();
    },

    close() {
      this._isSubmitting = false;
      if (this._countdownTimer) {
        clearInterval(this._countdownTimer);
        this._countdownTimer = null;
      }
      this._cancelPhotoAction();
      const overlay = document.getElementById('modal-suggest');
      if (overlay) {
        overlay.classList.add('hidden');
      }
      if (!document.querySelector('.modal-overlay:not(.hidden)')) {
        document.body.classList.remove('modal-open');
      }
    },

    async submitDeletePhoto() {
      if (this._isSubmitting || !this._activeCharacter || !this._targetPhoto) return;
      const reason = (document.getElementById('user-photo-delete-reason')?.value || '').trim();
      if (!reason || reason.length < 5) {
        global.Api?.showToast('Informe o motivo da exclusão com pelo menos 5 caracteres.', '⚠️');
        return;
      }

      this._isSubmitting = true;
      global.Api?.showLoading('Aguarde... Enviando sugestão de exclusão...', 'Registrando solicitação para a moderação...');
      try {
        const res = await global.Api.post(`/api/web/user/${encodeURIComponent(this._publicId)}/suggestions`, {
          token: this._token,
          type: 'IMAGE',
          characterId: this._activeCharacter.id,
          action: 'DELETE',
          targetPhoto: this._targetPhoto,
          reason,
        });

        if (!res?.success) {
          global.Api?.showToast(res?.error?.message || 'Falha ao enviar sugestão de exclusão.', '❌');
          return;
        }

        this.close();
        global.Api?.showToast('Sugestão de exclusão de foto enviada para moderação!', '🗑️');
        if (this._onSuccess) this._onSuccess(res);
      } catch (_) {
        global.Api?.showToast('Erro de comunicação ao enviar sugestão.', '❌');
      } finally {
        global.Api?.hideLoading();
        this._isSubmitting = false;
      }
    },

    async submitPhotoCrop() {
      if (this._isSubmitting) return;
      if (!this._activeCharacter) {
        global.Api?.showToast('Personagem não carregado.', '⚠️');
        return;
      }

      const fileInput = document.getElementById('suggest-file-input');
      const file = fileInput?.files?.[0];
      const btnCrop = document.getElementById('btn-submit-crop');
      const reason = (document.getElementById('suggest-photo-reason')?.value || '').trim();

      const progressContainer = document.getElementById('crop-progress-container');
      const progressBar = document.getElementById('crop-progress-bar');
      const progressText = document.getElementById('crop-progress-text');

      // Tenta obter o recorte do canvas de forma síncrona
      let imageBlob = null;
      if (this._cropper) {
        try {
          const canvas = this._cropper.getCroppedCanvas({ width: 450, height: 700 });
          if (canvas) {
            const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
            if (dataUrl && dataUrl.startsWith('data:image/')) {
              imageBlob = global.Api?.dataURItoBlob ? global.Api.dataURItoBlob(dataUrl) : null;
            }
          }
        } catch (e) {
          console.warn('Falha ao extrair canvas do Cropper:', e);
        }
      }

      // Se o cropper falhou ou não gerou blob, usa o arquivo original
      if (!imageBlob && file) {
        imageBlob = file;
      }

      if (!imageBlob) {
        global.Api?.showToast('Por favor, selecione uma foto antes de enviar.', '⚠️');
        return;
      }

      this._isSubmitting = true;
      if (btnCrop) {
        btnCrop.disabled = true;
        btnCrop.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Enviando...';
      }
      if (progressContainer) progressContainer.classList.remove('hidden');
      if (progressBar) progressBar.style.width = '0%';
      if (progressText) progressText.textContent = 'Aguarde... 0%';

      const formData = new FormData();
      formData.append('token', this._token);
      formData.append('type', 'IMAGE');
      formData.append('characterId', this._activeCharacter.id);
      formData.append('action', this._photoAction);
      if (this._targetPhoto) {
        formData.append('targetPhoto', this._targetPhoto);
      }
      formData.append('reason', reason);
      formData.append('image', imageBlob, 'user_photo.jpg');

      const onProgress = (percent) => {
        if (progressBar) progressBar.style.width = `${percent}%`;
        if (progressText) {
          if (percent < 100) {
            progressText.textContent = `Aguarde... ${percent}%`;
          } else {
            progressText.textContent = 'Processando no servidor... 100%';
          }
        }
      };

      try {
        const res = await (global.Api?.uploadWithProgress
          ? global.Api.uploadWithProgress(`/api/web/user/${encodeURIComponent(this._publicId)}/suggestions`, formData, onProgress)
          : global.Api.post(`/api/web/user/${encodeURIComponent(this._publicId)}/suggestions`, formData));

        if (!res?.success) {
          global.Api?.showToast(res?.error?.message || 'Falha ao enviar foto.', '❌');
          return;
        }

        const msg = this._photoAction === 'REPLACE'
          ? 'Sugestão de substituição de foto enviada para a moderação!'
          : 'Sugestão de nova foto enviada para a moderação!';
        this.close();
        global.Api?.showToast(msg, '🖼️');
        if (this._onSuccess) this._onSuccess(res);
      } catch (err) {
        global.Api?.showToast(err?.message || 'Erro de comunicação ao enviar imagem.', '❌');
      } finally {
        if (progressContainer) progressContainer.classList.add('hidden');
        if (btnCrop) {
          btnCrop.disabled = false;
          btnCrop.innerHTML = '<i class="fas fa-paper-plane"></i> Enviar Sugestão de Foto';
        }
        this._isSubmitting = false;
      }
    },

    async submitEditInfo() {
      if (this._isSubmitting || !this._activeCharacter) return;

      const suggestedName = (document.getElementById('suggest-edit-name')?.value || '').trim();
      const suggestedSeries = (document.getElementById('suggest-edit-series')?.value || '').trim();
      const suggestedGender = document.getElementById('suggest-edit-gender')?.value;
      const suggestedRarity = document.getElementById('suggest-edit-rarity')?.value;
      const suggestedTags = Array.isArray(this._tagsState) ? this._tagsState : [];
      const suggestedDescription = (document.getElementById('suggest-edit-description')?.value || '').trim();
      const reason = (document.getElementById('suggest-edit-reason')?.value || '').trim();

      if (!reason || reason.length < 5) {
        global.Api?.showToast('Por favor, informe uma justificativa válida com pelo menos 5 caracteres.', '⚠️');
        return;
      }

      const wasEverMarried = this._marriedGuardActive();
      if (wasEverMarried && suggestedRarity !== 'LEGENDARY') {
        const normReason = reason.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
        const asksLegendary = /\b(lenda\w*|legend\w*|upgrade\w*|subir raridade|aumentar raridade|mudar raridade|virar lenda\w*|passar pra lenda\w*|bota.*lenda\w*|coloca.*lenda\w*|p[oõ]e.*lenda\w*)/i.test(normReason);
        if (asksLegendary) {
          global.Api?.showToast('Este personagem já foi casado. A raridade máxima permitida para o mesmo é ÉPICO. Pedidos de alteração para Lendário não podem ser feitos via justificativa ou edição de dados.', '⚠️');
          return;
        }
      }

      if (wasEverMarried && suggestedRarity === 'LEGENDARY') {
        const phraseInput = document.getElementById('suggest-legendary-phrase-input')?.value || '';
        if (!isLegendaryPhraseValid(phraseInput)) {
          global.Api?.showToast('É obrigatório escrever a frase "Personagem casado, criar versão lendária" para prosseguir.', '⚠️');
          return;
        }
        if (!this._countdownFinished) {
          global.Api?.showToast('Aguarde o contador de 30 segundos finalizar para poder enviar a sugestão.', '⏳');
          return;
        }
        const photoFile = document.getElementById('suggest-legendary-photo-input')?.files?.[0];
        if (!photoFile) {
          global.Api?.showToast('É obrigatório fornecer uma nova foto para criar a versão lendária de um personagem já casado.', '⚠️');
          return;
        }

        const btnEdit = document.getElementById('btn-submit-edit-info');
        if (btnEdit) {
          btnEdit.disabled = true;
          btnEdit.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Enviando...';
        }
        this._isSubmitting = true;

        const progressContainer = document.getElementById('edit-info-progress-container');
        const progressBar = document.getElementById('edit-info-progress-bar');
        const progressText = document.getElementById('edit-info-progress-text');

        if (progressContainer) progressContainer.classList.remove('hidden');
        if (progressBar) progressBar.style.width = '0%';
        if (progressText) progressText.textContent = 'Aguarde... 0%';

        const onProgress = (percent) => {
          if (progressBar) progressBar.style.width = `${percent}%`;
          if (progressText) {
            if (percent < 100) {
              progressText.textContent = `Aguarde... ${percent}%`;
            } else {
              progressText.textContent = 'Processando no servidor... 100%';
            }
          }
        };

        let compressedPhoto = photoFile;
        try {
          compressedPhoto = await (global.Api?.compressImageFile ? global.Api.compressImageFile(photoFile, 900, 1400, 0.85) : photoFile);
        } catch (_) {}

        const chosenGender = suggestedGender || this._activeCharacter.gender || 'FEMALE';
        const formData = new FormData();
        formData.append('token', this._token);
        formData.append('type', 'NEW_CHARACTER');
        formData.append('characterId', this._activeCharacter.id);
        formData.append('name', suggestedName || this._activeCharacter.name);
        formData.append('series', suggestedSeries || this._activeCharacter.series);
        formData.append('gender', chosenGender);
        formData.append('suggestedGender', chosenGender);
        formData.append('rarity', 'LEGENDARY');
        formData.append('confirmationPhrase', phraseInput);
        if (suggestedDescription) formData.append('description', suggestedDescription);
        formData.append('reason', reason ? `[Versão Lendária] ${reason}` : '[Versão Lendária]');
        formData.append('photo', compressedPhoto, 'legendary.jpg');

        try {
          const res = await (global.Api?.uploadWithProgress
            ? global.Api.uploadWithProgress(`/api/web/user/${encodeURIComponent(this._publicId)}/suggestions`, formData, onProgress)
            : global.Api.post(`/api/web/user/${encodeURIComponent(this._publicId)}/suggestions`, formData));

          if (!res?.success) {
            global.Api?.showToast(res?.error?.message || 'Falha ao enviar sugestão lendária.', '❌');
            return;
          }

          this.close();
          global.Api?.showToast('Sugestão de novo personagem na versão Lendária enviada para moderação!', '⭐');
          if (this._onSuccess) this._onSuccess(res);
        } catch (err) {
          global.Api?.showToast(err?.message || 'Erro de comunicação ao enviar sugestão.', '❌');
        } finally {
          if (progressContainer) progressContainer.classList.add('hidden');
          this._isSubmitting = false;
          this._updateEditInfoSubmitButtonState();
        }
        return;
      }

      const curRarity = (this._activeCharacter.baseRarity || this._activeCharacter.rarity || 'COMMON').toUpperCase();
      const nameChanged = suggestedName && suggestedName !== (this._activeCharacter.name || '').trim();
      const seriesChanged = suggestedSeries && suggestedSeries !== (this._activeCharacter.series || '').trim();
      const genderChanged = suggestedGender && suggestedGender !== (this._activeCharacter.gender || '');
      const rarityChanged = suggestedRarity && suggestedRarity !== curRarity;
      const curTagsNorm = [...(this._activeCharacter.tags || [])].sort().join(',');
      const sugTagsNorm = [...suggestedTags].sort().join(',');
      const tagsChanged = sugTagsNorm !== curTagsNorm;
      const curDesc = (this._activeCharacter.description || '').trim();
      const descChanged = suggestedDescription !== curDesc;

      if (!nameChanged && !seriesChanged && !genderChanged && !rarityChanged && !tagsChanged && !descChanged) {
        global.Api?.showToast('Nenhum campo do personagem foi modificado! Altere a descrição, nome, série ou tags diretamente nos campos acima em vez de colocar apenas na justificativa.', '⚠️');
        return;
      }

      const btnEdit = document.getElementById('btn-submit-edit-info');
      if (btnEdit) {
        btnEdit.disabled = true;
        btnEdit.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Enviando...';
      }
      this._isSubmitting = true;
      global.Api?.showLoading('Aguarde... Enviando sugestão...', 'Enviando alterações para avaliação da moderação...');

      try {
        const res = await global.Api.post(`/api/web/user/${encodeURIComponent(this._publicId)}/suggestions`, {
          token: this._token,
          type: 'EDIT',
          characterId: this._activeCharacter.id,
          suggestedName,
          suggestedSeries,
          suggestedGender,
          suggestedRarity,
          suggestedTags,
          suggestedDescription,
          reason,
        });

        if (!res?.success) {
          global.Api?.showToast(res?.error?.message || 'Falha ao enviar sugestão.', '❌');
          return;
        }

        this.close();
        global.Api?.showToast('Sugestão de alteração de dados enviada para moderação!', '💡');
        if (this._onSuccess) this._onSuccess(res);
      } catch (_) {
        global.Api?.showToast('Erro de comunicação ao enviar sugestão.', '❌');
      } finally {
        global.Api?.hideLoading();
        this._isSubmitting = false;
        this._updateEditInfoSubmitButtonState();
      }
    },
  };

  global.SuggestionModal = SuggestionModal;
})(window);
