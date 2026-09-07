<script lang="ts">
  import Menu from '$lib/components/Menu.svelte'
  import GlobeIcon from '$lib/icons/GlobeIcon.svelte'
  import PaletteIcon from '$lib/icons/PaletteIcon.svelte'
  import { THEME_ICONS, THEME_MENU_OPTIONS } from '$lib/page/theme'
  import { UI_LANGUAGE_OPTIONS, UI_TEXT, type UiLocale } from '$lib/ui-text'
  import { useSettings, type UiTheme } from '$lib/use-settings.svelte'
  import UserAuthPanel from '$lib/components/UserAuthPanel.svelte'
  import Button from '$lib/components/Button.svelte'
  import DocumentIcon from '$lib/icons/DocumentIcon.svelte'
  import { goto } from '$app/navigation'
  import { page } from '$app/state'
  import { onMount } from 'svelte'
  import { lastDocUrl } from '$lib/document-history'

  const settings = useSettings()
  const text = $derived(UI_TEXT[settings.locale])

  const themeLabels = $derived<Record<UiTheme, string>>({
    dark: text.themeDark,
    ember: text.themeEmber,
    forest: text.themeForest,
    midnight: text.themeMidnight,
    nebula: text.themeNebula,
    light: text.themeLight,
    mint: text.themeMint,
    sepia: text.themeSepia,
    lavender: text.themeLavender,
    sky: text.themeSky,
  })

  const themeOptions = $derived(
    THEME_MENU_OPTIONS.map(option => ({ value: option.value, label: themeLabels[option.value], icon: THEME_ICONS[option.value] })),
  )

  function selectLanguage(value: UiLocale) {
    settings.setLocale(value)
  }

  function selectTheme(value: UiTheme) {
    settings.setTheme(value)
  }
  // The editor persists the active slug to localStorage on every navigation;
  // already-authenticated visitors bounce straight back to it (the server
  // cannot read localStorage, so this happens client-side).
  function goToLastDoc() {
    void goto(lastDocUrl())
  }

  onMount(() => {
    settings.hydrate()
    if (page.data.user) {
      goToLastDoc()
    }
  })
</script>
<svelte:head>
  <title>{text.appTitle}</title>
</svelte:head>

<div class="flex h-dvh flex-col overflow-hidden bg-slate-950 text-slate-200">
  <header class="flex flex-none items-center justify-between border-b border-slate-800 px-3 py-3 sm:px-4">
    <h1 class="text-base font-semibold tracking-tight text-slate-200 sm:text-lg">
      {text.appShortTitle}
    </h1>
    <div class="flex items-center gap-2">
      <Menu
        items={UI_LANGUAGE_OPTIONS}
        itemKey={option => option.value}
        ariaLabel={text.language}
        triggerTooltip={text.language}
        align="right"
        autoPlace={true}
        triggerClass="p-1.5 relative before:absolute before:-inset-1.5 before:content-['']"
        phoneSheetTitle={text.language}
        closeLabel={text.close}
        itemRole="menuitemradio"
        itemChecked={option => option.value === settings.locale}
        itemClass={(option, state) =>
          `flex w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-left text-sm outline-none transition-none ${
            state.disabled
              ? 'cursor-not-allowed text-slate-600'
              : state.active
                ? 'bg-slate-800 text-cyan-200'
                : option.value === settings.locale
                  ? 'text-cyan-200'
                  : 'text-slate-300'
          }`}
        onSelect={index => selectLanguage(UI_LANGUAGE_OPTIONS[index].value)}>
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
        ariaLabel={text.theme}
        triggerTooltip={text.theme}
        align="right"
        autoPlace={true}
        triggerClass="p-1.5 relative before:absolute before:-inset-1.5 before:content-['']"
        phoneSheetTitle={text.theme}
        closeLabel={text.close}
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
      <Button size="sm" ariaLabel={text.auth.goToEditor} tooltip={text.auth.goToEditor} onClick={goToLastDoc}>
        {#snippet icon()}
          <DocumentIcon />
        {/snippet}
      </Button>
    </div>
  </header>
  <main class="min-h-0 flex-1 overflow-y-auto @container">
    <UserAuthPanel />
  </main>
</div>
