<script lang="ts">
  import { onMount } from 'svelte'
  import { tick } from 'svelte'
  import Button from './Button.svelte'
  import Checkbox from './Checkbox.svelte'
  import PasswordInput from './PasswordInput.svelte'
  import { UI_TEXT, type UiLocale } from '$lib/ui-text'
  import { adminErrorCode, adminErrorMessage, adminLogin } from '$lib/admin-client'

  interface Props {
    locale: UiLocale
    unconfigured: boolean
    onAuthenticated: () => void
  }

  let { locale, unconfigured, onAuthenticated }: Props = $props()

  const text = $derived(UI_TEXT[locale])

  let username = $state('')
  let password = $state('')
  let rememberMe = $state(false)
  let pending = $state(false)
  let error = $state('')
  let usernameInput = $state<HTMLInputElement | null>(null)
  let passwordInput = $state<{ focus: () => void } | null>(null)

  // Focus the first empty field: username when blank, otherwise password.
  onMount(() => {
    void tick().then(() => {
      if (!username) {
        usernameInput?.focus()
      } else {
        passwordInput?.focus()
      }
    })
  })

  async function handleSubmit(event: SubmitEvent) {
    event.preventDefault()
    if (!username.trim() || !password) {
      error = text.adminLoginFillBoth
      return
    }
    pending = true
    error = ''
    try {
      await adminLogin(username.trim(), password, rememberMe)
      onAuthenticated()
    } catch (err) {
      const code = adminErrorCode(err)
      error = code === 'invalid_credentials' || code === 'rate_limited' ? adminErrorMessage(code, text) : text.adminLoginFailed
    } finally {
      pending = false
    }
  }
</script>

<div class="flex min-h-full items-center justify-center px-4 py-10">
  <div class="w-full max-w-md rounded-xl border border-slate-800 bg-slate-900/95 p-6 shadow-2xl shadow-slate-950/60">
    <h2 class="text-2xl font-semibold tracking-tight text-slate-100">{text.adminTitle}</h2>
    <p class="mt-1 text-sm text-slate-400">{text.adminLoginDescription}</p>
    {#if unconfigured}
      <p class="mt-3 rounded-lg border border-amber-700 bg-amber-950/50 px-3 py-2 text-sm text-amber-200">
        {text.adminNotConfigured}
      </p>
    {/if}
    <form class="mt-4 flex flex-col gap-4" onsubmit={handleSubmit} novalidate>
      <label class="flex flex-col gap-1.5">
        <span class="text-sm font-medium text-slate-200">{text.adminUsername}</span>
        <input
          bind:this={usernameInput}
          bind:value={username}
          type="text"
          autocomplete="username"
          disabled={pending}
          class="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none transition focus:border-cyan-500 disabled:opacity-40" />
      </label>
      <label class="flex flex-col gap-1.5">
        <span class="text-sm font-medium text-slate-200">{text.adminPassword}</span>
        <PasswordInput bind:this={passwordInput} bind:value={password} {locale} disabled={pending} />
      </label>
      {#if error}
        <p class="text-sm text-rose-400" role="alert">{error}</p>
      {/if}
      <Checkbox bind:checked={rememberMe} name="rememberMe" label={text.adminRememberMe} disabled={pending} />
      <Button variant="primary" accent="cyan" type="submit" pending={pending} className="w-full">{text.adminSignIn}</Button>
    </form>
  </div>
</div>
