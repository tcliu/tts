<script lang="ts">
  import { onMount, type Snippet } from 'svelte'
  import { goto } from '$app/navigation'
  import { page } from '$app/state'
  import { lastDocUrl } from '$lib/document-history'
  import Button from '$lib/components/Button.svelte'
  import Menu from '$lib/components/Menu.svelte'
  import DocumentIcon from '$lib/icons/DocumentIcon.svelte'
  import SignOutIcon from '$lib/icons/SignOutIcon.svelte'
  import RefreshIcon from '$lib/icons/RefreshIcon.svelte'
  import Spinner from '$lib/components/Spinner.svelte'
  import GlobeIcon from '$lib/icons/GlobeIcon.svelte'
  import PaletteIcon from '$lib/icons/PaletteIcon.svelte'
  import Tabs, { type Tab } from '$lib/components/Tabs.svelte'
  import { adminErrorMessage } from '$lib/admin-client'
  import AdminPropertiesView from '$lib/components/AdminPropertiesView.svelte'
  import AdminSynthesisCacheView from '$lib/components/AdminSynthesisCacheView.svelte'
  import { useAdminAuth } from '$lib/use-admin-auth.svelte'
  import { useAdminProperties } from '$lib/use-admin-properties.svelte'
  import { useAdminSynthesisCache } from '$lib/use-admin-synthesis-cache.svelte'
  import { useSettings, type UiTheme } from '$lib/use-settings.svelte'
  import { THEME_ICONS, THEME_MENU_OPTIONS } from '$lib/page/theme'
  import { LOCALES, getI18nContext, type Locale } from '$lib/i18n.svelte'
  import type { LayoutData } from './$types'

  const PROPERTIES_PATH = '/admin/properties'
  const CACHE_PATH = '/admin/synthesis-cache'

  type AdminState = {
    propertiesState: ReturnType<typeof useAdminProperties>
    cacheState: ReturnType<typeof useAdminSynthesisCache>
  }

  let { data, children }: { data: LayoutData; children: Snippet } = $props()

  const settings = useSettings()
  const i18n = getI18nContext()


  const themeLabels = $derived<Record<UiTheme, string>>({
    dark: i18n.t('theme.dark'),
    ember: i18n.t('theme.ember'),
    forest: i18n.t('theme.forest'),
    midnight: i18n.t('theme.midnight'),
    nebula: i18n.t('theme.nebula'),
    light: i18n.t('theme.light'),
    mint: i18n.t('theme.mint'),
    sepia: i18n.t('theme.sepia'),
    lavender: i18n.t('theme.lavender'),
    sky: i18n.t('theme.sky'),
  })

  const themeOptions = $derived(
    THEME_MENU_OPTIONS.map(option => ({ value: option.value, label: themeLabels[option.value], icon: THEME_ICONS[option.value] })),
  )

  function selectLanguage(value: Locale) {
    settings.setLocale(value)
  }

  function selectTheme(value: UiTheme) {
    settings.setTheme(value)
  }

  const propertiesState = useAdminProperties(() => authState.handleSignedOut())
  const cacheState = useAdminSynthesisCache(() => authState.handleSignedOut())
  const authState = useAdminAuth({
    get initialAuthenticated() {
      return data.adminAuthenticated
    },
    onSignedOut() {
      propertiesState.reset()
      cacheState.reset()
    },
  })

  $effect(() => {
    if (authState.state === 'authenticated' && !propertiesState.pending && propertiesState.properties.length === 0) {
      void propertiesState.load()
    }
  })

  $effect(() => {
    if (authState.state !== 'authenticated') return
    if (page.url.pathname === CACHE_PATH && !cacheState.loaded && !cacheState.loading) {
      void cacheState.load()
    }
  })

  onMount(() => {
    const disposeSettings = settings.hydrate()
    return () => {
      disposeSettings()
    }
  })
</script>

<svelte:head>
  <title>{i18n.t('app.appTitle')}</title>
</svelte:head>

