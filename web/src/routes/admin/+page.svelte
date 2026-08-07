<script lang="ts">
  import { onMount } from 'svelte';
  import {
    Shield,
    Plus,
    Trash2,
    Power,
    Copy,
    Sun,
    Moon,
    ArrowLeft,
    Globe,
    BookOpen,
  } from '@lucide/svelte';
  import {
    adminListDomains,
    adminAddDomain,
    adminToggleDomain,
    adminDeleteDomain,
    adminDomainGuide,
    loadAdminKey,
    saveAdminKey,
    loadTheme,
    saveTheme,
    type AdminDomain,
    type DnsGuide,
    type Theme,
  } from '$lib/api';

  let key = $state('');
  let unlocked = $state(false);
  let domains = $state<AdminDomain[]>([]);
  let publicIp = $state('');
  let newDomain = $state('');
  let err = $state('');
  let toast = $state('');
  let busy = $state(false);
  let theme = $state<Theme>('dark');
  let guide = $state<(DnsGuide & { domain: string }) | null>(null);
  let selected = $state<string | null>(null);

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
  }

  async function unlock() {
    err = '';
    busy = true;
    try {
      const res = await adminListDomains(key.trim());
      domains = res.domains;
      publicIp = res.publicIp;
      unlocked = true;
      saveAdminKey(key.trim());
      showToast('Masuk admin');
    } catch (e) {
      unlocked = false;
      const msg = String(e).replace(/^Error:\s*/, '');
      err = msg.includes('unauthorized') ? 'Admin key salah' : msg;
    } finally {
      busy = false;
    }
  }

  async function reload() {
    const res = await adminListDomains(key);
    domains = res.domains;
    publicIp = res.publicIp;
  }

  async function addDomain() {
    err = '';
    const name = newDomain.trim().toLowerCase();
    if (!name) return;
    busy = true;
    try {
      const res = await adminAddDomain(key, name);
      newDomain = '';
      await reload();
      selected = res.domain.name;
      guide = { domain: res.domain.name, ...res.guide };
      showToast('Domain ditambah');
    } catch (e) {
      err = String(e).replace(/^Error:\s*/, '');
    } finally {
      busy = false;
    }
  }

  async function toggle(d: AdminDomain) {
    busy = true;
    try {
      await adminToggleDomain(key, d.name, !d.active);
      await reload();
    } catch (e) {
      err = String(e);
    } finally {
      busy = false;
    }
  }

  async function remove(d: AdminDomain) {
    if (!confirm(`Hapus domain ${d.name}?`)) return;
    busy = true;
    try {
      await adminDeleteDomain(key, d.name);
      if (selected === d.name) {
        selected = null;
        guide = null;
      }
      await reload();
      showToast('Domain dihapus');
    } catch (e) {
      err = String(e);
    } finally {
      busy = false;
    }
  }

  async function openGuide(name: string) {
    busy = true;
    err = '';
    try {
      guide = await adminDomainGuide(key, name);
      selected = name;
    } catch (e) {
      err = String(e);
    } finally {
      busy = false;
    }
  }

  async function copyText(t: string) {
    try {
      await navigator.clipboard.writeText(t);
      showToast('Tersalin');
    } catch {
      showToast('Gagal salin');
    }
  }

  onMount(() => {
    applyTheme(loadTheme());
    const k = loadAdminKey();
    if (k) {
      key = k;
      void unlock();
    }
  });
</script>

