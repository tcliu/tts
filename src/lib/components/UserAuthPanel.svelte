<script lang="ts">
  import { tick } from 'svelte'
  import { goto, invalidateAll } from '$app/navigation'
  import Button from '$lib/components/Button.svelte'
  import Checkbox from '$lib/components/Checkbox.svelte'
  import PasswordInput from '$lib/components/PasswordInput.svelte'
  import { UI_TEXT } from '$lib/ui-text'
  import { useSettings } from '$lib/use-settings.svelte'
  import { login, register, UserAuthError } from '$lib/user-auth'
  import { lastDocUrl } from '$lib/document-history'

  type Mode = 'signin' | 'register'
  let mode = $state<Mode>('signin')
  let identifier = $state('')
  let username = $state('')
  let email = $state('')
  let password = $state('')
  let rememberMe = $state(false)
  let pending = $state(false)
  let error = $state('')
  let identifierInput = $state<HTMLInputElement | null>(null)
  let registerUsernameInput = $state<HTMLInputElement | null>(null)

  const settings = useSettings()
  const text = $derived(UI_TEXT[settings.locale])

  $effect(() => {
    if (mode === 'signin') {
      void tick().then(() => identifierInput?.focus())
    } else {
      void tick().then(() => registerUsernameInput?.focus())
    }
  })

  function switchMode(next: Mode) {
    mode = next
    password = ''
    error = ''
  }

  // Server errors arrive as stable codes (`invalid_credentials`,
  // `rate_limited`) or descriptive messages; map the known codes to
  // localized strings so the form never shows a raw code.
  function mapSignInError(err: unknown): string {
    const code = err instanceof Error ? err.message : ''
    if (code === 'invalid_credentials') return text.auth.signIn.failed
    if (code === 'rate_limited') return text.adminErrorRateLimited
    return text.auth.signIn.failed
  }

  function mapRegisterError(err: unknown): string {
    const code = err instanceof Error ? err.message : ''
    if (code === 'rate_limited') return text.adminErrorRateLimited
    if (code === 'username is reserved') return text.auth.usernameReserved
    if (code === 'password_too_short') {
      const min = err instanceof UserAuthError ? err.minLength : null
      if (typeof min === 'number') return text.auth.passwordTooShort.replace('{min}', String(min))
      return text.auth.createAccount.failed
    }
    return text.auth.createAccount.failed
  }

  async function handleSignIn() {
    if (!identifier.trim() || !password) {
      error = text.auth.fillBoth
      return
    }
    try {
      const result = await login(identifier.trim(), password, rememberMe)
      await goto(result.kind === 'admin' ? '/admin/properties' : lastDocUrl())
      // The session cookie is fresh from the login response; re-run loads so
      // `data.user` (and the header profile button) reflects the new session
      // even when the navigation reused cached load data.
      await invalidateAll()
    } catch (err) {
      error = mapSignInError(err)
    } finally {
      pending = false
    }
  }

  async function handleRegister() {
    if (!username.trim() || !email.trim() || !password) {
      error = text.auth.fillAll
      return
    }
    pending = true
    error = ''
    try {
      await register(username.trim(), email.trim(), password)
      await goto(lastDocUrl())
      // Same as sign-in: force fresh loads so the header shows the profile.
      await invalidateAll()
    } catch (err) {
      error = mapRegisterError(err)
    } finally {
      pending = false
    }
  }
</script>

<div class="flex min-h-full items-center justify-center px-4 py-10 @max-md:p-0">
  <div class="w-full max-w-md rounded-xl border border-slate-800 bg-slate-900/95 p-6 shadow-2xl shadow-slate-950/60 @max-md:max-w-none @max-md:self-stretch @max-md:rounded-none @max-md:border-x-0">
    <h1 class="text-2xl font-semibold tracking-tight text-slate-100">
      {mode === 'signin' ? text.auth.login : text.auth.createAccount.title}
    </h1>

    <div class="mt-4">
      <div class="mb-4 flex rounded-lg border border-slate-700 p-0.5" role="group" aria-label={text.auth.accountOptions}>
        <button
          type="button"
          aria-pressed={mode === 'signin'}
          onclick={() => switchMode('signin')}
          class={`flex-1 rounded-md px-3 py-1.5 text-sm font-semibold outline-none transition ${mode === 'signin' ? 'bg-slate-800 text-slate-100' : 'text-slate-400 hover:text-slate-200 focus:text-slate-200'}`}>
          {text.auth.login}
        </button>
        <button
          type="button"
          aria-pressed={mode === 'register'}
          onclick={() => switchMode('register')}
          class={`flex-1 rounded-md px-3 py-1.5 text-sm font-semibold outline-none transition ${mode === 'register' ? 'bg-slate-800 text-slate-100' : 'text-slate-400 hover:text-slate-200 focus:text-slate-200'}`}>
          {text.auth.createAccount.title}
        </button>
      </div>

      {#if mode === 'signin'}
        <form
          class="flex flex-col gap-4"
          onsubmit={e => {
            e.preventDefault()
            void handleSignIn()
          }}
          novalidate>
          <label class="flex flex-col gap-1.5">
            <span class="text-sm font-medium text-slate-200">{text.auth.usernameOrEmail}</span>
            <input
              bind:this={identifierInput}
              bind:value={identifier}
              type="text"
              autocomplete="username"
              disabled={pending}
              class="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none transition focus:border-cyan-500 disabled:opacity-40" />
          </label>
          <label class="flex flex-col gap-1.5">
            <span class="text-sm font-medium text-slate-200">{text.auth.password}</span>
            <PasswordInput bind:value={password} locale={settings.locale} disabled={pending} />
          </label>
          {#if error}
            <p class="text-sm text-rose-400" role="alert">{error}</p>
          {/if}
          <Checkbox bind:checked={rememberMe} name="rememberMe" label={text.auth.rememberMe} disabled={pending} />
          <Button variant="primary" accent="cyan" type="submit" pending={pending} className="w-full">
            {text.auth.continue}
          </Button>
        </form>
      {:else}
        <form
          class="flex flex-col gap-4"
          onsubmit={e => {
            e.preventDefault()
            void handleRegister()
          }}
          novalidate>
          <label class="flex flex-col gap-1.5">
            <span class="text-sm font-medium text-slate-200">{text.auth.username}</span>
            <input
              bind:this={registerUsernameInput}
              bind:value={username}
              type="text"
              autocomplete="username"
              disabled={pending}
              class="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none transition focus:border-cyan-500 disabled:opacity-40" />
          </label>
          <label class="flex flex-col gap-1.5">
            <span class="text-sm font-medium text-slate-200">{text.auth.email}</span>
            <input
              bind:value={email}
              type="email"
              autocomplete="email"
              disabled={pending}
              class="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none transition focus:border-cyan-500 disabled:opacity-40" />
          </label>
          <label class="flex flex-col gap-1.5">
            <span class="text-sm font-medium text-slate-200">{text.auth.password}</span>
            <PasswordInput bind:value={password} locale={settings.locale} disabled={pending} />
          </label>
          {#if error}
            <p class="text-sm text-rose-400" role="alert">{error}</p>
          {/if}
          <Button variant="primary" accent="cyan" type="submit" pending={pending} className="w-full">
            {text.auth.continue}
          </Button>
        </form>
      {/if}
    </div>
  </div>
</div>
