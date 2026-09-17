import { EditorSelection, EditorState, type Extension } from '@codemirror/state'

export function maxContentLengthFilter(maxContentLength: number): Extension {
  return EditorState.transactionFilter.of(tr => {
    if (!tr.docChanged || maxContentLength <= 0 || tr.newDoc.length <= maxContentLength) {
      return tr
    }
    const insert = tr.newDoc.toString().slice(0, maxContentLength)
    return [
      tr,
      {
        sequential: true,
        changes: { from: 0, to: tr.newDoc.length, insert },
        selection: EditorSelection.single(maxContentLength),
        scrollIntoView: true,
      },
    ]
  })
}
