export interface EdgeBoundaryEvent {
  type: 'WordBoundary' | 'SentenceBoundary'
  offset: number
  duration?: number
  text: string
}

export function parseEdgeMetadata(message: string): EdgeBoundaryEvent[] {
  const separator = message.indexOf('\r\n\r\n')
  const jsonPart = separator >= 0 ? message.slice(separator + 4) : message
  let data: {
    Metadata?: {
      Type?: string
      Data?: { Offset?: number; Duration?: number; text?: { Text?: string } }
    }[]
  }
  try {
    data = JSON.parse(jsonPart)
  } catch {
    return []
  }
  if (!Array.isArray(data?.Metadata)) return []
  const events: EdgeBoundaryEvent[] = []
  for (const item of data.Metadata) {
    const type = item?.Type
    const offset = Number(item?.Data?.Offset)
    const duration = Number(item?.Data?.Duration)
    const text = item?.Data?.text?.Text ?? ''
    if ((type === 'WordBoundary' || type === 'SentenceBoundary') && Number.isFinite(offset)) {
      events.push({
        type,
        offset,
        duration: Number.isFinite(duration) ? duration : undefined,
        text,
      })
    }
  }
  return events
}
