<script lang="ts">
  import BaseDialog from '$lib/components/BaseDialog.svelte'
  import Button from '$lib/components/Button.svelte'
  import SearchInput from '$lib/components/SearchInput.svelte'
  import SelectDropdown from '$lib/components/SelectDropdown.svelte'
  import NumberInput from '$lib/components/NumberInput.svelte'
  import Tabs from '$lib/components/Tabs.svelte'
  import { UI_TEXT, type UiLocale } from '$lib/ui-text'
  import { REFERENCE_LANGUAGES, SPEEDS, SPEED_STEP, getVoiceGroups, getVoiceOptions } from '$lib/tts-reference'
  import { formatBytes } from '$lib/format-bytes'

  interface Props {
    locale: UiLocale
    speed: number
    synthesisConcurrency: number
    voiceSelections: Record<string, string>
    groupSelections: Record<string, string>
    cacheStats: { segments: number; bytes: number } | null
    onCancel: () => void
    onSelectVoice: (languageCode: string, voiceId: string) => void
    onSelectGroup: (languageCode: string, group: string) => void
    onSelectSpeed: (speed: number) => void
    onSelectConcurrent: (value: number) => void
    onClearCache: () => void
    onViewCache: () => void
  }

  let {
    locale,
    speed,
    synthesisConcurrency,
    voiceSelections,
    groupSelections,
    cacheStats,
    onCancel,
    onSelectVoice,
    onSelectGroup,
    onSelectSpeed,
    onSelectConcurrent,
    onClearCache,
    onViewCache,
  }: Props = $props()

  const text = $derived(UI_TEXT[locale])

  let voiceSearch = $state('')

  const voiceQuery = $derived(voiceSearch.trim().toLowerCase())
  const filteredLanguages = $derived(
    voiceQuery
      ? REFERENCE_LANGUAGES.filter(language => {
          if (language.name.toLowerCase().includes(voiceQuery)) return true
          if (language.code.toLowerCase().includes(voiceQuery)) return true
          return language.voices.some(
            voice =>
              voice.name.toLowerCase().includes(voiceQuery) ||
              voice.edge.toLowerCase().includes(voiceQuery) ||
              (voice.group?.toLowerCase().includes(voiceQuery) ?? false),
          )
        })
      : REFERENCE_LANGUAGES,
  )

  function voiceGroups(languageCode: string) {
    return getVoiceGroups(languageCode)
  }

  function voicesFor(languageCode: string, group: string) {
    return getVoiceOptions(languageCode, group)
  }

  function voiceLabel(voice: { name: string; gender: 'Female' | 'Male' }): string {
    return `${voice.name} · ${voice.gender}`
  }

  const MIN_SPEED = SPEEDS[0]
  const MAX_SPEED = SPEEDS[SPEEDS.length - 1]
</script>

<BaseDialog title={text.settingsTitle} maxWidth="2xl" height="fixed" closeLabel={text.close} onCancel={onCancel}>
  <Tabs
    ariaLabel={text.settingsTitle}
    state={{}}
    tabs={[
      { label: text.voicesTab, path: 'voices', content: voicesContent },
      { label: text.speedTab, path: 'speed', content: speedContent },
      { label: text.synthesisTab, path: 'synthesis', content: synthesisContent },
    ]} />
</BaseDialog>