<div class="flex h-dvh flex-col overflow-hidden bg-slate-950 text-slate-200">
  <header class="flex flex-none items-center justify-between border-b border-slate-800 px-3 py-3 sm:px-4">
    <h1 class="text-base font-semibold tracking-tight text-slate-200 sm:text-lg">
      {i18n.t('app.appShortTitle')}
    </h1>
    <div class="flex items-center gap-2">
      <Menu
        items={LOCALES}
        itemKey={option => option.code}
        ariaLabel={i18n.t('app.language')}
        triggerTooltip={i18n.t('app.language')}
        align="right"
        autoPlace={true}
        triggerClass="p-1.5 relative before:absolute before:-inset-1.5 before:content-['']"
        phoneSheetTitle={i18n.t('app.language')}
        closeLabel={i18n.t('close')}
        itemRole="menuitemradio"
        itemChecked={option => option.code === settings.locale}
        itemClass={(option, state) =>
          `flex w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-left text-sm outline-none transition-none ${
            state.disabled
              ? 'cursor-not-allowed text-slate-600'
              : state.active
                ? 'bg-slate-800 text-cyan-200'
                : option.code === settings.locale
                  ? 'text-cyan-200'
                  : 'text-slate-300'
          }`}
        onSelect={index => selectLanguage(LOCALES[index].code)}>
        {#snippet icon()}
          <GlobeIcon className="h-4 w-4" />
        {/snippet}
        {#snippet item(option)}
          <span>{option.label}</span>
        {/snippet}
      </Menu>
      <Menu
        items={themeOptions}
        itemKey={option => option.value}
        ariaLabel={i18n.t('theme.label')}
        triggerTooltip={i18n.t('theme.label')}
        align="right"
        autoPlace={true}
        triggerClass="p-1.5 relative before:absolute before:-inset-1.5 before:content-['']"
        phoneSheetTitle={i18n.t('theme.label')}
        closeLabel={i18n.t('close')}
        itemRole="menuitemradio"
        itemChecked={option => option.value === settings.theme}
        itemClass={(option, state) =>
          `flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm outline-none transition-none ${
            state.disabled
              ? 'cursor-not-allowed text-slate-600'
              : state.active
                ? 'bg-slate-800 text-cyan-200'
                : option.value === settings.theme
                  ? 'text-cyan-200'
                  : 'text-slate-300'
          }`}
        onSelect={index => selectTheme(themeOptions[index].value)}>
        {#snippet icon()}
          <PaletteIcon className="h-4 w-4" />
        {/snippet}
        {#snippet item(option, _state)}
          {@const OptionIcon = option.icon}
          {#if OptionIcon}
            <OptionIcon className="h-4 w-4 shrink-0" />
          {/if}
          <span>{option.label}</span>
        {/snippet}
      </Menu>
      <Button size="sm" ariaLabel={i18n.t('admin.backToEditor')} tooltip={i18n.t('admin.backToEditor')} onClick={() => goto(lastDocUrl())}>
        {#snippet icon()}
          <DocumentIcon />
        {/snippet}
      </Button>
      <Button size="sm" ariaLabel={i18n.t('admin.signOut')} tooltip={i18n.t('admin.signOut')} onClick={() => void authState.handleLogout()}>
        {#snippet icon()}
          <SignOutIcon />
        {/snippet}
      </Button>
    </div>
  </header>
  <main class="min-h-0 flex-1">
    {#if authState.state === 'checking'}
      <div class="flex h-full items-center justify-center">
        <Spinner className="h-6 w-6" />
      </div>
    {:else if authState.state === 'error'}
      <div class="flex h-full flex-col items-center justify-center gap-3 px-4">
        <p class="text-sm text-rose-400">{adminErrorMessage(authState.sessionError || 'request_failed', i18n)}</p>
        <Button
          ariaLabel={i18n.t('admin.retry')}
          tooltip={i18n.t('admin.retry')}
          onClick={() => {
            authState.retry()
          }}>
          {#snippet icon()}
            <RefreshIcon />
          {/snippet}
        </Button>
      </div>
    {:else}
      {#snippet propertiesContent(state: AdminState)}
        <AdminPropertiesView propertiesState={state.propertiesState} />
      {/snippet}
      {#snippet cacheContent(state: AdminState)}
        <AdminSynthesisCacheView cacheState={state.cacheState} />
      {/snippet}
      {@const adminTabs = [
        {
          label: i18n.t('admin.tabProperties'),
          path: PROPERTIES_PATH,
          content: propertiesContent,
        },
        {
          label: i18n.t('admin.tabSynthesisCache'),
          path: CACHE_PATH,
          content: cacheContent,
        },
      ] satisfies Tab<AdminState>[]}
      <div class="mx-auto flex h-full max-w-[96rem] flex-col gap-3 px-4 pb-4">
        <Tabs
          tabs={adminTabs}
          state={{ propertiesState, cacheState }}
          pathname={page.url.pathname === '/admin' ? PROPERTIES_PATH : page.url.pathname}
          class="pt-4"
          ariaLabel={i18n.t('admin.sections')} />
      </div>
      {@render children()}
    {/if}
  </main>
</div>
