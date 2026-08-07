<script lang="ts">
  import { onMount } from 'svelte';
  import {
    Copy,
    RefreshCw,
    Sun,
    Moon,
    X,
    Mail,
    Inbox,
    LoaderCircle,
    Paperclip,
    Shuffle,
  } from '@lucide/svelte';
  import {
    createAddress,
    fetchDomains,
    fetchInbox,
    fetchMessage,
    loadSession,
    saveSession,
    clearSession,
    loadTheme,
    saveTheme,
    API_BASE,
    type MessageSummary,
    type Theme,
  } from '$lib/api';

  let domains = $state<string[]>([]);
  let domain = $state('');
  let localPart = $state('');
  let email = $state('');
  let token = $state('');
  let messages = $state<MessageSummary[]>([]);
  let selectedId = $state<string | null>(null);
  let detail = $state<{
    subject: string;
    from: string;
    htmlBody: string;
    textBody: string;
    receivedAt: number;
  } | null>(null);
  let showHtml = $state(true);
  let loading = $state(true);
  let busy = $state(false);
  let refreshing = $state(false);
  let err = $state('');
  let toast = $state('');
  let theme = $state<Theme>('light');
  let es: EventSource | null = null;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let applyTimer: ReturnType<typeof setTimeout> | null = null;

  function showToast(t: string) {
    toast = t;
    setTimeout(() => {
      if (toast === t) toast = '';
    }, 1500);
  }

  function applyTheme(t: Theme) {
    theme = t;
    document.documentElement.dataset.theme = t;
    saveTheme(t);
    const m = document.querySelector('meta[name="theme-color"]');
    if (m) m.setAttribute('content', t === 'dark' ? '#1a1915' : '#f5f4ed');
  }

  function toggleTheme() {
    applyTheme(theme === 'dark' ? 'light' : 'dark');
  }

  function syncUrl(addr: string) {
    if (typeof window === 'undefined' || !addr) return;
    const next = `/${addr}`;
    if (window.location.pathname !== next) {
      history.replaceState(history.state, '', next);
    }
  }

  function parsePathEmail(): { local: string; domain: string } | null {
    if (typeof window === 'undefined') return null;
    let path = decodeURIComponent(window.location.pathname || '/').replace(/^\/+|\/+$/g, '');
    if (!path || path === 'index.html') return null;
    // allow /mailto:user@domain or bare user@domain
    path = path.replace(/^mailto:/i, '');
    const at = path.lastIndexOf('@');
    if (at <= 0 || at === path.length - 1) return null;
    const local = path.slice(0, at).toLowerCase();
    const dom = path.slice(at + 1).toLowerCase();
    if (!/^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?$/i.test(local)) return null;
    if (!dom.includes('.')) return null;
    return { local, domain: dom };
  }

  async function copyEmail() {
    const full = email || (localPart && domain ? `${localPart}@${domain}` : '');
    if (!full) return;
    try {
      await navigator.clipboard.writeText(full);
      showToast('Tersalin');
    } catch {
      showToast('Gagal salin');
    }
  }

  function stopStream() {
    es?.close();
    es = null;
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = null;
  }

  function startStream(tok: string) {
    stopStream();
    const url = `${API_BASE}/api/inbox/${tok}/stream`;
    try {
      es = new EventSource(url);
      es.addEventListener('message', (ev) => {
        try {
          const msg = JSON.parse(ev.data) as MessageSummary;
          if (!messages.some((m) => m.id === msg.id)) {
            messages = [msg, ...messages];
          }
        } catch {
          /* ignore */
        }
      });
      es.addEventListener('expired', () => {
        clearSession();
        email = '';
        token = '';
        messages = [];
        detail = null;
        stopStream();
      });
      es.onerror = () => {
        es?.close();
        es = null;
        if (!pollTimer) pollTimer = setInterval(() => refreshInbox(), 5000);
      };
    } catch {
      pollTimer = setInterval(() => refreshInbox(), 5000);
    }
  }

  async function refreshInbox(manual = false) {
    if (!token) return;
    if (manual) refreshing = true;
    try {
      const box = await fetchInbox(token);
      if (!box) {
        clearSession();
        email = '';
        token = '';
        messages = [];
        return;
      }
      email = box.email;
      const at = box.email.lastIndexOf('@');
      if (at > 0) {
        localPart = box.email.slice(0, at);
        domain = box.email.slice(at + 1);
      }
      messages = box.messages;
      if (manual) showToast('Pesan diperbarui');
    } catch (e) {
      err = String(e);
    } finally {
      if (manual) refreshing = false;
    }
  }

  function randomLocal() {
    const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let s = '';
    for (let i = 0; i < 10; i++) s += alphabet[Math.floor(Math.random() * alphabet.length)];
    localPart = s;
    void applyAddress(true);
  }

  async function applyAddress(forceNew = false) {
    err = '';
    if (!domain) return;
    const lp = localPart.trim().toLowerCase();
    if (lp && !/^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?$/i.test(lp)) {
      err = 'Username tidak valid (a-z, 0-9, . _ -)';
      return;
    }

    busy = true;
    try {
      const a = await createAddress(domain, forceNew && !localPart ? undefined : lp || undefined);
      email = a.email;
      token = a.token;
      const at = a.email.lastIndexOf('@');
      if (at > 0) {
        localPart = a.email.slice(0, at);
        domain = a.email.slice(at + 1);
      }
      if (!a.reused || forceNew) {
        messages = [];
        detail = null;
        selectedId = null;
      } else {
        await refreshInbox();
      }
      saveSession({
        email,
        token,
        expiresAt: a.expiresAt,
        domain,
        localPart,
      });
      syncUrl(email);
      startStream(token);
      if (forceNew) showToast('Alamat baru');
    } catch (e) {
      const msg = String(e).replace(/^Error:\s*/, '');
      const map: Record<string, string> = {
        local_invalid: 'Username tidak valid',
        local_reserved: 'Username dilarang',
        local_too_long: 'Username terlalu panjang',
        domain_not_active: 'Domain tidak aktif',
        rate_limit: 'Terlalu cepat, coba lagi',
      };
      err = map[msg] || msg;
    } finally {
      busy = false;
    }
  }

  function onLocalInput() {
    // ponytail: auto-split pasted full email (user@domain)
    if (localPart.includes('@')) {
      const at = localPart.lastIndexOf('@');
      const pastedDomain = localPart.slice(at + 1).toLowerCase().replace(/[^a-z0-9.-]/g, '');
      localPart = localPart.slice(0, at);
      if (pastedDomain && domains.includes(pastedDomain)) {
        domain = pastedDomain;
      }
    }
    localPart = localPart.replace(/[^a-zA-Z0-9._-]/g, '').toLowerCase();
    if (applyTimer) clearTimeout(applyTimer);
    applyTimer = setTimeout(() => {
      if (localPart.trim().length >= 1) void applyAddress(false);
    }, 450);
  }

  function onDomainChange() {
    void applyAddress(false);
  }

  async function openMsg(id: string) {
    if (!token) return;
    selectedId = id;
    try {
      const m = await fetchMessage(token, id);
      detail = {
        subject: m.subject,
        from: m.from,
        htmlBody: m.htmlBody,
        textBody: m.textBody,
        receivedAt: m.receivedAt,
      };
    } catch (e) {
      err = String(e);
    }
  }

  function fmtTime(ts: number) {
    return new Date(ts).toLocaleString('id-ID', {
      hour: '2-digit',
      minute: '2-digit',
      day: '2-digit',
      month: 'short',
    });
  }

  function initials(from: string) {
    const s = (from || '?').replace(/["'<>]/g, ' ').trim();
    const part = s.split(/[\s@]+/).filter(Boolean)[0] || '?';
    return part.slice(0, 1).toUpperCase();
  }

  function greeting(): string {
    const h = new Date().getHours();
    if (h >= 4 && h < 11) return 'Selamat pagi';
    if (h >= 11 && h < 15) return 'Selamat siang';
    if (h >= 15 && h < 18) return 'Selamat sore';
    return 'Selamat malam';
  }

  onMount(() => {
    applyTheme(loadTheme());

    (async () => {
      try {
        domains = await fetchDomains();
        domain = domains[0] || '';

        const fromPath = parsePathEmail();
        if (fromPath && domains.includes(fromPath.domain)) {
          domain = fromPath.domain;
          localPart = fromPath.local;
          await applyAddress(false);
        } else {
          const sess = loadSession();
          if (sess && domains.includes(sess.domain)) {
            domain = sess.domain;
            token = sess.token;
            email = sess.email;
            localPart =
              sess.localPart ||
              (sess.email.includes('@') ? sess.email.split('@')[0]! : '');
            await refreshInbox();
            if (token) {
              startStream(token);
              syncUrl(email);
            }
          } else if (domain) {
            await applyAddress(true);
          }
        }
      } catch (e) {
        err = String(e);
      } finally {
        loading = false;
      }
    })();

    return () => {
      stopStream();
      if (applyTimer) clearTimeout(applyTimer);
    };
  });
</script>

<div class="page-shell">
  <header class="site-header sticky top-0 z-20">
    <div class="mx-auto flex h-12 max-w-xl items-center justify-between px-4 sm:px-5">
      <div class="flex items-center gap-2">
        <span
          class="inline-flex h-7 w-7 items-center justify-center rounded-xl bg-accent text-white"
          aria-hidden="true"
        >
          <Mail size={14} strokeWidth={2.2} />
        </span>
        <div class="leading-tight">
          <div class="font-serif text-[0.98rem] font-medium tracking-tight text-ink">TMail</div>
          <div class="font-sans text-[10px] text-faint">Inbox sekali pakai</div>
        </div>
      </div>

      <button
        type="button"
        class="icon-btn !h-9 !w-9"
        onclick={toggleTheme}
        title={theme === 'dark' ? 'Mode terang' : 'Mode gelap'}
        aria-label={theme === 'dark' ? 'Mode terang' : 'Mode gelap'}
      >
        {#if theme === 'dark'}
          <Sun size={16} strokeWidth={1.8} />
        {:else}
          <Moon size={16} strokeWidth={1.8} />
        {/if}
      </button>
    </div>
  </header>

  <main class="mx-auto flex w-full max-w-xl flex-1 flex-col px-4 pb-16 pt-7 sm:px-5 sm:pt-9">
    <div class="mb-5 w-full text-left">
      <h1 class="font-serif text-[1.55rem] font-medium leading-snug tracking-tight text-ink sm:text-[1.7rem]">
        {greeting()}, kak!
      </h1>
      <p class="mt-1.5 max-w-md font-sans text-[13px] leading-relaxed text-muted">
        Isi / generate alamat — pesan di bawah.
      </p>
    </div>

    {#if err}
      <div class="err-box mb-4 w-full px-3.5 py-2.5 text-left font-sans text-sm">
        {err}
      </div>
    {/if}

    <!-- address -->
    <section class="claude-card w-full p-4 sm:p-5">
      <div class="addr-compose">
        <div class="addr-row min-w-0 flex-1">
          <input
            class="addr-local"
            type="text"
            spellcheck="false"
            autocomplete="off"
            autocapitalize="off"
            placeholder="username"
            maxlength="64"
            bind:value={localPart}
            oninput={onLocalInput}
            disabled={loading}
            aria-label="Username"
          />
          <span class="addr-at" aria-hidden="true">@</span>
          <select
            class="addr-domain"
            bind:value={domain}
            onchange={onDomainChange}
            disabled={!domains.length || busy}
            aria-label="Domain"
          >
            {#each domains as d}
              <option value={d}>{d}</option>
            {/each}
          </select>
        </div>

        <button
          type="button"
          class="icon-btn icon-btn-primary shrink-0 !h-[2.85rem] !w-[2.85rem]"
          onclick={copyEmail}
          disabled={!email && !(localPart && domain)}
          title="Salin"
          aria-label="Salin alamat"
        >
          <Copy size={16} strokeWidth={1.9} />
        </button>
      </div>

      <div class="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5">
        <button
          type="button"
          class="link-action"
          onclick={randomLocal}
          disabled={busy || !domain}
        >
          <Shuffle size={13} strokeWidth={1.9} />
          Acak username
        </button>
        <button
          type="button"
          class="link-action"
          onclick={() => refreshInbox(true)}
          disabled={!token || refreshing}
        >
          {#if refreshing}
            <LoaderCircle size={13} class="animate-spin" strokeWidth={1.9} />
          {:else}
            <RefreshCw size={13} strokeWidth={1.9} />
          {/if}
          Refresh pesan
        </button>
        {#if loading || busy}
          <span class="inline-flex items-center gap-1 font-sans text-[11px] text-faint">
            <LoaderCircle size={12} class="animate-spin" />
            {loading ? 'Memuat…' : 'Sinkron…'}
          </span>
        {/if}
      </div>
    </section>

    <!-- inbox -->
    <section class="mt-5 w-full">
      <div class="mb-2.5 flex items-center justify-between px-0.5">
        <div class="section-label">
          <Inbox size={12} strokeWidth={2} />
          Pesan
        </div>
        <span class="chip tabular-nums">{messages.length} masuk</span>
      </div>

      <div class="claude-card overflow-hidden">
        {#if !messages.length}
          <div class="flex flex-col items-center px-6 py-12 text-center">
            <div class="empty-illus mb-3">
              <Mail size={20} strokeWidth={1.7} />
            </div>
            <p class="font-serif text-[1.08rem] text-ink-2">Belum ada pesan</p>
            <p class="mt-1.5 max-w-[17rem] font-sans text-xs leading-relaxed text-muted">
              Kirim ke alamat di atas. Muncul otomatis di sini.
            </p>
          </div>
        {:else}
          <ul class="divide-y divide-line-soft">
            {#each messages as m}
              <li>
                <button
                  type="button"
                  class="inbox-row flex w-full items-start gap-3 px-3.5 py-3 text-left sm:px-4 {selectedId ===
                  m.id
                    ? 'is-active'
                    : ''}"
                  onclick={() => openMsg(m.id)}
                >
                  <span
                    class="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-accent-soft font-sans text-xs font-semibold text-accent"
                    aria-hidden="true"
                  >
                    {initials(m.from)}
                  </span>
                  <span class="min-w-0 flex-1">
                    <span class="flex items-start justify-between gap-3">
                      <span class="min-w-0 truncate font-sans text-[12px] font-medium text-ink-2"
                        >{m.from || '—'}</span
                      >
                      <span class="shrink-0 font-sans text-[10px] tabular-nums text-faint"
                        >{fmtTime(m.receivedAt)}</span
                      >
                    </span>
                    <span class="mt-0.5 flex items-center gap-1.5">
                      <span class="truncate font-serif text-[0.98rem] font-medium text-ink"
                        >{m.subject}</span
                      >
                      {#if m.hasAttachments}
                        <Paperclip size={12} class="shrink-0 text-faint" strokeWidth={1.8} />
                      {/if}
                    </span>
                    <span class="mt-0.5 block truncate font-sans text-xs text-muted">{m.preview}</span>
                  </span>
                </button>
              </li>
            {/each}
          </ul>
        {/if}
      </div>
    </section>

    {#if detail}
      <section class="claude-card mt-4 w-full overflow-hidden">
        <div class="border-b border-line-soft px-4 py-4">
          <div class="flex items-start gap-2">
            <h3 class="min-w-0 flex-1 font-serif text-lg font-medium leading-snug tracking-tight text-ink">
              {detail.subject}
            </h3>
            <button
              type="button"
              class="icon-btn shrink-0 !h-9 !w-9"
              title="Tutup"
              aria-label="Tutup"
              onclick={() => {
                detail = null;
                selectedId = null;
              }}
            >
              <X size={15} strokeWidth={1.9} />
            </button>
          </div>
          <p class="mt-1.5 font-sans text-xs text-muted">
            {detail.from}
            <span class="text-faint"> · {fmtTime(detail.receivedAt)}</span>
          </p>
          <div class="mt-3 flex items-center gap-1">
            <button
              type="button"
              class="rounded-xl px-2.5 py-1 font-sans text-[11px] font-medium {showHtml
                ? 'bg-accent-soft text-accent'
                : 'text-faint hover:text-muted'}"
              onclick={() => (showHtml = true)}>HTML</button
            >
            <button
              type="button"
              class="rounded-xl px-2.5 py-1 font-sans text-[11px] font-medium {!showHtml
                ? 'bg-accent-soft text-accent'
                : 'text-faint hover:text-muted'}"
              onclick={() => (showHtml = false)}>Teks</button
            >
          </div>
        </div>
        <div class="p-4">
          {#if showHtml && detail.htmlBody}
            <iframe
              title="email"
              class="mail-frame min-h-[300px]"
              sandbox=""
              srcdoc={detail.htmlBody}
            ></iframe>
          {:else}
            <pre
              class="whitespace-pre-wrap break-words rounded-xl bg-surface p-4 font-serif text-sm leading-relaxed text-ink-2"
              >{detail.textBody || '(kosong)'}</pre
            >
          {/if}
        </div>
      </section>
    {/if}
  </main>

  {#if toast}
    <div
      class="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-xl bg-ink px-3.5 py-1.5 font-sans text-xs font-medium text-bg shadow-lg"
    >
      {toast}
    </div>
  {/if}
</div>
