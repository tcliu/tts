<script lang="ts">
  import { tick } from 'svelte'
  import { Compartment, EditorSelection, EditorState, RangeSetBuilder, type Extension } from '@codemirror/state'
  import { defaultKeymap, history, historyKeymap, indentLess } from '@codemirror/commands'
  import { bracketMatching, indentOnInput, indentUnit } from '@codemirror/language'
  import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete'
  import { search, searchKeymap } from '@codemirror/search'
  import { Decoration, EditorView, drawSelection, keymap, lineNumbers } from '@codemirror/view'
  import { githubDark, githubLight } from '@uiw/codemirror-theme-github'
  import { maxContentLengthFilter } from './code-editor-max-content'

  interface Props {
    content: string
    editable?: boolean
    docType?: string
    selectionEnabled?: boolean
    theme?: string
    containerClass?: string
    editorClass?: string
    editorAriaLabel?: string
    autoFocus?: boolean
    recreateKey?: string
    maxContentLength?: number
    onReady?: () => void
    onAutoFocused?: () => void
    onContentChange?: (content: string) => void
    onSelectionChange?: (range: { from: number; to: number } | null) => void
  }

  let {
    content = $bindable(),
    editable = true,
    docType = 'text',
    selectionEnabled = true,
    theme = 'dark',
    containerClass = '',
    editorClass = '',
    editorAriaLabel = 'Content',
    autoFocus = false,
    recreateKey = '',
    maxContentLength = 0,
    onReady,
    onAutoFocused,
    onContentChange,
    onSelectionChange,
  }: Props = $props()

  // Language packs are loaded on demand, one chunk per document type, so the
  // editor never bundles the languages a given document does not use. A host
  // that never passes `docType` (it defaults to `'text'`) loads no language,
  // exactly like an editor without language support.
  const LANGUAGE_LOADERS: Record<string, () => Promise<Extension | null>> = {
    html: () => import('@codemirror/lang-html').then(m => m.html()),
    javascript: () => import('@codemirror/lang-javascript').then(m => m.javascript()),
    json: () => import('@codemirror/lang-json').then(m => m.json()),
    markdown: () => import('@codemirror/lang-markdown').then(m => m.markdown()),
    xml: () => import('@codemirror/lang-xml').then(m => m.xml()),
    yaml: () => import('@codemirror/lang-yaml').then(m => m.yaml()),
  }

  function loadEditorLanguage(documentType: string): Promise<Extension | null> {
    return LANGUAGE_LOADERS[documentType]?.() ?? Promise.resolve(null)
  }

  // Chrome colors are CSS variables when the host theme defines them (the
  // themed host keeps its palette in its stylesheet) and fall back to the
  // fixed dark values otherwise, so an unthemed host renders the same dark
  // chrome it always did. `theme` stays a plain string so this shared file
  // never imports a per-app settings module.
  function colorThemeExtensions(theme: string) {
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
          caretColor: 'var(--cm-caret, rgb(103 232 249))',
        },
        '.cm-gutters': {
          color: 'var(--cm-gutterColor, rgb(100 116 139))',
          borderRight: '1px solid var(--cm-gutterBorder, rgb(51 65 85))',
        },
        '.cm-activeLineGutter': {
          backgroundColor: 'var(--cm-activeLineGutter, rgba(22, 27, 34, 0.95))',
        },
        '.cm-activeLine': {
          backgroundColor: 'var(--cm-activeLine, rgba(48, 54, 61, 0.45))',
        },
        '.cm-cursor, .cm-dropCursor': {
          borderLeftColor: 'var(--cm-caret, rgb(103 232 249))',
        },
        '.cm-selectionBackground, ::selection': {
          backgroundColor: 'var(--cm-selection, rgba(56, 139, 253, 0.35))',
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

  let editorContainerRef = $state<HTMLDivElement | null>(null)
  let editorView = $state<EditorView | null>(null)
  let lastEditable = false
  let lastSelectionEnabled = true
  let lastTheme = 'dark'
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

  // Large pastes through the browser's native contenteditable path force
  // CodeMirror to reverse-engineer the change from DOM mutations (seconds
  // for hundreds of KB). Applying the plain-text clipboard payload as a
  // single transaction reaches the same document state without that pass.
  function pasteExtension() {
    return EditorView.domEventHandlers({
      paste(event, view) {
        // While playback locks the editor the DOM is not editable, so a
        // paste event cannot arrive; refuse defensively to match that.
        if (!editable) {
          return false
        }
        const text = event.clipboardData?.getData('text/plain') ?? ''
        if (text.length === 0) {
          return false
        }
        event.preventDefault()
        view.dispatch(view.state.replaceSelection(text), { userEvent: 'input.paste', scrollIntoView: true })
        return true
      },
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

  function createEditorExtensions(languageExtensions: Extension[] = []): Extension[] {
    return [
      colorThemeCompartment.of(colorThemeExtensions(theme)),
      editableCompartment.of(EditorView.editable.of(editable)),
      selectionGuardCompartment.of(selectionGuardExtension(selectionEnabled)),
      selectionAttrCompartment.of(selectionAttrExtension(selectionEnabled)),
      pasteExtension(),
      ...languageExtensions,
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
      maxContentLengthFilter(maxContentLength),
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
    ]
  }

  function syncEditorDocument(nextContent: string) {
    if (!editorView) return
    const current = editorView.state.doc.toString()
    if (current === nextContent) return
    if (onSelectionChange) {
      // The host observes selection, so a wholesale replacement invalidates
      // any selection computed against the previous document; mapping it
      // instead would leak the old highlight into the new document as a
      // phantom range. Collapse to the start of the incoming text explicitly.
      editorView.dispatch({
        changes: { from: 0, to: current.length, insert: nextContent },
        selection: EditorSelection.cursor(0),
      })
      return
    }
    editorView.dispatch({
      changes: { from: 0, to: current.length, insert: nextContent },
      filter: false,
    })
  }

  $effect(() => {
    void recreateKey
    void docType
    let cancelled = false
    tick()
      .then(async () => {
        if (cancelled || !editorContainerRef) {
          editorView?.destroy()
          editorView = null
          return
        }
        const languageExtension = await loadEditorLanguage(docType)
        if (cancelled) {
          return
        }
        const languageExtensions = languageExtension ? [languageExtension] : []
        editorView?.destroy()
        editorView = new EditorView({
          state: EditorState.create({
            doc: content,
            extensions: createEditorExtensions(languageExtensions),
          }),
          parent: editorContainerRef,
        })
        lastEditable = editable
        lastSelectionEnabled = selectionEnabled
        lastTheme = theme
        if (autoFocus) {
          editorView.focus()
          onAutoFocused?.()
        }
        // Notify parent that the EditorView is ready so pending selections can be applied
        onReady?.()
      })
      .catch(error => {
        if (!cancelled) {
          console.error('Failed to load editor language support', error)
        }
      })
    return () => {
      cancelled = true
    }
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
    editorView.focus()
    const sel = EditorSelection.create([EditorSelection.range(from, to)])
    editorView.dispatch({ selection: sel, scrollIntoView: true })
    return true
  }

  export function clearSelection() {
    if (!editorView) return
    const pos = editorView.state.selection.main.anchor
    const sel = EditorSelection.create([EditorSelection.range(pos, pos)])
    editorView.dispatch({ selection: sel })
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

  $effect(() => {
    if (!editorView) return
    void content
    syncEditorDocument(content)
  })

  $effect(() => {
    return () => {
      editorView?.destroy()
      editorView = null
    }
  })
</script>

<div class={containerClass}>
  <div
    bind:this={editorContainerRef}
    role="textbox"
    aria-label={editorAriaLabel}
    class={editorClass}></div>
</div>
