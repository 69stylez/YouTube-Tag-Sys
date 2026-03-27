(function () {
  'use strict';

  const AUTH_STORAGE_KEY = 'ytm_auth';
  const PKCE_VERIFIER_KEY = 'ytm_pkce_verifier';
  const OAUTH_STATE_KEY = 'ytm_oauth_state';
  const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';

  const state = {
    auth: null,
    user: null,
    tags: [],
    tagSets: [],
    selectedTags: [],
    activeSuggestionIndex: -1,
    currentSuggestions: []
  };

  const el = {
    loggedOutState: document.getElementById('loggedOutState'),
    loggedInState: document.getElementById('loggedInState'),
    userName: document.getElementById('userName'),
    userEmail: document.getElementById('userEmail'),
    loginBtn: document.getElementById('loginBtn'),
    logoutBtn: document.getElementById('logoutBtn'),
    statusArea: document.getElementById('statusArea'),
    mainApp: document.getElementById('mainApp'),
    tagSetSelect: document.getElementById('tagSetSelect'),
    loadSetBtn: document.getElementById('loadSetBtn'),
    manageSetsBtn: document.getElementById('manageSetsBtn'),
    saveSetBtn: document.getElementById('saveSetBtn'),
    tagSearchInput: document.getElementById('tagSearchInput'),
    autocompleteList: document.getElementById('autocompleteList'),
    selectedCount: document.getElementById('selectedCount'),
    selectedChips: document.getElementById('selectedChips'),
    copyTagsBtn: document.getElementById('copyTagsBtn'),
    clearSelectionBtn: document.getElementById('clearSelectionBtn'),
    manageTagsBtn: document.getElementById('manageTagsBtn'),
    tagManagerModal: document.getElementById('tagManagerModal'),
    tagFilterCategory: document.getElementById('tagFilterCategory'),
    tagTableBody: document.getElementById('tagTableBody'),
    newTagInput: document.getElementById('newTagInput'),
    newTagCategory: document.getElementById('newTagCategory'),
    addTagBtn: document.getElementById('addTagBtn'),
    addTagHint: document.getElementById('addTagHint'),
    sheetLink: document.getElementById('sheetLink'),
    setManagerModal: document.getElementById('setManagerModal'),
    setList: document.getElementById('setList')
  };

  function getRedirectUri() {
    return window.location.origin + window.location.pathname;
  }

  function normalizeTag(value) {
    return String(value || '').trim().toLocaleLowerCase('de-AT');
  }

  function parseJwt(token) {
    try {
      const payload = token.split('.')[1];
      const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
      const json = decodeURIComponent(
        atob(base64)
          .split('')
          .map((char) => `%${`00${char.charCodeAt(0).toString(16)}`.slice(-2)}`)
          .join('')
      );
      return JSON.parse(json);
    } catch (_) {
      return null;
    }
  }

  function showStatus(message, type = 'info', timeoutMs = 6000) {
    const node = document.createElement('div');
    node.className = `status ${type}`;
    node.textContent = message;
    el.statusArea.prepend(node);
    if (timeoutMs > 0) {
      window.setTimeout(() => {
        node.remove();
      }, timeoutMs);
    }
  }

  function setLoadingState(isLoading) {
    const buttons = document.querySelectorAll('button');
    buttons.forEach((button) => {
      if (button.dataset.keepEnabled === 'true') {
        return;
      }
      button.disabled = isLoading;
    });
  }

  function saveAuth(auth) {
    state.auth = auth;
    sessionStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(auth));
  }

  function loadAuth() {
    try {
      const raw = sessionStorage.getItem(AUTH_STORAGE_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (_) {
      return null;
    }
  }

  function clearAuth() {
    state.auth = null;
    state.user = null;
    sessionStorage.removeItem(AUTH_STORAGE_KEY);
    sessionStorage.removeItem(PKCE_VERIFIER_KEY);
    sessionStorage.removeItem(OAUTH_STATE_KEY);
  }

  async function sha256Base64Url(text) {
    const data = new TextEncoder().encode(text);
    const digest = await crypto.subtle.digest('SHA-256', data);
    const bytes = Array.from(new Uint8Array(digest));
    return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  }

  function randomString(length) {
    const bytes = new Uint8Array(length);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (byte) => ('0' + (byte % 36).toString(36)).slice(-1)).join('');
  }

  async function startLogin() {
    if (CLIENT_ID.includes('DEIN_GOOGLE_CLIENT_ID')) {
      showStatus('Bitte trage zuerst CLIENT_ID in config.js ein.', 'error', 9000);
      return;
    }
    if (!TOKEN_PROXY_URL || TOKEN_PROXY_URL.includes('YOUR-WORKER-SUBDOMAIN')) {
      showStatus('Bitte trage zuerst TOKEN_PROXY_URL in config.js ein.', 'error', 9000);
      return;
    }

    const verifier = randomString(64);
    const challenge = await sha256Base64Url(verifier);
    const authState = randomString(20);

    sessionStorage.setItem(PKCE_VERIFIER_KEY, verifier);
    sessionStorage.setItem(OAUTH_STATE_KEY, authState);

    const params = new URLSearchParams({
      client_id: CLIENT_ID,
      redirect_uri: getRedirectUri(),
      response_type: 'code',
      scope: OAUTH_SCOPES.join(' '),
      code_challenge: challenge,
      code_challenge_method: 'S256',
      state: authState,
      include_granted_scopes: 'true'
    });

    window.location.href = `${AUTH_ENDPOINT}?${params.toString()}`;
  }

  async function exchangeCodeForToken(code) {
    const verifier = sessionStorage.getItem(PKCE_VERIFIER_KEY);
    if (!verifier) throw new Error('PKCE-Code-Verifier fehlt. Bitte Login erneut starten.');

    let response;
    try {
      response = await fetch(TOKEN_PROXY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          grant_type: 'authorization_code',
          code,
          code_verifier: verifier,
          redirect_uri: getRedirectUri()
        })
      });
    } catch (_) {
      throw new Error('Token-Proxy nicht erreichbar. Bitte Netzwerk/Worker prüfen.');
    }

    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(result.error_description || result.error || 'Token-Austausch fehlgeschlagen');
    }

    const now = Date.now();
    return {
      accessToken: result.access_token,
      refreshToken: null,
      idToken: result.id_token || null,
      expiresAt: now + (Number(result.expires_in || 3600) * 1000),
      scope: result.scope || OAUTH_SCOPES.join(' ')
    };
  }

  async function ensureValidToken() {
    if (!state.auth || !state.auth.accessToken) {
      throw new Error('Nicht eingeloggt.');
    }
    if (Date.now() < state.auth.expiresAt - 60000) return;
    throw new Error('Session abgelaufen. Bitte erneut einloggen.');
  }

  async function handleAuthCallback() {
    const url = new URL(window.location.href);
    const code = url.searchParams.get('code');
    const oauthState = url.searchParams.get('state');
    const error = url.searchParams.get('error');

    if (error) {
      showStatus(`Login fehlgeschlagen: ${error}`, 'error', 9000);
      cleanAuthQueryParams();
      return;
    }

    if (!code) return;

    const expectedState = sessionStorage.getItem(OAUTH_STATE_KEY);
    if (!expectedState || expectedState !== oauthState) {
      cleanAuthQueryParams();
      throw new Error('OAuth-Status ungültig. Bitte Login erneut starten.');
    }

    const token = await exchangeCodeForToken(code);
    saveAuth(token);
    cleanAuthQueryParams();
    showStatus('Login erfolgreich.', 'success');
  }

  function cleanAuthQueryParams() {
    const cleanUrl = getRedirectUri();
    window.history.replaceState({}, document.title, cleanUrl);
  }

  async function loadUserInfo() {
    if (!state.auth) return;

    if (state.auth.idToken) {
      const payload = parseJwt(state.auth.idToken);
      if (payload) {
        state.user = {
          name: payload.name || 'Eingeloggt',
          email: payload.email || ''
        };
        return;
      }
    }

    const response = await googleFetch('https://www.googleapis.com/oauth2/v3/userinfo');
    state.user = {
      name: response.name || 'Eingeloggt',
      email: response.email || ''
    };
  }

  function renderAuthState() {
    const isLoggedIn = Boolean(state.auth && state.auth.accessToken);
    el.loggedOutState.classList.toggle('hidden', isLoggedIn);
    el.loggedInState.classList.toggle('hidden', !isLoggedIn);
    el.mainApp.classList.toggle('hidden', !isLoggedIn);

    if (isLoggedIn && state.user) {
      el.userName.textContent = state.user.name || 'Eingeloggt';
      el.userEmail.textContent = state.user.email || '';
    }
  }

  async function googleFetch(url, options = {}) {
    await ensureValidToken();

    const headers = {
      Authorization: `Bearer ${state.auth.accessToken}`,
      ...(options.headers || {})
    };

    let response;
    try {
      response = await fetch(url, { ...options, headers });
    } catch (error) {
      throw new Error('Netzwerkfehler. Bitte Verbindung prüfen und erneut versuchen.');
    }

    const isJson = (response.headers.get('content-type') || '').includes('application/json');
    const body = isJson ? await response.json() : await response.text();

    if (!response.ok) {
      const message =
        (isJson && body && body.error && body.error.message) ||
        (typeof body === 'string' && body) ||
        `API-Fehler (${response.status})`;
      throw new Error(message);
    }

    return body;
  }

  async function fetchSheetMeta() {
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
      SHEET_ID
    )}?fields=sheets(properties(sheetId,title))`;
    const data = await googleFetch(url);
    return (data.sheets || []).reduce((acc, sheet) => {
      acc[sheet.properties.title] = sheet.properties.sheetId;
      return acc;
    }, {});
  }

  function parseTagsRows(values) {
    return (values || [])
      .filter((row) => row[0])
      .map((row, index) => ({
        tag: String(row[0] || '').trim(),
        category: String(row[1] || 'content').trim().toLowerCase(),
        usageCount: Number.parseInt(row[2] || '0', 10) || 0,
        rowIndex: index + 2
      }));
  }

  function parseTagSetsRows(values) {
    return (values || [])
      .filter((row) => row[0])
      .map((row, index) => ({
        setName: String(row[0] || '').trim(),
        tagsCsv: String(row[1] || ''),
        rowIndex: index + 2
      }));
  }

  async function loadData() {
    if (SHEET_ID === 'DEINE_GOOGLE_SHEET_ID') {
      throw new Error('Bitte trage SHEET_ID in config.js ein.');
    }

    const [tagData, tagSetData] = await Promise.all([
      googleFetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
          SHEET_ID
        )}/values/tags!A2:C`
      ),
      googleFetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
          SHEET_ID
        )}/values/tag_sets!A2:B`
      )
    ]);

    state.tags = parseTagsRows(tagData.values || []);
    state.tagSets = parseTagSetsRows(tagSetData.values || []);

    ensureFixedTagsSelected();
    renderTagSetSelect();
    renderSelectedTags();
    renderAutocomplete();
    renderTagTable();
    renderSetManager();
  }

  function ensureFixedTagsSelected() {
    const fixedTags = state.tags.filter((item) => item.category === 'fixed').map((item) => item.tag);
    if (state.selectedTags.length === 0) {
      fixedTags.forEach((tag) => addSelectedTag(tag, false));
      return;
    }

    fixedTags.forEach((tag) => {
      if (!state.selectedTags.some((entry) => normalizeTag(entry) === normalizeTag(tag))) {
        addSelectedTag(tag, false);
      }
    });
  }

  function tagMeta(tagText) {
    const key = normalizeTag(tagText);
    return state.tags.find((item) => normalizeTag(item.tag) === key) || null;
  }

  function addSelectedTag(tagText, showFeedback = true) {
    const tag = String(tagText || '').trim();
    if (!tag) return false;

    const exists = state.selectedTags.some((entry) => normalizeTag(entry) === normalizeTag(tag));
    if (exists) return false;

    state.selectedTags.push(tag);
    renderSelectedTags();
    renderAutocomplete();
    if (showFeedback) {
      showStatus(`Tag hinzugefügt: ${tag}`, 'success', 2200);
    }
    return true;
  }

  function removeSelectedTag(tagText) {
    const meta = tagMeta(tagText);
    if (meta && meta.category === 'fixed') {
      showStatus('Fixed-Tags können nicht entfernt werden.', 'warning', 3200);
      return;
    }

    state.selectedTags = state.selectedTags.filter((entry) => normalizeTag(entry) !== normalizeTag(tagText));
    renderSelectedTags();
    renderAutocomplete();
  }

  function clearNonFixedTags() {
    state.selectedTags = state.selectedTags.filter((tag) => {
      const meta = tagMeta(tag);
      return meta && meta.category === 'fixed';
    });
    renderSelectedTags();
    renderAutocomplete();
    showStatus('Nicht-fixe Tags wurden entfernt.', 'info', 2200);
  }

  function renderSelectedTags() {
    el.selectedCount.textContent = String(state.selectedTags.length);
    el.selectedChips.textContent = '';

    state.selectedTags.forEach((tag) => {
      const meta = tagMeta(tag);
      const isFixed = Boolean(meta && meta.category === 'fixed');
      const chip = document.createElement('div');
      chip.className = `chip ${isFixed ? 'fixed' : ''}`;

      const text = document.createElement('span');
      text.textContent = `${isFixed ? '🔒 ' : ''}${tag}`;

      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.textContent = '×';
      removeBtn.disabled = isFixed;
      removeBtn.title = isFixed ? 'Fixed-Tag' : 'Tag entfernen';
      removeBtn.addEventListener('click', () => removeSelectedTag(tag));

      chip.append(text, removeBtn);
      el.selectedChips.appendChild(chip);
    });
  }

  function fuzzyScore(query, candidate) {
    const q = normalizeTag(query);
    const c = normalizeTag(candidate);
    if (!q) return 0;

    const direct = c.indexOf(q);
    if (direct >= 0) {
      return 200 - direct + q.length * 2;
    }

    let qi = 0;
    let score = 0;
    for (let ci = 0; ci < c.length && qi < q.length; ci += 1) {
      if (c[ci] === q[qi]) {
        score += ci > 0 && c[ci - 1] === q[Math.max(qi - 1, 0)] ? 3 : 1;
        qi += 1;
      }
    }
    return qi === q.length ? score : -1;
  }

  function getSuggestions(query) {
    const results = state.tags
      .filter((item) => !state.selectedTags.some((tag) => normalizeTag(tag) === normalizeTag(item.tag)))
      .map((item) => ({
        ...item,
        score: fuzzyScore(query, item.tag)
      }))
      .filter((item) => item.score >= 0)
      .sort((a, b) => b.score - a.score || a.tag.localeCompare(b.tag, 'de-AT'))
      .slice(0, 8);

    return results;
  }

  function renderAutocomplete() {
    const query = el.tagSearchInput.value.trim();
    el.autocompleteList.textContent = '';
    state.activeSuggestionIndex = -1;

    if (!query) {
      el.autocompleteList.classList.add('hidden');
      state.currentSuggestions = [];
      return;
    }

    const suggestions = getSuggestions(query);
    const hasExact = state.tags.some((item) => normalizeTag(item.tag) === normalizeTag(query));

    state.currentSuggestions = suggestions.map((item) => ({ type: 'existing', value: item.tag }));

    suggestions.forEach((item) => {
      const li = document.createElement('li');
      li.textContent = `${item.tag} (${item.category})`;
      li.addEventListener('mousedown', (event) => {
        event.preventDefault();
        addSelectedTag(item.tag);
        el.tagSearchInput.value = '';
        renderAutocomplete();
      });
      el.autocompleteList.appendChild(li);
    });

    if (!hasExact) {
      state.currentSuggestions.push({ type: 'create', value: query });
      const createLi = document.createElement('li');
      createLi.textContent = `+ Neuen Tag anlegen: „${query}“`;
      createLi.addEventListener('mousedown', async (event) => {
        event.preventDefault();
        await createTagFromSearch(query);
      });
      el.autocompleteList.appendChild(createLi);
    }

    if (el.autocompleteList.children.length > 0) {
      el.autocompleteList.classList.remove('hidden');
    } else {
      el.autocompleteList.classList.add('hidden');
    }
  }

  async function createTagFromSearch(rawTag) {
    const tag = String(rawTag || '').trim();
    if (!tag) return;

    try {
      await addTag(tag, 'content');
      addSelectedTag(tag, false);
      el.tagSearchInput.value = '';
      renderAutocomplete();
      showStatus(`Neuer Tag gespeichert: ${tag}`, 'success');
    } catch (error) {
      showStatus(error.message, 'error', 9000);
    }
  }

  function renderTagSetSelect() {
    el.tagSetSelect.textContent = '';
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = 'Set auswählen';
    el.tagSetSelect.appendChild(placeholder);

    state.tagSets
      .slice()
      .sort((a, b) => a.setName.localeCompare(b.setName, 'de-AT'))
      .forEach((item) => {
        const option = document.createElement('option');
        option.value = item.setName;
        option.textContent = item.setName;
        el.tagSetSelect.appendChild(option);
      });
  }

  function findTagSetByName(name) {
    const key = normalizeTag(name);
    return state.tagSets.find((item) => normalizeTag(item.setName) === key) || null;
  }

  function loadTagSetIntoSelection(setName) {
    const set = findTagSetByName(setName);
    if (!set) {
      showStatus('Tag-Set wurde nicht gefunden.', 'warning');
      return;
    }

    const tags = set.tagsCsv
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);

    let added = 0;
    tags.forEach((tag) => {
      if (addSelectedTag(tag, false)) {
        added += 1;
      }
    });

    renderSelectedTags();
    renderAutocomplete();
    showStatus(`Tag-Set geladen: ${set.setName} (${added} hinzugefügt)`, 'success');
  }

  function renderTagTable() {
    const category = el.tagFilterCategory.value;
    const visible = state.tags
      .filter((item) => category === 'all' || item.category === category)
      .sort((a, b) => a.tag.localeCompare(b.tag, 'de-AT'));

    el.tagTableBody.textContent = '';

    visible.forEach((item) => {
      const row = document.createElement('tr');

      const tagCell = document.createElement('td');
      const tagInput = document.createElement('input');
      tagInput.value = item.tag;
      tagCell.appendChild(tagInput);

      const categoryCell = document.createElement('td');
      const categorySelect = document.createElement('select');
      ['fixed', 'format', 'content'].forEach((value) => {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = value;
        if (item.category === value) option.selected = true;
        categorySelect.appendChild(option);
      });
      categoryCell.appendChild(categorySelect);

      const usageCell = document.createElement('td');
      usageCell.textContent = String(item.usageCount);

      const actionsCell = document.createElement('td');
      const saveBtn = document.createElement('button');
      saveBtn.type = 'button';
      saveBtn.className = 'btn btn-secondary';
      saveBtn.textContent = 'Speichern';
      saveBtn.addEventListener('click', async () => {
        await updateTag(item, tagInput.value, categorySelect.value);
      });

      const deleteBtn = document.createElement('button');
      deleteBtn.type = 'button';
      deleteBtn.className = 'btn btn-ghost';
      deleteBtn.textContent = 'Löschen';
      deleteBtn.addEventListener('click', async () => {
        await deleteTag(item);
      });

      actionsCell.append(saveBtn, deleteBtn);
      row.append(tagCell, categoryCell, usageCell, actionsCell);
      el.tagTableBody.appendChild(row);
    });
  }

  async function addTag(rawTag, category) {
    const tag = String(rawTag || '').trim();
    if (!tag) throw new Error('Tag darf nicht leer sein.');

    const duplicate = state.tags.some((item) => normalizeTag(item.tag) === normalizeTag(tag));
    if (duplicate) throw new Error('Tag existiert bereits (Duplikat erkannt).');

    await googleFetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
        SHEET_ID
      )}/values/tags!A:C:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ values: [[tag, category, 0]] })
      }
    );

    await loadData();
  }

  async function updateTag(existingTag, newTagRaw, newCategoryRaw) {
    const newTag = String(newTagRaw || '').trim();
    const newCategory = String(newCategoryRaw || 'content').trim().toLowerCase();
    if (!newTag) {
      showStatus('Tag darf nicht leer sein.', 'error');
      return;
    }

    const duplicate = state.tags.find(
      (item) =>
        item.rowIndex !== existingTag.rowIndex &&
        normalizeTag(item.tag) === normalizeTag(newTag)
    );

    if (duplicate) {
      showStatus('Bearbeitung abgebrochen: Duplikat erkannt.', 'warning', 7000);
      return;
    }

    try {
      await googleFetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
          SHEET_ID
        )}/values/tags!A${existingTag.rowIndex}:B${existingTag.rowIndex}?valueInputOption=USER_ENTERED`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ values: [[newTag, newCategory]] })
        }
      );

      state.selectedTags = state.selectedTags.map((entry) => {
        if (normalizeTag(entry) === normalizeTag(existingTag.tag)) {
          return newTag;
        }
        return entry;
      });

      await loadData();
      showStatus('Tag gespeichert.', 'success');
    } catch (error) {
      showStatus(error.message, 'error', 9000);
    }
  }

  async function deleteTag(tagItem) {
    const ok = window.confirm(`Tag wirklich löschen: "${tagItem.tag}"?`);
    if (!ok) return;

    try {
      const sheetIds = await fetchSheetMeta();
      const tagSheetId = sheetIds.tags;
      if (typeof tagSheetId !== 'number') throw new Error('Sheet "tags" nicht gefunden.');

      await googleFetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(SHEET_ID)}:batchUpdate`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            requests: [
              {
                deleteDimension: {
                  range: {
                    sheetId: tagSheetId,
                    dimension: 'ROWS',
                    startIndex: tagItem.rowIndex - 1,
                    endIndex: tagItem.rowIndex
                  }
                }
              }
            ]
          })
        }
      );

      state.selectedTags = state.selectedTags.filter(
        (entry) => normalizeTag(entry) !== normalizeTag(tagItem.tag)
      );
      await loadData();
      showStatus('Tag gelöscht.', 'success');
    } catch (error) {
      showStatus(error.message, 'error', 9000);
    }
  }

  async function addTagFromManager() {
    const rawTag = el.newTagInput.value;
    const category = el.newTagCategory.value;

    try {
      await addTag(rawTag, category);
      el.newTagInput.value = '';
      el.addTagHint.textContent = 'Tag wurde gespeichert.';
      showStatus('Neuer Tag gespeichert.', 'success');
    } catch (error) {
      el.addTagHint.textContent = error.message;
      showStatus(error.message, 'warning', 7000);
    }
  }

  function renderSetManager() {
    el.setList.textContent = '';

    if (state.tagSets.length === 0) {
      const empty = document.createElement('p');
      empty.textContent = 'Noch keine Tag-Sets vorhanden.';
      el.setList.appendChild(empty);
      return;
    }

    state.tagSets
      .slice()
      .sort((a, b) => a.setName.localeCompare(b.setName, 'de-AT'))
      .forEach((setItem) => {
        const row = document.createElement('div');
        row.className = 'set-row';

        const info = document.createElement('div');
        const title = document.createElement('strong');
        title.textContent = setItem.setName;
        const meta = document.createElement('p');
        meta.className = 'set-meta';
        meta.textContent = setItem.tagsCsv;
        info.append(title, meta);

        const actions = document.createElement('div');
        actions.className = 'row wrap';
        const loadBtn = document.createElement('button');
        loadBtn.type = 'button';
        loadBtn.className = 'btn btn-secondary';
        loadBtn.textContent = 'Laden';
        loadBtn.addEventListener('click', () => {
          loadTagSetIntoSelection(setItem.setName);
          el.setManagerModal.close();
        });

        const deleteBtn = document.createElement('button');
        deleteBtn.type = 'button';
        deleteBtn.className = 'btn btn-ghost';
        deleteBtn.textContent = 'Löschen';
        deleteBtn.addEventListener('click', async () => {
          await deleteTagSet(setItem);
        });

        actions.append(loadBtn, deleteBtn);
        row.append(info, actions);
        el.setList.appendChild(row);
      });
  }

  async function saveCurrentAsTagSet() {
    if (state.selectedTags.length === 0) {
      showStatus('Keine Tags ausgewählt.', 'warning');
      return;
    }

    const nameInput = window.prompt('Name für das neue Tag-Set:');
    const setName = String(nameInput || '').trim();
    if (!setName) return;

    const existing = findTagSetByName(setName);
    const tagsCsv = state.selectedTags.join(', ');

    try {
      if (existing) {
        const overwrite = window.confirm('Ein Set mit diesem Namen existiert bereits. Überschreiben?');
        if (!overwrite) return;

        await googleFetch(
          `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
            SHEET_ID
          )}/values/tag_sets!A${existing.rowIndex}:B${existing.rowIndex}?valueInputOption=USER_ENTERED`,
          {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ values: [[setName, tagsCsv]] })
          }
        );
      } else {
        await googleFetch(
          `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
            SHEET_ID
          )}/values/tag_sets!A:B:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ values: [[setName, tagsCsv]] })
          }
        );
      }

      await loadData();
      showStatus('Tag-Set gespeichert.', 'success');
    } catch (error) {
      showStatus(error.message, 'error', 9000);
    }
  }

  async function deleteTagSet(setItem) {
    const ok = window.confirm(`Tag-Set wirklich löschen: "${setItem.setName}"?`);
    if (!ok) return;

    try {
      const sheetIds = await fetchSheetMeta();
      const setSheetId = sheetIds.tag_sets;
      if (typeof setSheetId !== 'number') throw new Error('Sheet "tag_sets" nicht gefunden.');

      await googleFetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(SHEET_ID)}:batchUpdate`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            requests: [
              {
                deleteDimension: {
                  range: {
                    sheetId: setSheetId,
                    dimension: 'ROWS',
                    startIndex: setItem.rowIndex - 1,
                    endIndex: setItem.rowIndex
                  }
                }
              }
            ]
          })
        }
      );

      await loadData();
      showStatus('Tag-Set gelöscht.', 'success');
    } catch (error) {
      showStatus(error.message, 'error', 9000);
    }
  }

  async function incrementUsageForSelection() {
    const updates = [];

    state.selectedTags.forEach((selected) => {
      const item = tagMeta(selected);
      if (!item) return;
      updates.push({
        range: `tags!C${item.rowIndex}`,
        values: [[item.usageCount + 1]]
      });
    });

    if (updates.length === 0) return;

    await googleFetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
        SHEET_ID
      )}/values:batchUpdate`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          valueInputOption: 'USER_ENTERED',
          data: updates
        })
      }
    );

    const updatedMap = new Map(
      state.tags.map((item) => [normalizeTag(item.tag), { ...item, usageCount: item.usageCount }])
    );
    state.selectedTags.forEach((selected) => {
      const key = normalizeTag(selected);
      const entry = updatedMap.get(key);
      if (entry) entry.usageCount += 1;
    });

    state.tags = Array.from(updatedMap.values());
    renderTagTable();
  }

  async function copyTagsToClipboard() {
    if (state.selectedTags.length === 0) {
      showStatus('Keine Tags zum Kopieren ausgewählt.', 'warning');
      return;
    }

    const content = state.selectedTags.join(', ');

    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(content);
      } else {
        const helper = document.createElement('textarea');
        helper.value = content;
        document.body.appendChild(helper);
        helper.select();
        document.execCommand('copy');
        helper.remove();
      }

      await incrementUsageForSelection();
      showStatus('Tags wurden in die Zwischenablage kopiert.', 'success');
    } catch (error) {
      showStatus(`Kopieren fehlgeschlagen: ${error.message}`, 'error', 9000);
    }
  }

  function handleSearchKeyDown(event) {
    if (el.autocompleteList.classList.contains('hidden')) return;

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      state.activeSuggestionIndex = Math.min(
        state.activeSuggestionIndex + 1,
        el.autocompleteList.children.length - 1
      );
      applyActiveSuggestionClass();
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      state.activeSuggestionIndex = Math.max(state.activeSuggestionIndex - 1, 0);
      applyActiveSuggestionClass();
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (state.activeSuggestionIndex >= 0) {
        const item = state.currentSuggestions[state.activeSuggestionIndex];
        if (!item) return;
        if (item.type === 'existing') {
          addSelectedTag(item.value);
          el.tagSearchInput.value = '';
          renderAutocomplete();
        } else if (item.type === 'create') {
          createTagFromSearch(item.value);
        }
      }
    } else if (event.key === 'Escape') {
      el.autocompleteList.classList.add('hidden');
    }
  }

  function applyActiveSuggestionClass() {
    Array.from(el.autocompleteList.children).forEach((node, index) => {
      node.classList.toggle('active', index === state.activeSuggestionIndex);
    });
  }

  function bindEvents() {
    el.loginBtn.addEventListener('click', startLogin);
    el.logoutBtn.addEventListener('click', () => {
      clearAuth();
      renderAuthState();
      showStatus('Du wurdest ausgeloggt.', 'info');
    });

    el.tagSearchInput.addEventListener('input', () => {
      renderAutocomplete();
    });
    el.tagSearchInput.addEventListener('keydown', handleSearchKeyDown);
    document.addEventListener('click', (event) => {
      if (!el.autocompleteList.contains(event.target) && event.target !== el.tagSearchInput) {
        el.autocompleteList.classList.add('hidden');
      }
    });

    el.loadSetBtn.addEventListener('click', () => {
      const setName = el.tagSetSelect.value;
      if (!setName) {
        showStatus('Bitte zuerst ein Tag-Set auswählen.', 'warning');
        return;
      }
      loadTagSetIntoSelection(setName);
    });

    el.saveSetBtn.addEventListener('click', saveCurrentAsTagSet);
    el.copyTagsBtn.addEventListener('click', copyTagsToClipboard);
    el.clearSelectionBtn.addEventListener('click', clearNonFixedTags);

    el.manageTagsBtn.addEventListener('click', () => {
      renderTagTable();
      el.tagManagerModal.showModal();
    });
    el.manageSetsBtn.addEventListener('click', () => {
      renderSetManager();
      el.setManagerModal.showModal();
    });

    el.tagFilterCategory.addEventListener('change', renderTagTable);
    el.addTagBtn.addEventListener('click', addTagFromManager);
    el.newTagInput.addEventListener('input', () => {
      const candidate = el.newTagInput.value.trim();
      if (!candidate) {
        el.addTagHint.textContent = '';
        return;
      }
      const duplicate = state.tags.some((item) => normalizeTag(item.tag) === normalizeTag(candidate));
      el.addTagHint.textContent = duplicate
        ? 'Hinweis: Dieser Tag existiert bereits.'
        : 'Tag ist neu und kann gespeichert werden.';
    });

    window.addEventListener('offline', () => {
      showStatus('Du bist offline. API-Aufrufe sind aktuell nicht möglich.', 'warning', 10000);
    });

    el.sheetLink.href = `https://docs.google.com/spreadsheets/d/${encodeURIComponent(SHEET_ID)}`;
  }

  async function bootstrap() {
    bindEvents();
    state.auth = loadAuth();

    try {
      await handleAuthCallback();
      state.auth = loadAuth();
      renderAuthState();
      if (!state.auth) return;

      setLoadingState(true);
      await loadUserInfo();
      renderAuthState();
      await loadData();
      showStatus('Tags und Sets wurden geladen.', 'success', 2500);
    } catch (error) {
      showStatus(error.message || 'Unerwarteter Fehler', 'error', 10000);
      clearAuth();
      renderAuthState();
    } finally {
      setLoadingState(false);
    }
  }

  bootstrap();
})();
    if (!TOKEN_PROXY_URL || TOKEN_PROXY_URL.includes('YOUR-WORKER-SUBDOMAIN')) {
      showStatus('Bitte trage TOKEN_PROXY_URL in config.js ein.', 'error', 9000);
      return;
    }