{#snippet voicesContent()}
  <div class="flex min-h-0 flex-1 flex-col gap-3">
    <SearchInput bind:value={voiceSearch} ariaLabel={text.voiceSearch} placeholder={text.voiceSearch} wrapperClass="shrink-0" />
    <div tabindex="-1" class="min-h-0 flex-1 overflow-y-auto rounded-xl border border-slate-800 bg-slate-950/50 outline-none">
      {#if filteredLanguages.length === 0}
        <p class="p-3 text-sm text-slate-500">{text.noMatchingVoices}</p>
      {:else}
        {#each filteredLanguages as language, i}
          {@const validGroups = voiceGroups(language.code)}
          {@const group = validGroups.includes(groupSelections[language.code]) ? groupSelections[language.code] : validGroups[0] ?? ''}
          {@const languageHeadingId = `voice-language-${language.code}`}
          <section aria-labelledby={languageHeadingId} class="flex flex-col gap-y-2.5 p-3 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-4 {i > 0 ? 'border-t border-slate-800' : ''}">
            <h3 id={languageHeadingId} class="w-full truncate text-left text-sm font-semibold text-slate-100 sm:w-32 sm:shrink-0">{language.name}</h3>
            <div class="flex w-full min-w-0 flex-1 flex-wrap items-center gap-2.5 text-sm text-slate-300 sm:w-auto">
              {#if validGroups.length > 1}
                <SelectDropdown
                  ariaLabel={`${language.name} ${text.spokenLanguage}`}
                  buttonLabel={group}
                  activeValue={group}
                  options={validGroups.map(group => ({ value: group, label: group }))}
                  size="sm"
                  emptyLabel={text.noOptions}
                  onSelect={group => onSelectGroup(language.code, group)} />
              {/if}
              <SelectDropdown
                ariaLabel={`${language.name} ${text.voiceModel}`}
                buttonLabel={voiceLabel(voicesFor(language.code, group).find(voice => voice.edge === voiceSelections[language.code]) ?? voicesFor(language.code, group)[0])}
                activeValue={voiceSelections[language.code]}
                options={voicesFor(language.code, group).map(voice => ({ value: voice.edge, label: voiceLabel(voice) }))}
                size="sm"
                emptyLabel={text.noOptions}
                onSelect={voiceId => onSelectVoice(language.code, voiceId)} />
            </div>
          </section>
        {/each}
      {/if}
    </div>
  </div>
{/snippet}

  {#snippet speedContent()}
    <div class="rounded-xl border border-slate-800 bg-slate-950/50">
      <div class="grid items-center gap-2 p-3 md:grid-cols-[minmax(0,1fr)_11rem]">
        <label for="default-speed" class="text-sm font-medium text-slate-100">{text.defaultSpeed}</label>
        <NumberInput
          id="default-speed"
          value={String(speed)}
          min={MIN_SPEED}
          max={MAX_SPEED}
          step={SPEED_STEP}
          ariaLabel={text.defaultSpeed}
          incrementLabel={text.increment}
          decrementLabel={text.decrement}
          oninput={event => {
            const raw = Number((event.target as HTMLInputElement).value)
            if (Number.isFinite(raw)) {
              onSelectSpeed(Math.min(MAX_SPEED, Math.max(MIN_SPEED, raw)))
            }
          }}
          onblur={event => {
            const raw = Number((event.target as HTMLInputElement).value)
            // NumberInput already clamps and snaps on blur; just propagate the committed value.
            onSelectSpeed(Number.isFinite(raw) ? raw : 1)
          }} />
      </div>
    </div>
  {/snippet}

  {#snippet synthesisContent()}
    <div class="rounded-xl border border-slate-800 bg-slate-950/50">
      <div class="grid items-center gap-2 p-3 md:grid-cols-[minmax(0,1fr)_11rem]">
        <label for="concurrent-synthesis" class="text-sm font-medium text-slate-100">{text.synthesisConcurrency}</label>
        <NumberInput
          id="concurrent-synthesis"
          value={String(synthesisConcurrency)}
          min={1}
          max={8}
          step={1}
          ariaLabel={text.synthesisConcurrency}
          incrementLabel={text.increment}
          decrementLabel={text.decrement}
          oninput={event => {
            const raw = Number((event.target as HTMLInputElement).value)
            if (Number.isFinite(raw)) {
              onSelectConcurrent(Math.min(8, Math.max(1, Math.round(raw))))
            }
          }}
          onblur={event => {
            const raw = Number((event.target as HTMLInputElement).value)
            // NumberInput already clamps/rounds on blur; propagate committed value.
            onSelectConcurrent(Number.isFinite(raw) ? raw : 1)
          }} />
      </div>
      <div class="grid items-center gap-2 border-t border-slate-800 p-3 md:grid-cols-[minmax(0,1fr)_auto]">
        <div class="text-sm">
          <span class="font-medium text-slate-100">{text.synthesisCache}</span>
          <p class="mt-0.5 text-xs text-slate-400" aria-live="polite">
            {#if cacheStats === null}
              —
            {:else if cacheStats.segments === 0}
              {text.cachedSegmentsNone}
            {:else}
              {cacheStats.segments} {text.segmentsUnit} · {formatBytes(cacheStats.bytes)}
            {/if}
          </p>
        </div>
        <div class="flex flex-wrap items-center justify-end gap-2">
          <Button
            variant="secondary"
            size="sm"
            disabled={cacheStats === null || cacheStats.segments === 0}
            ariaLabel={text.clearAllCacheEntries}
            onClick={onClearCache}>
            {text.clearAll}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            disabled={cacheStats === null || cacheStats.segments === 0}
            ariaLabel={text.viewSynthesisCache}
            onClick={onViewCache}>
            {text.view}
          </Button>
        </div>
      </div>
    </div>
  {/snippet}
