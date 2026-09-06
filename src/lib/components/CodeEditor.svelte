<script lang="ts">
  import { onDestroy, onMount } from 'svelte'
  import { Compartment, EditorSelection, EditorState, RangeSetBuilder } from '@codemirror/state'
  import { defaultKeymap, history, historyKeymap, indentLess } from '@codemirror/commands'
  import { bracketMatching, indentOnInput, indentUnit } from '@codemirror/language'
  import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete'
  import { search, searchKeymap } from '@codemirror/search'
  import { Decoration, EditorView, drawSelection, keymap, lineNumbers } from '@codemirror/view'
  import { githubDark, githubLight } from '@uiw/codemirror-theme-github'

  import type { UiTheme } from '$lib/use-settings.svelte'

  interface Props {
    content: string
    editable?: boolean
    selectionEnabled?: boolean
    theme?: UiTheme
    containerClass?: string
    editorClass?: string
    editorAriaLabel?: string
    onReady?: () => void
    onContentChange?: (content: string) => void
    onSelectionChange?: (range: { from: number; to: number } | null) => void
  }

  let {
    content = $bindable(),
    editable = true,
    selectionEnabled = true,
    theme = 'dark',
    containerClass = '',
    editorClass = '',
    editorAriaLabel = 'Content',
    onReady,
    onContentChange,
    onSelectionChange,
  }: Props = $props()

  // Chrome colors are CSS variables defined in src/styles.css per [data-theme].
  // Keeping them there satisfies AGENTS.md "palettes live only in styles.css"
  // while the CodeMirror compartment only maps the variables to the required
  // editor selectors.
  function colorThemeExtensions(theme: UiTheme) {
    return [
      theme === 'dark' || theme === 'ember' || theme === 'forest' || theme === 'midnight' || theme === 'nebula' ? githubDark : githubLight,
      EditorView.theme({
        '&': {
          height: '100%',
          maxHeight: '100%',
          fontSize: '0.875rem',
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, Liberation Mono, Courier New, monospace',
        },
        '.cm-scroller': {
          height: '100%',
          overflow: 'auto',
        },
        '.cm-content': {
          paddingTop: '0.75rem',
          paddingRight: '1rem',
          paddingBottom: '0.75rem',
          paddingLeft: '0.5rem',
          minHeight: '100%',
          caretColor: 'var(--cm-caret)',
        },
        '.cm-gutters': {
          color: 'var(--cm-gutterColor)',
          borderRight: `1px solid var(--cm-gutterBorder)`,
        },
        '.cm-activeLineGutter': {
          backgroundColor: 'var(--cm-activeLineGutter)',
        },
        '.cm-activeLine': {
          backgroundColor: 'var(--cm-activeLine)',
        },
        '.cm-cursor, .cm-dropCursor': {
          borderLeftColor: 'var(--cm-caret)',
        },
        '.cm-selectionBackground, ::selection': {
          backgroundColor: 'var(--cm-selection)',
        },
        '.cm-playbackHighlight': {
          backgroundColor: 'var(--cm-playbackHighlight)',
          borderRadius: '0.125rem',
        },
        '.cm-playbackHighlightSelected': {
          backgroundColor: 'var(--cm-playbackHighlightSelected)',
          borderRadius: '0.125rem',
        },
        '.cm-selectionBackground .cm-playbackHighlight, .cm-playbackHighlight.cm-selectionBackground, .cm-content:has(.cm-selectionBackground) .cm-playbackHighlight': {
          backgroundColor: 'var(--cm-playbackHighlightSelected) !important',
        },
        '.cm-selectionDisabled': {
          userSelect: 'none',
        },
        '.cm-focused': {
          outline: 'none',
        },
      }),
    ]
  }

  let editorContainerRef: HTMLDivElement | null = null
  let editorView: EditorView | null = null
  let lastEditable = false
  let lastSelectionEnabled = true
  let lastTheme: UiTheme = 'dark'
  const editableCompartment = new Compartment()
  const colorThemeCompartment = new Compartment()
  const playbackHighlightCompartment = new Compartment()
  const selectionGuardCompartment = new Compartment()
  const selectionAttrCompartment = new Compartment()

  const playbackHighlightMark = Decoration.mark({ class: 'cm-playbackHighlight' })
  const playbackHighlightSelectedMark = Decoration.mark({ class: 'cm-playbackHighlightSelected' })

  function playbackHighlightField(from: number | null, to: number | null, selected = false) {
    return EditorView.decorations.compute([], () => {
      if (from == null || to == null || from >= to) {
        return Decoration.none
      }
      const builder = new RangeSetBuilder<Decoration>()
      builder.add(from, to, selected ? playbackHighlightSelectedMark : playbackHighlightMark)
      return builder.finish()
    })
  }

  function selectionGuardExtension(enabled: boolean) {
    if (enabled) return []
    return EditorView.domEventHandlers({
      dragstart(event) {
        event.preventDefault()
        return true
      },
    })
  }

  function selectionAttrExtension(enabled: boolean) {
    return EditorView.contentAttributes.of({
      class: enabled ? '' : 'cm-selectionDisabled',
    })
  }

  function insertTwoSpaces(): boolean {
    if (!editorView) return false
    editorView.dispatch(editorView.state.replaceSelection('  '), { userEvent: 'input', scrollIntoView: true })
    return true
  }

  function removeTwoSpaces(): boolean {
    if (!editorView) return false
    const state = editorView.state
    const main = state.selection.main
    if (!main.empty) {
      return indentLess({ state, dispatch: editorView.dispatch })
    }
    const line = state.doc.lineAt(main.from)
    let from: number
    let to: number
    const before = state.doc.sliceString(Math.max(line.from, main.from - 2), main.from)
    if (before.length > 0 && /^[ \t]+$/.test(before)) {
      from = main.from - before.length
      to = main.from
    } else {
      const leading = /^[ \t]*/.exec(line.text)?.[0] ?? ''
      const removeCount = Math.min(leading.length, 2)
      if (removeCount === 0) return false
      from = line.from
      to = line.from + removeCount
    }
    editorView.dispatch({ changes: { from, to }, userEvent: 'delete.dedent', scrollIntoView: true })
    return true
  }

  function syncEditorDocument(nextContent: string) {
    if (!editorView) return
    const current = editorView.state.doc.toString()
    if (current === nextContent) return
    // Replacing the whole buffer invalidates any selection computed against
    // the previous document; mapping it instead would leak the old playback
    // highlight into the new document as a phantom range. Collapse to the
    // start of the incoming text explicitly.
    editorView.dispatch({
      changes: { from: 0, to: current.length, insert: nextContent },
      selection: EditorSelection.cursor(0),
    })
  }

  function createEditor() {
    if (!editorContainerRef) return
    lastEditable = editable
    lastSelectionEnabled = selectionEnabled
    lastTheme = theme
    editorView = new EditorView({
      state: EditorState.create({
        doc: content,
        extensions: [
          colorThemeCompartment.of(colorThemeExtensions(theme)),
          editableCompartment.of(EditorView.editable.of(editable)),
          selectionGuardCompartment.of(selectionGuardExtension(selectionEnabled)),
          selectionAttrCompartment.of(selectionAttrExtension(selectionEnabled)),
          drawSelection(),
          playbackHighlightCompartment.of(playbackHighlightField(null, null)),
          lineNumbers(),
          search({ top: true }),
          history(),
          bracketMatching(),
          closeBrackets(),
          indentOnInput(),
          indentUnit.of('  '),
          EditorState.tabSize.of(2),
          EditorView.lineWrapping,
          EditorView.contentAttributes.of({
            'aria-label': editorAriaLabel,
            'aria-multiline': 'true',
          }),
          EditorView.updateListener.of(update => {
            if (update.docChanged) {
              const next = update.state.doc.toString()
              content = next
              onContentChange?.(next)
            }
            if (update.selectionSet) {
              const main = update.state.selection.main
              if (!lastSelectionEnabled && main.from !== main.to) {
                update.view.dispatch({
                  selection: EditorSelection.cursor(main.head),
                  userEvent: 'select.pointer.collapse',
                })
                return
              }
              onSelectionChange?.(main.from === main.to ? null : { from: main.from, to: main.to })
            }
          }),
          keymap.of([
            { key: 'Tab', run: insertTwoSpaces, preventDefault: true },
            { key: 'Shift-Tab', run: removeTwoSpaces, preventDefault: true },
            ...closeBracketsKeymap,
            ...defaultKeymap,
            ...historyKeymap,
            ...searchKeymap,
          ]),
        ],
      }),
      parent: editorContainerRef,
    })

    onReady?.()
  }

  onMount(() => {
    createEditor()
  })

  onDestroy(() => {
    editorView?.destroy()
    editorView = null
  })

  $effect(() => {
    void editable
    if (!editorView || editable === lastEditable) return
    lastEditable = editable
    editorView.dispatch({
      effects: editableCompartment.reconfigure(EditorView.editable.of(editable)),
    })
  })

  $effect(() => {
    void selectionEnabled
    if (!editorView || selectionEnabled === lastSelectionEnabled) return
    lastSelectionEnabled = selectionEnabled
    editorView.dispatch({
      effects: [
        selectionGuardCompartment.reconfigure(selectionGuardExtension(selectionEnabled)),
        selectionAttrCompartment.reconfigure(selectionAttrExtension(selectionEnabled)),
      ],
    })
  })

  $effect(() => {
    void theme
    if (!editorView || theme === lastTheme) return
    lastTheme = theme
    editorView.dispatch({
      effects: colorThemeCompartment.reconfigure(colorThemeExtensions(theme)),
    })
  })

  $effect(() => {
    if (!editorView) return
    void content
    syncEditorDocument(content)
  })

  export function focus() {
    editorView?.focus()
  }

  export function hasFocus(): boolean {
    return editorView?.hasFocus ?? false
  }

  export function getSelectionText(): string {
    if (!editorView) return ''
    const { from, to } = editorView.state.selection.main
    if (from === to) return ''
    return editorView.state.sliceDoc(from, to)
  }

  export function getSelectionRange(): { from: number; to: number } | null {
    if (!editorView) return null
    const { from, to } = editorView.state.selection.main
    if (from === to) return null
    return { from, to }
  }

  export function getCaretPosition(): number | null {
    if (!editorView) return null
    return editorView.state.selection.main.head
  }

  export function setSelection(from: number, to: number): boolean {
    if (!editorView) return false
    const current = editorView.state.selection.main
    if (current.from === from && current.to === to) return false
    const selection = EditorSelection.create([EditorSelection.range(from, to)])
    editorView.dispatch({ selection, scrollIntoView: true })
    return true
  }

  export function clearSelection() {
    if (!editorView) return
    const position = editorView.state.selection.main.anchor
    const selection = EditorSelection.create([EditorSelection.range(position, position)])
    editorView.dispatch({ selection })
  }

  export function setPlaybackHighlight(from: number, to: number) {
    if (!editorView) return
    editorView.dispatch({
      effects: playbackHighlightCompartment.reconfigure(playbackHighlightField(from, to, false)),
      scrollIntoView: true,
    })
  }

  export function setPlaybackHighlightSelected(from: number, to: number) {
    if (!editorView) return
    editorView.dispatch({
      effects: playbackHighlightCompartment.reconfigure(playbackHighlightField(from, to, true)),
      scrollIntoView: true,
    })
  }

  export function clearPlaybackHighlight() {
    if (!editorView) return
    editorView.dispatch({
      effects: playbackHighlightCompartment.reconfigure(playbackHighlightField(null, null)),
    })
  }
</script>

<div class={containerClass}>
  <div bind:this={editorContainerRef} class={editorClass}></div>
</div>
