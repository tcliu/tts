<script lang="ts">
  import BaseDialog from '$lib/components/BaseDialog.svelte'
  import SelectDropdown from '$lib/components/SelectDropdown.svelte'
  import NumberInput from '$lib/components/NumberInput.svelte'
  import Tabs from '$lib/components/Tabs.svelte'
  import { UI_TEXT, type UiLocale } from '$lib/ui-text'
  import { REFERENCE_LANGUAGES, SPEED_OPTIONS, getVoiceGroups, getVoiceOptions } from '$lib/tts-reference'

  interface Props {
    locale: UiLocale
    speed: number
    synthesisConcurrency: number
    voiceSelections: Record<string, string>
    groupSelections: Record<string, string>
    onCancel: () => void
    onSelectVoice: (languageCode: string, voiceId: string) => void
    onSelectGroup: (languageCode: string, group: string) => void
    onSelectSpeed: (speed: number) => void
    onSelectConcurrent: (value: number) => void
  }

  let {
    locale,
    speed,
    synthesisConcurrency,
    voiceSelections,
    groupSelections,
    onCancel,
    onSelectVoice,
    onSelectGroup,
    onSelectSpeed,
    onSelectConcurrent,
  }: Props = $props()

  const text = $derived(UI_TEXT[locale])

  function voiceGroups(languageCode: string) {
    return getVoiceGroups(languageCode)
  }

  function voicesFor(languageCode: string, group: string) {
    return getVoiceOptions(languageCode, group)
  }
</script>

<BaseDialog title={text.settingsTitle} maxWidth="2xl" closeLabel={text.close} onCancel={onCancel}>
  <Tabs
    ariaLabel={text.settingsTitle}
    state={{}}
    tabs={[
      { label: text.voicesTab, path: 'voices', content: voicesContent },
      { label: text.speedTab, path: 'speed', content: speedContent },
    ]} />
</BaseDialog>

{#snippet voicesContent()}
  <div class="rounded-xl border border-slate-800 bg-slate-950/50">
    {#each REFERENCE_LANGUAGES as language, i}
      {@const group = groupSelections[language.code] ?? voiceGroups(language.code)[0] ?? ''}
      <section aria-label={language.name} class="p-3 {i > 0 ? 'border-t border-slate-800' : ''}">
        <h3 class="mb-2.5 text-sm font-semibold text-slate-100">{language.name}</h3>

        <div class="flex flex-wrap gap-2.5">
          {#if voiceGroups(language.code).length > 1}
            <div class="flex flex-col gap-2 text-sm text-slate-300">
              <SelectDropdown
                ariaLabel={`${language.name} ${text.spokenLanguage}`}
                buttonLabel={group}
                activeValue={group}
                options={voiceGroups(language.code).map(group => ({ value: group, label: group }))}
                size="sm"
                onSelect={group => onSelectGroup(language.code, group)} />
            </div>
          {/if}

          <div class="flex flex-col gap-2 text-sm text-slate-300">
            <SelectDropdown
              ariaLabel={`${language.name} ${text.voiceModel}`}
              buttonLabel={voicesFor(language.code, group).find(voice => voice.edge === voiceSelections[language.code])?.name ?? voicesFor(language.code, group)[0]?.name ?? ''}
              activeValue={voiceSelections[language.code]}
              options={voicesFor(language.code, group).map(voice => ({ value: voice.edge, label: voice.name }))}
              size="sm"
              onSelect={voiceId => onSelectVoice(language.code, voiceId)} />
          </div>
        </div>
      </section>
    {/each}
  </div>
{/snippet}

  {#snippet speedContent()}
    <div class="rounded-xl border border-slate-800 bg-slate-950/50">
      <div class="grid items-center gap-2 p-3 md:grid-cols-[minmax(0,1fr)_11rem]">
        <span class="text-sm font-medium text-slate-100">{text.defaultSpeed}</span>
        <SelectDropdown
          ariaLabel={text.defaultSpeed}
          buttonLabel={`${speed}x`}
          activeValue={String(speed)}
          options={SPEED_OPTIONS}
          size="sm"
          onSelect={value => onSelectSpeed(Number(value))} />
      </div>
      <div class="grid items-center gap-2 border-t border-slate-800 p-3 md:grid-cols-[minmax(0,1fr)_11rem]">
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
            const next = Number.isFinite(raw) ? Math.min(8, Math.max(1, Math.round(raw))) : 1
            onSelectConcurrent(next)
          }} />
      </div>
    </div>
  {/snippet}
