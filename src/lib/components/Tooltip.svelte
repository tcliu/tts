<script lang="ts">
  import type { Snippet } from 'svelte'

  interface Props {
    children: Snippet
    align?: 'center' | 'left' | 'right'
    class?: string
  }

  let { children, align = 'center', class: extraClass = '' }: Props = $props()

  let anchor = $state<HTMLElement | null>(null)
  let visible = $state(false)
  let top = $state(0)
  let left = $state(0)

  const transformClass = $derived(
    align === 'left' ? 'translate-x-0' : align === 'right' ? '-translate-x-full' : '-translate-x-1/2',
  )

  function place() {
    const trigger = anchor?.parentElement
    if (!trigger) {
      return
    }
    const rect = trigger.getBoundingClientRect()
    top = Math.round(rect.bottom + 8)
    left = Math.round(align === 'left' ? rect.left : align === 'right' ? rect.right : rect.left + rect.width / 2)
  }

  function show() {
    hideQueued = false
    place()
    visible = true
  }

  function hide() {
    clearDismissTimer()
    if (!visible) {
      return
    }
    hideQueued = true
    queueMicrotask(() => {
      if (hideQueued) {
        hideQueued = false
        visible = false
      }
    })
  }

  const supportsHover = $derived(
    typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(hover: hover)').matches,
  )

  const LONG_PRESS_MS = 500
  const TOOLTIP_LINGER_MS = 2000
  let pressTimer: ReturnType<typeof setTimeout> | null = null
  let dismissTimer: ReturnType<typeof setTimeout> | null = null
  let hideQueued = false

  function clearPressTimer() {
    if (pressTimer) {
      clearTimeout(pressTimer)
      pressTimer = null
    }
  }

  function clearDismissTimer() {
    if (dismissTimer) {
      clearTimeout(dismissTimer)
      dismissTimer = null
    }
  }

  $effect(() => {
    const trigger = anchor?.parentElement
    if (!trigger || !supportsHover) {
      return
    }
    const enter = () => show()
    const leave = () => hide()
    trigger.addEventListener('mouseenter', enter)
    trigger.addEventListener('mouseleave', leave)
    trigger.addEventListener('focusin', enter)
    trigger.addEventListener('focusout', leave)
    return () => {
      trigger.removeEventListener('mouseenter', enter)
      trigger.removeEventListener('mouseleave', leave)
      trigger.removeEventListener('focusin', enter)
      trigger.removeEventListener('focusout', leave)
    }
  })

  $effect(() => {
    const trigger = anchor?.parentElement
    if (!trigger) {
      return
    }
    const startPress = (event: PointerEvent) => {
      if (event.pointerType !== 'touch') {
        return
      }
      clearPressTimer()
      if (visible) {
        clearDismissTimer()
        dismissTimer = setTimeout(() => {
          dismissTimer = null
          hide()
        }, TOOLTIP_LINGER_MS)
        return
      }
      pressTimer = setTimeout(() => {
        pressTimer = null
        show()
        dismissTimer = setTimeout(() => {
          dismissTimer = null
          hide()
        }, TOOLTIP_LINGER_MS)
      }, LONG_PRESS_MS)
    }
    const cancelPress = () => clearPressTimer()
    trigger.addEventListener('pointerdown', startPress)
    trigger.addEventListener('pointerup', cancelPress)
    trigger.addEventListener('pointercancel', cancelPress)
    trigger.addEventListener('pointerleave', cancelPress)
    return () => {
      trigger.removeEventListener('pointerdown', startPress)
      trigger.removeEventListener('pointerup', cancelPress)
      trigger.removeEventListener('pointercancel', cancelPress)
      trigger.removeEventListener('pointerleave', cancelPress)
      clearPressTimer()
      clearDismissTimer()
    }
  })

  $effect(() => {
    if (!visible) {
      return
    }
    const trigger = anchor?.parentElement
    const reposition = () => place()
    const hideWhenAway = (event: PointerEvent) => {
      if (!trigger || (event.target instanceof Node && trigger.contains(event.target))) {
        return
      }
      hide()
    }
    const hideOnBlur = () => hide()
    window.addEventListener('scroll', reposition, true)
    window.addEventListener('resize', reposition)
    window.addEventListener('pointermove', hideWhenAway, true)
    window.addEventListener('pointerdown', hideWhenAway, true)
    window.addEventListener('blur', hideOnBlur)
    return () => {
      window.removeEventListener('scroll', reposition, true)
      window.removeEventListener('resize', reposition)
      window.removeEventListener('pointermove', hideWhenAway, true)
      window.removeEventListener('pointerdown', hideWhenAway, true)
      window.removeEventListener('blur', hideOnBlur)
    }
  })

  function portal(node: HTMLElement) {
    document.body.appendChild(node)
    return {
      destroy() {
        node.remove()
      },
    }
  }
</script>

<span bind:this={anchor} class="hidden"></span>

{#if visible}
  <span
    use:portal
    role="tooltip"
    class={`st-tooltip ${transformClass} ${extraClass}`}
    style={`top:${top}px; left:${left}px; opacity:1;`}>
    {@render children()}
  </span>
{/if}