<div class="page-shell">
  <header class="site-header sticky top-0 z-20">
    <div class="mx-auto flex h-12 max-w-3xl items-center justify-between px-4 sm:px-5">
      <div class="flex items-center gap-3">
        <a href="/" class="icon-btn !h-9 !w-9" title="Kembali" aria-label="Kembali">
          <ArrowLeft size={16} strokeWidth={1.8} />
        </a>
        <div class="flex items-center gap-2">
          <span
            class="inline-flex h-7 w-7 items-center justify-center rounded-xl bg-accent text-white"
          >
            <Shield size={14} strokeWidth={2.2} />
          </span>
          <div class="leading-tight">
            <div class="font-serif text-[0.98rem] font-medium text-ink">Admin TMail</div>
            <div class="font-sans text-[10px] text-faint">Domain & DNS</div>
          </div>
        </div>
      </div>
      <button
        type="button"
        class="icon-btn !h-9 !w-9"
        onclick={() => applyTheme(theme === 'dark' ? 'light' : 'dark')}
        aria-label="Toggle theme"
      >
        {#if theme === 'dark'}
          <Sun size={16} strokeWidth={1.8} />
        {:else}
          <Moon size={16} strokeWidth={1.8} />
        {/if}
      </button>
    </div>
  </header>

  <main class="mx-auto w-full max-w-3xl px-4 pb-16 pt-7 sm:px-5 sm:pt-9">
    <div class="mb-5 text-left">
      <h1 class="font-serif text-[1.45rem] font-medium tracking-tight text-ink sm:text-[1.6rem]">
        Panel domain
      </h1>
      <p class="mt-1.5 font-sans text-[13px] text-muted">
        Tambah domain, lihat IP VPS, ikuti panduan DNS (Spaceship / registrar).
      </p>
    </div>

    {#if err}
      <div class="err-box mb-4 px-3.5 py-2.5 font-sans text-sm">{err}</div>
    {/if}

    {#if !unlocked}
      <section class="claude-card p-5">
        <label class="mb-1.5 block font-sans text-xs font-medium text-muted" for="admin-key"
          >Admin key</label
        >
        <div class="flex gap-2">
          <input
            id="admin-key"
            class="addr-local flex-1 rounded-[0.85rem] border border-line bg-surface px-3 py-2.5 font-sans text-sm text-ink outline-none"
            type="password"
            placeholder="ADMIN_KEY"
            bind:value={key}
            onkeydown={(e) => e.key === 'Enter' && unlock()}
          />
          <button
            type="button"
            class="icon-btn icon-btn-primary !h-auto !w-auto rounded-[0.85rem] px-4 py-2 font-sans text-sm"
            onclick={unlock}
            disabled={busy || !key.trim()}
          >
            Masuk
          </button>
        </div>
        <p class="mt-3 font-sans text-[11px] text-faint">
          Key dari env <code class="text-muted">ADMIN_KEY</code> di server. Salah 3× → IP diblokir 24 jam.
        </p>
      </section>
    {:else}
      <section class="claude-card mb-4 p-4 sm:p-5">
        <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div class="flex items-center gap-2 font-sans text-sm text-ink-2">
            <Globe size={15} />
            <span>IP VPS publik</span>
          </div>
          <button
            type="button"
            class="link-action"
            onclick={() => copyText(publicIp || '')}
            disabled={!publicIp}
          >
            <Copy size={13} />
            {publicIp || 'belum diset PUBLIC_IP'}
          </button>
        </div>

        <div class="flex flex-col gap-2 sm:flex-row">
          <input
            class="flex-1 rounded-[0.85rem] border border-line bg-surface px-3 py-2.5 font-sans text-sm text-ink outline-none"
            type="text"
            placeholder="contoh: mail.domain.com atau domain.com"
            bind:value={newDomain}
            onkeydown={(e) => e.key === 'Enter' && addDomain()}
          />
          <button
            type="button"
            class="inline-flex items-center justify-center gap-1.5 rounded-[0.85rem] bg-accent px-4 py-2.5 font-sans text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-50"
            onclick={addDomain}
            disabled={busy || !newDomain.trim()}
          >
            <Plus size={15} />
            Tambah domain
          </button>
        </div>
      </section>

      <div class="grid gap-4 lg:grid-cols-2">
        <section class="claude-card overflow-hidden">
          <div class="border-b border-line-soft px-4 py-3 font-sans text-xs font-medium uppercase tracking-wide text-faint">
            Domain aktif ({domains.length})
          </div>
          {#if !domains.length}
            <p class="px-4 py-10 text-center font-sans text-sm text-muted">Belum ada domain.</p>
          {:else}
            <ul class="divide-y divide-line-soft">
              {#each domains as d}
                <li class="flex items-center gap-2 px-3 py-3 {selected === d.name ? 'bg-accent-soft/40' : ''}">
                  <button
                    type="button"
                    class="min-w-0 flex-1 text-left"
                    onclick={() => openGuide(d.name)}
                  >
                    <div class="truncate font-sans text-sm font-medium text-ink">{d.name}</div>
                    <div class="font-sans text-[11px] text-faint">
                      {d.active ? 'aktif' : 'nonaktif'}
                    </div>
                  </button>
                  <button
                    type="button"
                    class="icon-btn !h-8 !w-8"
                    title={d.active ? 'Nonaktifkan' : 'Aktifkan'}
                    onclick={() => toggle(d)}
                    disabled={busy}
                  >
                    <Power size={14} class={d.active ? 'text-accent' : ''} />
                  </button>
                  <button
                    type="button"
                    class="icon-btn !h-8 !w-8"
                    title="Hapus"
                    onclick={() => remove(d)}
                    disabled={busy}
                  >
                    <Trash2 size={14} />
                  </button>
                </li>
              {/each}
            </ul>
          {/if}
        </section>

        <section class="claude-card p-4 sm:p-5">
          <div class="mb-3 flex items-center gap-2 font-sans text-xs font-medium uppercase tracking-wide text-faint">
            <BookOpen size={13} />
            Panduan koneksi DNS
          </div>

          {#if !guide}
            <p class="font-sans text-sm leading-relaxed text-muted">
              Pilih domain di kiri, atau tambah domain baru. Panel ini menampilkan record A/MX yang
              harus diisi di Spaceship (atau registrar lain) agar email masuk ke IP
              <span class="text-ink-2">{publicIp || 'VPS'}</span>.
            </p>
          {:else}
            <h2 class="font-serif text-lg font-medium text-ink">{guide.domain}</h2>
            <p class="mt-1 font-sans text-xs text-muted">IP target: {guide.publicIp}</p>

            <div class="mt-4 space-y-4">
              {#each guide.steps as step}
                <div>
                  <div class="mb-1.5 font-sans text-sm font-medium text-ink-2">{step.title}</div>
                  <div class="overflow-hidden rounded-xl border border-line">
                    <table class="w-full font-sans text-[11px]">
                      <thead class="bg-surface text-faint">
                        <tr>
                          <th class="px-2 py-1.5 text-left font-medium">Type</th>
                          <th class="px-2 py-1.5 text-left font-medium">Host</th>
                          <th class="px-2 py-1.5 text-left font-medium">Value</th>
                        </tr>
                      </thead>
                      <tbody class="divide-y divide-line-soft">
                        {#each step.records as rec}
                          <tr>
                            <td class="px-2 py-1.5 text-muted">{rec.type}{#if rec.priority != null} {rec.priority}{/if}</td>
                            <td class="px-2 py-1.5 text-ink">{rec.host}</td>
                            <td class="px-2 py-1.5">
                              <button
                                type="button"
                                class="link-action max-w-full truncate"
                                onclick={() => copyText(rec.value)}
                                title="Salin"
                              >
                                {rec.value}
                              </button>
                            </td>
                          </tr>
                        {/each}
                      </tbody>
                    </table>
                  </div>
                  <p class="mt-1 font-sans text-[11px] text-faint">{step.note}</p>
                </div>
              {/each}
            </div>

            <div class="mt-5">
              <div class="mb-1.5 font-sans text-sm font-medium text-ink-2">Spaceship (ringkas)</div>
              <ol class="list-decimal space-y-1 pl-4 font-sans text-xs leading-relaxed text-muted">
                {#each guide.spaceship as s}
                  <li>{s}</li>
                {/each}
              </ol>
            </div>

            <div class="mt-4">
              <div class="mb-1.5 font-sans text-sm font-medium text-ink-2">Checklist</div>
              <ul class="space-y-1 font-sans text-xs text-muted">
                {#each guide.checklist as c}
                  <li class="flex gap-2">
                    <span class="text-faint">•</span>
                    <span>{c}</span>
                  </li>
                {/each}
              </ul>
            </div>
          {/if}
        </section>
      </div>
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
